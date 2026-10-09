import { build } from "esbuild";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";
import path from "node:path";
const destination=process.argv[2];
if(!destination)throw new Error("Pass an output HTML path.");
const result=await build({entryPoints:["scripts/journal-preview.tsx"],bundle:true,write:false,outdir:"preview",format:"iife",platform:"browser",jsx:"automatic",minify:true,define:{"process.env.NODE_ENV":"\"production\""},target:["es2020"],tsconfig:"tsconfig.json"});
const js=result.outputFiles.find(f=>f.path.endsWith(".js")).text;
const css=result.outputFiles.find(f=>f.path.endsWith(".css")).text;
const logo=(await readFile("public/images/brand/alpha-traders-logo.webp")).toString("base64");
let html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="dark"><meta name="robots" content="noindex,nofollow"><title>Alpha Traders — Trading Journal Preview</title><style>html,body{margin:0;background:#090a0c;font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,textarea,select{font:inherit}.preview-banner{max-width:1680px;box-sizing:border-box;margin:auto;background:#1b170f;border-bottom:1px solid #e9bb6325;padding:10px 26px;display:flex;justify-content:space-between;gap:14px;align-items:center;color:#dfc38e;font-size:12px}.preview-banner>div{display:flex;align-items:center;gap:14px}.preview-banner strong{font-weight:600}.preview-banner span{color:#b4a07b}.preview-banner button{color:#dfd0ac;border:1px solid #dfd0ac35;border-radius:6px;background:#dfd0ac07;padding:7px 10px;font-size:12px;cursor:pointer;min-height:33px}@media(max-width:640px){.preview-banner{padding:10px 16px;font-size:10px;gap:8px;flex-wrap:wrap}.preview-banner>div{gap:9px}.preview-banner>div:first-child{width:100%}.preview-banner button{font-size:11px}}${css}
#root[hidden]{display:none!important}
#preview-fallback *{animation:none!important;transition:none!important}
#preview-fallback button:disabled{opacity:1;cursor:default}
.preview-fallback-note{max-width:1680px;box-sizing:border-box;margin:auto;padding:16px 26px;background:#241d12;border-bottom:1px solid #e9bb6340;color:#f1d6a5;font-size:13px;line-height:1.6}
.preview-fallback-note strong{display:block}.preview-fallback-note p{margin:3px 0 0;color:#c7b591}
</style></head><body><div id="root"></div><script>window.JOURNAL_LOGO="data:image/webp;base64,${logo}";</script><script>${js.replaceAll("</script","<\\/script")}</script></body></html>`;

// Capture the actual sample dashboard at build time. Restricted attachment viewers
// must have useful content before (or without) JavaScript, not an empty React root.
const server=createServer((_request,response)=>{response.writeHead(200,{"content-type":"text/html; charset=utf-8"});response.end(html);});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
let browser;
let snapshot;
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.JOURNAL_BROWSER_EXECUTABLE||undefined,args:["--no-sandbox"]});
  const page=await browser.newPage({viewport:{width:1440,height:1080},reducedMotion:"reduce"});
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator(".j-stat").first().waitFor();
  if(errors.length)throw new Error(`Preview could not render: ${errors.join("; ")}`);
  snapshot=await page.locator(".j-app").evaluate(app=>{
    // These are a read-only copy, never buttons that falsely promise to save.
    app.querySelectorAll("button,input,select,textarea").forEach(control=>{control.disabled=true;});
    app.querySelectorAll("[tabindex]").forEach(control=>{control.setAttribute("tabindex","-1");control.setAttribute("aria-disabled","true");});
    return app.outerHTML;
  });
} finally {
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
const fallback=`<section id="preview-fallback" aria-label="Read-only sample journal"><div class="preview-fallback-note"><strong>Read-only preview · Sample data</strong><p>To add trades and use all features, open the browser preview link from our chat in Safari or Chrome.</p><noscript><p>This file viewer does not run interactive apps. You can still view the dashboard below.</p></noscript></div>${snapshot}</section>`;
const reveal=`<script>(function(){var root=document.getElementById("root"),fallback=document.getElementById("preview-fallback");var observer=new MutationObserver(function(){if(root.querySelector(".j-stat")){root.hidden=false;fallback.remove();observer.disconnect();}else if(root.querySelector(".j-error")){fallback.querySelector(".preview-fallback-note p").textContent="Interactive mode could not open local storage here. Open the browser preview link from our chat in Safari or Chrome.";observer.disconnect();}});observer.observe(root,{childList:true,subtree:true});})();</script>`;
html=html.replace('<div id="root"></div>',`${fallback}<div id="root" hidden></div>${reveal}`);
await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,html);
console.log(JSON.stringify({path:destination,bytes:Buffer.byteLength(html)}));
