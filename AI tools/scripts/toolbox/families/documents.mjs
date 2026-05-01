import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_MAX_CHARS, DEFAULT_MAX_ITEMS, numberFlag, resolveRoot } from "../shared/args.mjs";
import { assertReadableDirectory, walk } from "../shared/filesystem.mjs";
import { baseEnvelope } from "../shared/output.mjs";
import { isSecretLikeFile, lineRange, readBoundedTextFile, truncate } from "../shared/text.mjs";

export function extractMarkdownHeadings(text) {
  const headings = [];
  const lines = text.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(lines[index]);
    if (!match) {
      continue;
    }
    headings.push({
      level: match[1].length,
      text: match[2].trim(),
      line: index + 1
    });
  }
  return headings;
}

export async function extractHeadings(flags, positional) {
  const filePathArg = positional[0];
  if (!filePathArg) {
    return baseEnvelope("extract-headings", process.cwd(), { headings: [] }, [], ["Missing document file path."]);
  }

  const filePath = path.resolve(filePathArg);
  const text = await readBoundedTextFile(filePath);
  return baseEnvelope("extract-headings", path.dirname(filePath), {
    source_path: filePath,
    headings: extractMarkdownHeadings(text)
  });
}

export function extractMarkdownLinks(text) {
  const links = [];
  const lines = text.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    for (const match of lines[index].matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
      links.push({
        target: match[1].trim(),
        line: index + 1
      });
    }
  }
  return links;
}

function isExternalLink(target) {
  return /^(https?:|mailto:|#)/iu.test(target);
}

export async function docCheck(flags) {
  const root = resolveRoot(flags);
  await assertReadableDirectory(root);
  const maxItems = numberFlag(flags, "max-items", DEFAULT_MAX_ITEMS);
  const brokenLinks = [];
  const headingCounts = new Map();
  const veryLongSections = [];
  const maxSectionChars = numberFlag(flags, "max-section-chars", 4000);

  await walk(root, flags, async ({ fullPath, relativePath, entry }) => {
    if (!entry.isFile() || !/\.(md|mdx)$/iu.test(relativePath)) {
      return;
    }
    const text = await readBoundedTextFile(fullPath);
    const headings = extractMarkdownHeadings(text);
    for (const heading of headings) {
      const key = heading.text.toLowerCase();
      const current = headingCounts.get(key) ?? {
        heading: heading.text,
        count: 0,
        locations: []
      };
      current.count += 1;
      current.locations.push({ path: relativePath, line: heading.line });
      headingCounts.set(key, current);
    }

    for (const link of extractMarkdownLinks(text)) {
      const targetWithoutHash = link.target.split("#")[0];
      if (isExternalLink(link.target) || targetWithoutHash.length === 0) {
        continue;
      }
      const targetPath = path.resolve(path.dirname(fullPath), targetWithoutHash);
      try {
        await access(targetPath, constants.R_OK);
      } catch {
        brokenLinks.push({
          path: relativePath,
          line: link.line,
          target: link.target
        });
      }
    }

    const lines = text.split(/\r?\n/u);
    for (let headingIndex = 0; headingIndex < headings.length; headingIndex += 1) {
      const heading = headings[headingIndex];
      const nextHeading = headings[headingIndex + 1];
      const startLine = heading.line;
      const endLine = nextHeading ? nextHeading.line - 1 : lines.length;
      const sectionText = lines.slice(startLine - 1, endLine).join("\n");
      if (sectionText.length > maxSectionChars) {
        veryLongSections.push({
          path: relativePath,
          heading: heading.text,
          lines: lineRange(startLine, endLine),
          char_count: sectionText.length
        });
      }
    }
  });

  return baseEnvelope("doc-check", root, {
    broken_links: brokenLinks.sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line).slice(0, maxItems),
    duplicate_headings: Array.from(headingCounts.values())
      .filter((heading) => heading.count > 1)
      .sort((left, right) => right.count - left.count || left.heading.localeCompare(right.heading))
      .slice(0, maxItems),
    very_long_sections: veryLongSections.sort((left, right) => right.char_count - left.char_count).slice(0, maxItems)
  });
}

export async function extractText(flags, positional) {
  const filePathArg = positional[0];
  if (!filePathArg) {
    return baseEnvelope("extract-text", process.cwd(), {}, [], ["Missing file path."]);
  }

  const filePath = path.resolve(filePathArg);
  const fileName = path.basename(filePath);
  if (isSecretLikeFile(fileName)) {
    return baseEnvelope("extract-text", path.dirname(filePath), {}, [], ["Refusing to extract text from a secret-like file."]);
  }

  const text = await readBoundedTextFile(filePath);
  const maxChars = numberFlag(flags, "max-chars", DEFAULT_MAX_CHARS);
  const extracted = truncate(text, maxChars);
  return baseEnvelope("extract-text", path.dirname(filePath), {
    source_path: filePath,
    char_count: text.length,
    line_count: text.split(/\r?\n/u).filter((line) => line.length > 0).length,
    truncated: extracted.length < text.length,
    text: extracted
  });
}

export async function extractLinks(flags, positional) {
  const root = path.resolve(flags.root ? String(flags.root) : positional[0] ?? process.cwd());
  const rootStat = await stat(root);
  const maxItems = numberFlag(flags, "max-items", DEFAULT_MAX_ITEMS);
  const links = [];

  const inspectFile = async (fullPath, relativePath) => {
    if (!/\.(md|mdx|html?)$/iu.test(relativePath)) {
      return;
    }
    const text = await readBoundedTextFile(fullPath);
    for (const link of extractMarkdownLinks(text)) {
      const targetWithoutHash = link.target.split("#")[0];
      const external = isExternalLink(link.target);
      let exists = null;
      if (!external && targetWithoutHash.length > 0) {
        try {
          await access(path.resolve(path.dirname(fullPath), targetWithoutHash), constants.R_OK);
          exists = true;
        } catch {
          exists = false;
        }
      }
      links.push({
        path: relativePath,
        line: link.line,
        target: link.target,
        external,
        exists
      });
    }
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

  links.sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line || left.target.localeCompare(right.target));
  return baseEnvelope("extract-links", rootStat.isDirectory() ? root : path.dirname(root), {
    links: links.slice(0, maxItems),
    truncated: links.length > maxItems
  });
}

export const documentCommands = {
  "doc-check": docCheck,
  "extract-headings": extractHeadings,
  "extract-links": extractLinks,
  "extract-text": extractText
};
