# Android App — Device Use Policy (draft for SHO decision)

Build Guide §14 item 8 asks whether staff will use personal Android devices. This draft records what the app already does and the decisions the department needs to make.

## What the app does today

- Shows only the signed-in officer's own records (duty, attendance, leave, movements, tasks, notifications).
- Connects only over HTTPS in release builds; plain HTTP is allowed only in developer builds.
- Stores the session token encrypted with a key held in the Android Keystore; app data is excluded from Android backups.
- Signs out on the server when the officer signs out, when the session expires, or after the inactivity limit.
- Requires officers to replace the temporary password at first sign-in.
- Shows notifications for published duties, decisions and new tasks while the app is in use (polling; no third-party push service).

## Decisions required

| Question | Options | Decision |
|:--|:--|:--|
| Personal phones allowed? | Yes / Department phones only / Both | |
| Minimum Android version | Android 6 (current minimum) / Android 8+ | |
| Screen lock required on the phone? | Recommended: yes (PIN or biometric) | |
| Block screenshots of the app? | Yes (prevents sharing duty lists) / No | |
| Background notifications when the app is closed | Not available without a push service; options: department push server, SMS, or accept in-app only | |
| Lost or replaced phone | Admin SI resets the officer's password: any session on the lost phone is then refused everything except a password change, which needs the new password | |
| Distribution | Department-managed APK / MDM / Play Store private channel | |

Decided by (SHO): ____________________  Date: ____________
