import { NextRequest } from "next/server";
import { z } from "zod";
import { journalAccess, journalBody, journalError, journalJson } from "@/lib/journal/api";
import { journalId } from "@/lib/journal/validation";
import { deleteTrade } from "@/lib/journal/repository";
export const runtime = "nodejs";
export async function DELETE(request: NextRequest, context: { params: Promise<{id:string}> }) {
  const { user, response } = await journalAccess(request,true);
  if (!user) return response;
  try {
    const id = journalId.parse((await context.params).id);
    const input = await journalBody(request,z.object({ version: z.number().int().positive() }).strict());
    await deleteTrade(user.id,id,input.version);
    return journalJson({ ok: true });
  } catch (error) { return journalError(error); }
}
