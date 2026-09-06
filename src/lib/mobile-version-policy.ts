import {
  MOBILE_API_VERSION,
  MOBILE_CURRENT_APP_VERSION,
  type MobilePlatform,
} from "@alpha-traders/contracts";

type VersionTuple = readonly [major: number, minor: number, patch: number];

type MobileVersionEnvironmentKey =
  | "MOBILE_MIN_IOS_VERSION"
  | "MOBILE_LATEST_IOS_VERSION"
  | "MOBILE_MIN_ANDROID_VERSION"
  | "MOBILE_LATEST_ANDROID_VERSION";

type MobileVersionEnvironment = Readonly<Record<string, string | undefined>>;

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseMobileAppVersion(value: string): VersionTuple | null {
  const match = VERSION_PATTERN.exec(value.trim());
  if (!match) return null;
  const tuple = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  return tuple.every(Number.isSafeInteger) ? tuple : null;
}

export function compareMobileAppVersions(left: string, right: string) {
  const leftVersion = parseMobileAppVersion(left);
  const rightVersion = parseMobileAppVersion(right);
  if (!leftVersion || !rightVersion) return null;
  for (let index = 0; index < leftVersion.length; index += 1) {
    const difference = leftVersion[index] - rightVersion[index];
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

function configuredVersion(
  environment: MobileVersionEnvironment,
  key: MobileVersionEnvironmentKey,
) {
  const value = environment[key]?.trim() ?? "";
  return parseMobileAppVersion(value) ? value : MOBILE_CURRENT_APP_VERSION;
}

export function resolveMobileVersionPolicy(
  platform: MobilePlatform,
  currentVersion: string,
  environment: MobileVersionEnvironment = process.env,
) {
  const minimumKey = platform === "ios" ? "MOBILE_MIN_IOS_VERSION" : "MOBILE_MIN_ANDROID_VERSION";
  const latestKey = platform === "ios" ? "MOBILE_LATEST_IOS_VERSION" : "MOBILE_LATEST_ANDROID_VERSION";
  const minimumSupportedVersion = configuredVersion(environment, minimumKey);
  const configuredLatestVersion = configuredVersion(environment, latestKey);
  const latestVersion = compareMobileAppVersions(configuredLatestVersion, minimumSupportedVersion) === -1
    ? minimumSupportedVersion
    : configuredLatestVersion;
  const minimumComparison = compareMobileAppVersions(currentVersion, minimumSupportedVersion);
  const latestComparison = compareMobileAppVersions(currentVersion, latestVersion);
  const updateRequired = minimumComparison === null || minimumComparison < 0;

  return {
    apiVersion: MOBILE_API_VERSION,
    platform,
    currentVersion,
    minimumSupportedVersion,
    latestVersion,
    updateRequired,
    updateRecommended: !updateRequired && latestComparison !== null && latestComparison < 0,
  } as const;
}
