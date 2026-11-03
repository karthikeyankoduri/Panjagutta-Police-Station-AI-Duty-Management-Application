## Panjagutta Police Station AI Duty Management Application: Build Guide

Architecture, hierarchy, tech stack and end-to-end workflow. Based on the project SOP and the interactive HTML demo.

## 1. Purpose and scope

This document describes what we are building, why, and how. The application, built for Panjagutta Police Station, is a centralized web system (with an Android app for staff in a later phase) that lets the SI Admin and SHO monitor the availability, attendance, shift status, current duties and movements of every police station staff member from one dashboard.

The SOP requires the system to answer these questions at any time:

- How many staff are assigned to the station?

- Who is present, on duty, on rest or duty off?

- Who is on leave, absent, attached to another wing, or outside on official work?

- What task is each available person performing?

- Which duties are vacant, pending or unallocated?

- Who is assigned to patrol vehicles, beats, court duties, reception, eCOPS, CCTNS and other sections?

The demo (13 screens, all data in browser memory) is the UI reference. The real application keeps its layout and adds what the demo lacks: login, a database, approvals, validation rules, versioned rosters and an audit trail.

Note on sources: the SOP text received ended at section 10 (User roles and access control). Roles and permissions in this document are therefore provisional and must be reconciled with the full section 10.


## 2. What the application solves

| Problem today | How the application solves it |
| --- | --- |
| Duties allocated from memory; clashes and | Warnings before saving a conflicting |
| double assignments | allocation (overlap, leave, rest, vacancy) |
| "Present" assumed to mean "available" | Availability is calculated from attendance, |
|   | roster, assignments, leave and movements |
|   | together |
| One person counted twice across leave, | Each person gets exactly one current status |
| duty and movement |   |
| Staff leave the station with no record of | Movement records with expected return; |
| destination or return | overdue ones are highlighted |
| Vacancies found only after a shift starts | Required strength compared with valid |
|   | allocations before the shift |
| Roster changes overwrite the original | New roster version per change, with reason; |
|   | original preserved |
| Approved leave does not reach the roster | Approved leave removes eligibility and |
|   | alerts the SI Admin |
| Reports compiled by hand | Shift-end and daily reports generated from |
|   | records |

The application does not assign shifts or declare staff eligible from an assumed rotation rule, does not treat an unreported absence as an authorized movement, and does not replace human approval.


## 3. Users, hierarchy and roles

## 3.1 Station hierarchy (SOP section 2)

```
SHO (Station House Officer)
|-- DI (Detective Officer)
|-- Admin SI
|-- Sector 1 SI ... Sector 5 SI
|-- DSI
|
+-- Staff register
|-- ASI / AWSI
|-- HC / WHC
|-- PC / WPC
|-- ARPC / ARWPC
|-- HGS / WHGS
|-- SPOs
+-- Inspector and other authorized supervisory personnel
```

Staff groups used for allocation: sector staff (PCs and writers), section and duty staff (reception, court, patrol), and drivers and attached personnel (SHO Driver, DI Driver, Pilot Driver, Station Writer, staff attached to other wings).

## 3.2 Application roles (provisional)

| Role | Main permissions |
| --- | --- |
| SHO | Approves and publishes rosters; approves leave |
|   | and movements as configured; sees all screens, |
|   | reports and audit log; confirms rotation and rest |
|   | rules |
| Admin SI | Primary user. Maintains staff register; prepares |
|   | rosters; allocates duties; monitors dashboard; |
|   | handles changes and emergencies; manages |
|   | configuration (shift timings only if authorized) |
| Sector SI (1 to 5) Views and supervises their own sector's staff and |   |
|   | assignments, within permissions granted by SHO |
|   | or Admin SI |


| Role | Main permissions |
| --- | --- |
| DI, DSI | Monitor assigned duties; access as configured by |
|   | station administration |
| Staff | Submit own attendance; request leave and |
|   | movement; view published roster and own records |

