import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const require = createRequire(import.meta.url);
const expoRequire = createRequire(require.resolve("@expo/cli/package.json"));
const vercelRequire = createRequire(require.resolve("@vercel/cli-config"));

describe("Zod dependency security and integration compatibility", () => {
  it("resolves the reviewed security release for the app, Expo and Vercel", () => {
    for (const resolver of [require, expoRequire, vercelRequire]) {
      const manifest = resolver("zod/package.json") as { version: string };
      expect(manifest.version).toBe("4.6.6");
      expect(resolver.resolve("zod")).toBe(require.resolve("zod"));
    }
    const lock = JSON.parse(readFileSync(require.resolve("../../package-lock.json"), "utf8")) as {
      packages: Record<string, { version?: string }>;
    };
    const copies = Object.entries(lock.packages).filter(([name]) => name.endsWith("node_modules/zod"));
    expect(copies).toHaveLength(1);
    expect(copies[0][1].version).toBe("4.6.6");
  });

  it.each(["max", "length"] as const)("rejects an oversized array before walking its elements (%s)", bound => {
    let visited = 0;
    const element = z.string().superRefine(() => { visited++; });
    const array = z.array(element)[bound](2);
    const result = z.object({ values: array }).safeParse({ values: Array(10_000).fill("valid element") });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toMatchObject([{ code: "too_big", path: ["values"] }]);
    expect(visited).toBe(0);
    expect(array.parse(["one", "two"])).toEqual(["one", "two"]);
    expect(visited).toBe(2);
  });

  it("rejects oversized maps and sets before parsing their contents", () => {
    let visited = 0;
    const element = z.string().superRefine(() => { visited++; });
    expect(z.set(element).max(1).safeParse(new Set(["a", "b"])).success).toBe(false);
    expect(z.map(element, element).max(1).safeParse(new Map([["a", "one"], ["b", "two"]])).success).toBe(false);
    expect(visited).toBe(0);
  });

  it("preserves Expo plugin configuration validation and typed MCP arguments", () => {
    const { PluginSchema } = expoRequire("./build/src/start/server/DevToolsPlugin.schema.js") as { PluginSchema: z.ZodType };
    const { createMCPDevToolsExtensionSchema } = expoRequire("./build/src/start/server/createMCPDevToolsExtensionSchema.js") as {
      createMCPDevToolsExtensionSchema: (plugin: unknown) => z.ZodType;
    };
    const plugin = {
      packageName: "audit-synthetic-plugin", packageRoot: "/synthetic/plugin",
      cliExtensions: { description: "Synthetic compatibility check", entryPoint: "plugin.js", commands: [{
        name: "inspect", title: "Inspect", environments: ["cli", "mcp"], parameters: [
          { name: "label", type: "text" }, { name: "count", type: "number" }, { name: "confirm", type: "confirm" },
        ],
      }] },
    };
    const parsed = PluginSchema.parse(plugin);
    const command = createMCPDevToolsExtensionSchema(parsed);
    const input = { command: "inspect", label: "sample", count: 2, confirm: true };
    expect(command.parse(input)).toEqual(input);
    expect(command.safeParse({ ...input, count: "2" }).success).toBe(false);
    expect(command.safeParse({ ...input, command: "unknown" }).success).toBe(false);
    expect(command.safeParse({ ...input, extra: true }).success).toBe(false);
    expect(PluginSchema.safeParse({ ...plugin, packageRoot: "" }).success).toBe(false);
    expect(z.toJSONSchema(command)).toMatchObject({ type: "object", additionalProperties: false });
  });

  it("preserves Expo text, image and audio output validation and issue reporting", () => {
    const { DevToolsPluginOutputSchema } = expoRequire("./build/src/start/server/DevToolsPlugin.schema.js") as {
      DevToolsPluginOutputSchema: z.ZodType;
    };
    const output = [
      { type: "text", text: "Synthetic result", level: "info" },
      { type: "image", url: "https://example.invalid/image.png" },
      { type: "audio", url: "https://example.invalid/audio.wav" },
    ];
    expect(DevToolsPluginOutputSchema.parse(output)).toEqual(output);
    const invalid = DevToolsPluginOutputSchema.safeParse([{ type: "image", url: "invalid" }]);
    expect(invalid.success).toBe(false);
    if (!invalid.success) expect(invalid.error.issues.map(issue => issue.message).join(", ")).toBeTruthy();
  });
});
