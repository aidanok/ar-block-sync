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

export type Db = LevelDb & TryGet; 

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
export async function levelDb(name: string, persist = true): Promise<(LevelDb & TryGet)> {
  return new Promise((res, rej) => {
    const db = levelup(persist ? ld(name) : memdown(), undefined, (er) => {
      if (er) {
        console.error(er);
        console.error('Caugh error opening Db!');
        console.log(`is In browser?: ${typeof indexedDB === 'undefined'}` )
        rej(er);
      }
      addTryGet(db);
      res(db as LevelDb & TryGet);
    });
  
    
  })
   
}


function addTryGet(db: any) {
  // add tryGet method, a get() that doesn't throw on key not found errors, but
  // returns undefined instead.
  db.tryGet = async (key: any): Promise<any> => {
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
}