Permissions are enforced in the API layer, never only in the screens.

## 4. Configuration data (from the SOP)

All values below are stored in editable configuration tables, never hard-coded.

## 4.1 Shifts

| Shift Start End |   | Duration |
| --- | --- | --- |
| A | 08:00 14:00 | 6 hours |
| B | 14:00 20:00 | 6 hours |
| C | 20:00 08:00 next day 12 hours |   |

Only authorized administrators may change shift timings.

## 4.2 Duty requirements

| Category | Required strength |
| --- | --- |
| Summons | 2 PCs |
| Warrants | 2 PCs |
| Sessions Court | 2 ASIs/HCs |
| JFCM Staff | 2 PCs |
| Reception | 2 |
| eCOPS | 2 |
| CCTNS | 1 |


| Category | Required strength |
| --- | --- |
| Section In-charges | 3 |
| Patrol Vehicles (per shift A, B, C) | 3 |
| Beat Constables (per shift A, B, C) 4 |   |

Other structures: five sectors, each with a designated Sector SI and sector PCs assisting as writers; separate categories for SHO Driver, DI Driver, Pilot Driver, Station Writer, staff attached to other wings and staff temporarily on other official duties.

## 4.3 Status and state lists

- Staff statuses (configurable): Present – Available, On Duty, Field Duty, Court Duty, Patrol / Beat Duty, Official Movement, Attached to Other Wing, On Leave, Duty Off / Rest, Absent, Emergency Deployment, Shift Change Pending.

- Leave states: Pending, Approved, Rejected, Cancelled.

- Task states: Not Started, In Progress, Completed, On Hold, Cancelled.

- Movement: shown as Outside on Official Duty until the return is recorded or the assignment is otherwise closed.


## 5. System architecture

## 5.1 Layers

## Every request passes the API layer and every change reaches the audit log

Dashed boxes arrive in later phases. The highlighted box feeds every dashboard and warning.

architecture blueprint · 4 layers, 8 services

Requests enter through the API layer, the availability engine feeds every dashboard and warning, and the AI service only suggests.

## 5.2 Component responsibilities

| Component | Responsibility |
| --- | --- |
| Staff and config | Staff profiles, shifts, duty master, sectors, |
|   | sections, status lists |


| Component | Responsibility |
| --- | --- |
| Roster and allocation | Draft, validate, approve and publish rosters; |
|   | version every change |
| Attendance and tasks | Scheduled vs confirmed attendance; task lifecycle |
| Leave, movement, attachments Requests, approvals, open movements, attachment |   |
|   | orders |
| Availability engine | Calculates one current status per person; single |
|   | source for dashboards and warnings |
| Reports and audit | Shift, daily and vacancy reports; change history |
| Scheduler | Highlights overdue movements, stalled approvals, |
|   | tasks past expected completion |
| AI service | Roster suggestions, explanations, natural-language |
|   | queries. Read-only via the same API; never writes |
|   | directly |

## 5.3 Design principles

- 1. Attendance, assignment and availability are separate. Attendance and assignments are stored. Availability is calculated, never typed in.

- 2. One change, reflected everywhere. Records link to the individual staff profile.

- 3. Never delete a roster. Changes create a new version with reason and author.

- 4. Every change is traceable to the user who entered and the officer who authorized it.

- 5. Hard rules are plain code (rest, leave, duplicates). AI never replaces them.

## 6. Tech stack

This is a recommendation; confirm against the department's infrastructure and security policy.

| Layer | Choice | Reason |
| --- | --- | --- |
| Frontend | React (Vite or Next.js), | Reuses the demo's screen |
|   | TypeScript | structure; strong table and form |
|   |   | libraries |


