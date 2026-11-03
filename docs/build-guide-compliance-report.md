s# Build Guide Compliance Report

**Reviewed against:** *Panjagutta AI Application – Police Station Staff Duty Management Application Build Guide* (16 sections, 33-step blueprint)
**Scope:** FastAPI backend, Next.js web app, native Android app, project infrastructure
**Method:** Static code and document review (three parallel audits). Nothing was executed: tests, Docker and the apps were not run. File references are from that review and should be spot-checked before being quoted externally.
**Date:** 2026-11-03

Legend: ✅ Implemented · 🟡 Partial · ❌ Not implemented

---

## 0. Remediation status (updated after the remediation work, 2026-11-03)

Sections 1–7 below are the **original baseline review** and are kept unchanged for reference. This section records what was done afterwards. Verified by: 203 backend tests passing (`backend/tests/`), web typecheck/lint/production build passing, Android debug and release builds compiling, and a live smoke test of every main endpoint against a copy of the existing local database. Not verified: a full Docker/PostgreSQL deployment and the Android app on a device.

Features listed in §4 (beyond the guide) were deliberately left unchanged, including the *Wipe Demo Data* tool. AI stages (§11, blueprint 31–33) were out of scope.

### Critical findings

| # | Status | What changed |
|:-:|:-:|:--|
| C1 | ✅ | Role checks on leave approve/reject, movement authorize/reject, task status/updates, attendance verify, alerts, attachments, duties, AI query (`test_roles.py`) |
| C2 | ✅ | Sector scoping on rosters (assignment rows), leave, movements, tasks, reports, alerts, attachments, inbox |
| C3 | ✅ | Contact phone and notes only for SHO, Admin SI, own Sector SI and self |
| C4 | 🟡 | Audit rows cannot be updated/deleted through the app; PostgreSQL trigger blocks UPDATE; authorizer and exception reason returned and shown. The wipe tool still clears the log (kept as instructed) |
| C5 | ✅ | Backdoor password aliases removed; default/admin-set passwords force a change at first sign-in, enforced by the API, web and Android |
| C6 | ✅ | Rate limit now on `/api/auth/login` |
| C7 | ✅ | Compose passes `JWT_SECRET_KEY`; production refuses to start with a placeholder or short secret |
| C8 | ✅ | Alembic baseline revision (upgrade/downgrade verified); app creates missing tables and loads §4 config at startup; Docker runs migrations |
| C9 | 🟡 | CSV removed from `frontend/public/`; template now served by the API. Still in Git history and the template endpoint still serves the full file without sign-in (protected import feature) — see security doc |
| C10 | ✅ | Passwords, tokens and secrets stripped from all audit values (`test_staff_create_never_logs_password`) |
| C11 | ✅ | `requirements-traceability.md`, `security-and-deployment.md`, `policy-confirmation.md`, README rewritten to match the code |
| C12 | 🟡 | Nothing has been committed (no commit was requested). A clean clone needs the untracked files listed by `git status` to be committed |

### Recommended order of work (§5)

| Item | Status | Notes |
|:-:|:-:|:--|
| 1–7 | ✅ / 🟡 | As in the table above |
| 8 | ✅ | Engine rewritten: Duty Off/Rest from the rotation rule, date-aware movements, court sections, newest published version only, emergency and shift-change-pending, bulk queries; 140+ engine tests incl. all 128 record combinations |
| 9 | ✅ | Validation reads `shift_config` and `rotation_rule`; real overlap and rest windows (before and after); unconfirmed-availability and open-task checks; per-duty vacancies; dry-run `/rosters/validate`; blocking violations need a distinct authorizing officer; one audit row per exception |
| 10 | ✅ | Version history, Revise (new version), superseding on publish, SHO Return, week/month calendar |
| 11 | ✅ | Dashboard filters, per-card lists, current/upcoming/rest/vacancy views, daily/vacancy/workload reports, PDF and Excel export, authenticated downloads |
| 12 | ✅ | Leave cancel, routing notifications, overlap check, reference numbers, impact preview; movement reject/cancel; alert resolve and auto-resolve; approvals inbox; stalled leave/movement and expired attachment alerts |
| 13 | ✅ | Android: movement requests, change password, server logout, sign-out on 401, inactivity sign-out, attendance history, tasks, cancel requests, notification bell and system notifications (while the app is open), encrypted token, HTTPS-only release |
| 14 | ✅ | CI workflow, nginx HTTPS proxy, encrypted backup and restore-drill scripts. Department certificate and the first drill still need IT |
| 15 | 🟡 | Shift timings reconciled everywhere (all screens read the configured values). The SHO sign-off itself is pending: [policy-confirmation.md](policy-confirmation.md) is ready to sign |
| 16 | 🟡 | Decision documents prepared ([role-matrix-for-sho.md](role-matrix-for-sho.md), [mobile-device-policy-draft.md](mobile-device-policy-draft.md)); decisions pending |

