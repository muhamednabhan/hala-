# HALA Phone: install and first run

SwiftUI app that looks like the stock Phone and Messages apps and talks to the HALA agent. Built by the
GitHub Actions workflow in this repo (Actions → *HALA Phone (iOS)* → latest run → artifact **HalaPhone-ipa**).

## Install (free Apple ID, no paid developer account)

1. Download `HalaPhone.ipa` from the run's artifacts and unzip the artifact.
2. **Sideloadly** (Windows/Mac) or **AltStore**: plug in the iPhone, sign in with your Apple ID, drag the IPA in.
3. On the iPhone: Settings → General → VPN & Device Management → trust your Apple ID. On iOS 16+, also turn on Developer Mode (Settings → Privacy & Security).
4. The app expires after 7 days with a free Apple ID; re-install the same way.

## First run

- Allow notifications and the microphone when asked (the mic prompt appears on the first call).
- **Lines** tab → *Test connection*. It names anything missing on the server.
- Scanning the robot page's QR code with the Camera app opens the app on Messages with the code filled in and sets the server address. If the app has no server yet, it opens on Lines.
- Switch *Keep line open in background* on if HALA should ring you while the phone is locked or the app is in the background. Do not force-quit the app.

## Build it yourself

`xcodegen generate` in this folder, then open `HalaPhone.xcodeproj` in Xcode 26 and run. To bake in a server address, set the build setting `HALA_DEFAULT_SERVER`.
Simulator screenshots with sample data: `scripts/screenshots.sh` (the CI run uploads them as an artifact).

## What it cannot do without a paid developer account

A ring while the app is closed (needs VoIP push) and the native iOS call screen on lock screen (needs CallKit + PushKit).
Everything else works. See `agent/11-phone/README.md` in the HALA repo.
