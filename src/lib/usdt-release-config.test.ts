import { describe, expect, it } from "vitest";
import { validateUsdtReleaseConfig, validateUsdtReleaseRuntime, validateUsdtReleaseState } from "./usdt-release-config";

const release = { NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://www.alphatraders.co.il" };
describe("Buy Requests release configuration", () => {
  it.each(["24.20.0", "24.22.0", "22.16.0", "25.0.0", "24.22.1-rc.1"])("rejects an unapproved or unpatched Node runtime %s", version => {
    expect(validateUsdtReleaseRuntime(version)).toHaveLength(1);
  });
  it.each(["24.22.1", "24.22.2", "24.23.0"])("accepts a patched Node24 runtime %s", version => {
    expect(validateUsdtReleaseRuntime(version)).toEqual([]);
  });
  it("accepts a disabled initial rollout and an explicitly enabled release with private key material", () => {
    expect(validateUsdtReleaseState(release, "off")).toEqual([]);
    expect(validateUsdtReleaseState({ ...release, ALPHA_USDT_REQUESTS_ENABLED: "1", ALPHA_EXCHANGE_CARDLESS_CREDENTIAL_SECRET: "private-release-key-material-of-at-least-32-characters" }, "on")).toEqual([]);
  });
  it.each(["true", "false", "01", " 1", "yes"])("rejects ambiguous feature values %j", value => {
    expect(validateUsdtReleaseConfig({ ALPHA_USDT_REQUESTS_ENABLED: value })).toHaveLength(1);
  });
  it.each(["ALPHA_USDT_OFFLINE_PREVIEW", "ALPHA_USDT_OFFLINE_QUOTE_SCENARIOS"])("rejects even an apparently disabled offline marker %s", key => {
    expect(validateUsdtReleaseConfig({ [key]: "0" })[0]).toContain(key);
  });
  it.each(["offline-preview-synthetic-credentials-only", "alpha-exchange-loopback-e2e-cardless-key-only"])("rejects a copied synthetic encryption key", secret => {
    for (const key of ["ALPHA_EXCHANGE_CARDLESS_CREDENTIAL_SECRET", "ALPHA_EXCHANGE_CARDLESS_CREDENTIAL_PREVIOUS_SECRET"]) {
      const errors = validateUsdtReleaseConfig({ [key]: secret });
      expect(errors).toHaveLength(1); expect(errors[0]).toContain(key); expect(errors[0]).not.toContain(secret);
    }
  });
  it.each(["https://usdt-offline.invalid/quote", "https://usdt-offline.invalid./quote", "http://rates.example.com", "https://localhost/quote", "https://localhost./", "https://0.0.0.0/", "https://127.0.0.1/quote", "https://[::1]/quote", "https://[::ffff:127.0.0.1]/", "https://secret-user:secret-password@rates.example.com"])("refuses a synthetic or insecure quote URL without echoing it", endpoint => {
    const errors = validateUsdtReleaseConfig({ ALPHA_FX_REFERENCE_URL: endpoint });
    expect(errors).toHaveLength(1); expect(errors[0]).not.toContain(endpoint);
  });
  it.each(["https://localhost./", "https://0.0.0.0/", "https://[::ffff:127.0.0.1]/", "https://usdt-offline.invalid./", "https://www.alphatraders.co.il/private?secret=value"])("requires an actual release origin %s", endpoint => {
    expect(validateUsdtReleaseState({ ...release, NEXT_PUBLIC_SITE_URL: endpoint }, "off")).toHaveLength(1);
  });
  it("does not allow local production exemptions to satisfy a release preflight", () => {
    const errors = validateUsdtReleaseState({ ...release, ALPHA_E2E_TEST_SUPPORT: "1", ALPHA_E2E_LOOPBACK_ONLY: "1", ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY: "1" }, "off");
    expect(errors).toHaveLength(3);
  });
  it("requires the requested rollout state and stops demand email during rollback", () => {
    expect(validateUsdtReleaseState({ ...release, ALPHA_USDT_REQUESTS_ENABLED: "1", ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED: "1" }, "off")).toHaveLength(4);
    expect(validateUsdtReleaseState(release, "on")).toHaveLength(2);
    expect(validateUsdtReleaseState({ ...release, NODE_ENV: "development" }, "off")[0]).toContain("NODE_ENV");
  });
  it("keeps email-off releases valid without provider configuration", () => {
    expect(validateUsdtReleaseConfig({ VERCEL_ENV: "preview", ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED: "0" })).toEqual([]);
  });
  it.each(["RESEND_API_KEY", "EMAIL_FROM"])("requires %s only when email is enabled without exposing values", key => {
    const env = { ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED: "1", RESEND_API_KEY: "private-provider-credential", EMAIL_FROM: "private-sender@example.com", [key]: " " };
    expect(validateUsdtReleaseConfig(env)).toEqual([`Buy Requests email delivery requires ${key}.`]);
  });
  it.each([undefined, "", "*", "allowed@example.com,*", "@example.com"])("blocks enabled preview email with invalid allowlist %s", allowlist => {
    expect(validateUsdtReleaseConfig({ VERCEL_ENV: "preview", ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED: "1", RESEND_API_KEY: "configured", EMAIL_FROM: "sender@example.com", ALPHA_EMAIL_STAGING_ALLOWLIST: allowlist }))
      .toEqual(["Preview email delivery requires ALPHA_EMAIL_STAGING_ALLOWLIST with exact, comma-separated approved email addresses."]);
  });
  it("accepts configured preview email and does not constrain production recipients", () => {
    const env = { ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED: "1", RESEND_API_KEY: "configured", EMAIL_FROM: "sender@example.com" };
    expect(validateUsdtReleaseConfig({ ...env, VERCEL_ENV: "preview", ALPHA_EMAIL_STAGING_ALLOWLIST: "approved@example.com" })).toEqual([]);
    expect(validateUsdtReleaseConfig({ ...env, VERCEL_ENV: "production" })).toEqual([]);
  });
});
