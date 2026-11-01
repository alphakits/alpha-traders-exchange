import "server-only";

export type NewsProvider = "trading-economics" | "fxstreet";
type Environment = Readonly<Record<string, string | undefined>>;

export function configuredNewsProvider(env: Environment = process.env): NewsProvider | null {
  // A quote request or a personal charting subscription is not a data licence.
  if (env.ECONOMIC_NEWS_DATA_LICENSE_CONFIRMED !== "true"
    || env.ECONOMIC_NEWS_WHITE_LABEL_CONFIRMED !== "true") return null;
  if (env.ECONOMIC_NEWS_PROVIDER === "trading-economics" && env.TRADING_ECONOMICS_API_KEY?.trim()) return "trading-economics";
  if (env.ECONOMIC_NEWS_PROVIDER === "fxstreet" && env.FXSTREET_CLIENT_ID?.trim() && env.FXSTREET_CLIENT_SECRET?.trim()) return "fxstreet";
  return null;
}

export function newsProviderConfigured(env: Environment = process.env) {
  return configuredNewsProvider(env) !== null;
}

export function newsProviderPrefix(provider: NewsProvider) {
  return provider === "fxstreet" ? "fxs-" : "te-";
}
