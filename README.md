

A block syncing library for arweave that persists synced blocks and resumes syncing when starting again.

- Synchronize N last blocks & tags from the arweave blockchain
- Persists synced blocks to indexdb (browser) or a leveldb store (node) using levelup
- Detects and handles re-orgs/forks 
- Handles block propogation delays. 

This can be used for various things: 

- For dapps that want to confirm when their txs are mined, especially if they can post many inbetween
  blocks, this may be better than checking/polling for each tx individually.
- For keeping tracking of how many confirmations a data tx or transfer has.
- For watching new content posted on the arweave blockchain
- Writing discord/telegram/twitter etc bots that post content from arweave.
- For syncing a server side DB of blocks without running a full node 
- For indexing the last couple of hours data for tx and tags locally for quick searching. 
- For invalidating a client-side cache of graphl/arql query results (no new blocks, no new results)
- Other? 




Currently, its suited for syncing block counts in 10-150 ish range, with a bit of adjustment it would work for much higher counts. 

It ships with 'polite' network settings, it will poll every 100-200 seconds and if tx tag retrieval is
enabled (defaults to off) it will retrieve them without using a lot of network resources. Important if 
you are using it from a browser dapp, but also just so we don't hammer nodes/gateway with lots of concurrent requests.

If you would like to use this, you'll need to figure out how it fits your use-case, still version 0.1.0, but you can start by checking:

[src/console-test2.ts](src/console-test2.ts), [src/types.ts](src/types.ts), [src/observable.ts](src/observable.ts)

API is unlikely to change much. 

Currently this only published on the arweave blockchain: 

`npm install https://e5hareckrltt.arweave.net/f-8pqMhEMM1v8BlhN81yazG_P7og_Yfzv1lAeE27B1o`


Uses https://www.npmjs.com/package/debug for debug logging and https://www.npmjs.com/package/promises-tho 
for retries and batching network requests. 

Enable `ar-block-sync:*` in your environment to see debug logs, or `ar-block-sync:*,promises-tho:*` if you want to see retries and batch retrieval logs aswell.

Sample output of some logs where we see a new height but it takes some time to get propogated to all nodes: [block-propogation-delay-handling.md](block-propogation-delay-handling.md)

Most of the time you don't see this, but in this instance we learn of a new height before a) the block is propogated to all nodes, b) the tx tags are propogated to all nodes. This results in a few retries getting the new block data and a few more retries getting all the TX tags. If it had of exhausted retries (after about another 30-60 seconds), the sync iteration would have been aborted and tried again a minute or two later. 


As a consumer of this library, you wont see any of this, you can subscribe, and receive a` SyncResult` object which will have a list of synced blocks, their tags (if tag retrieval is enabled) and any information about blocks discarded due to a re-org.