### Other gaps closed

Configuration UI (duties, sectors, sections, status and leave-type lists); staff register attachment details and section/attachment filters; task reporting officer and current-task view; attachment reporting officer and repatriation authority; in-app Workflow Guide; drafts preserved across logout; client-side inactivity warning; sign-in guard on every page; first-time password screen; scheduled-vs-confirmed attendance; staff web self-submission; pilot and rollout plan.

### Still open

- Phase 0 decisions (SHO rules sheet, SOP §10 role matrix, vehicles, device and AI policy).
- OTP (optional in the guide; channel not decided).
- Background push to phones when the app is closed (needs an approved push or SMS service).
- Vehicle register (optional; decision pending).
- Department security review, real staff data, pilot, training, one-month review (blueprint 28–30).
- AI stages 31–33 (excluded from this phase).

---

## 1. Executive summary

| Area | ✅ | 🟡 | ❌ | Overall |
|---|---|---|---|---|
| Stage A – Prepare (steps 1-3) | 1 | 1 | 1 | Rules never signed off; no CI |
| Stage B – Foundation (steps 4-10) | 2 | 5 | 0 | Strong base, security gaps |
| Stage C – Roster and allocation (11-15) | 1 | 4 | 0 | Workflow works; validation is weak |
| Stage D – Daily operations (16-21) | 1 | 5 | 0 | Screens exist; role checks and routing gaps |
| Stage E – Availability and dashboards (22-25) | 0 | 2 | 2 | Engine incomplete; reports incomplete |
| Stage F – Mobile and release (26-30) | 1 | 1 | 3 | Mobile core works; release hardening absent |
| Stage G – AI (31-33) | 0 | 0 | 3 | Only keyword query and a static "explain" |

**The headline:** the application covers the spec's *screens and data model* well, and the daily staff workflow (attendance, leave, published roster on mobile) works. It falls short of the guide in four areas that the guide treats as non-negotiable:

1. **Server-side permission enforcement** (guide §3.2, §12): several write endpoints have no role check, and sector scoping is applied to only some endpoints.
2. **The availability engine** (guide §8): priority 3 (Duty Off / Rest) is never computed, so the "Duty Off" card is always 0 and "Available" always equals "Present".
3. **Validation rules** (guide §9.2 step 5): rest and conflict checks use hard-coded values and ignore the configuration tables, and they warn only after the draft is saved.
4. **Audit integrity** (guide §5.3, §12): the audit log can be deleted by the "clear demo data" endpoint, and authorizer and exception reason are stored but not shown.

Phase 0 (SHO sign-off on rotation, rest and approvals) has not happened. Every rule in the code is provisional, which the guide says must block Phase 2.

---

## 2. Critical findings (fix before any pilot)

