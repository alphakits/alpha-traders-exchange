import { NextRequest } from "next/server";
import { journalAccess, journalError, journalHeaders, journalJson } from "@/lib/journal/api";
import { journalId } from "@/lib/journal/validation";
import { attachmentKey, deleteAttachment, JOURNAL_BUCKET } from "@/lib/journal/repository";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, context: Context) {
  const { user, response } = await journalAccess(request);
  if (!user) return response;
  try {
    const key = await attachmentKey(user.id,journalId.parse((await context.params).id));
    const { data,error } = await createSupabaseAdminClient().storage.from(JOURNAL_BUCKET).download(key);
    if (error || !data) throw error ?? new Error("Chart unavailable");
    return new Response(await data.arrayBuffer(), { headers: { ...journalHeaders, "Content-Type": "image/webp", "Content-Disposition": 'inline; filename="chart.webp"', "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return journalError(error); }
}
export async function DELETE(request: NextRequest, context: Context) {
  const { user, response } = await journalAccess(request,true);
  if (!user) return response;
  try {
    await deleteAttachment(user.id,journalId.parse((await context.params).id));
    return journalJson({ ok: true });
  } catch (error) { return journalError(error); }
}
