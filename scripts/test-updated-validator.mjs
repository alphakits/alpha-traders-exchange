import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { z } from "zod";

const require = createRequire(import.meta.url);
const expoRoot = path.dirname(require.resolve("@expo/cli/package.json"));
const schema = require(path.join(expoRoot, "build/src/start/server/DevToolsPlugin.schema.js"));
const { createMCPDevToolsExtensionSchema } = require(path.join(expoRoot, "build/src/start/server/createMCPDevToolsExtensionSchema.js"));

test("all affected consumers resolve the patched validator", () => {
  for (const entry of [null, "@expo/cli", "@vercel/cli-config"]) {
    const consumer = entry ? createRequire(require.resolve(entry)) : require;
    assert.equal(consumer("zod/package.json").version, "4.6.7", entry ?? "application");
  }
});

test("oversized constrained collections fail before inspecting individual elements", () => {
  let inspected = 0;
  const result = z.array(z.custom(() => { inspected++; return false; })).max(3).safeParse(Array(1000).fill(null));
  assert.equal(result.success, false);
  assert.equal(inspected, 0);
  assert.equal(result.error.issues.length, 1);
  assert.equal(result.error.issues[0].code, "too_big");
});

test("Expo plugin and output validators retain supported and rejected inputs", () => {
  const valid = { packageName: "demo", packageRoot: "/workspace/demo", cliExtensions: {
    description: "Demo", entryPoint: "index.js", commands: [{ name: "inspect", title: "Inspect", environments: ["cli", "mcp"],
      parameters: [{ name: "count", type: "number" }, { name: "label", type: "text" }, { name: "confirm", type: "confirm" }] }],
  } };
  const parsed = schema.PluginSchema.parse(valid);
  assert.equal(Object.isFrozen(parsed.cliExtensions.commands[0].environments), true);
  const command = createMCPDevToolsExtensionSchema(valid);
  assert.equal(command.safeParse({ command: "inspect", count: 3 }).success, true);
  assert.equal(command.safeParse({ command: "unknown" }).success, false);
  assert.equal(command.safeParse({ command: "inspect", count: "3" }).success, false);
  assert.equal(command.safeParse({ command: "inspect", extra: true }).success, false);
  assert.equal(command.safeParse({ command: "inspect", label: "Example", confirm: true }).success, true);
  assert.equal(command.safeParse({ command: "inspect", label: 3, confirm: "yes" }).success, false);
  assert.equal(schema.PluginSchema.safeParse({ ...valid, packageRoot: "" }).success, false);
  assert.equal(schema.DevToolsPluginOutputSchema.safeParse([{ type: "text", text: "Ready", level: "info" }]).success, true);
  assert.equal(schema.DevToolsPluginOutputSchema.safeParse([{ type: "text", text: "Ready", level: "invalid" }]).success, false);
  assert.equal(schema.DevToolsPluginOutputSchema.safeParse([{ type: "image", url: "https://example.test/image.png" }, { type: "audio", url: "https://example.test/clip.wav" }]).success, true);
  assert.equal(schema.DevToolsPluginOutputSchema.safeParse([{ type: "image", url: "not-a-url" }]).success, false);
  assert.equal(schema.PluginSchema.safeParse({ ...valid, cliExtensions: { ...valid.cliExtensions,
    commands: [{ name: "inspect", title: "Inspect", environments: ["invalid"] }] } }).success, false);
});

test("Vercel config validators still accept valid data and reject invalid values", () => {
  const config = require("@vercel/cli-config");
  assert.equal(config.parseGlobalConfig({ telemetry: { enabled: false } }).telemetry.enabled, false);
  assert.throws(() => config.parseGlobalConfig({ telemetry: { enabled: "false" } }));
});
