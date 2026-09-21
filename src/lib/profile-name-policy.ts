export const PROFILE_NAME_CHANGE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export function nextProfileNameChangeAt(changedAt?: string): string | undefined {
  const time = changedAt ? Date.parse(changedAt) : NaN;
  return Number.isFinite(time) ? new Date(time + PROFILE_NAME_CHANGE_INTERVAL_MS).toISOString() : undefined;
}

export class ProfileNameCooldownError extends Error {
  constructor(public readonly nextAllowedAt: string) {
    super("You can change your profile name once every 7 days.");
    this.name = "ProfileNameCooldownError";
  }
}