| Layer | Choice | Reason |
| --- | --- | --- |
| Mobile (later) | Android (Kotlin or React Native) Demo includes an Android |   |
|   |   | preview; same API |
| Backend | Python, FastAPI | Fast to build; works well with |
|   |   | solver and AI libraries |
| Database | PostgreSQL | Relational integrity, strong audit |
|   |   | and transaction support |
| Auth | JWT or session tokens, role- | Role enforcement in the API |
|   | based access control, optional |   |
|   | OTP |   |
| Background jobs | Celery or APScheduler | Overdue and stalled-item alerts |
| Roster solver (AI | Google OR-Tools (CP-SAT) | Constraint-based suggestions, |
| phase) |   | explainable |
| Language model (AI | Department-approved | Natural-language queries and |
| phase) | deployment, on-premise where | summaries without sending data |
|   | required | out |
| Reports | Server-side PDF and Excel | Shift and daily reports |
|   | export |   |
| Hosting | On-premise or private cloud | Sensitive operational data |
| Dev tooling | Git, CI pipeline, automated tests, | Repeatable builds and |
|   | Docker | deployment |

## 7. Data model

| Table | Key contents |
| --- | --- |
| users, roles, permissions | Login identity, role, sector scope |
| staff | Service number, name, designation, category, |
|   | station, sector, section, reporting officer, contact |
|   | (if authorized), active flag |
| shift_config | Shift code, start, end, duration |


| Table | Key contents |
| --- | --- |
| duty_master | Duty category, section, required strength by shift |
| rotation_rule | Rotation sequence, mandatory rest, duty-off |
|   | periods (set by SHO) |
| roster, roster_assignment Date, shift, duty, staff, status (draft, approved, |   |
|   | published), version, reason, prepared / modified / |
|   | approved by |
| attendance | Staff, shift, status, submitted by, verified by, |
|   | timestamps |
| task | Description, assignee, start, expected completion, |
|   | reporting officer, status |
| movement | Staff, departure, purpose, destination, authorizing |
|   | officer, expected and actual return, status |
| leave_request | Type, dates, reference number, status, approver, |
|   | decision time, remarks |
| attachment_order | Parent unit, attached wing, order reference, start, |
|   | expected end, reporting officer |
| vehicle (optional) | Vehicle number, assigned driver and staff, |
|   | deployment status |
| audit_log | Who, what, when, old and new values, authorizer, |
|   | exception reason |

## 8. Availability engine

The SOP states that availability must be determined using attendance, shift roster, current assignments, approved leave and recorded movements. A person marked present is not automatically available.

To avoid double counting across mutually exclusive status totals, each person receives one current status, chosen by this proposed priority (to be confirmed by the SHO):

- 1. On Leave (approved only; pending requests stay visible but do not count)

- 2. Attached to Other Wing

- 3. Duty Off / Rest


- 4. Official Movement (open)

- 5. Patrol / Beat, Court, Field or On Duty

- 6. Present – Available

- 7. Absent (expected to report, no attendance recorded)

People with more than one related duty record still show all their assignments in a separate assignment view. A person assigned to patrol or beat never appears as freely available unless an authorized reassignment is made.

## 9. End-to-end workflow

## 9.1 One user session, login to logout

- 1. Login page. Staff ID and password (OTP if required). Fields validated; account locks after repeated failures; every attempt is audited.

- 2. Role check and session start. Role identified, session token issued, first-time users change password, user routed to the screens their role allows.

- 3. Dashboard. Live availability and pending items per role: officers see approvals waiting, the SI Admin sees vacancy alerts, staff see their published duty.

- 4. Attendance and status. Staff submit; the system validates the shift and records the submitter; an authorized officer verifies; availability recalculates.

- 5. Leave and outside movement requests. Request routed to the designated approver, who approves or rejects with a recorded decision.

- 6. Roster allocation and publishing. SI Admin allocates, system validates, authorized officer approves, roster is published.

- 7. Movement return and review. Return recorded, movement closed, availability recalculated; SHO and SI Admin review reports and audit log.

