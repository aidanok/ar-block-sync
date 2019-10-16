import Arweave from 'arweave/node';
import * as ArweaveUtils from 'arweave/web/lib/utils';

export const arweave = Arweave.init({
    host: 'arweave.net',
    port: 443,
    protocol: 'https'
});

export interface DecodedTag {
  name: string
  value: string 
}

export function tagsArrayToObject(tags: DecodedTag[]): Record<string, string> {
  var ret: Record<string, string> = {}
  tags.forEach((x) => ret[x.name] = x.value);
  return ret;
}

export function decodeTag(x: any): DecodedTag {
  if (!x || typeof x['name'] !== 'string' || typeof x['value'] !== 'string') {
    throw new Error(`Error decoding tag from object: ${x}`);
  }
  return { 
    name: ArweaveUtils.b64UrlToString(x.name),
    value: ArweaveUtils.b64UrlToString(x.value)
  }
}






