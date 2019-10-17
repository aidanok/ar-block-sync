import { Observable, Observer } from "rxjs";
import { shareReplay } from "rxjs/operators";
import { BlocksDatabase } from "./block-db";
import { iterateWithBackoff, consistencyCheck } from "./block-sync";
import { randomDelayBetween } from "./utils";
import { BlockWatcherOptions, SyncResult } from "./types";

import debug from "debug";


/**
 * Observable that can be shared between multiple subscribers and 
 * replays the last value to them when they subscribe. Generally you 
 * should use this over the direct source observable.
 * 
 * @param opts 
 */
export function arBlocks(opts?: Partial<BlockWatcherOptions>): Observable<SyncResult> {
  return blocksObservable(opts).pipe(
    shareReplay(1)
  );
}

/**
 * 
 * The source Observable. This runs the 'main' loop that first loads blocks from persistence,
 * runs a syncIteration, and persists blocks back. 
 * 
 * Its written as an Observable just to take advantage of RxJs subscriber, sharing, replay 
 * functionalities. 
 * 
 * TODO: support syncing higher counts of blocks by 
 *  - only persisting new or changed blocks
 *  - not nessecarily loading the entire block list, or passing the entire block list
 *  - to syncIteration. 
 * 
 * TODO: support increasing the amount of blocks to sync without just clearing the DB. 
 *       just needs the ability to retrieve blocks starting from the bottom of the list we
 *       already have.
 * 
 * 
 * @param opts 
 */
export function blocksObservable(opts?: Partial<BlockWatcherOptions>): Observable<SyncResult> {
  const options: BlockWatcherOptions = 
  
  Object.assign({
    minPollTime: 100,
    maxPollTime: 200,
    blocksToSync: 20,
    startupDelay: 120,
    persist: true,
    retrieveTags: false,
  }, opts);

  const log = debug('ar-block-sync:main');

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

      consistencyCheck(blocks);

      // Main loop
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

        observer.next(result);

        firstIteration = false;
        blocks = result.list;
        
        consistencyCheck(blocks);
        
        if (result.synced > 0) {
          // Persist new list. 
          log(`synced blocks: ${blocks[0].info.height} -> ${blocks[blocks.length-1].info.height} (${blocks.length})`);
        
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