| # | Finding | Guide ref | Evidence |
|---|---|---|---|
| C1 | Any logged-in user, including STAFF, can approve or reject leave, authorize movements, and change any task's status | §3.2, §12 | `backend/app/api/routes/operations.py:63-139, 227, 665` |
| C2 | Sector SI can read other sectors' rosters, leave, movements, tasks, reports and alerts (only staff, attendance and dashboard are scoped). `require_sector_scope()` exists but is never used | §12, step 7 | `dependencies.py:87`; routes listed above |
| C3 | `contact_phone` is returned to every authenticated user, including STAFF | §12 | `staff.py:108-169` |
| C4 | `POST /staff/clear-demo-data` runs `DELETE FROM audit_log`; no DB-level append-only protection exists | §5.3 #4, §12 | `staff.py:376-438`, `seed.py:37` |
| C5 | A hard-coded password list works for demo accounts (`admin123`, `staff123`, `Password@PJ2024!`); default password for all imported users | §12 | `auth.py:107-109`, `staff.py:191,284` |
| C6 | The login rate-limit checks `/auth/login` but the real route is `/api/auth/login`, so it never fires | §12 | `main.py:112` |
| C7 | docker-compose passes `SECRET_KEY` but the app reads `JWT_SECRET_KEY`; the deployed stack signs tokens with the default key | §12 | `docker-compose.yml`, `core/config.py` |
| C8 | A fresh Docker stack has an empty database: no Alembic revisions exist and `create_all` runs only inside `seed.py` | step 3, 4 | `backend/migrations/versions/` is empty |
| C9 | The 140-person staff CSV, containing personal mobiles, emails and the plaintext password column, is served publicly from `frontend/public/`; row 1 appears to be a real person | §12 | `frontend/public/panjagutta_140_police_staff.csv` |
| C10 | Staff-create writes `payload.model_dump()` to the audit log, which can include the password field | §12 | `staff.py:207` (flagged for verification) |
| C11 | The repo's own `docs/requirements-traceability.md` and `security-and-deployment.md` mark most items "Complete" and make claims the code does not support (append-only audit with SELECT/INSERT grants, leave approval restricted to SHO/Admin SI, passlib bcrypt, 60-second overdue job) | – | see §6 |
| C12 | A fresh clone of `HEAD` would not start: `mobile.py`, `duties.py` and `init_users.py` are untracked but imported by `main.py` | step 3 | `git status` |

---

## 3. Section-by-section compliance

### §1–2 Purpose, scope, problems solved

| Guide requirement | Status | Notes |
|---|---|---|
| Centralized web system | ✅ | Next.js + FastAPI |
| Android app for staff | ✅ | Native app exists (core flows only; see §3.12) |
| Answer "who is present / on duty / on rest / on leave / outside" | 🟡 | "On rest" never computed; "available" = "present" |
| Warn before conflicting allocation | 🟡 | Warnings returned after save, not before; see §3.9 |
| One status per person | ✅ | Single `compute_staff_status()` |
| Movement records with overdue highlight | ✅ | Scheduler flags; UI highlights |
| Vacancies before shift starts | 🟡 | A single vacancy count; no per-duty vacancy view |
| Roster versioning, original preserved | 🟡 | New version row per POST, but edits to a draft hard-delete and re-insert assignments |
| Approved leave reaches roster and alerts SI Admin | 🟡 | Vacancy alerts are created on approval; they are global alerts, not routed to the Admin SI user |
| Reports generated from records | 🟡 | Two reports, CSV only |
| Does not assign shifts from assumed rotation; does not replace human approval | ✅ | Policy gate blocks roster creation until SHO confirms or simulates; approval chain enforced |

### §3 Users, hierarchy and roles

| Requirement | Status | Notes |
|---|---|---|
| Roles SHO, Admin SI, Sector SI, DI, DSI, Staff | ✅ | Plus SUPER_ADMIN (not in spec) |
| Sectors 1-5 | ✅ | 5 rows seeded; only Sector 1-2 demo SIs exist |
| Staff categories / designations (ASI…SPO, drivers, attached) | 🟡 | Designations are stored; category/section are free text, not tables |
| Permissions enforced in the API, never only in screens | 🟡 | `require_roles` exists but is missing on the endpoints in C1; the UI also hides menus client-side only |
| Permissions table / role matrix | ❌ | Hard-coded per route; no permissions table |
| SHO approves roster | ✅ | SHO only |
| Admin SI prepares and submits | ✅ | |
| Staff submit own attendance, request leave and movement | 🟡 | Mobile: attendance + leave only. Web: staff cannot self-submit attendance (supervisor marks) |

### §4 Configuration data

