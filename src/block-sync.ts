import { WatchedBlock, SyncResult, BlockWatcherOptions } from './types';
import { getBlockAtHeight, range, getTagsForTx } from './utils';
import { batch, batchWithProgress, BatchJob } from 'promises-tho';
import { RawBlock } from '.';
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
const updateTxTags = ({ b, tx }: { b: WatchedBlock, tx: string }) => {
  return getTxTags(tx)
  .then(tags => { b.tags[tx] = tags })
}

// Wrapped versions that execute in batches to not tie up all network connections
// while retrieving multiple items at once. 

const getBlocksBatch = batchWithProgress({ batchSize: 4, batchDelayMs: 50 }, getBlock);

const updateTxTagsBatch = batch({ batchSize: 4, batchDelayMs: 100 }, updateTxTags);

const log = debug('ar-blocks:sync');

/**
 * A version of iterate() that has backoff to 5 minutes on errors but never gives up. 
 * Probably this should give up so main() can handle shutdown gracefully.
 */
export const iterateWithBackoff = retryWithBackoff({ tries: Number.POSITIVE_INFINITY, startMs: 300, pow: 4 }, iterate);

/**
 * Run a single sync iteration.
 *  
 * @param inBlocks a list of the current blocks we have, must be sorted by height, low->high.  
 * @param options the sync options.
 */
export async function iterate(inBlocks: WatchedBlock[], options: BlockWatcherOptions): Promise<SyncResult> {
     
  log(`Polling`);
 
  const findInBlocks = (height: number) => inBlocks.find(x => x.info.height === height);
  const findIndexInBlocks = (height: number) => inBlocks.findIndex(x => x.info.height === height);

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
    };
  }
  if (ourHeight === netInfo.height && netInfo.current === ourHash) {
    log('Top is synced, nothing to do.');
    return {
      list: inBlocks,
      synced: 0,
      missed: false,
      reorg: false,
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
  let discarded = [] as WatchedBlock[];
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

  // Re-org fixing finished.

  if (discarded.length > 0) {
    discarded.forEach(b => {
      log(`Discarded: Height: ${b.info.height}, Hash: ${b.info.indep_hash.substr(0, 5)}, Prev: ${b.info.previous_block.substr(0, 5)}`)
    })
    log(`Discarded ${discarded.length} due to re-org`)
  }

  // Watched will contain all the new blocks
  const newBlocks = receviedRawBlocks.map(x => ({tags: {}, info: x }));

  // prep array for batch get of all tags.
  const btxs = [] as { b: WatchedBlock, tx: string}[];
  Object.values(newBlocks)
    .forEach(b => { 
      b.info.txs.forEach(tx => { btxs.push({b, tx})
    })
  });
  // this will fill in all tx tags for all blocks.
  await updateTxTagsBatch(btxs);

  log(`Synced from ${newBlocks[0].info.height} to ${newBlocks[newBlocks.length-1].info.height}`);
  
  // const trimIndex = Math.max(findIndexInBlocks(newBlocks[0].info.height) - 1, 0);
  
  const outBlocks = (inBlocks.concat(newBlocks)).slice(-options.blocksToSync);

  // save to persistence.
  //await db.updateMultipleBlocks(newBlocks);
  //await db.trimPastHeight(oldestHeight+1);
  
  // get all the blocks back out of persistence, and emit to subscribers. 
  //const allBlocks = await db.allBlocks();
  
  const syncResult: SyncResult = {
    synced: newBlocks.length,
    reorg: detectedReorg,
    missed: newBlocks.length === outBlocks.length, 
    list: outBlocks,
  }

  return syncResult;
}




