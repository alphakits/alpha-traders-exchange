import { NextRequest } from "next/server";
import { journalAccess, journalBody, journalError, journalJson } from "@/lib/journal/api";
import { journalReviewInput } from "@/lib/journal/validation";
import { saveReview } from "@/lib/journal/repository";
export const runtime = "nodejs";
export async function PUT(request: NextRequest) {
  const { user, response } = await journalAccess(request,true);
  if (!user) return response;
  try { return journalJson({ review: await saveReview(user.id,await journalBody(request,journalReviewInput)) }); }
  catch (error) { return journalError(error); }
}
