import { NextRequest } from "next/server";
import { demandApi, demandBody } from "@/lib/usdt-demand-api";
import { publishDemand, readDemands } from "@/lib/usdt-demand-store";
export const dynamic = "force-dynamic";
export function GET(request: NextRequest) {
  return demandApi(request, false, id => readDemands(id, { scope: request.nextUrl.searchParams.get("scope") ?? "mine", cursor: request.nextUrl.searchParams.get("cursor") ?? undefined }));
}
export function POST(request: NextRequest) {
  return demandApi(request, true, async id => {
    const demand = await publishDemand(id, await demandBody(request));
    return { id: demand.id, destination: `/usdt-exchange/requests/${encodeURIComponent(demand.id)}` };
  });
}
