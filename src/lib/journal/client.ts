import type { JournalAttachment, JournalReview, JournalSettings, JournalSnapshot, JournalTrade } from "./model";

export interface JournalAdapter {
  load(signal?: AbortSignal): Promise<JournalSnapshot>;
  saveTrade(trade: JournalTrade): Promise<JournalTrade>;
  deleteTrade(trade: JournalTrade): Promise<void>;
  saveReview(review: JournalReview): Promise<JournalReview>;
  saveSettings(settings: JournalSettings): Promise<JournalSettings>;
  charts(tradeId: string): Promise<JournalAttachment[]>;
  uploadChart(tradeId: string, file: Blob): Promise<JournalAttachment>;
  deleteChart(id: string): Promise<void>;
}
export class JournalClientError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/journal${path}`, { ...init, cache: "no-store", credentials: "same-origin" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new JournalClientError(body.error ?? "Could not complete the request.",response.status);
  return body as T;
}
const json = (method: string, value: unknown): RequestInit => ({ method,headers: { "Content-Type":"application/json" },body: JSON.stringify(value) });
export function tradeInput(trade: JournalTrade) {
  // Never send server-owned timestamps or user IDs from the client.
  const { createdAt: _created, updatedAt: _updated, ...input } = trade;
  void _created; void _updated;
  return input;
}
export const journalApi: JournalAdapter = {
  async load(signal) {
    type Page = JournalSnapshot & { nextOffset: number | null; revision:string };
    const first = await request<Page>("",{ signal });
    const trades = [...first.trades]; let next = first.nextOffset;
    while (next !== null) {
      const page = await request<Page>(`?offset=${next}`,{ signal });
      if(page.revision!==first.revision)throw new JournalClientError("Your journal changed while loading. Reload to see consistent totals.",409);
      trades.push(...page.trades); next = page.nextOffset;
    }
    return { ...first,trades: [...new Map(trades.map(t => [t.id,t])).values()] };
  },
  async saveTrade(trade) { return (await request<{trade:JournalTrade}>("/trades",json("POST",tradeInput(trade)))).trade; },
  async deleteTrade(trade) { await request(`/trades/${trade.id}`,json("DELETE",{ version:trade.version })); },
  async saveReview(review) { return (await request<{review:JournalReview}>("/reviews",json("PUT",review))).review; },
  async saveSettings(settings) { return (await request<{settings:JournalSettings}>("/settings",json("PUT",settings))).settings; },
  async charts(id) { return (await request<{charts:JournalAttachment[]}>(`/trades/${id}/charts`)).charts; },
  async uploadChart(id,file) { return (await request<{chart:JournalAttachment}>(`/trades/${id}/charts`,{ method:"POST",headers:{ "Content-Type":file.type },body:file })).chart; },
  async deleteChart(id) { await request(`/charts/${id}`,{ method:"DELETE" }); },
};

/** Strip camera metadata and bound the upload before sending over a mobile connection. */
export async function prepareChart(file: File): Promise<Blob> {
  if (!["image/png","image/jpeg","image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) throw new JournalClientError("Choose a PNG, JPEG, or WebP image smaller than 10 MB.",400);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    if (image.naturalWidth * image.naturalHeight > 40000000) throw new JournalClientError("This image is too large.",400);
    const ratio = Math.min(1,2048 / Math.max(image.naturalWidth,image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * ratio); canvas.height = Math.round(image.naturalHeight * ratio);
    const context = canvas.getContext("2d"); if (!context) throw new Error("Image editor unavailable");
    context.drawImage(image,0,0,canvas.width,canvas.height);
    const blob = await new Promise<Blob>((resolve,reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Image could not be read")),"image/webp",0.88));
    if (blob.size > 3 * 1024 * 1024) throw new JournalClientError("This chart is too large. Try a smaller screenshot.",413);
    return blob;
  } finally { URL.revokeObjectURL(url); }
}
