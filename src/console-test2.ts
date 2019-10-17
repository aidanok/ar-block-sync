
import { arBlocks } from './observable';
import { inspect } from 'util';

import debug from 'debug';

const log = debug('ar-blocks:console-test2');

arBlocks({
  startupDelay: 0,
  persist: true,
  retrieveTags: true,
  minPollTime: 10,
  maxPollTime: 30,
})
.subscribe(x => {
  log(inspect(x));
})