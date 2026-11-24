#!/usr/bin/env bash
# Boots an iPhone simulator, installs the Debug build and captures the main screens using the app's demo
# launch arguments (no network, no real data). Output: ./shots/*.png
set -euo pipefail

BUNDLE=com.teamkanban.halaphone
APP=build/sim/Build/Products/Debug-iphonesimulator/HalaPhone.app
UDID=$(xcrun simctl list devices available | grep -E "iPhone 17 \(" | head -1 | grep -oE '[0-9A-F]{8}-([0-9A-F]{4}-){3}[0-9A-F]{12}')
echo "Simulator: $UDID"

xcrun simctl boot "$UDID" || true
xcrun simctl bootstatus "$UDID" -b
xcrun simctl status_bar "$UDID" override --time "9:41" --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3 || true
xcrun simctl install "$UDID" "$APP"
mkdir -p shots

shot() {
  local name=$1; shift
  xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true
  xcrun simctl launch "$UDID" "$BUNDLE" -HALA_DEMO 1 "$@" >/dev/null
  sleep 5
  xcrun simctl io "$UDID" screenshot "shots/$name.png"
  echo "captured $name"
}

xcrun simctl ui "$UDID" appearance light
shot keypad            -HALA_TAB 2
shot recents           -HALA_TAB 0
shot contacts          -HALA_TAB 1
shot messages-list     -HALA_TAB 3
shot messages-thread   -HALA_TAB 3 -HALA_THREAD 1
shot lines             -HALA_TAB 4
shot call-connected    -HALA_TAB 2 -HALA_CALL connected
shot call-incoming     -HALA_TAB 2 -HALA_CALL incoming
shot call-failed       -HALA_TAB 2 -HALA_CALL failed

xcrun simctl ui "$UDID" appearance dark
shot dark-keypad       -HALA_TAB 2
shot dark-thread       -HALA_TAB 3 -HALA_THREAD 1
