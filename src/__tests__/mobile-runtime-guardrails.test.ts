// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { MOBILE_CURRENT_APP_VERSION } from "@alpha-traders/contracts";
import mobileAppConfig from "../../apps/mobile/app.json";
import mobilePackage from "../../apps/mobile/package.json";
import { resolveNativeNetworkAvailability } from "../../apps/mobile/src/network/network-state";
import { requireMobileApiUser } from "@/lib/mobile-api-auth";
import type { MobileAuthService } from "@/lib/mobile-auth";
import {
  compareMobileAppVersions,
  parseMobileAppVersion,
  resolveMobileVersionPolicy,
} from "@/lib/mobile-version-policy";

afterEach(() => {
  vi.unstubAllEnvs();
});

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name === "route.ts" ? [path] : [];
  });
}

describe("native runtime guardrails", () => {
  it("keeps the native binary and server policy version sources aligned", () => {
    expect(mobileAppConfig.expo.version).toBe(MOBILE_CURRENT_APP_VERSION);
    expect(mobilePackage.version).toBe(MOBILE_CURRENT_APP_VERSION);
  });

  it("keeps every mobile endpoint except app config behind a version gate", () => {
    const root = join(process.cwd(), "src/app/api/mobile/v1");
    for (const path of routeFiles(root)) {
      if (path === join(root, "app-config/route.ts")) continue;
      expect(
        readFileSync(path, "utf8"),
        `${relative(root, path)} must enforce the native app version`,
      ).toMatch(/mobileClientVersionError|requireMobileApiUser/);
    }
  });

  it("parses and compares strict semantic app versions", () => {
    expect(parseMobileAppVersion("1.2.3")).toEqual([1, 2, 3]);
    expect(parseMobileAppVersion("01.2.3")).toBeNull();
    expect(parseMobileAppVersion("1.2")).toBeNull();
    expect(compareMobileAppVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareMobileAppVersions("2.0.0", "2.0.0")).toBe(0);
    expect(compareMobileAppVersions("1.9.9", "2.0.0")).toBe(-1);
    expect(compareMobileAppVersions("beta", "1.0.0")).toBeNull();
  });

  it("resolves platform-specific minimum and recommended update policy safely", () => {
    const environment = {
      MOBILE_MIN_IOS_VERSION: "2.0.0",
      MOBILE_LATEST_IOS_VERSION: "2.2.0",
      MOBILE_MIN_ANDROID_VERSION: "1.5.0",
      MOBILE_LATEST_ANDROID_VERSION: "1.4.0",
    };

    expect(resolveMobileVersionPolicy("ios", "1.9.9", environment)).toMatchObject({
      minimumSupportedVersion: "2.0.0",
      latestVersion: "2.2.0",
      updateRequired: true,
      updateRecommended: false,
    });
    expect(resolveMobileVersionPolicy("ios", "2.1.0", environment)).toMatchObject({
      updateRequired: false,
      updateRecommended: true,
    });
    expect(resolveMobileVersionPolicy("android", "1.5.0", environment)).toMatchObject({
      minimumSupportedVersion: "1.5.0",
      latestVersion: "1.5.0",
      updateRequired: false,
      updateRecommended: false,
    });
  });

  it("fails closed for malformed client versions and safe-defaults malformed policy values", () => {
    expect(resolveMobileVersionPolicy("ios", "release-candidate", {
      MOBILE_MIN_IOS_VERSION: "not-a-version",
      MOBILE_LATEST_IOS_VERSION: "also-invalid",
    })).toMatchObject({
      minimumSupportedVersion: "1.0.0",
      latestVersion: "1.0.0",
      updateRequired: true,
    });
  });

  it.each([
    [{ isConnected: false, isInternetReachable: true }, false],
    [{ isConnected: true, isInternetReachable: false }, false],
    [{ isConnected: true, isInternetReachable: null }, true],
    [{ isConnected: null, isInternetReachable: true }, true],
    [{ isConnected: null, isInternetReachable: null }, null],
  ] as const)("maps native connectivity %j to %s", (snapshot, expected) => {
    expect(resolveNativeNetworkAvailability(snapshot)).toBe(expected);
  });

  it("blocks unsupported versions before private token validation", async () => {
    vi.stubEnv("MOBILE_MIN_ANDROID_VERSION", "2.0.0");
    const request = new NextRequest("https://www.alphatraders.co.il/api/mobile/v1/auth/me");
    const result = await requireMobileApiUser(
      request,
      "runtime-guard-request",
      {
        deviceId: "550e8400-e29b-41d4-a716-446655440000",
        appVersion: "1.0.0",
        platform: "android",
        locale: "en",
      },
      {} as MobileAuthService,
    );

    expect(result.unauthorized?.status).toBe(426);
    await expect(result.unauthorized?.json()).resolves.toMatchObject({
      error: { code: "APP_UPDATE_REQUIRED" },
      requestId: "runtime-guard-request",
    });
  });
});
