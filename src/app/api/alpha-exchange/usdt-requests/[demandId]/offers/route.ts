import { NextRequest } from "next/server";
import { demandApi, demandBody } from "@/lib/usdt-demand-api";
import { offerDemand, withdrawOffer } from "@/lib/usdt-demand-store";
import { z } from "zod";
type Context = { params: Promise<{ demandId: string }> };
export function POST(request: NextRequest, context: Context) {
  return demandApi(request, true, async id => { const offer = await offerDemand(id, (await context.params).demandId, await demandBody(request)); return { id: offer.id }; });
}
export function DELETE(request: NextRequest, context: Context) {
  return demandApi(request, true, async id => {
    const body = z.object({ offerId: z.string().min(1).max(100) }).strict().parse(await demandBody(request));
    await withdrawOffer(id, (await context.params).demandId, body.offerId); return { ok: true };
  });
}
