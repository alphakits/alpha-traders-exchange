import { headers } from "next/headers";
import { userAgentFromString } from "next/server";

/** Keep phones, tablets and Safari on the compact card, including at desktop widths. */
export async function isCompactListingDevice(): Promise<boolean> {
  const requestHeaders = await headers();
  if (requestHeaders.get("sec-ch-ua-mobile") === "?1") return true;
  const { browser, device } = userAgentFromString(requestHeaders.get("user-agent") ?? "");
  return device.type === "mobile" || device.type === "tablet" || browser.name === "Safari" || browser.name === "Mobile Safari";
}
