
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
  txs: string[]
  previous_block: string
  height: number
  timestamp: number 
  block_size: number
  /* Block Hash */
  indep_hash: string 
}

/**
 * tags.txId = null                         - if we haven't got the tags
 * tags.txId = { tag: value, tag: value }   - if we have the tags.
 */
export type BlockTxTags = Record<string, null | Record<string, string>>

export interface SyncedBlock {
  info: RawBlock
  tags: BlockTxTags
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
