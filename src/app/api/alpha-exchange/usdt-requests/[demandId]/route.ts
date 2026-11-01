import { NextRequest } from "next/server";
import { demandApi, demandBody } from "@/lib/usdt-demand-api";
import { editDemand, readDemands } from "@/lib/usdt-demand-store";
type Context = { params: Promise<{ demandId: string }> };
export function GET(request: NextRequest, context: Context) {
  return demandApi(request, false, async id => readDemands(id, { id: (await context.params).demandId }));
}
export function PATCH(request: NextRequest, context: Context) {
  return demandApi(request, true, async id => { await editDemand(id, (await context.params).demandId, await demandBody(request)); return { ok: true }; });
}