| Requirement | Status | Notes |
|---|---|---|
| Shifts A/B/C in an editable table | ✅ | `shift_config`; PUT by SHO/Admin SI, audited |
| Shift times consistent everywhere | 🟡 | Dashboard uses 08-14/14-20/20-08; roster, allocation and attendance pages show 07-15/15-23/23-07; validation text assumes yet other times |
| Duty requirements loaded (Summons 2 … Beat 4 per shift) | ✅ | Seeded in `duty_master` |
| Duty requirements editable | 🟡 | PATCH for strength/eligibility/active only; no create/delete; **no UI** (`updateDuty` unused) |
| Sectors, sections editable | ❌ | No sector API; no Section table; hard-coded in UI |
| Status lists editable | ❌ | Python enums, not tables |
| 12 staff statuses | ✅ | All defined; `EMERGENCY_DEPLOYMENT` and `SHIFT_CHANGE_PENDING` are never produced |
| Leave states incl. Cancelled | 🟡 | Enum has it; no cancel route; UI has no cancel |
| Task states (5) | ✅ | |
| Movement "Outside on Official Duty" until return | 🟡 | Matches any open movement with no date check; `OVERDUE` status never set (flag only) |
| rotation_rule table | 🟡 | Created only via policy confirm; **not used by validation** |

### §5 Architecture and design principles

| Principle | Status | Notes |
|---|---|---|
| 1. Attendance, assignment, availability separate; availability calculated | ✅ | |
| 2. One change reflected everywhere | ✅ | Linked to staff profile |
| 3. Never delete a roster; new version with reason and author | 🟡 | Versions are kept, but publishing v2 does not supersede v1, so two published versions can coexist; `availability.py` uses `.first()` |
| 4. Traceable to user and authorizing officer | 🟡 | Columns exist; `/audit` response omits `authorizer_username` and `exception_reason`; exception overrides default the authorizer to the current user |
| 5. Hard rules are plain code | ✅ | Rules-based; AI is read-only |
| Scheduler | ✅ | APScheduler: overdue movements, overdue tasks, stalled rosters |
| AI service read-only via API | ✅ | |

### §6 Tech stack

| Layer | Spec | Actual | Status |
|---|---|---|---|
| Frontend | React, TypeScript | Next.js 16, TS | ✅ |
| Mobile | Kotlin or React Native | Native Android, **Java**, programmatic views | 🟡 (acceptable deviation) |
| Backend | Python FastAPI | FastAPI | ✅ |
| Database | PostgreSQL | Postgres in compose; **SQLite in the active `.env`**; `aiosqlite` not in requirements | 🟡 |
| Auth | JWT + RBAC + optional OTP | JWT + server session + RBAC; no OTP | 🟡 |
| Background jobs | Celery or APScheduler | APScheduler | ✅ |
| Roster solver | OR-Tools | not in requirements | ❌ |
| Language model | On-prem approved | AI config keys defined but unused | ❌ |
| Reports | Server-side PDF + Excel | CSV only (reportlab and openpyxl are installed but unused for reports) | ❌ |
| Hosting | On-prem / private | Notes in docs; no TLS config | 🟡 |
| Dev tooling | Git, CI, tests, Docker | Git ✅, Docker ✅, tests thin 🟡, **CI ❌** | 🟡 |

### §7 Data model

| Table | Status | Gap |
|---|---|---|
| users, roles, permissions | 🟡 | No permissions table |
| staff | ✅ | `contact_address` has no write path |
| shift_config | ✅ | `version` never bumped |
| duty_master | ✅ | |
| rotation_rule | 🟡 | Exists; not consumed |
| roster, roster_assignment | ✅ | No `published_by_id` |
| attendance | ✅ | Not auto-created for scheduled staff |
| task | ✅ | |
| movement | ✅ | |
| leave_request | 🟡 | `reference_number` is client-supplied, not generated |
| attachment_order | 🟡 | No reporting officer field in UI; no auto-end at expected end date |
| vehicle (optional) | ❌ | Not built (spec marks it optional; SHO decision pending, §14 item 7) |
| audit_log | 🟡 | Columns complete; not tamper-proof (C4) |

### §8 Availability engine

| Priority | Status | Notes |
|---|---|---|
| 1 On Leave (approved only; pending ignored) | ✅ | |
| 2 Attached to Other Wing | ✅ | Uses `scalar_one_or_none` (fails with two active orders) |
| 3 Duty Off / Rest | ❌ | Only a TODO; never returned |
| 4 Official Movement (open) | 🟡 | No date/shift check |
| 5 Patrol / Beat / Court / Field / On Duty | 🟡 | Substring match on category; Summons, Warrants and JFCM all become "On Duty" |
| 6 Present – Available | 🟡 | Requires confirmed attendance **and no assignment**; no shift-window logic |
| 7 Absent | ✅ | Default |
| Patrol/beat never appears as free | ✅ | |
| Performance | 🟡 | ~6 queries per staff per dashboard call (N+1) |

