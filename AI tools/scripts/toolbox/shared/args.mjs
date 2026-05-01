import path from "node:path";

export const DEFAULT_MAX_ITEMS = 50;
export const DEFAULT_MAX_CHARS = 240;
export const DEFAULT_MAX_DEPTH = 4;

export function numberFlag(flags, name, fallback) {
  const value = Number(flags[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function resolveRoot(flags, cwd = process.cwd()) {
  return path.resolve(flags.root ? String(flags.root) : cwd);
}
