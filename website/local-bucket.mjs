// Local server and tests only. Production supplies the R2 binding.
import {createHash} from 'node:crypto';

export function localBucket() {
  const objects = new Map();
  return {
    async get(key) {
      const item = objects.get(key);
      return item ? {httpEtag: item.tag, json: async () => JSON.parse(item.text)} : null;
    },
    async put(key, text, {onlyIf}) {
      const existing = objects.get(key);
      if (onlyIf.has('If-None-Match') && existing) return null;
      if (onlyIf.has('If-Match') && existing?.tag !== onlyIf.get('If-Match')) return null;
      const tag = '"' + createHash('sha256').update(text).digest('hex') + '"';
      objects.set(key, {text, tag});
      return {httpEtag: tag};
    }
  };
}
