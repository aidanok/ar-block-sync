import { RawBlock } from './types';
import { decodeTag, tagsArrayToObject, DecodedTag } from './arweave';
import 'cross-fetch/polyfill';

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
export async function getTagsForTx(txId: string): Promise<DecodedTag[]> {
  const resp = await fetch(`https://arweave.net/tx/${txId}/tags`).then(resp => resp.json());
  if (Array.isArray(resp)) {
    return resp.map(decodeTag);
  }
  console.warn(`Recevied non array trying to get tags for ${txId}`, resp);
  throw new Error(`Recevied non array trying to get tags for ${txId}: ${resp}`);
}


/**
 * Gets tags for a tx via the GraphQL endpoint. 
 * 
 * This is not currently used. GraphQl used to return 
 * more tags (from, quantity, reward, etc) but currently it 
 * provides no advantage over the /tags endpoint when retrieving
 * for a single Tx. 
 * 
 * GraphQL *does* allow us to batch get tags for multiple TXs in 
 * one request, (by using multiple top level named queries) but
 * this function does not do that.
 * 
 * @param id 
 */
export async function getTagsForTxGraphQl(id: string) {
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