- 8. Logout. Button or inactivity timeout; token invalidated on the server; logout written to the audit log; drafts preserved.

## 9.2 Duty allocation workflow (SOP section 8)

| Step Action |   | Screen | Who | System behavior |
| --- | --- | --- | --- | --- |
| 1 | Maintain staff | Staff register | SI Admin or | Saves profile, audits |
|   | records |   | authorized data | change |
|   |   |   | entry |   |


| Step Action |   | Screen | Who | System behavior |
| --- | --- | --- | --- | --- |
| 2 | Prepare shift | Shift roster | SI Admin | Creates daily or |
|   | roster |   |   | periodic draft using |
|   |   |   |   | approved rotation and |
|   |   |   |   | rest rules |
| 3 | Review | Duty allocation | SI Admin | Shows status, |
|   | availability |   |   | approved leave, rest |
|   |   |   |   | period, existing |
|   |   |   |   | assignments |
| 4 | Allocate duties Duty allocation |   | SI Admin | Assigns eligible staff |
|   |   |   |   | against required |
|   |   |   |   | strength |
| 5 | Validate | Duty allocation | System | Checks duplicates, |
|   |   |   |   | shift-time conflicts, |
|   |   |   |   | insufficient rest, |
|   |   |   |   | approved leave, |
|   |   |   |   | existing commitments, |
|   |   |   |   | vacancies, |
|   |   |   |   | unconfirmed |
|   |   |   |   | availability. Warns |
|   |   |   |   | before saving; |
|   |   |   |   | exceptions need |
|   |   |   |   | authorization and an |
|   |   |   |   | audit entry |
| 6 | Approve and | Approvals | SHO or | Locks version; records |
|   | publish |   | authorized | who prepared, |
|   |   |   | officer | modified and approved |
| 7 | Attendance and | Attendance | Staff, officer | Distinguishes |
|   | duty start |   | verifies | scheduled duty from |
|   |   |   |   | confirmed attendance |
| 8 | Monitor | Dashboard | SI Admin, SHO | Summary cards, |
|   |   |   |   | current shift, rest and |
|   |   |   |   | vacancy views |
| 9 | Changes and | Leave, | SI Admin, | Updates status; |
|   | emergencies | Movements, | approvers | arranges replacement |
|   |   | Attachments |   |   |


| Step Action | Screen | Who | System behavior |
| --- | --- | --- | --- |
| 10 Complete duty | Tasks, | Responsible user Records completion |   |
|   | Movements |   | time; recalculates |
|   |   |   | availability |
| 11 Reports | Reports | SI Admin, SHO | Shift-end and daily |
|   |   |   | reports |

## 9.3 Status update workflow (SOP section 9)

Attendance, duty assignment, leave, movement or attachment change, then record or authorization, then status validation, then dashboard update, then audit log.

## 9.4 Outside movement lifecycle

- 1. Record purpose, destination, expected return.

- 2. Obtain authorization under station procedure.

- 3. Record actual departure; movement shows Outside on Official Duty.

- 4. Record return; close movement; recalculate availability.

- 5. If the expected return passes with the movement open, highlight it for the SI Admin.

## 9.5 Leave lifecycle

- 1. Staff submit request with dates and type.

- 2. Routed to the designated approver.

- 3. Approved, rejected or cancelled with recorded approver, date and time.

- 4. Only approved leave counts for roster planning; the roster updates and the SI Admin is alerted about vacancies.


## 10. Screens and modules

