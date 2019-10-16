
export interface BlockWatcherOptions {
  minPollTime: number 
  maxPollTime: number
  blocksToSync: number
  startupDelay: number
  persist: boolean
  retrieveTags: boolean 
}

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

export interface WatchedBlock {
  info: RawBlock
  tags: Record<string, null | Record<string, string>>
}

export interface BlockWatcherSubscriber {
  (sync: SyncResult): void
}

export interface SubscriberOptions {
  tags?: (tags: Record<string, string>) => boolean
}

export interface SyncResult {
  synced: number,
  list: WatchedBlock[],
  missed: boolean,
  reorg: boolean,
  discarded?: WatchedBlock[]
}
