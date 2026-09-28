import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function expandStreamedHtml(source: string) {
  let html = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  for (let count = 0; count < 30; count++) {
    const match = /<div hidden(?:="")? id="S:(\d+)">/.exec(html);
    if (!match) break;
    const bodyStart = match.index + match[0].length;
    const tags = /<\/?div\b[^>]*>/g;
    tags.lastIndex = bodyStart;
    let depth = 1;
    let tag: RegExpExecArray | null;
    while ((tag = tags.exec(html))) {
      depth += tag[0].startsWith("</") ? -1 : 1;
      if (depth !== 0) continue;
      const content = html.slice(bodyStart, tag.index);
      html = html.slice(0, match.index) + html.slice(tags.lastIndex);
      html = html.replace(`<template id="B:${match[1]}"></template>`, content);
      break;
    }
    if (depth !== 0) break;
  }
  return html;
}

// Temporary preview-only visual fixture; excluded from the production commit.
export async function GET() {
  if (process.env.VERCEL_ENV !== "preview" || !process.env.VERCEL_URL) return new NextResponse(null, { status: 404 });
  const origin = `https://${process.env.VERCEL_URL}`;
  const pages = await Promise.all((["en", "ar"] as const).map(async (locale) => {
    const response = await fetch(`${origin}/${locale}/news`, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not render the public news page");
    const html = expandStreamedHtml(await response.text());
    const escaped = html.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    return `<section><h2>${locale} · 375 px</h2><iframe title="${locale} mobile news" width="375" height="1350" srcdoc="${escaped}"></iframe></section>`;
  }));
  return new NextResponse(`<!doctype html><html><head><meta name="robots" content="noindex"><title>News mobile preview</title><style>body{background:#151515;color:white;font:14px Arial;margin:24px}main{display:flex;gap:24px;align-items:start}iframe{border:1px solid #555}</style></head><body><h1>Public news layout · 375 px</h1><p>Static page render with the live calendar. Controls in the page snapshot are inactive.</p><main>${pages.join("")}</main></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