| Screen | Purpose |
| --- | --- |
| Dashboard | Summary cards (total staff, scheduled for current |
|   | shift, present, on duty, available, field, court, patrol |
|   | or beat, leave, duty off, attached, official |
|   | movement, absent, vacant positions). Each card |
|   | opens its staff list. Current shift, rest and |
|   | upcoming shift, and vacancy and shortage views |
| Staff register | Profiles, filters, attachment details |
| Shift roster | Daily, weekly, monthly rosters for A, B, C; versions; |
|   | reasons for changes |
| Duty allocation | Required, allocated and vacant strength per duty; |
|   | warnings |
| Attendance | Submit and verify; scheduled vs confirmed |
| Tasks | Current task per person with status |
| Outside movements Open movements, overdue highlight |   |
| Leave and rest | Requests, approvals, rest and duty-off calculation |
| Attachments | Staff attached to other wings or departments |
| Approvals and alerts Approval queue; vacancy, overdue and conflict |   |
|   | alerts |
| Reports | Shift, daily, vacancy and workload reports |
| Android preview | Staff-facing mobile view (later phase) |
| Workflow guide | In-app reference for the four main flows |

The dashboard supports filtering by designation, sector, section, shift, duty category and current status.


## 11. AI features

The core of the Panjagutta AI application is rules-based. AI is added on top as an assistant: it suggests, people decide. This respects the SOP rule that the system must not automatically assign a shift or declare a person eligible from an assumed rotation.

| Feature | What it does | Technique |
| --- | --- | --- |
| Roster suggestion | Drafts a roster that meets required | Constraint solver (OR-Tools) |
|   | strength, avoids conflicts and |   |
|   | balances night and heavy duties; SI |   |
|   | Admin edits and approves |   |
| Smart warnings | Explains the problem and proposes | Rules plus language model |
|   | a replacement | wording |
| Natural-language | Answers questions such as who is | Language model calling |
| assistant | free for C shift tomorrow, from live | approved queries |
|   | data |   |
| Leave impact | Shows coverage impact and | Rules plus model summary |
| preview | alternative dates before approval |   |
| Overdue movement | Warns before a movement becomes | Statistics, later ML |
| alerts | overdue |   |
| Anomaly flags | Repeated late entries, status | Rules first, ML later |
|   | conflicting with movement or leave |   |
| Shortage forecast | Seven-day vacancy projection | Forecasting once history |
|   |   | exists |
| Report summaries | Plain-language shift and daily | Language model |
|   | summaries |   |

## Guardrails

- 1. Human decides: every AI output is a draft; approval stays with the SI Admin, SHO and authorized officers.

- 2. Rules confirmed first: the solver runs only on rotation and rest rules the SHO has signed off.

- 3. Explainable: each suggestion shows its reason and rule.


- 4. Logged: every suggestion and whether it was accepted or overridden goes to the audit log.

- 5. Hard checks run after any suggestion; a suggestion that fails them is rejected.

- 6. The AI service reads data only through the role-checked API.

- 7. Data protection: use an on-premise or department-approved deployment; do not send personal data to external AI services unless authorized.

## 12. Security and audit

- Role-based access control enforced server-side, with sector-scoped views for Sector SIs.

- Password hashing, lockout after repeated failures, optional OTP, inactivity timeout.

- HTTPS everywhere; encrypted backups; restricted database access.

- Audit log is append-only: user, action, time, old and new values, authorizer, exception reason.

- Exceptions to validation rules require appropriate authorization and are always logged.

- Contact details are shown only where authorized.

## 13. Build plan

| Phase Deliverable |   |
| --- | --- |
| 0 | Confirm rules with the SHO (see section 14); obtain |
|   | full SOP section 10 |
| 1 | Login, roles, staff register, configuration tables |
|   | loaded with section 4 data, audit log |
| 2 | Roster, duty allocation, validation warnings, |
|   | approval and publish, roster versioning |
| 3 | Attendance, tasks, movements with overdue |
|   | highlight, leave, attachments |
| 4 | Availability engine, dashboards, vacancy view, |
|   | reports |
| 5 | Android app for staff; notifications |


| Phase Deliverable |   |
| --- | --- |
| 6 | Testing with real station data, security review, |
|   | training, rollout |
| AI 1 | Roster suggestion and smart warnings |
| AI 2 | Natural-language assistant, leave impact preview, |
|   | overdue alerts, report summaries |
| AI 3 | Anomaly flags and shortage forecasting after a few |
|   | months of data |

