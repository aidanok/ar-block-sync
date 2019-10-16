import { Observable, Observer } from "rxjs";
import { shareReplay } from "rxjs/operators";
import { BlocksDatabase } from "./block-db";
import { iterateWithBackoff } from "./block-sync";
import { randomDelayBetween } from "./utils";
import { BlockWatcherOptions, SyncResult } from "./types";
import debug from "debug";


/**
 * Observable that will allow multiple subscribers and replay 
 * the last value to them when they subscribe. Generally you 
 * should use this. 
 * 
 * @param opts 
 */
export function arBlocks(opts?: Partial<BlockWatcherOptions>): Observable<SyncResult> {
  return blocksObs(opts).pipe(
    shareReplay(1)
  );
}

/**
 * The single source Observable.
 * 
 * @param opts 
 */
export function blocksObs(opts?: Partial<BlockWatcherOptions>): Observable<SyncResult> {
  const options: BlockWatcherOptions = 
  
  Object.assign({
    minPollTime: 65,
    maxPollTime: 150,
    blocksToSync: 20,
    startupDelay: 120,
    persist: false,
    retrieveTags: false,
  }, opts);

  const log = debug('ar-blocks:main');

  return Observable.create((observer: Observer<SyncResult>) => {
    let isShuttingDown = false; 
    let firstIteration = true;
    
    const db = new BlocksDatabase('.db.ar-blocks', options.persist);
    
    async function start() {
      
      await new Promise(res => setTimeout(res, options.startupDelay * 1000));
      
      let blocks = await db.allBlocks();
      
      log(`loaded blocks: ${blocks.map(x => x.info.height).join(',')}`);

      // Initialization.
      const dbCount = blocks.length;
      if (dbCount > 0 && dbCount < options.blocksToSync) {
        // we increased the amount of blocks to sync since 
        // last time the db was used. For simplicity, 
        // just clear the DB entirely.
        log(`blocksToSync increased, clearing Db to start fresh`);
        await db.clearDb();
        blocks = [];
      }

      // Loop
      while (!isShuttingDown) {
        
        const result = await iterateWithBackoff(blocks, options);
        
        // Not sure if needed, but the above await can potentially 
        // take a very long time, so if we have been told to shutdown
        // while it completes we may aswell not do anymore work.
        // In fact, the above await may never return... if network
        // is down it will retry forever.. ! perhaps it should 
        // have a limit on retries.
        if (isShuttingDown) {
          return; 
        }

        if (result.synced > 0 || firstIteration) {
          observer.next(result);  
        }

        firstIteration = false;
        blocks = result.list;
      
        log(`synced blocks: ${blocks.map(x => x.info.height).join(',')}`);

        const bottomHeight = blocks[0].info.height;
        if (options.persist) {
          
          // hmm should we await? doesn't really matter.
          db.updateMultipleBlocks(blocks)
          .then(_ => {
            log(`persisted ${blocks.length} blocks, trimming past ${bottomHeight}`);
            db.trimPastHeight(bottomHeight);
          })
          .catch(er => {
            console.error(er); // ? 
            log(`Got error persisting DB!`);
            })
        }

        await randomDelayBetween(options.minPollTime, options.maxPollTime);
      }
    }

    start()
    .then(_ => observer.complete())
    .catch(er => {
      console.error(er);
      console.error('Unexpected error, please fix.');
    })

    // return a dispose() function.
    return () => isShuttingDown = true; 

  })
  
}