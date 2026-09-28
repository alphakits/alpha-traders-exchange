export type MobileAppState = "active" | "background" | "inactive" | "unknown" | "extension";

export function shouldLockForAppState({
  enabled,
  authenticated,
  nextState,
}: {
  enabled: boolean;
  authenticated: boolean;
  nextState: MobileAppState;
}) {
  return enabled && authenticated && nextState !== "active";
}

export function shouldMaskAuthenticatedContent({
  authenticated,
  checking,
  locked,
}: {
  authenticated: boolean;
  checking: boolean;
  locked: boolean;
}) {
  return authenticated && !checking && locked;
}