### §9 Workflow

**9.1 Session**

| Step | Status | Notes |
|---|---|---|
| Login with validation | 🟡 | Server lockout (5 fails/15 min) ✅; UI shows the raw error, no countdown; OTP ❌ |
| Every attempt audited | 🟡 | Unknown username, inactive user and locked attempts are not audited |
| First-time password change | ❌ | Flag and endpoint exist; web, mobile and server enforcement all absent; all users seeded with the flag `False` |
| Role-based routing | 🟡 | Client-side only; most pages render an empty shell without a token (no middleware) |
| Dashboard per role | 🟡 | Staff are redirected to `/roster`; no "my duty" view; no approval-count badge |
| Attendance: submit → verify → recalculate | 🟡 | Mobile submit ✅, supervisor verify ✅; web staff cannot submit |
| Leave/movement routed to designated approver | 🟡 | No routing logic; anyone can approve (C1) |
| Logout invalidates token and is audited | ✅ web / 🟡 mobile | The Android app does not call `/auth/logout` |
| Inactivity timeout | 🟡 | Server 60 min ✅; no idle timer on web or mobile |
| Drafts preserved | ❌ | `draft_payload` column is never read or written; UI drafts live in React state |

**9.2 Duty-allocation workflow (11 steps)**

| Step | Status | Notes |
|---|---|---|
| 1 Staff register | 🟡 | CRUD, filters (search, designation, sector) and CSV import ✅; no attachment details, no section/status filters |
| 2 Prepare roster using approved rotation and rest rules | 🟡 | Creates an empty draft; rules are not applied |
| 3 Review availability | 🟡 | Via warnings only |
| 4 Allocate duties | ✅ | |
| 5 Validate | 🟡 | See §3.9a below |
| 6 Approve and publish | ✅ | Draft → submit → SHO approve → publish; no reject path |
| 7 Attendance: scheduled vs confirmed | ✅ | |
| 8 Monitor dashboard | 🟡 | 14 cards ✅; views and filters missing |
| 9 Changes and emergencies | 🟡 | Vacancy alerts on leave approval; no replacement workflow |
| 10 Complete duty | 🟡 | Task status change exists; no ownership check |
| 11 Reports | 🟡 | See §3.10 |

**9.3 Status update workflow:** 🟡 Audit and recalculation happen; scheduler and bulk attendance writes are not audited.

**9.4 Movement lifecycle:** 🟡 Record → authorize → depart → return ✅; overdue flag ✅; authorize sets departure at the same instant and does not check status; no reject or cancel; the UI does not show the authorizer's name.

**9.5 Leave lifecycle:** 🟡 Request / approve / reject ✅; **Cancel ❌**; no routing; no overlap or end ≥ start check on the web route; no impact preview.

#### 3.9a Validation rules (guide step 13)

| Rule | Status | Gap |
|---|---|---|
| Duplicate assignment | 🟡 | `autoflush=False` means duplicates within one payload escape the check and hit the unique constraint as a 500 |
| Shift-time conflict | 🟡 | Flags any other roster that day; no time-overlap calculation; includes drafts |
| Insufficient rest | 🟡 | Previous day only; hard-coded C→A, B→A; ignores `rotation_rule` and `shift_config` |
| Approved leave | ✅ | Via the availability engine |
| Existing commitment | 🟡 | Attachment and open movement only |
| Vacancies | 🟡 | Aggregate count, not per-duty warning at save |
| Unconfirmed availability | ❌ | |
| Warn before saving | 🟡 | Post-save only; no dry-run endpoint |
| Override needs authorizing officer + audit | 🟡 | Web UI never sends the authorizer; backend defaults to the current user; no per-exception audit row; `EXCEPTION_AUTHORIZED` is unused |

### §10 Screens and modules

