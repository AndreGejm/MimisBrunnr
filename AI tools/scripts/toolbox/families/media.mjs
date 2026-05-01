import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_MAX_ITEMS, numberFlag } from "../shared/args.mjs";
import { walk } from "../shared/filesystem.mjs";
import { baseEnvelope } from "../shared/output.mjs";

function mediaTypeForExtension(extension) {
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(extension)) {
    return "image";
  }
  if ([".mp4", ".mov", ".mkv", ".webm", ".avi"].includes(extension)) {
    return "video";
  }
  if ([".mp3", ".wav", ".flac", ".m4a", ".ogg"].includes(extension)) {
    return "audio";
  }
  return null;
}

function mimeTypeForExtension(extension) {
  const mimeTypes = {
    ".avi": "video/x-msvideo",
    ".flac": "audio/flac",
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".m4a": "audio/mp4",
    ".mkv": "video/x-matroska",
    ".mov": "video/quicktime",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".ogg": "audio/ogg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".wav": "audio/wav",
    ".webm": "video/webm",
    ".webp": "image/webp"
  };
  return mimeTypes[extension] ?? "application/octet-stream";
}

async function readImageDimensions(fullPath, extension) {
  const buffer = await readFile(fullPath);
  if (extension === ".png" && buffer.length >= 24 && buffer.toString("ascii", 12, 16) === "IHDR") {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20)
    };
  }
  if (extension === ".gif" && buffer.length >= 10) {
    return {
      width: buffer.readUInt16LE(6),
      height: buffer.readUInt16LE(8)
    };
  }
  if (extension === ".svg") {
    const text = buffer.toString("utf8");
    const width = /<svg[^>]*\swidth=["']?([0-9.]+)/iu.exec(text)?.[1];
    const height = /<svg[^>]*\sheight=["']?([0-9.]+)/iu.exec(text)?.[1];
    return {
      width: width ? Number(width) : null,
      height: height ? Number(height) : null
    };
  }
  return { width: null, height: null };
}

export async function mediaInfo(flags, positional) {
  const root = path.resolve(flags.root ? String(flags.root) : positional[0] ?? process.cwd());
  const rootStat = await stat(root);
  const maxItems = numberFlag(flags, "max-items", DEFAULT_MAX_ITEMS);
  const files = [];

  const inspectFile = async (fullPath, relativePath) => {
    const extension = path.extname(relativePath).toLowerCase();
    const mediaType = mediaTypeForExtension(extension);
    if (!mediaType) {
      return;
    }
    const fileStat = await stat(fullPath);
    const item = {
      path: relativePath,
      media_type: mediaType,
      mime_type: mimeTypeForExtension(extension),
      extension,
      size_bytes: fileStat.size,
      modified_at: fileStat.mtime.toISOString()
    };
    if (mediaType === "image") {
      Object.assign(item, await readImageDimensions(fullPath, extension));
    }
    files.push(item);
  };

  if (rootStat.isFile()) {
    await inspectFile(root, path.basename(root));
  } else {
    await walk(root, flags, async ({ fullPath, relativePath, entry }) => {
      if (entry.isFile()) {
        await inspectFile(fullPath, relativePath);
      }
    });
  }

  files.sort((left, right) => left.path.localeCompare(right.path));
  return baseEnvelope("media-info", rootStat.isDirectory() ? root : path.dirname(root), {
    files: files.slice(0, maxItems),
    truncated: files.length > maxItems
  });
}

export const mediaCommands = {
  "media-info": mediaInfo
};
