// @vitest-environment node
import { expect, it, vi } from "vitest";
import { isCompactListingDevice } from "./compact-listing-device";

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));

const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
it.each([
  ["desktop Safari", mac + " Version/18.1 Safari/605.1.15", "", true],
  ["iPad Chrome requesting desktop", mac + " CriOS/145 Version/18.1 Safari/605.1.15", "", true],
  ["macOS Chrome", mac + " Chrome/145.0.0.0 Safari/537.36", "", false],
  ["macOS Firefox", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:136.0) Gecko/20100101 Firefox/136.0", "", false],
  ["mobile client hint", "Mozilla/5.0", "?1", true],
] as const)("keeps the correct listing presentation for %s", async (_case, ua, mobileHint, compact) => {
  request.headers = new Headers({ "user-agent": ua, "sec-ch-ua-mobile": mobileHint });
  expect(await isCompactListingDevice()).toBe(compact);
});
