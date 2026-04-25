import { clientConfigSchema, type ClientConfig } from "./schema.js";

export function loadClientConfig(input: unknown): ClientConfig {
  return clientConfigSchema.parse(input);
}
