import { DecodedTag } from "./arweave";

/**
 * These are the options the 'main' loop uses.
 * 
 */
export interface BlockWatcherOptions {
  minPollTime: number 
  maxPollTime: number
  blocksToSync: number
  startupDelay: number
  persist: boolean
  retrieveTags: boolean 
}

/**
 * These are the options the syncIteration uses.
 */
export interface SyncOptions {
  blocksToSync: boolean 
  retrieveTags: boolean
}

// Partial typing of the raw block format from the /blocks endpoint.
export interface RawBlock {
  nonce: string 
  hash: string 
  txs: string[]
  height: number
  
  /**
   * Timestamp, unix seconds
   */
  timestamp: number 
  
  /**
   * Timestamp, unix seconds
   */
  last_retarget: number 
  
  /* Block Hash thats referenced by previous_block */  
  indep_hash: string 
  
  /* indep_hash of previous block */
  previous_block: string
  
  reward_addr: string
  reward_pool: number 
  block_size: number
  weave_size: number
}

/**
 * BlockTransaction aligns with the GraphQL schema for a transaction. 
 * 
 * tags = null                                  - if we haven't got the tags
 * tags = [{ name: string, value: string }, ... ]    - if we have the tags.
 */

export interface BlockTransaction {
  id: string,
  tags: DecodedTag[] | null
}

/**
 * An individual block we have synced. 
 */
export interface SyncedBlock {
  info: RawBlock
  transactions: BlockTransaction[]
}


/**
 * The result of a sync iteration. 
 */
export interface SyncResult {
  
  /**
   * The number of new blocks we have synced in this iteration, these will be the last N blocks in `list`
   */
  synced: number,

  /**
   * The entire list of blocks we have synced. You should not mutate this array or data. 
   */
  list: SyncedBlock[],

  /**
   * If we missed any blocks since we last synced, this will be true when we first start or 
   * when we have lost connectivity for long enough to miss blocks. 
   */
  missed: boolean,

  /**
   * If we saw a re-org in the last sync iteration, implies discard.length > 0 
   */
  reorg: boolean,
  
  /**
   * A list of the blocks that were discarded due to a re-org in the last iteration.
   */
  discarded: SyncedBlock[]
}
