import { Observable, Observer } from "rxjs";
import { shareReplay } from "rxjs/operators";
import { BlocksDatabase } from "./block-db";
import { syncIteration, consistencyCheck } from "./block-sync";
import { randomDelayBetween } from "./utils";
import { BlockWatcherOptions, SyncResult } from "./types";

import debug from "debug";


/**
 * Observable that can be shared between multiple subscribers and 
 * replays the last value to them when they subscribe. 
 * 
 * You should use this over the direct source observable.
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
 * runs a syncIteration, and persists the blocks back. 
 * 
 * Its written as an RxJs Observable to take advantage of RxJs subscriber, sharing, replay 
 * functionalities, Observable is also becoming a tc39 standard. Consumers dont have to nessecarily
 * know or use RxJs to use. See console-test2.ts for example usage.
 * 
 * TODO: support syncing higher counts of blocks by: 
 *    - not nessecarily loading the entire block list, or passing the entire block list to syncIteration. 
 *    - only persisting back new blocks to avoid serialization, currently we just persist back the entire list
 *      for simplicity.
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

      // If we are in production we can just clear the db, otherwise
      // halt. 
      try {
        consistencyCheck(blocks);
      } catch (e) {
        console.error(`consistency check failed`)
        await db.debugDump();
        if (process.env.NODE_ENV == 'production') {
          console.error(`Clearing DB due to consistency problems. This is a bug that should be fixed`);
          await db.clearDb();
          blocks = [];
        }
        else {
          throw(e);
        }
      }

      // Main loop
      while (!isShuttingDown) {
        
        let result: SyncResult;

        try { 
          result = await syncIteration(blocks, options);
        } catch (e) {
          // This can be normal enough. we might want to wrap syncIteration 
          // with a backoff, but we are already waiting between iterations anyway.
          console.warn(e);
          console.warn(`Caught error during sync iteration, will try again`);
          // delay and continue while() loop.
          await randomDelayBetween(options.minPollTime, options.maxPollTime);
          continue;
        }

        // If we've been told to shutdown, dont do any more work. 

        if (isShuttingDown) {
          return; 
        }

        try {
          consistencyCheck(blocks);
        } catch (e) {
          console.error(`consistency check failed`)
          await db.debugDump();
          // we could.., clear db and recover here same as above, only in production mode..
          // honestly, consitencyCheck should never fail, it just indicates bug in syncIteration.
          throw(e);
        }
        

        observer.next(result);

        firstIteration = false;
        blocks = result.list;
        
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