import { NextRequest, NextResponse } from "next/server";
import {
  clearMarketplaceEmailAttempts,
  listMarketplaceEmailAttempts,
} from "@/lib/marketplace-email-delivery";

const TEST_SUPPORT_HEADER = "x-alpha-test-support";

function isEnabled(request: NextRequest) {
  return process.env.NODE_ENV !== "production" && request.headers.get(TEST_SUPPORT_HEADER) === "enabled";
}

export async function GET(request: NextRequest) {
  if (!isEnabled(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  return NextResponse.json({ attempts: listMarketplaceEmailAttempts() }, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function DELETE(request: NextRequest) {
  if (!isEnabled(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  clearMarketplaceEmailAttempts();
  return NextResponse.json({ ok: true }, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