| Screen | Web | Mobile | Notes |
|---|---|---|---|
| Dashboard | 🟡 | – | 14 cards ✅; each card filters one list client-side (vacant, total and scheduled show everything); no rest/upcoming/vacancy views; filters = shift + text search only |
| Staff register | 🟡 | – | No attachment details |
| Shift roster | 🟡 | 🟡 | Web: flat table, no daily/weekly/monthly grid, no version-history view. Mobile: personal calendar and list |
| Duty allocation | 🟡 | – | "n / required" with Fulfilled/Deficit badge; no explicit vacant count; roster deep-link query params ignored; sector filter hard-coded |
| Attendance | 🟡 | ✅ | Web staff are read-only; mobile submits |
| Tasks | 🟡 | ❌ | No "current task per person" view; no reporting officer field; no role gating; mobile shows only the roster's `current_task` text |
| Outside movements | ✅ | ❌ | Mobile has no movement request |
| Leave and rest | 🟡 | 🟡 | No Cancel, no rest/duty-off calculation, approver not shown |
| Attachments | 🟡 | – | No reporting officer; hard-coded form defaults |
| Approvals and alerts | 🟡 | – | No backend inbox; alerts cannot be acknowledged or resolved |
| Reports | 🟡 | – | Shift-end and a "vacancy" report; CSV export in a new tab sends no Authorization header (likely 401); no workload report; no PDF/Excel |
| Android preview | ❌ | – | Superseded by the real app |
| Workflow guide | ❌ | – | Only `docs/user-guide.md` |
| Audit log (extra) | ✅ | – | |

### §11 AI features

| Feature | Status | Notes |
|---|---|---|
| Roster suggestion (OR-Tools) | ❌ | |
| Smart warnings | 🟡 | Rule warnings exist; no replacement suggestions; no model wording |
| Natural-language assistant | 🟡 | Keyword matching returning counts; **not an LLM**; any role (including STAFF) can query names on leave; no sector scoping |
| Leave-impact preview | ❌ | Vacancy alerts appear only *after* approval |
| Overdue alerts | 🟡 | Rule-based scheduler only; no early warning |
| Anomaly flags, shortage forecast, report summaries | ❌ | |
| Guardrails | 🟡 | Read-only and `is_ai_draft` disclaimer ✅; accept/override logging ❌; `explain-roster` returns static text claiming "16-hour rest was enforced", which is misleading |

### §12 Security and audit

| Requirement | Status | Notes |
|---|---|---|
| Server-side RBAC with sector scoping | 🟡 | See C1, C2 |
| Password hashing | ✅ | bcrypt |
| Lockout | ✅ | 5 failures / 15 min |
| Optional OTP | ❌ | |
| Inactivity timeout | 🟡 | Server only |
| HTTPS everywhere | ❌ | Plain HTTP; no reverse proxy or TLS config |
| Encrypted backups, restricted DB access | ❌ | Prose only; no scripts, no GRANTs; Postgres is published on host port 5433 with a default password |
| Append-only audit log | 🟡 | No update/delete API, but wipeable (C4) |
| Exceptions require authorization and are logged | 🟡 | See §3.9a |
| Contact details only where authorized | ❌ | C3 |
| Other | 🟡 | The 500 handler returns `str(exc)` to clients; the login identifier also matches phone and notes fields |

### §13 / §16 Build plan and 33-step blueprint

