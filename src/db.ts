import levelup, { LevelUp } from 'levelup';
import memdown from 'memdown';

import { AbstractIterator } from 'abstract-leveldown';

// TODO: No idea how the various bundlers will handle this.
// TODO: window check is not a robust way to detect browser or not.
let ld: any;
if (typeof window === 'undefined') {
  ld = require('leveldown');
} else {
  ld = require('level-js');
}

type TryGet =  { tryGet(key: any): Promise<any> }

type LevelDb = LevelUp<any, AbstractIterator<any, any>>

/**
 * Creates a levelup database. 
 * Returns a standard levelup interface with one 
 * additional method: tryGet(key: any): Promise<any> 
 * 
 * tryGet will return undefined if the key is not found, 
 * rather than throwing an exception.
 * 
 * @param name Name of the database.
 */
export function levelDb(name: string, persist = true): (LevelDb & TryGet) {
  const db = levelup(persist ? ld(name) : memdown());
  
  // add tryGet method, a get() that doesn't throw on key not found errors, but
  // returns undefined instead.
  (db as any).tryGet = async (key: any): Promise<any> => {
    let val: any = undefined;
    try {
      val = await db.get(key);
    } catch (e) {
      // blerg
      const m = e.message.toLowerCase();
        if (m.indexOf('not') === -1 && m.indexOf('found') === -1) {
        throw (e)
      }
    }
    return val;
  }

  return db as LevelDb & TryGet; 
}
