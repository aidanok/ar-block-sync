import { SyncedBlock, SyncResult, BlockWatcherOptions, RawBlock, BlockTxTags } from './types';
import { getBlockAtHeight, range, getTagsForTx } from './utils';
import { batch, batchWithProgress, BatchJob } from 'promises-tho';
import { retryWithBackoff } from 'promises-tho';

import debug from 'debug';
import fetch from 'cross-fetch';

// Configure some functions we will use later. The retries are quite
// often used with these due to block propogation. With a setting of 7 tries
// we will try 7 times over around 2-3 minutes before failing.  

// network op wrapped with backoff
const getBlock = retryWithBackoff({ tries: 7 }, getBlockAtHeight);

// network op wrapped with backoff.
const getTxTags = retryWithBackoff({ tries: 7 }, getTagsForTx);

// update the WatchedBlock with the result of a tags retrieval 
// throw if we cant retrieve tags. 
const updateTxTags = ({ b, tx }: { b: SyncedBlock, tx: string }) => {
  return getTxTags(tx)
  .then(tags => { b.tags[tx] = tags })
}

// Wrapped versions that execute in batches to not tie up all network connections
// while retrieving multiple items at once. 

const getBlocksBatch = batchWithProgress({ batchSize: 4, batchDelayMs: 250 }, getBlock);

const updateTxTagsBatch = batch({ batchSize: 2, batchDelayMs: 350 }, updateTxTags);

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
 * A version of iterate() that has backoff to 5 minutes on errors but never gives up. 
 * Probably this should give up so main() can handle shutdown gracefully.
 */
export const iterateWithBackoff = retryWithBackoff({ tries: Number.POSITIVE_INFINITY, startMs: 300, pow: 4 }, syncIteration);

/**
 * Run a single sync iteration.
 *  
 * @param inBlocks a list of the current blocks we have, must be sorted by height, low->high.  
 * @param options the sync options.
 */
export async function syncIteration(inBlocks: SyncedBlock[], options: BlockWatcherOptions): Promise<SyncResult> {
     
  log(`Polling`);
 
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
  // more if there was a re-org.
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
    receviedRawBlocks.slice().reverse().forEach(b => {
      log(`Height: ${b.height}, Hash: ${b.indep_hash.substr(0,6)} - Prev: ${b.previous_block.substr(0, 6)}`);
    })
    log('^^ received blocks^^');
    log(`Height: ${ourHeight}, Hash: ${ourHash.substr(0, 6)}`);
    log('^^ our top ^^');
  }
  
  // Vars we need for sorting out re-org, wont be used in 
  // most cases. We just walk back one block at a time. 
    
  let fixingReorg = detectedReorg;
  let discarded = [] as SyncedBlock[];
  let height = receviedRawBlocks[0].height - 1;
  
  while (fixingReorg && height > oldestHeight) {
    
    
    const [ourPrev, blockAtHeight] = await Promise.all([
      findInBlocks(height), // not async anymore 
      getBlock(height),
    ]);

    receviedRawBlocks.unshift(blockAtHeight);
    
    if (ourPrev) {
      discarded.push(ourPrev);
    }
    
    if (!ourPrev || blockAtHeight.previous_block === ourPrev.info.previous_block) {
      fixingReorg = false;
    }
    else {
      height--;
    }
  }

  // Re-org checking finished.

  // All the new blocks we go, including any re-org.
  const newBlocks = receviedRawBlocks.map(x => ({tags: {} as BlockTxTags, info: x }));

  // set tags to 'null' to indicate they haven't been retrieved. 
  for (const b of newBlocks) {
    for (const txId of b.info.txs) {
      b.tags[txId] = null;
    }
  }

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
    .slice(-discarded.length)
    .concat(newBlocks)
  ).slice(-options.blocksToSync);

  log(`Final blocks: ${outBlocks[0].info.height} -> ${outBlocks[outBlocks.length-1].info.height} (${outBlocks.length})`);

  if (options.retrieveTags) {
    log(`Retrieving TX tags`);
    const txBatch = [] as { b: SyncedBlock, tx: string}[];
    for (const b of outBlocks) {
      for (const tx of b.info.txs) {
        if (!b.tags[tx]) {
          txBatch.push({ b, tx });
        }
      }
    }
    log(`Retrieving tags for ${txBatch.length} TXs in total`);
    await updateTxTagsBatch(txBatch);
  }

  const syncResult: SyncResult = {
    synced: newBlocks.length,
    reorg: detectedReorg,
    missed: newBlocks.length === outBlocks.length, 
    list: outBlocks,
    discarded
  }

  return syncResult;
}




