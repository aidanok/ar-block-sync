
/*import { BlockSync } from './block-sync';

async function test() {
  new BlockSync( {startupDelay: 0, persist: true, blocksToSync: 55, minPollTime: 120, maxPollTime: 360, retrieveTags: true });
}

test();*/


import { iterateWithBackoff } from './block-sync';
import { WatchedBlock, BlockWatcherOptions } from '.';
import { inspect } from 'util';
import { randomDelayBetween } from './utils';

async function runTest() {
  const blocks: WatchedBlock[] = [];
  const options: BlockWatcherOptions = {
    minPollTime: 65,
    maxPollTime: 150,
    blocksToSync: 5, // sync option.
    startupDelay: 0,
    persist: false,
    retrieveTags: true, // sync option
  }

  let result = await iterateWithBackoff(blocks, options);
  result.list.forEach(dumpBlock);
  
  await randomDelayBetween(30, 60);
  result = await iterateWithBackoff(blocks, options);
  result.list.forEach(dumpBlock);
  
  await randomDelayBetween(30, 60);
  result = await iterateWithBackoff(blocks, options);
  result.list.forEach(dumpBlock);
    
}


function dumpBlock(b: WatchedBlock) {
  console.log(`\n-----\nBlock ${b.info.height}: ${b.info.indep_hash.substr(0, 5)}, prev: ${b.info.previous_block.substr(0, 5)}}`)
  Object.keys(b.tags).forEach(tx => {
    console.log(`--- ${tx.substr(0, 4)}`);
    Object.keys(b.tags[tx]!).forEach(tag => {
      console.log(`----- ${tag} ${b.tags[tx]![tag].substr(0, 10)}`);
    })
  })
}


runTest();
