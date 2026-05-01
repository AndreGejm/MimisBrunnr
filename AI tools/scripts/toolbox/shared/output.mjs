export function baseEnvelope(tool, root, data = {}, warnings = [], errors = []) {
  return {
    tool,
    schema_version: "1.0",
    root,
    generated_at: new Date().toISOString(),
    data,
    warnings,
    errors
  };
}
