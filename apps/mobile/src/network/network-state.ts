export type NativeNetworkSnapshot = {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
};

export function resolveNativeNetworkAvailability(
  snapshot: NativeNetworkSnapshot,
): boolean | null {
  if (snapshot.isConnected === false || snapshot.isInternetReachable === false) {
    return false;
  }
  if (snapshot.isConnected === true || snapshot.isInternetReachable === true) {
    return true;
  }
  return null;
}
