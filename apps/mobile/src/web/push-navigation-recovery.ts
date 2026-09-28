export type WebsiteSource = {
  uri: string;
  headers?: Record<string, string>;
};

export type PreparedWebsiteSource = {
  source: WebsiteSource;
  consumedPushUrl: string | null;
};

/**
 * A notification can be opened while the asynchronous startup/session
 * migration source is still being prepared. The trusted notification target
 * wins that race, but it is consumed once so a later preparation cannot reopen
 * an old Trade Room. Migration headers must never follow the push URL.
 */
export function resolvePreparedWebsiteSource(
  initialSource: WebsiteSource,
  pendingPushUrl: string | null,
): PreparedWebsiteSource {
  if (!pendingPushUrl) {
    return { source: initialSource, consumedPushUrl: null };
  }

  return {
    source: { uri: pendingPushUrl },
    consumedPushUrl: pendingPushUrl,
  };
}

/**
 * Clear only the notification target that was actually consumed. If a newer
 * tap arrived between reading and committing the source, preserve it.
 */
export function pendingPushUrlAfterConsumption(
  currentPendingPushUrl: string | null,
  consumedPushUrl: string | null,
) {
  if (!consumedPushUrl || currentPendingPushUrl !== consumedPushUrl) {
    return currentPendingPushUrl;
  }
  return null;
}