| Step | Status | Evidence / gap |
|---|---|---|
| 1 SHO answers to every §14 item; signed rules sheet | ❌ | `docs/policy-confirmation.md` marks everything "Provisional"; no signature, date or name |
| 2 SOP §10 role matrix finalized | 🟡 | Project-authored matrix in `docs/security-and-deployment.md`; not tied to SOP §10 |
| 3 Git, Docker, Postgres, CI | 🟡 | Git ✅, Docker ✅, Postgres ✅; **CI ❌**; startup is not one command (needs seed; migrations empty) |
| 4 Migrations create and roll back cleanly | ❌ | Alembic scaffold only; zero revisions |
| 5 Load §4 config; admin can view/edit everything | 🟡 | Loaded ✅; only shifts, duty strength and rotation text are editable; no UI for duties |
| 6 Auth: lockout, logout invalidation, timeout | 🟡 | Lockout ✅, logout ✅, timeout 🟡; OTP ❌ |
| 7 Role checks with sector scoping | 🟡 | C1, C2 |
| 8 Audit service on every write; append-only | 🟡 | Bulk attendance, scheduler writes and import are not audited; not tamper-proof |
| 9 Staff register: add, find by sector or designation | ✅ | |
| 10 Shell with role-based menu | ✅ | Menu ✅; routing guard 🟡 |
| 11 Roster versions; original viewable | 🟡 | Stored; **no viewer** |
| 12 Allocation shows required/allocated/vacant (4 required, 3 assigned → 1 vacancy) | 🟡 | Shows "3 / 4" and a Deficit badge |
| 13 Each validation rule has a failing-without-it test | ❌ | No rule tests exist |
| 14 Override needs authorizer + audit | 🟡 | C-level gap in §3.9a |
| 15 Draft invisible until published | 🟡 | Enforced for STAFF only; DI, DSI and Sector SI see drafts |
| 16 Dashboard shows scheduled and confirmed separately | 🟡 | "Scheduled" counts attendance rows, not roster assignments |
| 17 Tasks: flagged when overdue | 🟡 | Flag ✅; reporting officer field missing in UI |
| 18 Movements: Outside on Official Duty; late highlighted | ✅ | |
| 19 Leave: only approved removes eligibility; pending visible | 🟡 | Logic ✅; Cancel ❌ |
| 20 Attachments count in total strength, not routine deployment | ✅ | |
| 21 Approvals inbox, alerts, scheduler | 🟡 | Scheduler ✅; no inbox endpoint; alerts cannot be resolved; stalled leave/movement not covered; alerts are DB rows only (no push) |
| 22 Engine with unit tests: one status across every combination | ❌ | Priority 3 missing; one real engine test |
| 23 14 cards; no person in two exclusive totals | 🟡 | "Available" duplicates "Present" |
| 24 Current shift, rest/upcoming, vacancy views; all filters | ❌ | |
| 25 Reports with PDF and Excel; match dashboard | ❌ | CSV only |
| 26 Android: mark attendance and request leave | ✅ | Works (see mobile table) |
| 27 Tests (unit, scenario, role) pass in CI | ❌ | ~25 backend tests, mostly trivial; no scenarios; no role tests; no CI; no frontend tests |
| 28 Security review, HTTPS, encrypted backups, restore drill | ❌ | |
| 29 Pilot on real data | ❌ | Staff data is synthetic apart from one row; no pilot plan |
| 30 Training and rollout | 🟡 | `docs/user-guide.md` (web); no mobile guide; no rollout plan |
| 31–33 AI stages | ❌ | |

### §14 Items to confirm with the SHO

