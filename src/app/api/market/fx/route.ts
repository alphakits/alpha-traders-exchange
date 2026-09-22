import { NextResponse } from "next/server";
import { FX_CURRENCIES, parseFxReference } from "@/lib/fx-reference";

export async function GET() {
  try {
    const start = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const end = new Date().toISOString().slice(0, 10);
    const response = await fetch(`https://api.frankfurter.dev/v2/rates?base=USD&quotes=${FX_CURRENCIES.join(",")}&from=${start}&to=${end}`, {
      next: { revalidate: 3600 }, signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("FX unavailable");
    return NextResponse.json(parseFxReference(await response.json()), { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
  } catch {
    return NextResponse.json({ error: "FX_REFERENCE_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
