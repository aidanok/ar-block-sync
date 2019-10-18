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
 * tags.txId = null                         - if we haven't got the tags
 * tags.txId = { tag: value, tag: value }   - if we have the tags.
 */

export interface BlockTransaction {
  id: string,
  tags: DecodedTag[] | null
}

export interface SyncedBlock {
  info: RawBlock
  transactions: BlockTransaction[]
}

export interface BlockWatcherSubscriber {
  (sync: SyncResult): void
}

export interface SubscriberOptions {
  tags?: (tags: Record<string, string>) => boolean
}

export interface SyncResult {
  synced: number,
  list: SyncedBlock[],
  missed: boolean,
  reorg: boolean,
  discarded: SyncedBlock[]
}
