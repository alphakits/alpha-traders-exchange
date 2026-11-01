import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { getTradeRoomData } from "@/lib/alpha-exchange-store";
import { tradeReceiptDocument } from "@/lib/trade-receipt-render";

export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  Vary: "Cookie, Authorization",
};

export async function GET(request: NextRequest, context: { params: Promise<{ requestId: string }> }) {
  const { user } = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers });
  const { requestId } = await context.params;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(requestId)) return NextResponse.json({ error: "Receipt not found." }, { status: 404, headers });
  try {
    // Canonical database roles and participant checks, never a role/query flag from the browser.
    const room = await getTradeRoomData({ purchaseRequestId: requestId, actorUserId: user.id, actorRole: user.role, strongConsistency: true, markMessagesRead: false });
    const receipt = room.request.completionReceipt;
    if (!receipt) return NextResponse.json({ error: "Receipt not found." }, { status: 404, headers });
    if (request.nextUrl.searchParams.get("format") !== "html") return NextResponse.json({ receipt }, { headers });
    const locale = request.nextUrl.searchParams.get("locale") === "ar" ? "ar" : "en";
    const download = request.nextUrl.searchParams.get("download") === "1";
    return new NextResponse(tradeReceiptDocument(receipt, locale), { headers: {
      ...headers,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="Alpha-Traders-receipt-${requestId}.html"`,
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; sandbox",
    } });
  } catch (error) {
    const denied = error instanceof Error && (error.message === "Trade not found." || error.message.startsWith("You are not allowed"));
    return NextResponse.json({ error: denied ? "Receipt not found." : "Receipt temporarily unavailable." }, { status: denied ? 404 : 503, headers });
  }
}
