import { SyncedBlock, SyncResult, BlockWatcherOptions, RawBlock, BlockTransaction } from './types';
import { getBlockAtHeight, range, getTagsForTx } from './utils';
import { retryWithBackoff, batch, batchWithProgress, BatchJob } from 'promises-tho';
import { DecodedTag } from './arweave';

import debug from 'debug';

// This method of import means the browsers native fetch() method WILL be used. 
// The other method of import cross-fetch provides ends up using Xhr in the browser. 
import 'cross-fetch/polyfill';

// Configure some functions we will use later. The retries are quite
// often used with these due to block propogation. With a setting of 7 tries
// we will try 7 times over around 2-3 minutes before failing.  

// network op wrapped with backoff
const getBlock = retryWithBackoff({ tries: 7 }, getBlockAtHeight);

// network op wrapped with backoff.
const getTxTags = retryWithBackoff({ tries: 7 }, getTagsForTx);

// TODO: move somewhere else. 
const graphQlTags = async (id: string) => {
  const qlQuery = `query {
    transaction(id: "${id}") {
      id,
      tags {
        name,
        value
      }
    }
  }`
  const resp = await fetch(`https://arweave.net/arql`,{ method: 'POST', body: JSON.stringify({ query: qlQuery }) })
  const data = await resp.json()
  if (data.data.transaction.id !== id || !Array.isArray(data.data.transaction.tags)) {
    console.error(data);
    throw new Error(`Unexpected response: ${JSON.stringify(data)}`);
  }
  return data.data.transaction.tags as DecodedTag[];
}

// Un-used atm, TODO: provide user option to use graphql or arql to retrieve tags.
const getTxTagsGraphQl = retryWithBackoff({ tries: 3, pow: 5 }, graphQlTags);

// update the WatchedBlock with the result of a tags retrieval 
// throw if we cant retrieve tags. 
const updateTxTags = ({ b, tx }: { b: SyncedBlock, tx: string }) => {
  return getTxTags(tx)
  .then(tags => {
    const blockTx = b.transactions.find(t => t.id === tx);
    if (!blockTx) {
      throw new Error(`Block doesnt contain tx ${tx}. This is a bug, please fix.`)
    }
    blockTx.tags = tags; 
  })
}

// Wrapped versions that execute in batches to not tie up all network connections
// while retrieving multiple items at once. 

const getBlocksBatch = batchWithProgress({ batchSize: 4, batchDelayMs: 150 }, getBlock);

const updateTxTagsBatch = batch({ batchSize: 4, batchDelayMs: 150 }, updateTxTags);

const log = debug('ar-block-sync:sync');
 
/**
 * Checks a list of blocks for consistency by comparing previous_block to indep_hash
 * Throws if check fails.
 * 
 * @param blocks 
 */
export function consistencyCheck(blocks: SyncedBlock[]): void {
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i].info.previous_block !== blocks[i-1].info.indep_hash) {
      throw new Error(`Consitency check failed: Block ${blocks[i-1].info.height} -> ${blocks[i].info.height}`);
    }
  }
}

/**
 * Run a single sync iteration.
 *  
 * @param inBlocks a list of the current blocks we have, must be sorted by height, low->high.  
 * @param options the sync options.
 */
