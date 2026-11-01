import type { JournalLocale } from "./model";
import type { JournalShare } from "./sharing";

/** Render only the approved projection. No DOM screenshots, account data, URLs, or image metadata. */
export async function makeShareImage(doc: JournalShare, locale: JournalLocale, chartUrls: string[], signal: AbortSignal): Promise<Blob> {
  await document.fonts?.ready;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image unavailable");
  const width = 1080, padding = 64, contentWidth = width - padding * 2;
  const rtl = locale === "ar";
  const font = 'Arial, sans-serif';
  const wrap = (text: string, size: number) => {
    ctx.font = `${size}px ${font}`;
    const lines: string[] = [];
    for (const paragraph of text.split("\n")) {
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width <= contentWidth) { line = next; continue; }
        if (line) lines.push(line);
        line = "";
        for (const char of word) {
          if (ctx.measureText(line + char).width > contentWidth) { lines.push(line); line = ""; }
          line += char;
        }
      }
      lines.push(line);
    }
    return lines;
  };
  const fields = doc.fields.map(field => ({ ...field, lines: wrap(field.value, 32) }));
  const pictures: ImageBitmap[] = [];
  try {
    for (const url of chartUrls) {
      // Chart URLs originate from the authenticated journal adapter, never user-entered links.
      if (!(url.startsWith("/api/journal/charts/") || url.startsWith("blob:") || /^data:image\/(png|jpeg|webp);base64,/.test(url))) throw new Error("Invalid chart");
      const response = await fetch(url, { credentials: "same-origin", cache: "no-store", signal });
      if (!response.ok) throw new Error("Chart unavailable");
      pictures.push(await createImageBitmap(await response.blob()));
    }
    const imageHeights = pictures.map(picture => Math.round(contentWidth * picture.height / picture.width));
    const height = 300 + fields.reduce((sum, field) => sum + 62 + field.lines.length * 44, 0) + imageHeights.reduce((sum, h) => sum + h + 30, 0) + 110;
    // Do not silently crop notes, drop selected charts, or produce a blank oversized mobile canvas.
    if (height > 12000 || signal.aborted) throw new Error("Use text for long selections");
    canvas.width = width; canvas.height = height;
    ctx.fillStyle = "#0b0e13"; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#d5b36b"; ctx.fillRect(padding, 42, contentWidth, 3);
    ctx.textBaseline = "top"; ctx.textAlign = "left"; ctx.direction = "ltr";
    ctx.fillStyle = "#f15d79"; ctx.font = `bold 36px ${font}`; ctx.fillText("Alpha Traders", padding, 74);
    ctx.fillStyle = "#d5b36b"; ctx.font = `22px ${font}`; ctx.fillText("TRADING JOURNAL", padding, 124);
    ctx.textAlign = rtl ? "right" : "left"; ctx.direction = rtl ? "rtl" : "ltr";
    const x = rtl ? width - padding : padding;
    ctx.fillStyle = "#f3f4f6"; ctx.font = `bold 44px ${font}`; ctx.fillText(doc.title, x, 184, contentWidth);
    ctx.fillStyle = "#b3bccb"; ctx.font = `26px ${font}`; ctx.fillText(doc.context, x, 244, contentWidth);
    let y = 300;
    for (const field of fields) {
      ctx.textAlign = rtl ? "right" : "left"; ctx.direction = rtl ? "rtl" : "ltr";
      ctx.fillStyle = "#b3bccb"; ctx.font = `24px ${font}`; ctx.fillText(field.label, x, y); y += 38;
      ctx.fillStyle = field.tone === "positive" ? "#5ee1ad" : field.tone === "negative" ? "#ff6b7a" : "#f3f4f6";
      ctx.font = `32px ${font}`;
      for (const line of field.lines) {
        ctx.direction = /[\u0590-\u08ff]/.test(line) ? "rtl" : "ltr";
        ctx.fillText(line, x, y); y += 44;
      }
      y += 24;
    }
    pictures.forEach((picture, i) => { ctx.drawImage(picture, padding, y, contentWidth, imageHeights[i]); y += imageHeights[i] + 30; });
    ctx.fillStyle = "#aeb7c4"; ctx.font = `21px ${font}`; ctx.direction = rtl ? "rtl" : "ltr"; ctx.textAlign = rtl ? "right" : "left";
    ctx.fillText(rtl ? "محتوى اختاره صاحبه للمشاركة" : "Selected by the journal owner for sharing", x, height - 66);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Image unavailable")), "image/png"));
  } finally { pictures.forEach(picture => picture.close()); }
}
