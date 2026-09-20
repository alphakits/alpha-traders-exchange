/** Re-fetch the current document, keeping the trade URL and never replaying a mutation. */
export function reloadCurrentPage() {
  window.location.reload();
}

/** Bound automatic reloads if an account read recovers before the page does. */
export function reloadAfterSessionRecovery() {
  try {
    const key = "alpha-session-recovery-reload";
    const lastReload = Number(window.sessionStorage.getItem(key));
    if (lastReload > 0 && Date.now() - lastReload < 60_000) return;
    window.sessionStorage.setItem(key, String(Date.now()));
  } catch {
    // If storage is unavailable, leave the explicit retry button in control.
    return;
  }
  reloadCurrentPage();
}
