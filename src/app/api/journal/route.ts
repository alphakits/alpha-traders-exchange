import { NextRequest } from "next/server";
import { journalAccess, journalError, journalJson } from "@/lib/journal/api";
import { readJournal } from "@/lib/journal/repository";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const { user, response } = await journalAccess(request);
  if (!user) return response;
  const raw = request.nextUrl.searchParams.get("offset") ?? "0";
  if (!/^\d{1,7}$/.test(raw) || Number(raw) % 500 !== 0) return journalJson({ error: "Invalid page." }, 400);
  try { return journalJson(await readJournal(user.id,Number(raw))); } catch (error) { return journalError(error); }
}
