import "server-only";
import { createHash } from "node:crypto";
import { officialSourceUrl, officialText, parseOfficialResult, seriesKey, type CalendarEvent, type OfficialDocument, type OfficialResult } from "./official-sources";

const hosts = new Set(["www.bls.gov", "www.bea.gov", "www.dol.gov", "www.federalreserve.gov", "www.census.gov"]);
export function allowedOfficialUrl(raw: string) {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && hosts.has(url.hostname) && !url.username && !url.password && !url.port;
  } catch { return false; }
}

export async function fetchOfficialDocument(url: string, signal: AbortSignal): Promise<OfficialDocument> {
  if (!allowedOfficialUrl(url)) throw new Error("Unapproved official source");
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]), redirect: "error", cache: "no-store",
    headers: { Accept: "text/html,application/pdf,text/plain", "User-Agent": "AlphaTradersNews/1.0 (+https://www.alphatraders.co.il)" } });
  if (!response.ok || !response.body || (response.url && !allowedOfficialUrl(response.url))) throw new Error("Official source unavailable");
  const maxBytes = 4 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > maxBytes) { await response.body.cancel(); throw new Error("Official source too large"); }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("Official source too large");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = Buffer.concat(chunks);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.subarray(0, 5).toString() === "%PDF-") {
    const { getDocumentProxy, extractText } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes), { maxImageSize: 1_000_000, disableFontFace: true, useSystemFonts: false });
    const destroy = () => { void pdf.loadingTask.destroy().catch(() => {}); };
    const timeout = setTimeout(destroy, 8_000);
    signal.addEventListener("abort", destroy, { once: true });
    try {
      if (signal.aborted || pdf.numPages > 30) throw new Error("Official PDF limit");
      const { text } = await extractText(pdf, { mergePages: true });
      if (signal.aborted) throw new Error("Official source deadline");
      return { url, text, sha256 };
    } finally { clearTimeout(timeout); signal.removeEventListener("abort", destroy); await pdf.loadingTask.destroy(); }
  }
  if (!/text\/(?:html|plain)|application\/xhtml/.test(response.headers.get("content-type") ?? "")) throw new Error("Unsupported official document");
  const html = bytes.toString("utf8");
  return { url, html, text: officialText(html), sha256 };
}

export type Collection = { results: OfficialResult[]; checked: string[]; pending: string[]; failed: string[]; unsupported: string[] };
export async function collectOfficialResults(events: CalendarEvent[], now: number, fetcher = fetchOfficialDocument): Promise<Collection> {
  const result: Collection = { results: [], checked: [], pending: [], failed: [], unsupported: [] };
  const cache = new Map<string, Promise<OfficialDocument>>();
  const signal = AbortSignal.timeout(40_000);
  const get = (url: string) => {
    let work = cache.get(url);
    if (!work) { work = fetcher(url, signal); cache.set(url, work); }
    return work;
  };
  let cursor = 0;
  async function worker() {
    while (cursor < events.length && !signal.aborted) {
      const event = events[cursor++];
      let url = officialSourceUrl(event);
      if (!url) { result.unsupported.push(event.id); continue; }
      try {
        if (url.endsWith("/news/current-releases")) {
          const index = await get(url);
          const links = [...(index.html ?? "").matchAll(/href=["']([^"']*\/news\/\d{4}\/(?:gross-domestic-product|gdp)[^"']*advance[^"']*)["']/gi)]
            .map(match => new URL(match[1], url!).href).filter(allowedOfficialUrl);
          if (!links.length) { result.pending.push(event.id); continue; }
          url = links[0];
        }
        const document = await get(url);
        const supplementary = seriesKey(event) === "official-bls-core-ppi-mom" ? await get("https://www.bls.gov/news.release/ppi.t01.htm") : undefined;
        const parsed = parseOfficialResult(event, document, now, supplementary);
        result.checked.push(event.id);
        if (parsed) result.results.push(parsed); else result.pending.push(event.id);
      } catch { result.failed.push(event.id); }
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  for (const event of events.slice(cursor)) result.failed.push(event.id);
  return result;
}
