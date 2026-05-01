import { findToolByFamilyAndName, findToolById, readToolMetadata } from "../registry.mjs";
import { resolveRoot } from "../shared/args.mjs";
import { baseEnvelope } from "../shared/output.mjs";

async function readToolIndex() {
  return (await readToolMetadata()).map((tool) => ({
    id: tool.id,
    family: tool.family,
    name: tool.name,
    purpose: tool.purpose,
    description: tool.description,
    safe: tool.safe,
    mutates_files: tool.mutates_files,
    requires_git: tool.requires_git,
    requires_external_binaries: tool.requires_external_binaries,
    requires_network: tool.requires_network,
    reads_secrets: tool.reads_secrets,
    safety_level: tool.safety_level,
    stable_for_agent_use: tool.stable_for_agent_use,
    example: tool.example,
    status: tool.status
  }));
}

export async function listToolsCommand(flags) {
  const root = resolveRoot(flags);
  return baseEnvelope("list-tools", root, {
    tools: await readToolIndex()
  });
}

export async function describeToolCommand(flags, positional) {
  const root = resolveRoot(flags);
  const tool = positional.length >= 2
    ? await findToolByFamilyAndName(positional[0], positional[1])
    : await findToolById(positional[0]);

  if (!tool) {
    const lookup = positional.join(" ");
    return baseEnvelope("describe", root, {}, [], [`Unknown tool: ${lookup}`]);
  }

  return baseEnvelope("describe", root, {
    tool
  });
}

export async function runRegisteredToolCommand(flags, positional, dispatchToolCommand) {
  const [toolId, ...toolPositional] = positional;
  if (!toolId) {
    return baseEnvelope("run", resolveRoot(flags), {}, [], ["Missing tool id"]);
  }

  const tool = await findToolById(toolId);
  if (!tool) {
    return baseEnvelope("run", resolveRoot(flags), {}, [], [`Unknown tool: ${toolId}`]);
  }

  const result = await dispatchToolCommand(tool.name, flags, toolPositional);
  if (!result) {
    return baseEnvelope("run", resolveRoot(flags), {}, [], [`Registered tool has no launcher handler: ${toolId}`]);
  }
  return result;
}
