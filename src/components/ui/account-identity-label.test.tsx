import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountIdentityLabel } from "./account-identity-label";

describe("owner-only account identity label", () => {
  it.each(["Amir Hassan", "أحمد علي", "A Very Long Private Name With Several Parts"])("renders the server-projected name beside the same AT ID for an owner: %s", name => {
    const html = renderToStaticMarkup(<AccountIdentityLabel publicId="AT-123456" label={`AT-123456 (${name})`} canViewPrivateIdentity />);
    expect(html).toContain("AT-123456");
    expect(html).toContain(`(${name})`);
    expect(html).toContain("flex-wrap");
    expect(html).toContain('dir="auto"');
  });
  it("keeps a name hidden without owner capability even if stale data contains it", () => {
    const html = renderToStaticMarkup(<AccountIdentityLabel publicId="AT-123456" label="AT-123456 (Private Buyer)" />);
    expect(html).toContain("AT-123456");
    expect(html).not.toContain("Private Buyer");
  });
  it.each(["Private Buyer", "AT-654321 (Private Buyer)", "AT-123456", "AT-123456 (Private Buyer"])("does not invent or misattribute a name from %s", label => {
    const html = renderToStaticMarkup(<AccountIdentityLabel publicId="AT-123456" label={label} canViewPrivateIdentity />);
    expect(html).toContain("AT-123456");
    expect(html).not.toContain("Private Buyer");
  });
  it("renders names as escaped text", () => {
    const html = renderToStaticMarkup(<AccountIdentityLabel publicId="AT-123456" label={'AT-123456 (<script>alert(1)</script>)'} canViewPrivateIdentity />);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
