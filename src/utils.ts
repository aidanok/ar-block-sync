import { RawBlock } from './types';
import { decodeTag, tagsArrayToObject } from './arweave';
import fetch from 'cross-fetch';

/**
 * 
 * Get the raw block json from blocks endpoint.
 * Checks the block is in the format we expect 
 * and throws otherwise.
 * 
 * @param height
 */
export async function getBlockAtHeight(height: number): Promise<RawBlock> { 
  const block  = await fetch(`https://arweave.net/block/height/${height}`).then(x => x.json());
  
  if (typeof block === 'object' && block && block.height && block.indep_hash) {
    return block;
  } else {
    console.warn(`Received invalid block from node`, block);
    throw new Error(`Recevied invalid block from node :${block}`);
  }
}

/**
 * 
 * Get the raw block json from blocks endpoint.
 * Checks the block is in the format we expect
 * and throws otherwise
 * 
 * @param height
 */
export async function getBlockByHash(hash: string): Promise<RawBlock> { 
  const block  = await fetch(`https://arweave.net/block/hash/${hash}`).then(x => x.json());
  if (typeof block === 'object' && block && block.height && block.indep_hash === hash) {
    return block;
  } else{
    console.warn(`Received invalid block from node`, block);
    throw new Error(`Recevied invalid block from node: ${block}`);
  }
}


/**
 * Get the decoded tags for a TX in object format. 
 * 
 * Throws if we get a non-array response from the server.
 * 
 * @param txId
 */
export async function getTagsForTx(txId: string): Promise<Record<string, string>> {
  const resp = await fetch(`https://arweave.net/tx/${txId}/tags`).then(resp => resp.json());
  if (Array.isArray(resp)) {
    return tagsArrayToObject(resp.map(decodeTag));
  }
  console.warn(`Recevied non array trying to get tags for ${txId}`, resp);
  throw new Error(`Recevied non array trying to get tags for ${txId}: ${resp}`);
}

/**
 * Wait a random period of time between min and max seconds. 
 * 
 * @param minSeconds 
 * @param maxSeconds 
 */
export const randomDelayBetween = (minSeconds: number, maxSeconds: number) => {
  const ms = (Math.random() * ((maxSeconds - minSeconds)*1000)) + minSeconds*1000;
  return new Promise(res => setTimeout(res, ms));
}

/**
 * Generates an array of numbers
 * 
 * @param start 
 * @param count 
 */
export const range = (start: number, count: number) => {
  return Array(count).fill(undefined).map((_, idx) => start + idx)
}
