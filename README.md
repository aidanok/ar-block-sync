

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
- For invalidating a client-side cache of graphl/arql query results (no new blocks, no new results)
- Other? 


Currently, its suited for syncing block counts in 10-150 ish range, with a bit of adjustment it would work for much higher counts. 

It ships with very 'polite' network settings, it will poll every 100-200 seconds and if tx tag retrieval is
enabled (defaults to off) it will retrieve them without using a lot of network resources. Important if you are using it from a browser dapp, but also just so we don't hammer nodes/gateway with lots of concurrent requests.

If you would like to use this, you'll need to figure out how it fits your use-case, but you can start by checking:

[src/console-test2.ts](src/console-test2.ts) and [src/types.ts](src/types.ts) 

Uses https://www.npmjs.com/package/debug for debug logging and https://www.npmjs.com/package/promises-tho 
for retries and batching network requests. 

Enable `ar-block-sync:*` in your environment to see debug logs, or `ar-block-sync:*,promies-tho:*` if you want to see retries and batch retrieval logs aswell.

Sample output of some logs where we see a new height but it takes some time to get propogated to all nodes: [./block-propogation-delay-handling.html] 

We see first the block not being propogated to the node we try and get it from, that succeeds at the 3rd attempt, then
one of the TX tags retrieval call fails over a few attemps also due to block propogation, but eventually succeeded. Even if that
eventually failed (after another 1-2 minutes it would give up), the sync would just abort and try again a minute or so later.


As a consumer of this library, you wont see any of this, you can subscribe, and receive a` SyncResult` object which will have a list of synced blocks, their tags (if tag retrieval is enabled) and any information about blocks discarded due to a re-org.


