export function toMarkdown(payload) {
  const lines = [`# ${payload.tool}`, "", `Root: ${payload.root}`, ""];
  if (Array.isArray(payload.data.tools)) {
    for (const tool of payload.data.tools) {
      lines.push(`- ${tool.name}: ${tool.purpose}`);
    }
  } else if (Array.isArray(payload.data.entries)) {
    for (const entry of payload.data.entries) {
      lines.push(`- ${entry.type}: ${entry.path}`);
    }
  } else if (Array.isArray(payload.data.matches)) {
    for (const match of payload.data.matches) {
      lines.push(`- ${match.path}:${match.line} (${match.score}) ${match.context}`);
    }
  } else if (Array.isArray(payload.data.chunks)) {
    for (const chunk of payload.data.chunks) {
      lines.push(`- ${chunk.id} ${chunk.lines} ${chunk.heading ?? "untitled"}: ${chunk.preview}`);
    }
  } else if (Array.isArray(payload.data.commands)) {
    for (const command of payload.data.commands) {
      lines.push(`- ${command.name}: ${command.command}`);
    }
  } else {
    lines.push("```json");
    lines.push(JSON.stringify(payload.data, null, 2));
    lines.push("```");
  }
  return `${lines.join("\n")}\n`;
}

export function formatPayload(payload, flags) {
  if (payload.data?.markdown) {
    return payload.data.markdown;
  }
  if (flags.markdown) {
    return toMarkdown(payload);
  }
  return `${JSON.stringify(payload, null, 2)}\n`;
}
