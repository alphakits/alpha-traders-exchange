import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ts from "typescript";

// Static inventory is a review queue, never proof that a reachable action works.
const output = process.argv[2] ?? "docs/audits/2026-10-16/inventory.json";
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const items = [];
const env = new Set();
const add = (kind, file, line, details) => items.push({ id: `${kind}:${file}:${line}:${items.length}`, kind, file, line, ...details, status: "NOT TESTED", evidence: "Static discovery only; runtime role/state verification required." });
for (const file of files) {
  if (!/\.(tsx?|mjs|js)$/.test(file) || /(?:test|spec)\.[^.]+$/.test(file)) continue;
  if (!/^(?:src|packages|scripts)\//.test(file)) continue;
  const content = fs.readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const short = (node) => node?.getText(source).replace(/\s+/g, " ").slice(0, 300) ?? "";
  if (/src\/app\/.+\/(?:page|route)\.tsx?$/.test(file) || file === "src/app/page.tsx") {
    const route = "/" + path.dirname(file).replace(/^src\/app\/?/, "").split("/").filter(p => !p.startsWith("(")).join("/");
    add(file.endsWith("page.tsx") ? "page" : "endpoint", file, 1, { route, methods: [...content.matchAll(/export\s+(?:(?:async\s+)?function|const|let)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map(m => m[1]) });
  }
  if (/^src\/workers\//.test(file)) add("worker", file, 1, { description: "Worker entry point" });
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = short(node.tagName);
      const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
      const props = Object.fromEntries(attrs.map(a => [short(a.name), short(a.initializer)]));
      if (["button", "Button", "a", "Link", "form", "input", "Input", "select", "textarea"].includes(tag) || attrs.some(a => /^(?:href|action)$|^on(?:Click|Submit|Change|Select)/.test(short(a.name)))) {
        add("control", file, lineOf(node), { tag, props: Object.fromEntries(Object.entries(props).filter(([k]) => /^(?:id|href|action|type|name|disabled|aria-label|onClick|onSubmit|onChange|onSelect)$/.test(k))), label: short(node.parent).slice(0, 200) });
      }
    }
    if (ts.isCallExpression(node)) {
      const call = short(node.expression);
      if (/^(?:redirect|permanentRedirect|notFound)$|(?:^|\.)(?:router|navigation)\.(?:push|replace)$|(?:^|\.)location\.(?:assign|replace)$/.test(call)) add("navigation", file, lineOf(node), { call, destination: short(node.arguments[0]) });
      if (/^(?:fetch|setInterval)$/.test(call)) add(call === "fetch" ? "dependency_call" : "scheduled_loop", file, lineOf(node), { destination: short(node.arguments[0]) });
    }
    if (ts.isPropertyAccessExpression(node) && short(node.expression) === "process.env") env.add(short(node.name));
    ts.forEachChild(node, visit);
  };
  visit(source);
}
const vercel = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
for (const job of vercel.crons ?? []) add("cron", "vercel.json", 1, job);
for (const file of files.filter(f => /^\.github\/workflows\/.*\.ya?ml$/.test(f))) {
  const text = fs.readFileSync(file, "utf8");
  add("workflow", file, 1, { schedules: [...text.matchAll(/cron:\s*["']([^"']+)["']/g)].map(m => m[1]) });
}
const counts = items.reduce((sum, item) => ({ ...sum, [item.kind]: (sum[item.kind] ?? 0) + 1 }), {});
const report = { commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), scope: "Tracked web source, shared contracts, scripts, Vercel cron and GitHub workflows. Generated routes and role/state combinations still require runtime enumeration.", counts, environmentVariableNames: [...env].sort(), items };
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ output, counts, total: items.length, status: "NOT TESTED" }));
