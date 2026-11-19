# Web ↔ Android feature parity

Leave and rest management has been removed from both client interfaces. Existing records and roster availability and rest checks remain in the backend.

The Android app (`mobile-android/`) must offer everything the web app (`frontend/`) does, for every role.
**Any change to one is made to the other in the same pull request**, or this document says why not.

## How parity is enforced

| Safeguard | What it protects | Where |
|---|---|---|
| **Shared access matrix** | Which role sees which module/tab and may run which action. One JSON file read by the web sidebar, asserted by the Android unit test and checked against the real API. | `frontend/src/lib/access-matrix.json` |
| **Android unit test** | App rules equal the shared file (modules, order, labels, tabs, actions, groups). | `mobile-android/app/src/test/.../RoleAccessTest.java` |
| **Backend access test** | For every probed module and every role, the server returns 403 exactly when the matrix says that role is excluded. | `backend/tests/test_access_matrix.py` |
| **API contract snapshot** | Every endpoint, method and allowed roles. Adding, removing or re-roling an endpoint fails CI until the snapshot is regenerated, so it appears in review. | `backend/tests/test_api_contract.py`, `api_contract.snapshot.json` |
| **PR checklist** | Reminds the author to update both clients and this file. | `.github/pull_request_template.md` |

### When you change something

1. **Role or menu change** (who sees a page, a tab, an action): edit `access-matrix.json` first. Then run
   `cd mobile-android && ./gradlew testDebugUnitTest` and update `RoleAccess.java` until it passes; run
   `cd backend && pytest tests/test_access_matrix.py` and fix the server `require_roles` if it disagrees.
2. **New or changed endpoint**: run `UPDATE_CONTRACT=1 pytest tests/test_api_contract.py` and commit the snapshot diff.
3. **New web feature**: add a row below (status ❌ for Android), then build the Android side in the same PR.
4. **Always**: tick the on-device checklist (bottom) for the roles you touched.

## Module map

| Web page (`frontend/src/app/…`) | Android screen (`…/dutymanagement/…`) | Roles |
|---|---|---|
| `dashboard` | `DashboardScreen` | Officers |
| `roster` (tabs: Rosters / Allocation / Requests) | `Modules.roster` → `CompositeScreen` of `RosterScreen`, `AllocationScreen`, `DutyRequestsScreen` | All; Allocation: supervisors |
| `attendance` | `AttendanceScreen` (officers), staff **Attend** tab | All |
| `tasks` | `TasksScreen`, staff **Home** tasks | All |
| `movements` | `MovementsScreen`, staff **Requests** tab | All |
| Outside movement requests | `MovementsScreen`, staff **Requests** tab | All |
| `attachments` | `AttachmentsScreen` | Officers (manage: SHO, Admin SI) |
| `approvals` | `ApprovalsScreen` | Officers |
| `reports` | `ReportsScreen` | Officers |
| `policy` | `PolicyScreen` | SHO, Admin SI, Super Admin |
| `config` (tabs: Staff, Duty requirements, Sectors, Sections, Lists, Dashboard cards) | `Modules.administration` → `CompositeScreen` of `StaffScreen`, `ConfigScreen` | Admin SI, Super Admin (**not SHO**) |
| `audit` | `AuditScreen` | Admin SI, Super Admin (**not SHO**) |
| `locations` | `LocationsScreen` (list + Google Maps link; web shows a Leaflet/OSM map) | Admin SI, Super Admin (**not SHO**) |
| `guide` | `GuideScreen` | All |
| `login`, `change-password` | login and change-password screens in `MainActivity` | All |

## Feature status

✅ same on both · 🔶 differs on purpose (reason given) · ❌ missing on Android

| Feature | Web | Android | Status |
|---|---|---|---|
| Role-based menu, SHO excluded from Administration and Audit | `AppShell` + matrix | `RoleAccess` + matrix | ✅ |
| Roster & Duty as one page with tabs, `?tab=` deep links | `roster/page.tsx` | `CompositeScreen`, `openModule("roster:tab")` | ✅ |
| Duty change requests: submit, approve, reject, withdraw | Requests tab | `DutyRequestsScreen` | ✅ |
| Duty change requests in the Approvals inbox | `approvals/page.tsx` | `ApprovalsScreen.addDutyChanges` | ✅ |
| Staff asks for a duty change from their roster | "My Published Duties" banner | Staff Roster tab button + pick-from-my-duties list | ✅ |
| Notification link for duty change requests / allocation | `AppShell` | `RoleAccess.targetForEntity` | ✅ |
| Administration as one page (Staff + 5 config tabs) | `config/page.tsx` | `Modules.administration` | ✅ |
| Staff import: preview, edit cells, remove/add rows, missing-name warning, then import | `StaffPanel` | `StaffScreen` import preview | ✅ |
| Login usernames `pg` + designation + last 4 phone digits: pre-filled in import preview, suggested on add/edit, Convert Usernames (preview then apply) | `StaffPanel` | `StaffScreen` | ✅ |
| Password rule: any length, letters + numbers, not the username | `change-password` | `showChangePassword` (server enforces) | ✅ |
| Idle sign-out with "Stay signed in" a minute before | `auth-context` | `MainActivity.idleWatch` | ✅ |
| Pending-approvals count on the Approvals menu item | `AppShell` badge | Bottom-bar label `Approvals (n)` | ✅ |
| Dashboard filters, cards hidden by config, shift views | `dashboard` | `DashboardScreen` | ✅ |
| Reports: 4 reports, PDF / Excel / CSV export | `reports` | `ReportsScreen` | ✅ |
| Attendance sign-in | automatic at login | automatic at login + roll call for officers | 🔶 Android also offers roll call; server rules are the same |
| Calendar diary, monthly attendance | `attendance` | staff **Calendar** / **Attend** tabs | ✅ |
| Notifications | bell, 60 s poll | bell + system notifications, 60 s poll | 🔶 Android adds system notifications |
| Session token storage | `localStorage` | Android Keystore (AES-GCM) | 🔶 platform difference |
| Demo quick-login buttons | login page | none | 🔶 deliberately web-only |
| AI explain / Copilot | roster, approvals | roster, approvals | ✅ |
| Server-side allocation drafts | `/auth/drafts` | `AllocationScreen` | ✅ |

> Items marked ✅ were checked by reading both implementations, not by running every screen on a device.
> Use the checklist below to confirm on a phone.

## On-device checklist (run for each role you touched)

Backend for the phone: `http://<PC-IP>:8000` (Docker, `docker-compose.dev.yml`).

| Role | Check |
|---|---|
| **SHO** | Menu has Dashboard, Roster & Duty, Approvals, Attendance + More (Tasks, Movements, Leave, Attachments, Reports, Policy, Guide). **No Administration, no Audit Log.** Approve a submitted roster; approve/reject a duty change request. |
| **Admin SI** | More shows Administration and Audit Log. Administration has 6 tabs. Import an Excel file: rows appear for review; blank a name → row turns red; Import saves. Submit a roster for approval. |
| **Sector SI** | Roster & Duty shows Rosters, Allocation (read-only), Requests. No Policy, Administration, Audit. Only own-sector data. |
| **DI / DSI** | Dashboard, Roster (Rosters + Requests only), Approvals (no decisions), Reports. No Allocation tab. |
| **Staff** | Home, Calendar, Roster, Attendance, Requests. Roster tab: **Request a shift / duty change** → submit → withdraw while pending. Change password to a short one (letters + numbers). |
| **Super Admin** | Everything above is reachable. |
| **Everyone** | Leave the app idle until the "Still there?" prompt; "Stay signed in" keeps the session; ignoring it signs out. |
