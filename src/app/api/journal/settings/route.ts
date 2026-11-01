import { NextRequest } from "next/server";
import { journalAccess, journalBody, journalError, journalJson } from "@/lib/journal/api";
import { journalSettingsInput } from "@/lib/journal/validation";
import { saveSettings } from "@/lib/journal/repository";
export const runtime = "nodejs";
export async function PUT(request: NextRequest) {
  const { user, response } = await journalAccess(request,true);
  if (!user) return response;
  try { return journalJson({ settings: await saveSettings(user.id,await journalBody(request,journalSettingsInput)) }); }
  catch (error) { return journalError(error); }
}
