

A very resillient block syncing library for arweave 

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
- For invalidating a client-side cache of queries
- Other? 


Currently, its suited for syncing block counts in 10-100 ish range, with a bit of adjustment
it would work for much higher counts. 

It ships with very 'polite' network settings, it will poll every 100-200 seconds and if tx tag retrieval is
enabled (defaults to off) it will retrieve them without using a lot of network resources. Important if you are
using it from a browser dapp, but also just so we don't hammer nodes/gateway with lots of concurrent requests.

If you would like to use this, you'll need to 

Check [src/console-test2.ts](src/console-test2.ts) and [src/types.ts](src/types.ts) for an idea on how to use it.

Uses https://www.npmjs.com/package/debug for debug logging and https://www.npmjs.com/package/promises-tho 
for retries and batching network requests. 

Enable `ar-block-sync:*` in your environment to see debug logs. 

Sample output of some logs where we see a new height but it takes some time to get propogated to all nodes: [./block-propogation-delay-handling.html] 


