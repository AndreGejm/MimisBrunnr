import { createMimirResultCache } from "../cache/mimir-result-cache.js";
import type {
  AssembleAgentContextRequest,
  AssembleContextPacketRequest
} from "./command-types.js";
import type { MimirCommandSurface } from "./mimir-command-adapter.js";

function createCacheKey(toolName: string, args: unknown): string {
  return `${toolName}:${stableStringify(args)}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(
        ([key, nestedValue]) =>
          `${JSON.stringify(key)}:${stableStringify(nestedValue)}`
      )
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

async function getOrSetCachedRead(
  cache: ReturnType<typeof createMimirResultCache<string, Promise<unknown>>>,
  key: string,
  loadValue: () => Promise<unknown>
) {
  const cachedValue = cache.get(key);

  if (cachedValue) {
    return cachedValue;
  }

  const pendingValue = loadValue().catch((error) => {
    cache.delete(key);
    throw error;
  });

  cache.set(key, pendingValue);

  return pendingValue;
}

export function createCachedMimirCommandSurface(
  adapter: MimirCommandSurface
): MimirCommandSurface {
  const cache = createMimirResultCache<string, Promise<unknown>>();

  return {
    retrieveContext(args: AssembleAgentContextRequest) {
      return getOrSetCachedRead(
        cache,
        createCacheKey("retrieveContext", args),
        () => adapter.retrieveContext(args)
      );
    },

    getContextPacket(args: AssembleContextPacketRequest) {
      return getOrSetCachedRead(
        cache,
        createCacheKey("getContextPacket", args),
        () => adapter.getContextPacket(args)
      );
    },

    executeLocalCodingTask(args) {
      return adapter.executeLocalCodingTask(args);
    },

    listLocalAgentTraces(args) {
      return adapter.listLocalAgentTraces(args);
    },

    draftMemoryNote(args) {
      return adapter.draftMemoryNote(args);
    }
  };
}
