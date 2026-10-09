import { NextRequest } from "next/server";
import { journalAccess, journalBody, journalError, journalJson } from "@/lib/journal/api";
import { journalTradeInput } from "@/lib/journal/validation";
import { saveTrade } from "@/lib/journal/repository";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const { user, response } = await journalAccess(request,true);
  if (!user) return response;
  try { return journalJson({ trade: await saveTrade(user.id,await journalBody(request,journalTradeInput)) }); }
  catch (error) { return journalError(error); }
}