Phase 0 runs in parallel with Phase 1, but nothing in Phase 2 is built until the rotation rules are confirmed. The AI phases start only after the core application is stable and holds clean data.

## Converting the demo

The demo is a single HTML file with in-memory arrays. Keep its screen layout and styling as the UI reference; replace each in-memory array with API calls; move validation from browser code to the backend; add login, role-based navigation and the audit trail.

## 14. Items to confirm with the SHO

- 1. The exact rotation sequence between A, B and C shifts.

- 2. Minimum rest after each shift, and whether roughly 36 hours of duty off after B shift is a fixed rule.

- 3. Mandatory rest periods and permitted exceptions, and who can authorize them.

- 4. Who approves which leave types and movements.

- 5. The status priority order in section 8.

- 6. Full user roles and access rules (SOP section 10).

- 7. Whether vehicle details (number, driver, staff) are to be maintained.

- 8. Whether staff will use personal Android devices, and the department's policy on AI deployment.


## 15. Testing and rollout

- Unit tests for the availability engine and every validation rule (rest, leave, duplicates, vacancies).

- Scenario tests: emergency deployment, leave approved mid-roster, late return from movement, shift change pending.

- Role tests: each role sees and does only what it should.

- Pilot with one shift and real data before full rollout.

- Train the SI Admin first, then officers and staff.

- Review reports and the audit log with the SHO after the first month.

## 16. Step-by-step build blueprint

The application is built in 33 steps across seven stages, in this order. Each step names what to build and the check that proves it is done.

## Stage A: Prepare (Phase 0)

| Step Build |   | Done when |
| --- | --- | --- |
| 1 | Get the SHO's answers to every item in | A signed rules sheet exists |
|   | section 14 (rotation, rest, approvals, |   |
|   | exceptions) |   |
| 2 | Obtain SOP section 10 and finalize the | Each role's screens and actions are |
|   | role and permission matrix | listed and agreed |
| 3 | Set up the project: Git repository, | The empty app starts with one |
|   | Docker, PostgreSQL, CI pipeline | command and CI runs its tests |

## Stage B: Foundation (Phase 1)

| Step Build |   | Done when |
| --- | --- | --- |
| 4 | Database migrations for users, roles, | Tables are created and rolled back |
|   | staff, shift_config, duty_master, | cleanly |
|   | rotation_rule, audit_log |   |


| Step Build |   | Done when |
| --- | --- | --- |
| 5 | Load configuration from section 4: shifts | An admin can view and edit every value, |
|   | A, B, C; duty requirements; sectors; | nothing is hard-coded |
|   | sections; status lists |   |
| 6 | Authentication: login, password hashing, | A wrong password locks the account; |
|   | lockout, optional OTP, session token, | logout makes the token unusable |
|   | logout, inactivity timeout |   |
| 7 | Role checks in the API with sector | A Sector SI cannot read another sector's |
|   | scoping for Sector SIs | staff |
| 8 | Audit log service called by every write; | Each create, update and approval |
|   | append-only | appears with user, time, old and new |
|   |   | values |
| 9 | Staff register: create, edit, filter, | The SI Admin can add a staff profile and |
|   | attachment details | find it by sector or designation |
| 10 | React shell: login page, role-based menu, | Each role sees only its own menu after |
|   | screens ported from the demo layout | login |

## Stage C: Roster and allocation (Phase 2)

| Step Build |   | Done when |
| --- | --- | --- |
| 11 | Roster and roster_assignment with | The original roster stays viewable after |
|   | versions; a change creates a new version | a change |
|   | with a reason |   |
| 12 | Duty allocation screen showing required, | Four BCs required and three assigned |
|   | allocated and vacant strength per duty | shows one vacancy |
| 13 | Validation rules: duplicate assignment, | Each rule has a test that fails without it |
|   | shift-time conflict, insufficient rest, |   |
|   | approved leave, existing commitment, |   |
|   | unconfirmed availability |   |
| 14 Warnings before saving; exceptions need |   | An override cannot be saved without |
|   | an authorizing officer and an audit entry | an authorizer |


