import { NextRequest, NextResponse } from "next/server";
import { getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import { invalidateAlphaExchangeStoreCache, runAlphaExchangeMaintenance } from "@/lib/alpha-exchange-store";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";

const TEST_SUPPORT_HEADER = "x-alpha-test-support";

declare global {
  var __alphaExchangeTestingStateQueue: Promise<void> | undefined;
}

function isEnabled(request: NextRequest) {
  const headerEnabled = request.headers.get(TEST_SUPPORT_HEADER) === "enabled";
  if (!headerEnabled) return false;
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.ALPHA_ENABLE_TEST_SUPPORT === "1";
}

async function withTestingStateQueue<T>(operation: () => Promise<T>) {
  const previous = globalThis.__alphaExchangeTestingStateQueue ?? Promise.resolve();
  let release!: () => void;
  globalThis.__alphaExchangeTestingStateQueue = previous
    .catch(() => undefined)
    .then(() => new Promise<void>((resolve) => {
      release = resolve;
    }));
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
  }
}

async function parseSnapshotPayload(request: NextRequest) {
  const raw = await request.text();
  if (!raw.trim()) {
    return { ok: false as const, error: "Empty request body." };
  }
  try {
    return { ok: true as const, snapshot: JSON.parse(raw) as AlphaExchangeDb };
  } catch {
    return { ok: false as const, error: "Invalid JSON payload." };
  }
}

const MAX_TEST_SNAPSHOT_NOTIFICATIONS = 2400;

function pruneTestingSnapshot(snapshot: AlphaExchangeDb): AlphaExchangeDb {
  const notifications = Array.isArray(snapshot.notifications) ? snapshot.notifications : [];
  if (notifications.length <= MAX_TEST_SNAPSHOT_NOTIFICATIONS) return snapshot;
  return {
    ...snapshot,
    notifications: notifications.slice(0, MAX_TEST_SNAPSHOT_NOTIFICATIONS),
  };
}

export async function GET(request: NextRequest) {
  if (!isEnabled(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    return await withTestingStateQueue(async () => {
      const repository = await getAlphaExchangeRepository();
      const snapshot = await repository.loadSnapshot();
      const pruned = pruneTestingSnapshot(snapshot);
      if (pruned !== snapshot) {
        await repository.saveSnapshot(pruned);
        invalidateAlphaExchangeStoreCache();
      }
      return NextResponse.json(pruned, {
        headers: {
          "Cache-Control": "no-store",
        },
      });
    });
  } catch (error) {
    console.error("[testing/alpha-exchange-state] GET failed", error);
    return NextResponse.json({ error: "Failed to read runtime state." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  if (!isEnabled(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const parsed = await parseSnapshotPayload(request);
    if (!parsed.ok) {
      return NextResponse.json({ error: "Invalid runtime state payload." }, { status: 400 });
    }
      const snapshot = pruneTestingSnapshot(parsed.snapshot);
    await withTestingStateQueue(async () => {
      const repository = await getAlphaExchangeRepository();
      await repository.saveSnapshot(snapshot);
      invalidateAlphaExchangeStoreCache();
      await runAlphaExchangeMaintenance();
    });
  } catch (error) {
    console.error("[testing/alpha-exchange-state] PUT failed", error);
    return NextResponse.json({ error: "Failed to write runtime state." }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
