#!/usr/bin/env node

import process from "node:process";
import { createBrainApiServer } from "./server.js";

async function main(): Promise<void> {
  const api = createBrainApiServer();
  await api.listen();

  process.stdout.write(
    `brain-api listening on http://${api.env.apiHost}:${api.env.apiPort}\n`
  );

  const shutdown = async () => {
    await api.close();
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });
}

await main();