export async function syncIteration(inBlocks: SyncedBlock[], options: BlockWatcherOptions): Promise<SyncResult> {
     
  log(`syncIteration starting`);
 
  const findInBlocks = (height: number) => inBlocks.find(x => x.info.height === height);
 
  const netInfo = await fetch('https://arweave.net/info').then(resp => resp.json());
  const ourTop = inBlocks[inBlocks.length-1];
  const ourHeight = ourTop ? ourTop.info.height : 0;
  const ourHash = ourTop ? ourTop.info.indep_hash : '';
 
  // Few possible cases: 
  // ourHeight > netInfo.height  - network is reporting lower height than we have.  
  // ourHeight === netInfo.height && netInfo.current === ourHash - everything is normal. 
  // ourHeight === netInfo.height && netInfo.current !== ourHash - top block has changed, re-org
  // ourHeight < netInfo.height - network has new blocks, might be a re-org in them. 

  // To simplify our life, we ignore every case except when the network is reporting 
  // a higher height than we have.

  let count = 0;
  
  if (ourHeight > netInfo.height) {
    log(`Network is reporting lower height: ${netInfo.height} than we have: ${ourHeight}`);
    return {
      list: inBlocks,
      synced: 0,
      missed: false,
      reorg: false,
      discarded: [],
    };
  }

  if (ourHeight === netInfo.height && netInfo.current === ourHash) {
    log(`Top is synced at ${netInfo.height}. Nothing to do.`);
    return {
      list: inBlocks,
      synced: 0,
      missed: false,
      reorg: false,
      discarded: [],
    }; 
  }

  if (ourHeight === netInfo.height && netInfo.current !== ourHash) {
    // We could do some work in this case, but lets just wait it out.
    log(`Network is reporting different top hash ${netInfo.current} than we have: ${ourHash}`);
    return {
      list: inBlocks,
      synced: 0,
      missed: false,
      reorg: false,
      discarded: [],
    }; 
  }

  if (ourHeight < netInfo.height && netInfo.current !== ourHash) {
    // We have some work to do, find out how many blocks we need to 
    // catch up on.
    count = Math.min(netInfo.height - ourHeight, options.blocksToSync)
  }

  if (count < 1) {
    throw new Error('Programmer is dumb');
  }

  // the oldest height we are interested in.
  const oldestHeight = netInfo.height - options.blocksToSync;

  // the blocks we know we need to retrieve, we may need to 
  // retrieve more if there was a re-org.
  const blockHeights = range(netInfo.height-count+1, count);

  let job: BatchJob<number, RawBlock> = {
    pending: blockHeights,
    completed: [] as RawBlock[],
    batched: 0,
  }

  while (job.pending.length) {
    job = await getBlocksBatch(job);
    // TODO: we can start retrieving tags already here if we wish.
  }

  const receviedRawBlocks = job.completed;

  // At this point, we expect blocks[0] to have a prev_block with the same 
  // hash as our top hash, (as long as the heights match and we haven't done a complete
  // new sync)

  // If its doesn't, there has been a re-org, and we will walk back the block list 
  // to find the exact point where it happened.
  
  let detectedReorg = false;

  if (receviedRawBlocks[0].height === ourHeight + 1 && receviedRawBlocks[0].previous_block !== ourHash) {
    detectedReorg = true;
    log(`** Detected Re-org **`);
    receviedRawBlocks.forEach(b => {
      log(`Height: ${b.height}, Hash: ${b.indep_hash.substr(0,6)} - Prev: ${b.previous_block.substr(0, 6)}`);
    })
    log('^^ received blocks ^^');
    log(`Height: ${ourHeight}, Hash: ${ourHash.substr(0, 6)}`);
    log('^^ our top ^^');
  }
  
  // Vars we need for sorting out re-org, wont be used in 
  // most cases. 
  // We just walk back one block at a time. 
    
  let fixingReorg = detectedReorg;
  let discarded = [] as SyncedBlock[];
  let height = receviedRawBlocks[0].height - 1;
  
  while (fixingReorg && height > oldestHeight) {
    
    log(`Fixing re-org, height: ${height}`);
    const [ourPrev, blockAtHeight] = await Promise.all([
      findInBlocks(height), // not async anymore 
      getBlock(height),
    ]);
    log (`Fixing re-org: ourPrev: ${ourPrev && ourPrev.info.height}, Hash: ${ourPrev && ourPrev.info.indep_hash.substr(0, 4)}, Prev: ${ourPrev && ourPrev.info.previous_block.substr(0, 4)}`);
    log (`Fixing re-org: newBlock: ${blockAtHeight.height}, Hash: ${blockAtHeight.indep_hash.substr(0, 4)}, Prev: ${blockAtHeight.previous_block.substr(0, 4)}`);
    
    // received blocks sorted low->high so insert at start of array.
    receviedRawBlocks.unshift(blockAtHeight);
    
    if (ourPrev) {
      discarded.push(ourPrev);
    }
    
    if (!ourPrev || blockAtHeight.previous_block === ourPrev.info.previous_block) {
      fixingReorg = false;
      log(`Fixing re-org finished, height: ${height}, ourPrev?: ${!!ourPrev}`);
    }
    else {
      height--;
    }

  }

  // Re-org checking finished.

  // All the new blocks we got, including any re-org, 
  // convert to SyncedBlock, leave tags blank for now.
  const newBlocks = receviedRawBlocks.map(x => ({
      transactions: x.txs.map(id => ({ id, tags: null }) ), 
      info: x
    })
  );


  if (inBlocks.length) {
    log(`Prev blocks: ${inBlocks[0].info.height} -> ${inBlocks[inBlocks.length-1].info.height} (${inBlocks.length})`)
  }
  if (newBlocks.length) {
    log(`New blocks: ${newBlocks[0].info.height} -> ${newBlocks[newBlocks.length-1].info.height} (${newBlocks.length})`);
  }
  if (discarded.length) {
    log(`Discarded blocks: ${discarded[0].info.height} -> ${discarded[discarded.length-1].info.height} (${discarded.length})`);
  }

  // get rid of discard blocks from the end of inBlocks, concat newBlocks, and trim to 
  // max size.
  
  const outBlocks = (
    inBlocks
    .slice(0, inBlocks.length - discarded.length)
    .concat(newBlocks)
  ).slice(-options.blocksToSync);

  log(`Final blocks: ${outBlocks[0].info.height} -> ${outBlocks[outBlocks.length-1].info.height} (${outBlocks.length})`);

  if (options.retrieveTags) {
    log(`Retrieving TX tags`);
    const txBatch = [] as { b: SyncedBlock, tx: string}[];
    for (const b of outBlocks) {
      for (const tx of b.transactions) {
        if (!tx.tags) {
          txBatch.push({ b, tx: tx.id });
        }
      }
    }
    log(`Retrieving tags for ${txBatch.length} TXs in total`);
    await updateTxTagsBatch(txBatch);
  }

  // did we miss any blocks?
  const missed = newBlocks[newBlocks.length-1].info.height < ourHeight;

  const syncResult: SyncResult = {
    synced: newBlocks.length,
    reorg: detectedReorg,
    list: outBlocks,
    missed, 
    discarded
  }

  return syncResult;
}