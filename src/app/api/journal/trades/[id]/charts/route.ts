import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { journalAccess, journalError, journalJson } from "@/lib/journal/api";
import { journalId } from "@/lib/journal/validation";
import { listAttachments, reserveAttachment, finishAttachment, deleteAttachment, JOURNAL_BUCKET } from "@/lib/journal/repository";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { sanitizeProfileImage } from "@/lib/profile-image-sanitization";
import { validateUploadContent } from "@/lib/file-content-validation";
import { RequestBodyTooLargeError } from "@/lib/request-body";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, context: Context) {
  const { user, response } = await journalAccess(request);
  if (!user) return response;
  try { return journalJson({ charts: await listAttachments(user.id,journalId.parse((await context.params).id)) }); }
  catch (error) { return journalError(error); }
}
export async function POST(request: NextRequest, context: Context) {
  const { user, response } = await journalAccess(request,true);
  if (!user) return response;
  let reservedId: string | null = null;
  try {
    const tradeId = journalId.parse((await context.params).id);
    const mime = request.headers.get("content-type") ?? "";
    if (mime !== "image/png" && mime !== "image/jpeg" && mime !== "image/webp") return journalJson({ error: "Use a PNG, JPEG, or WebP chart." },400);
    const limit = 3 * 1024 * 1024;
    if (Number(request.headers.get("content-length")) > limit) throw new RequestBodyTooLargeError();
    const reader = request.body?.getReader();
    if (!reader) return journalJson({ error: "Choose a chart." },400);
    const chunks: Buffer[] = []; let size = 0;
    try { while (true) {
      const { done,value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new RequestBodyTooLargeError(); }
      chunks.push(Buffer.from(value));
    } } finally { reader.releaseLock(); }
    const bytes = Buffer.concat(chunks);
    if (!validateUploadContent(bytes,mime)) return journalJson({ error: "This chart image could not be read." },400);
    let image: Awaited<ReturnType<typeof sanitizeProfileImage>>;
    try { image = await sanitizeProfileImage(bytes); }
    catch { return journalJson({ error: "This chart image could not be read." },400); }
    if (image.bytes.length > limit) throw new RequestBodyTooLargeError();
    const id = randomUUID();
    const key = await reserveAttachment(user.id,tradeId,id,"Chart"); reservedId = id;
    const { error } = await createSupabaseAdminClient().storage.from(JOURNAL_BUCKET).upload(key,image.bytes,{ contentType: "image/webp", upsert: false });
    if (error) throw error;
    await finishAttachment(user.id,id); reservedId = null;
    return journalJson({ chart: { id,tradeId,name:"Chart",url:`/api/journal/charts/${id}` } });
  } catch (error) {
    // Deleting the reservation queues retryable storage cleanup in the same transaction.
    if (reservedId) await deleteAttachment(user.id,reservedId).catch(() => undefined);
    return journalError(error);
  }
}
