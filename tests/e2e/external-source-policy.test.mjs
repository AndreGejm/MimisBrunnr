import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ObsidianVaultSource } from "../../packages/infrastructure/dist/index.js";

test("obsidian vault source lists and reads only policy-allowed markdown notes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-obsidian-source-"));
  const vaultRoot = path.join(root, "vault");
  await mkdir(path.join(vaultRoot, "daily"), { recursive: true });
  await mkdir(path.join(vaultRoot, "projects"), { recursive: true });
  await mkdir(path.join(vaultRoot, "private"), { recursive: true });
  await mkdir(path.join(vaultRoot, ".obsidian"), { recursive: true });

  await writeFile(
    path.join(vaultRoot, "projects", "mimir.md"),
    [
      "---",
      "title: Mimir Note",
      "tags: ai, obsidian",
      "---",
      "# Mimir Note",
      "",
      "Connect this to [[daily/today]] and [Plan](../daily/today.md)."
    ].join("\n"),
    "utf8"
  );
  await writeFile(path.join(vaultRoot, "daily", "today.md"), "# Today\n", "utf8");
  await writeFile(path.join(vaultRoot, "private", "secret.md"), "# Secret\n", "utf8");
  await writeFile(path.join(vaultRoot, ".obsidian", "workspace.json"), "{}\n", "utf8");
  await writeFile(path.join(vaultRoot, "image.png"), "not-markdown\n", "utf8");

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const source = new ObsidianVaultSource({
    sourceId: `obsidian-${randomUUID()}`,
    sourceType: "obsidian_vault",
    displayName: "Personal Vault",
    rootPath: vaultRoot,
    accessPolicy: {
      allowedReadGlobs: ["**/*.md"],
      deniedReadGlobs: ["private/**"],
      allowWrites: false,
      deniedWriteGlobs: ["**/*"]
    }
  });

  assert.equal("writeDocument" in source, false);
  assert.equal(source.getRegistration().accessPolicy.allowWrites, false);

  const documents = await source.listDocuments();
  assert.deepEqual(documents.map((document) => document.path), [
    "daily/today.md",
    "projects/mimir.md"
  ]);
  assert.deepEqual(
    documents.map((document) => document.contentType),
    ["text/markdown", "text/markdown"]
  );

  const note = await source.readDocument("projects/mimir.md");
  assert.equal(note.path, "projects/mimir.md");
  assert.equal(note.title, "Mimir Note");
  assert.equal(note.frontmatter.title, "Mimir Note");
  assert.equal(note.frontmatter.tags, "ai, obsidian");
  assert.deepEqual(note.links.wiki, ["daily/today"]);
  assert.deepEqual(note.links.markdown, [{ label: "Plan", target: "../daily/today.md" }]);
  assert.match(note.contentHash, /^sha256:[a-f0-9]{64}$/);

  await assert.rejects(
    () => source.readDocument("../outside.md"),
    /relative path inside the external source root/
  );
  await assert.rejects(
    () => source.readDocument("private/secret.md"),
    /not allowed by external source access policy/
  );
  await assert.rejects(
    () => source.readDocument(".obsidian/workspace.json"),
    /not allowed by external source access policy/
  );
});