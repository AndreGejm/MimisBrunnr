import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const INDEX_ROOT = path.join(TOOL_ROOT, "index");

const FAMILY_BY_TOOL = new Map([
  ["chunk-file", "text"],
  ["csv-profile", "data"],
  ["doc-check", "documents"],
  ["extract-headings", "documents"],
  ["extract-links", "documents"],
  ["extract-text", "documents"],
  ["file-inventory", "workspace"],
  ["log-summary", "text"],
  ["smart-search", "text"],
  ["tree-lite", "workspace"]
]);

function normalizeToolMetadata(parsed) {
  const family = parsed.family ?? FAMILY_BY_TOOL.get(parsed.name) ?? "general";
  const description = parsed.description ?? parsed.purpose ?? "";
  return {
    id: parsed.id ?? (family === "general" ? parsed.name : `${family}.${parsed.name}`),
    family,
    name: parsed.name,
    description,
    purpose: parsed.purpose ?? description,
    input_parameters: parsed.input_parameters ?? parsed.parameters ?? [],
    output_format: parsed.output_format ?? parsed.default_output ?? "json",
    side_effects: parsed.side_effects ?? (parsed.mutates_files ? "modifies workspace files" : "none"),
    safety_level: parsed.safety_level ?? (parsed.mutates_files ? "modifies_workspace" : "read_only"),
    mutates_files: Boolean(parsed.mutates_files),
    requires_git: Boolean(parsed.requires_git),
    requires_external_binaries: parsed.requires_external_binaries ?? [],
    requires_network: Boolean(parsed.requires_network),
    reads_secrets: Boolean(parsed.reads_secrets),
    safe: Boolean(parsed.safe),
    stable_for_agent_use: parsed.stable_for_agent_use ?? parsed.status !== "experimental",
    example: parsed.example,
    script: parsed.script,
    schema_version: parsed.schema_version ?? "1.0",
    status: parsed.status ?? "draft"
  };
}

export async function readToolMetadata() {
  const entries = await readdir(INDEX_ROOT, { withFileTypes: true });
  const tools = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === "tool-template.json") {
      continue;
    }

    const fullPath = path.join(INDEX_ROOT, entry.name);
    tools.push(normalizeToolMetadata(JSON.parse(await readFile(fullPath, "utf8"))));
  }

  return tools;
}

export async function findToolById(id) {
  const tools = await readToolMetadata();
  return tools.find((tool) => tool.id === id || tool.name === id) ?? null;
}

export async function findToolByFamilyAndName(family, name) {
  const tools = await readToolMetadata();
  return tools.find((tool) => tool.family === family && tool.name === name) ?? null;
}