| Step Build |   | Done when |
| --- | --- | --- |
| 15 | Approval and publish: records who | A draft is invisible to staff until |
|   | prepared, modified and approved; | published |
|   | published roster visible to concerned |   |
|   | users |   |

## Stage D: Daily operations (Phase 3)

| Step Build |   | Done when |
| --- | --- | --- |
| 16 | Attendance: submit, officer verification, | The dashboard shows scheduled and |
|   | scheduled vs confirmed | confirmed separately |
| 17 | Tasks: description, assignee, start, | A task past its expected time is flagged |
|   | expected completion, reporting officer, |   |
|   | five statuses |   |
| 18 | Outside movements: purpose, | An open movement shows Outside on |
|   | destination, authorizer, expected and | Official Duty; a late one is highlighted |
|   | actual return |   |
| 19 | Leave requests: types, dates, approver, | Only approved leave removes eligibility; |
|   | Pending, Approved, Rejected, Cancelled | pending stays visible |
| 20 | Attachments to other wings with order | Attached staff count in total strength |
|   | reference, dates and reporting officer | but not in routine deployment |
| 21 | Approvals inbox, alerts and scheduler | The right officer is alerted when an item |
|   | jobs for overdue movements and stalled | is overdue or stalled |
|   | approvals |   |

## Stage E: Availability and dashboards (Phase 4)

| Step Build |   | Done when |
| --- | --- | --- |
| 22 | Availability engine using the confirmed | Unit tests show one status per person |
|   | status priority order | across every combination of records |
| 23 | The 14 summary cards, each opening its | No person is counted in two exclusive |
|   | staff list | status totals |


| Step Build |   | Done when |
| --- | --- | --- |
| 24 | Current shift view, rest and upcoming | Filters by designation, sector, section, |
|   | shift view, vacancy and shortage view, | shift, duty and status all work |
|   | with filters |   |
| 25 | Reports: shift-end, daily, vacancy and | A report matches the dashboard for the |
|   | workload, with PDF and Excel export | same shift |

## Stage F: Mobile and release (Phases 5 and 6)

| Step Build |   | Done when |
| --- | --- | --- |
| 26 | Android app for attendance, requests | A staff member can mark attendance |
|   | and viewing the published roster | and request leave from a phone |
| 27 | Testing: unit, scenario (emergency | All pass in CI |
|   | deployment, leave approved mid-roster, |   |
|   | late return, shift change pending) and |   |
|   | role tests |   |
| 28 | Security review, HTTPS, encrypted | A backup restores to a working system |
|   | backups, restore drill |   |
| 29 | Pilot with one shift on real data; fix what | The SI Admin runs that shift from the |
|   | it exposes | application alone |
| 30 | Train the SI Admin, then officers and | The SHO signs off the first monthly |
|   | staff; full rollout; review reports and | review |
|   | audit log with the SHO after one month |   |

## Stage G: AI (only after the core is stable)

| Step Build |   | Done when |
| --- | --- | --- |
| 31 | Roster suggestion (OR-Tools) on SHO- | Every suggestion shows its reason and is |
|   | approved rules, plus smart warnings with | logged as accepted or overridden |
|   | replacement suggestions |   |
| 32 | Natural-language assistant, leave impact | Answers come only from role-checked |
|   | preview, overdue alerts, report | data |
|   | summaries |   |


| Step Build |   | Done when |
| --- | --- | --- |
| 33 | Anomaly flags and shortage forecast | Flags are reviewed by an officer before |
|   | after a few months of real data | any action |

Nothing in Stage C starts until step 1 is signed. Stage G starts only when Stages A to F are live and the data is clean.
