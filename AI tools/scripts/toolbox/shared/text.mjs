import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export const MAX_TEXT_FILE_BYTES = 1024 * 1024;

const SECRET_FILE_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".npmrc",
  ".pypirc",
  "id_ed25519",
  "id_rsa"
]);
const SECRET_FILE_EXTENSIONS = new Set([".key", ".pem", ".p12", ".pfx"]);

export function truncate(value, maxChars) {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

export function isProbablyText(buffer) {
  return !buffer.subarray(0, 2048).includes(0);
}

export function isSecretLikeFile(relativePath) {
  const fileName = path.basename(relativePath).toLowerCase();
  if (SECRET_FILE_NAMES.has(fileName)) {
    return true;
  }
  if (fileName.startsWith(".env.")) {
    return true;
  }
  return SECRET_FILE_EXTENSIONS.has(path.extname(fileName));
}

export async function readBoundedTextFile(filePath) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    throw new Error(`Path is not a file: ${filePath}`);
  }
  if (fileStat.size > MAX_TEXT_FILE_BYTES) {
    throw new Error(`File is larger than the ${MAX_TEXT_FILE_BYTES} byte AI tools read limit: ${filePath}`);
  }

  const buffer = await readFile(filePath);
  if (!isProbablyText(buffer)) {
    throw new Error(`File does not look like text: ${filePath}`);
  }
  return buffer.toString("utf8");
}

export function lineRange(startLine, endLine) {
  return `${startLine}-${endLine}`;
}
