import { NextRequest, NextResponse } from "next/server";
import { getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import { invalidateAlphaExchangeStoreCache } from "@/lib/alpha-exchange-store";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";

const TEST_SUPPORT_HEADER = "x-alpha-test-support";

function isEnabled(request: NextRequest) {
  return process.env.NODE_ENV !== "production" && request.headers.get(TEST_SUPPORT_HEADER) === "enabled";
}

export async function GET(request: NextRequest) {
  if (!isEnabled(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const repository = await getAlphaExchangeRepository();
  const snapshot = await repository.loadSnapshot();
  return NextResponse.json(snapshot, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function PUT(request: NextRequest) {
  if (!isEnabled(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const snapshot = (await request.json()) as AlphaExchangeDb;
  const repository = await getAlphaExchangeRepository();
  await repository.saveSnapshot(snapshot);
  invalidateAlphaExchangeStoreCache();

  return NextResponse.json({ ok: true }, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
