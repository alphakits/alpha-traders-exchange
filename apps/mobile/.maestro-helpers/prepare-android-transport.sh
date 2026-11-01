#!/usr/bin/env bash
set -euo pipefail

# Only the disposable EAS Android test device and guest app are prepared here.
android_transport_deadline=$((SECONDS + 45))
android_transport_stable_reads=0

wait_for_stable_android_transport() {
  android_transport_stable_reads=0
  while (( SECONDS < android_transport_deadline )); do
    android_transport_state=$(timeout 3s adb get-state 2>/dev/null || true)
    android_transport_boot=$(timeout 3s adb shell getprop sys.boot_completed 2>/dev/null || true)
    android_transport_boot=${android_transport_boot//$'\r'/}
    if [[ "$android_transport_state" == device && "$android_transport_boot" == 1 ]]; then
      android_transport_stable_reads=$((android_transport_stable_reads + 1))
      if (( android_transport_stable_reads >= 3 )); then
        return 0
      fi
    else
      android_transport_stable_reads=0
    fi
    sleep 1
  done
  echo "Android emulator transport did not remain connected and fully booted." >&2
  return 1
}

wait_for_stable_android_transport
android_transport_package=$(timeout 3s adb shell pm path com.alphakits.alphatraders 2>/dev/null || true)
if [[ "$android_transport_package" == package:* ]]; then
  # Perform the cold app reset before Maestro creates its driver connection.
  reset_cold_guest_app() {
    timeout 5s adb shell am force-stop com.alphakits.alphatraders >/dev/null \
      && timeout 5s adb shell pm clear com.alphakits.alphatraders >/dev/null
  }
  if ! reset_cold_guest_app; then
    wait_for_stable_android_transport
    reset_cold_guest_app
  fi
  wait_for_stable_android_transport
fi
echo "Android emulator transport is stable; guest UI assertions will run once."