All eight items are **open**. Rotation sequence (A→B→C), rest (16 h assumed), weekly duty-off (24 h assumed, versus the guide's ~36 h after B), leave approver (SHO all / Admin SI up to 2 days CL) and the status priority are implemented as *provisional assumptions*. The roster-creation gate (demo simulation mode) allows work to continue, which conflicts with the guide's rule that nothing in Phase 2 is built until the rules are confirmed.

### §15 Testing and rollout

| Item | Status |
|---|---|
| Unit tests for availability and every validation rule | 🟡 / ❌ — ~14 availability tests, of which one exercises the engine; no rule tests |
| Scenario tests (emergency deployment, mid-roster leave, late return, shift change pending) | ❌ |
| Role tests | ❌ |
| Pilot, training order, one-month review | ❌ / 🟡 |

---

## 3.12 Android app against the guide

| Requirement | Status | Notes |
|---|---|---|
| Mark own attendance | ✅ | Requires a published roster and an assignment; duplicate → 409; audited; awaits officer verification |
| Request leave | ✅ | Calendar pickers; types Casual/Medical/Rest day/Duty off |
| **Request movement** | ❌ | No UI; no `/mobile` route (the generic `/api/movements` already allows STAFF) |
| View published roster | ✅ | Roster tab, Home, Calendar diary |
| View own records | 🟡 | Attendance by date and leave history; no attendance history, movements or tasks |
| Same API | ✅ | |
| First-time password change | ❌ | `must_change_password` returned but ignored |
| Failed-login / lockout display | 🟡 | Shows the server's message only |
| Inactivity timeout | 🟡 | Server-side only; the app does not return to login on a mid-session 401 |
| Logout invalidates token | 🟡 | App clears the local token but never calls `/auth/logout` |
| HTTPS in release | 🟡 | Cleartext disabled for release; minSdk 23 means that is advisory below API 28; the user can type any server URL |
| Notifications | ❌ | None |
| Offline | 🟡 | In-memory cache only |
| Token storage | 🟡 | Plain SharedPreferences (introduced in this redesign) |
| Official look and feel | ✅ | Crest header, gold accent, bottom navigation, skeleton loaders, date pickers *(not yet run on a device)* |
| Personal-device policy | ❌ | No document; no app lock or screenshot protection |

---

## 4. What exists beyond the guide

- Policy gate and demo-simulation mode for rotation rules; `is_demo_policy` flag on rosters
- Bulk CSV/XLSX staff import with auto-provisioned logins, template download and "wipe demo data"
- Station Roll-Call console (bulk confirm) and personal monthly attendance calendar
- Movement authorization workflow; roster designation-eligibility validation
- Leave-approval vacancy alerts; `X-Request-ID` middleware; LAN CORS rules
- Flexible login identifier (username, email, service number, phone)
- SUPER_ADMIN role; mobile duty-diary endpoint

Several of these (the backdoor passwords, the wipe tool, the flexible login) increase risk and should be reviewed for removal before production.

---

## 5. Recommended order of work

**Now (security and correctness; days)**
1. Add `require_roles` to leave approve/reject, movement authorize, task status, alerts, attachments, duties, AI query (C1).
2. Apply sector scoping to rosters, leave, movements, tasks, reports and alerts (C2); mask `contact_phone` (C3).
3. Remove the demo backdoor passwords and default import password; force `must_change_password` on first login in the API, web and mobile (C5).
4. Make `clear-demo-data` leave `audit_log` alone; add DB-level protection; return `authorizer` and `exception_reason` from `/audit` (C4).
5. Fix the rate-limit path, the `SECRET_KEY` / `JWT_SECRET_KEY` mismatch, and strip `password` from audit payloads (C6, C7, C10).
6. Remove the CSV from `frontend/public/` and purge the plaintext passwords and the real-looking SHO row from git history (C9).
7. Commit the untracked backend files so a clean clone starts (C12); add Alembic revisions or run `create_all` at startup (C8).

**Next (spec completeness; weeks)**
8. Complete the availability engine (Duty Off / Rest, movement date check, separate "available"), then write the unit-test matrix the guide asks for.
9. Rewrite validation to read `shift_config` and `rotation_rule`, run before save (dry-run endpoint), include the unconfirmed-availability rule, and require a distinct authorizer for overrides.
10. Roster version history UI, supersede earlier published versions, week/month roster view.
11. Dashboard views and filters; per-card staff lists; duty-vacancy report; PDF and Excel export; fix the CSV export auth bug.
12. Leave Cancel and routing; movement reject/cancel; alert acknowledge/resolve; approvals inbox endpoint.
13. Mobile: movement request, change-password screen, call `/auth/logout`, return to login on 401, attendance history; add notifications.
14. CI pipeline (tests on every push), HTTPS reverse proxy, encrypted backup script with a restore drill.

**Needs the SHO (Phase 0)**
15. Get the eight §14 answers signed; replace "Provisional" values; reconcile the shift timings used in different screens (08-14 vs 07-15).
16. Decide on vehicles, personal-device policy and AI deployment (§14 items 7-8).

**Later (AI stages)** — OR-Tools suggestions, LLM assistant, leave-impact preview, forecasting. Only after the core is stable, per the guide.

---

## 6. Documentation that overstates completion

`docs/requirements-traceability.md` and `docs/security-and-deployment.md` should be corrected so they do not mislead the SHO or a reviewer. Specific mismatches found: audit "append-only with SELECT/INSERT-only grants" (nothing implements it); "leave approval SHO/Admin SI only" (code allows any user); "DI can draft/submit rosters" (code allows SHO/Admin SI only); "Shift A 07-15" (seed uses 08-14); "60-second overdue job" (scheduler runs every 15 minutes); "passlib bcrypt" (code uses raw bcrypt). The README also lists demo logins that no longer match the seeded users and uses `file:///c:/Users/karthu/...` links that break for anyone else.

## 7. Repository hygiene

- `mobile-android/mobile-android/` is an untracked older duplicate of the Android project; the outer copy is current.
- `mobile-android/.artifacts/...implementation_plan.artifact.md` and `gradle-wrapper.jar` are staged by mistake (the plan file should not be committed).
- 55 files and ~6,700 lines are uncommitted, against only three commits.
- `backend/.env` and `backend/panjagutta_local.db` are on disk but ignored; confirm `.env` is not tracked.
- `requirements.txt` lists `httpx` twice and mixes test packages into production requirements; `aiosqlite` is missing despite the SQLite `.env`.
