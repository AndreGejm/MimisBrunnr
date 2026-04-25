import { LRUCache } from "lru-cache";

const DEFAULT_MIMIR_RESULT_CACHE_MAX = 64;
const DEFAULT_MIMIR_RESULT_CACHE_TTL_MS = 15_000;

export function createMimirResultCache<K extends {}, V extends {}>() {
  return new LRUCache<K, V>({
    max: DEFAULT_MIMIR_RESULT_CACHE_MAX,
    ttl: DEFAULT_MIMIR_RESULT_CACHE_TTL_MS,
    ttlAutopurge: true,
    ttlResolution: 0,
    perf: {
      now: () => Date.now()
    }
  });
}
