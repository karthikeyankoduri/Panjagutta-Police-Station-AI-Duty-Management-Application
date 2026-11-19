# Panjagutta Duty Management for Flutter

This app uses the same FastAPI server as the native Android and web apps. The
first migration milestone includes sign-in, required password changes, staff
profile, published duties, duty change requests, duty calendar, today's
attendance, tasks, outside movements, the notification inbox, and admin Live Locations.

## Run locally

Use Flutter 3.47.4 and an Android SDK with API 36. The current Flutter project
requires Android 7.0 (API 24) or later. An iOS build requires macOS,
Xcode, and Apple signing for physical devices.

```sh
flutter pub get
flutter analyze
flutter test
flutter run --dart-define=API_BASE_URL=https://your-station-server.example
```

The sign-in screen also accepts a server address. Android debug builds can use a
local HTTP server. Use HTTPS on iOS and for release builds. An Android upgrade
can read the previous app's server address and requires a new sign-in. Debug
builds use the `.flutterpilot` application ID suffix and install alongside the
native app. A production upgrade needs the existing application ID and signing
configuration, plus a version code higher than the deployed app.

## Live location pilot

1. Sign in to a linked staff account and tap **Start sharing** on Home.
2. Allow location access. Verify Home shows the time of the last successful fix.
3. Open **Live Locations** as Admin SI or Super Admin and verify the officer's fix.
4. Repeat on real Android and iOS devices with approximate permission, locked
   screens, weak connectivity, and permission revoked. Confirm sharing stops
   on sign-out and session expiry.

Location reports target a one-minute interval when new fixes arrive. The admin
list flags fixes three minutes old or older. The API currently has no refresh
endpoint, so a session that expires requires another sign-in.

## Migration status

Officer and admin workflows beyond Live Locations,
notification deep links and system alerts, and signed upgrade testing are still
pending. Keep the native Android app available through the parity pilot.

The Flutter asset is a bundled copy of the repository's shared access rules.
After editing the source, copy frontend/src/lib/access-matrix.json to
mobile-flutter/assets/access-matrix.json. A Flutter test checks for drift.
