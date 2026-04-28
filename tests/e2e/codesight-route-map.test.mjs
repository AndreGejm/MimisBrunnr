import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { existsSync } from "node:fs";
import { getHttpRouteDefinitions } from "../../apps/mimir-api/dist/server.js";

test("tracked interface docs include every HTTP route", async () => {
  const interfaceMap = await readFile("documentation/reference/interfaces.md", "utf8");

  for (const route of getHttpRouteDefinitions()) {
    assert.ok(
      interfaceMap.includes(`| \`${route.method}\` | \`${route.path}\` |`),
      `Expected documentation/reference/interfaces.md to include ${route.method} ${route.path}`
    );
  }
});

test("local Codesight route map includes every HTTP route when generated", async (t) => {
  if (!existsSync(".codesight/routes.md")) {
    t.skip(".codesight/routes.md is a local generated artifact and is ignored by git");
    return;
  }

  const routeMap = await readFile(".codesight/routes.md", "utf8");

  for (const route of getHttpRouteDefinitions()) {
    assert.ok(
      routeMap.includes(`\`${route.method}\` \`${route.path}\``),
      `Expected .codesight/routes.md to include ${route.method} ${route.path}`
    );
  }
});
