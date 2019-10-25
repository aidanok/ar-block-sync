
import { levelDb, Db } from './db';
import { SyncedBlock } from './types';

/**
 * Class to provide a persistent database of blocks.
 * 
 * Uses leveldb internally, as it seems the most practical option
 * that works in both the browser and node. It has a pretty wierd 
 * interface though with nodejs style readable streams, we translate 
 * these to promise based api where approriate. 
 * 
 * This class doesn't do a whole lot, except provide an interface to save/load
 * 'blocks' indexed by height and abstract the storage mechanism. One thing
 * we have to do for storing blocks sorted correctly is convert height numbers
 * to strings padded with leading zeros as leveldb sorts lexographically.
 */

export class BlocksDatabase {
  
  
  private isOpen = false; 
  private initPromise: Promise<Db>

  constructor(
    private dbName = '.db.ar-block-db',
    private perist = true,
  ) {
    this.initPromise = levelDb(dbName, perist)
  }



  /**
   * Returns all blocks, ordered by block height, low->high
   */
  public async allBlocks(): Promise<SyncedBlock[]> {
    const db = await this.initPromise;

    return new Promise((res, rej) => {
      const blocks = [] as SyncedBlock[];
      db.createReadStream({ keyAsBuffer: false, valueAsBuffer: false, reverse: false })
        .on('data', data => {
          if (data.key && data.value) {
            const height: number = parseInt(data.key, 10);
            const block = JSON.parse(data.value);
            blocks.push(block);
          }
        })
        .on('close', () => res(blocks))
        .on('error', (e) => rej(e));
    })
  }

  /**
   * Return the current top height in the block database.
   * Returns undefined if we have no blocks.
   */
  public async findTopBlock(): Promise<SyncedBlock | undefined> {
    const db = await this.initPromise;
    return new Promise((res, rej) => {
      let height: number | undefined;
      let block: SyncedBlock | undefined;
      db.createReadStream({ limit: 1, keyAsBuffer: false, valueAsBuffer: false, reverse: true })
        .on('data', (data: any) => {
          height = parseInt(data.key, 10);
          block = JSON.parse(data.value);
        })
        .on('close', () => {
          if (typeof height === 'number' && block) {
            res(block);
          }
          else {
            res(undefined);
          }
        })
        .on('error', (e) => rej(e))
    })
  }

  /**
   * Inserts or updates a block.
   * 
   * @param height 
   * @param block 
   */
  public async updateBlock(height: number, block: SyncedBlock): Promise<void> {
    const db = await this.initPromise;

    if (!block.info.indep_hash || typeof block.info.height !== 'number') {
      console.error(block);
      throw new Error('Invalid block');
    }
    const key = stringifyNumber(block.info.height);
    return db.put(key, JSON.stringify(block));
  }

  /**
   * Inserts/updates multiple blocks in a batch operation.
   *  
   * Accepts blocks in any order or in a sparse arrray,
   * since it will use the blocks own reported height 
   * as a key rather than anything to do with the array index.
   * 
   * @param blocks 
   */
  public async updateMultipleBlocks(blocks: SyncedBlock[]) {
    const db = await this.initPromise;
    
    const b = db.batch();

    Object.entries(blocks).forEach(([height, block]) => {
      if (!block.info.indep_hash) {
        console.error(block);
        throw new Error('Invalid block');
      }
      b.put(stringifyNumber(block.info.height), JSON.stringify(block));
    })

    return b.write();
  }

  
  /**
   * Gets a block at height.
   * Throws an error if the block does not exist in the database.
   * 
   * @param height 
   */
  public async getBlock(height: number): Promise<SyncedBlock> {
    const db = await this.initPromise;

    const key = stringifyNumber(height);
    const val: any = db.get(key)
    return JSON.parse(val);
  }

  /**
   * Tries to get a block at height
   * Returns undefined if the block does not exist in the database. 
   * Throws only on unexpected failures.
   * 
   * @param height 
   */
  public async tryGetBlock(height: number): Promise<SyncedBlock | undefined> {
    const db = await this.initPromise;
    const key = stringifyNumber(height);
    const val = await db.tryGet(key);
    if (val) {
      return JSON.parse(val);
    }
    return;
  }

  /**
   * Returns a count of all blocks in the database.
   */
  public async count(): Promise<number> {
    // prob smart to cache this or store in db itself.
    const db = await this.initPromise;

    return new Promise((res, rej) => {
      let count = 0;
      db.createReadStream({ keys: true, values: false })
      .on('data', (d) => {
        if (d !== undefined) {
          count++;
        }
      })
      .on('close', _ => res(count))
      .on('error', e=> rej(e))
    }) 
  }

  /**
   * Removes blocks that less than 'height'  
   * 
   * @param height blocks below this height will be removed from the db.
   */
  public async trimPastHeight(height: number) {
    const db = await this.initPromise;

    return new Promise((res, rej) => {
      const b = db.batch();
      db.createReadStream({ keysOnly: true, keyAsBuffer: false, lt: stringifyNumber(height) })
      .on('data', data => {
        if (data !== undefined) {
          b.del(data.key);
        }
      })
      .on('close', () => {
        res(b.write())
      })
      .on('error', (e) => rej(e));
    })
  }

  /**
   * Clears the entire database.
   */
  public async clearDb() {
    const db = await this.initPromise;

    if (typeof (db as any)['clear'] === 'function') {
      return (db as any).clear();
    } else {
      // TODO: manually iterate all keys and delete, some levelup impls 
      // may not have a clear() method.
      throw new Error('DB does not have a clear() method.');
    }
  }
  

  /**
   * Debug method to print a list of time, block hash and prev_hash to console.
   * 
   */
  public async debugDump() {
    const db = await this.initPromise;

    return new Promise((res) => {
      let i = 0;
      db.createReadStream({ reverse: true })
        .on('data', (data) => {
          if (!data.key) {
            console.log('got not key');
            return; 
          }
          const wb: SyncedBlock = JSON.parse(data.value);
          const t = ((Date.now() / 1000) - wb.info.timestamp) / 60;
          console.log(`${++i} - ${data.key} - ${t.toFixed(2)} Minutes Ago, Hash:${wb.info.indep_hash.substr(0, 5)}, Prev: ${wb.info.previous_block.substr(0, 5)}`);
        })
        .on('error', er => { throw(er) })
        .on('close', res)
      })
  };

}

/**
 * Stringify a number padding with leading zeros
 * so its sorted in leveldb (lexographic sorting) 
 * 
 * We might want to reverse the string so newest blocks
 * are sorted first if we were to be storing large numbers
 * of blocks.
 * 
 * @param x 
 */
function stringifyNumber(x: number) {
  return `00000000000000${x}`.slice(-13);
}



