# MASTER PROMPT FOR GEMINI: BUILD THE PANJAGUTTA POLICE STATION AI DUTY MANAGEMENT APPLICATION

## 0. Your role and the task

Act as a senior full-stack engineer, solution architect, database designer, UX engineer, test engineer, and security-conscious technical lead. Build a **working, end-to-end prototype** of the **Panjagutta Police Station AI Duty Management Application** from the two files attached to this conversation:

1. **`Panjagutta AI Application Police Station Staff Duty Management Application Build Guide.pdf`** — 21-page detailed build guide.
2. **`Panjagutta_AI_Duty_Management.pptx`** — 7-slide presentation summarizing purpose, hierarchy, architecture, workflow, tech stack/AI and delivery stages.

Read and analyze **both files in full before coding**. Inspect every PDF page and every PowerPoint slide, including diagrams, tables, labels, and visual hierarchy. Treat the PDF as the detailed functional specification and the PowerPoint as a complementary summary and visual/design reference. Do not merely summarize the files, create a Figma-like mockup, or return pseudocode. Implement a runnable application with working forms, persistence, validation, role restrictions, workflows, reports, tests, and setup instructions.

Work directly in the available coding workspace/repository if one is provided. Create and modify the actual source files, install dependencies where possible, run migrations and tests, start the app, test major workflows, and fix errors before declaring completion. If you cannot execute code in your environment, still provide the complete project files and exact commands rather than pretending that the application was run.

### North-star outcome

A station administrator should be able to launch the prototype, sign in, register staff, configure station data, draft and validate a roster, route it for approval, publish a version, record/verify attendance, manage tasks/leave/movements/attachments, monitor live availability and vacancies, and export reports. Staff should only see the records and actions their role allows. Every significant change must be traceable. AI is an assistant that proposes and explains; **authorized officers remain responsible for decisions**.

This is a **prototype**, not authorization to use real operational/personal police data or to deploy to production. Seed only fabricated demo data unless the department has separately approved real data and the security design.

---

## 1. Source authority, traceability, and unresolved policy

### Source handling rules

- Use the exact concepts, terms, roles, statuses, shift times, duty requirements, workflows and module names in the attached sources.
- Do not silently replace a source requirement with a generic industry assumption.
- The PDF notes that the supplied SOP ended at section 10, **User roles and access control**, and that the role/permission matrix in the build guide is provisional. Do not claim the complete SOP has been reviewed.
- The PDF refers to an interactive HTML demo with 13 screens, but that HTML demo is not one of the two supplied files in this task. Use the guide’s described modules and the PowerPoint’s visual language; do not claim to have inspected the separate HTML demo or invent details from it.
- Where the source says a rule must be confirmed by the SHO, model it as a configurable, visibly unconfirmed policy. Do not manufacture an official rotation sequence, mandatory-rest rule, approval matrix or exception policy.
- Add a **Requirements Traceability** document or page that maps every source requirement below to the relevant screen, API/service, database field, and test. Mark it `Implemented`, `Partially implemented`, `Deferred`, or `Blocked on policy confirmation` honestly.

### Policy gate that must be implemented

The build guide says Phase 0 (confirm rules) runs in parallel with Phase 1, but Stage C / Phase 2 roster implementation must not begin until the SHO signs off on rotation and rest rules. For this prototype:

1. Provide a setup/policy-confirmation screen for the authorized SHO or delegated authorized administrator.
2. Initially show rotation/rest and role policy as **Unconfirmed** unless an explicit, auditable demo-only sign-off is made.
3. While unconfirmed, permit viewing seeded example rosters and testing validation in a clearly labeled **Demo/Preview** mode, but do not silently allow an operational roster to be published.
4. Offer a clearly marked synthetic **Demo Policy Sign-off** flow for local demonstrations only. It must be labeled non-operational, capture the demo user, timestamp, policy version and acknowledgement, and be disableable for production configuration. It must never be represented as a real SHO approval.
5. Store the configured policies, their effective dates, approver, approval time and version. A change creates a new policy version and an audit event.

Items requiring SHO / department confirmation from PDF page 16 and PowerPoint slide 7:
- Exact rotation sequence between shifts A, B and C.
- Minimum rest after each shift, and whether roughly 36 hours of duty off after Shift B is a fixed rule.
- Mandatory rest periods, permitted exceptions and who may authorize each exception.
- Which role approves each leave type and each movement type.
- Whether the proposed availability-status priority is approved.
- Full user roles and access rules from the complete SOP section 10.
- Whether vehicle details (number, driver, staff) must be maintained.
- Whether staff may use personal Android devices and which AI deployment options are department-approved.

Display these as explicit configuration/policy items, not buried TODOs. Do not infer official rules from common practice.

---

## 2. Product purpose and problems to solve

Build a centralized web application for **Panjagutta Police Station** so the SHO, Admin SI, Sector SIs, DI, DSI and permitted staff can understand staff strength and status in one place. The system should answer at any time:

- How many staff are assigned to the station?
- Who is present, on duty, on rest/duty-off, on leave, absent, attached to another wing, or on official work outside the station?
- What task is each available person performing?
- Which duty positions are vacant, pending or unallocated?
- Who is assigned to patrol vehicles, beats, court duties, reception, eCOPS, CCTNS and other sections?

Implement the source's direct problem-to-solution mapping:

- Prevent allocations from memory, clashes and double assignments with validation warnings **before saving**.
- Do not treat `Present` as synonymous with `Available`; calculate availability from attendance, roster, assignments, leave and movement records together.
- Count one current status per person for mutually exclusive status totals; maintain assignments in a separate view.
- Record station departures with purpose, destination, authorizer and expected return; flag open overdue movements.
- Compare required staffing strength with eligible/valid allocations before a shift starts.
- Never overwrite a roster version; preserve the original and create a new version with change reason and author.
- Approved leave must remove a person from eligibility, affect coverage and alert the SI Admin; pending leave remains visible but does not count as approved.
- Generate shift-end, daily, vacancy and workload reports from the same stored records used by the dashboard.

The system must **not** automatically assign shifts based on an assumed rotation, decide eligibility from an invented rotation rule, treat an unreported absence as authorized movement, or replace human approval.

---

## 3. Station hierarchy, staff groups and provisional roles

### Station hierarchy (PDF page 3; deck slide 3)

Represent the hierarchy in the UI and the permission model:

- **SHO (Station House Officer)** — station-wide oversight.
- Reporting/related roles: **DI**, **Admin SI**, **Sector 1 SI through Sector 5 SI**, and **DSI**.
- Staff register includes **ASI/AWSI, HC/WHC, PC/WPC, ARPC/ARWPC, HGS/WHGS, SPOs**, and Inspector/other authorized supervisory personnel where applicable.
- Staff groups: sector staff (PCs and writers); section/duty staff (reception, court, patrol); drivers and attached personnel (SHO Driver, DI Driver, Pilot Driver, Station Writer, staff attached to other wings or temporarily on other official duties).
- Model five sectors, a designated Sector SI for each, and sector PCs who may assist as writers.

### Application roles — provisional until the full SOP is obtained

Implement an editable, centralized permission matrix. Enforce every permission in the **backend/API**, not merely by hiding buttons.

- **SHO:** approve and publish rosters; approve leave and movements according to configured policy; view all allowed screens, reports and audit history; confirm rotation/rest rules.
- **Admin SI:** primary day-to-day operator; maintain staff register; prepare rosters; allocate duties; monitor dashboard; handle changes/emergencies; edit configuration only where authorized (shift times especially restricted).
- **Sector SI (1–5):** view/supervise only their own sector's staff and assignments within the configured permissions.
- **DI and DSI:** monitor assigned duties and access the records granted by station administration.
- **Staff:** submit own attendance, request leave and movement, view published roster and own records.

Create permission actions such as `view`, `create`, `edit`, `submit`, `verify`, `approve`, `publish`, `configure`, `export` and `view_audit`, scoped as applicable by station/sector/self. Ensure a Sector SI cannot fetch another sector's staff by changing a URL, request body, query parameter or API identifier. Hide unauthorized navigation and also return correct server-side `401/403` errors.

Seed role-labelled demo accounts and display a clear demo warning. Never use real officer credentials. Document how to change demo passwords and disable demo accounts.

---

## 4. Configuration data — seed exactly, make editable, avoid hard-coding rules in UI

Store shifts, duty requirements, sector/section definitions, status lists, role/permission rules and approved rotation/rest rules in configuration tables. Provide a restricted configuration UI and audit every modification. Shift times can be changed only by authorized administrators.

### Shifts (PDF page 4)

| Shift | Start | End | Duration |
|---|---:|---:|---:|
| A | 08:00 | 14:00 | 6 hours |
| B | 14:00 | 20:00 | 6 hours |
| C | 20:00 | 08:00 next day | 12 hours |

Handle overnight shifts correctly, including dates crossing midnight, overlaps and report boundaries. Do not assume the rotation sequence simply because shifts have labels A/B/C.

### Duty requirements (PDF pages 4–5)

Seed these requirements as configurable `duty_master` entries. Preserve the designation constraints shown:

| Duty/category | Required strength / rule |
|---|---|
| Summons | 2 PCs |
| Warrants | 2 PCs |
| Sessions Court | 2 ASIs/HCs |
| JFCM Staff | 2 PCs |
| Reception | 2 |
| eCOPS | 2 |
| CCTNS | 1 |
| Section In-charges | 3 |
| Patrol Vehicles | 3 per shift (A, B and C) |
| Beat Constables | 4 per shift (A, B and C) |

Also allow configuration for five sectors, sector writers/PCs, SHO Driver, DI Driver, Pilot Driver, Station Writer, attachments to other wings, temporary official duties and other categories approved by station administration. Do not add invented required strengths for these categories; default unspecified requirements to “not configured” until an authorized user supplies them.

### Statuses and state lists (PDF page 5)

Configurable staff-status vocabulary must include:
- Present – Available
- On Duty
- Field Duty
- Court Duty
- Patrol / Beat Duty
- Official Movement
- Attached to Other Wing
- On Leave
- Duty Off / Rest
- Absent
- Emergency Deployment
- Shift Change Pending

Leave states: `Pending`, `Approved`, `Rejected`, `Cancelled`.

Task states: `Not Started`, `In Progress`, `Completed`, `On Hold`, `Cancelled`.

An active movement displays the person as `Outside on Official Duty` until the return is recorded or the assignment is otherwise formally closed. Distinguish the detailed current-status label from the top-level mutually exclusive dashboard bucket where needed, without double-counting people.

---

## 5. Architecture and implementation stack

### Recommended default stack from the sources (PDF pages 6–8; deck slide 4 and slide 6)

Use the following practical, coherent default unless the provided workspace imposes a real constraint:

- **Frontend:** React + Vite + TypeScript.
- **UI:** responsive, accessible, component-based UI; usable tables, filters, forms, drawers/modals, confirmation steps, empty states and error states.
- **Backend/API:** Python + FastAPI; typed schemas, service layer, request validation and OpenAPI docs.
- **Database:** PostgreSQL with real migrations and foreign-key/unique/check constraints.
- **Authentication:** password hashing; server-validated session/JWT token; role-based access; lockout after repeated failed attempts; optional OTP only if configured; first-login password change; inactivity timeout; server-side logout/session invalidation, with drafts preserved on logout.
- **Background scheduling:** APScheduler for a light single-instance prototype, or Celery if the environment truly needs a task queue. Do not add infrastructure without a reason.
- **Roster solver (later AI phase):** Google OR-Tools CP-SAT, operating only against SHO-confirmed constraints.
- **AI model (later phase):** only a department-approved model and deployment, on-premise where required. No external model calls by default.
- **Reports:** server-generated PDF and Excel export.
- **Deployment:** Docker/Compose for local development; on-premise or approved private cloud for any authorized deployment.
- **Developer workflow:** Git-ready repository, automated tests and CI-friendly commands.
- **Future native mobile:** Android with Kotlin or React Native, sharing the same API. For this prototype provide a polished responsive staff-facing mobile view/Android preview if a native app is not practical; label native Android as a later phase rather than falsely claiming it exists.

### Required logical layers and eight service areas

Implement clear separation between:
1. React web app for SHO, Admin SI and Sector SIs.
2. API layer for authentication/session, roles, sector scoping, validation and business endpoints.
3. Application services:
   - Staff and configuration.
   - Roster and allocation/versioning.
   - Attendance and tasks.
   - Leave, movements and attachments.
   - Availability engine.
   - Reports and audit.
   - Scheduler for overdue/stalled items.
   - AI assistant/suggestions (later, read-only through the same role-checked API).
4. PostgreSQL persistence.

Keep the AI service read-only. It must never write directly to the database or bypass normal API validation and permissions.

### Design principles (PDF page 7)

- Attendance, assignment and availability are separate concepts. Store attendance and assignments; calculate availability, never manually type it.
- Changes to a person's records should be reflected wherever that person appears because records link to the individual staff profile.
- Never delete/overwrite a roster history entry; create a new version and capture the reason.
- Record the actor, timestamp, old/new values, authorizer and exception reason for material changes.
- Hard rules (leave, duplicate assignments, approved rest and shift conflicts) must be ordinary code/tests, never delegated to an LLM.

---

## 6. Data model and database integrity

Create migrations and relational models for all source-listed tables below. Rename only where necessary for a consistent codebase, and document the mapping.

- `users`, `roles`, `permissions`: login identity, role assignments, permission scopes and sector scope.
- `staff`: service number, name, designation, category, station, sector, section, reporting officer, contact details (only where authorized), active flag.
- `shift_config`: shift code, start, end, duration and active/version metadata.
- `duty_master`: duty category, section, eligible designation(s), required strength by shift and active/configured status.
- `rotation_rule`: rotation sequence, mandatory rest, duty-off periods and the SHO approval/version metadata.
- `roster` and `roster_assignment`: date/period, shift, duty, staff, status (`draft`, `approved`, `published`), version, reason, prepared/modified/approved by, timestamps.
- `attendance`: staff, shift, status, submitter, verifier and timestamps; keep scheduled attendance separate from confirmed attendance.
- `task`: description, assignee, start time, expected completion, reporting officer, status and completion timestamp.
- `movement`: staff, departure, purpose, destination, authorizing officer, expected return, actual return, status, close details.
- `leave_request`: type, dates, reference number, status, approver, decision time and remarks.
- `attachment_order`: parent unit, attached wing, order reference, start date, expected end date and reporting officer.
- `vehicle` (optional/configurable, as the PDF says): vehicle number, assigned driver/staff, deployment status.
- `audit_log`: user, action, time, old/new values, authorizer and exception reason; append-only through application permissions.
- Add supporting tables for policy versions, demo-policy acknowledgement, notification/alert state and report metadata only where justified.

Use appropriate primary/foreign keys, indexes, uniqueness constraints and transactions. Consider PostgreSQL constraints and service-level safeguards for roster assignments and audit integrity. A service number should uniquely identify a staff profile. Define deletion/archive behavior so referenced audit history is not destroyed. Use soft deactivation where appropriate. Store times and timestamps consistently, and model local station time explicitly; do not mis-handle overnight shifts.

Write reversible migrations. Include a deterministic seed script containing **fabricated names and staff IDs only**, a few sectors, shifts, duty categories, demo roles, sample rosters, tasks, leave requests and movement records in varied states. Clearly badge seeded content as `DEMO DATA`; include a reset command.

---

## 7. Availability engine — a central, deterministic business service

The availability engine is the single source of truth for each person's current status, used by dashboard summaries, assignment validation, duty-eligibility checks, warnings and reports. Derive status from attendance, approved roster, assignments, approved leave, open movement, attachments and authorized emergency deployment records.

The guide proposes the following priority order, explicitly subject to SHO confirmation. Implement it as versioned configuration, visibly marked provisional until confirmed:

1. `On Leave` — approved leave only; pending requests stay visible but do not make someone ineligible as approved leave.
2. `Attached to Other Wing`.
3. `Duty Off / Rest`.
4. `Official Movement` — open movement.
5. `Patrol / Beat`, `Court`, `Field` or `On Duty` — based on active assignment.
6. `Present – Available`.
7. `Absent` — expected to report but no attendance is recorded.

Requirements:
- Every staff member must resolve to **exactly one** current status for mutually exclusive status totals (or an explicit inactive/not-in-scope state for inactive profiles, clearly handled in totals). Related assignments can be many and must appear in a separate assignments view.
- Someone assigned to patrol/beat cannot appear as freely available unless an authorized reassignment closes/changes that duty.
- A person with an open official movement is outside on official duty until the return is recorded or movement is formally closed.
- Approved leave removes eligibility for applicable shifts and creates a coverage/vacancy alert. Pending leave remains visible and should be shown in planning/approval context.
- Attachment orders count the staff member in overall station strength but exclude them from routine deployment while active, matching the source.
- Emergency deployment and shift-change-pending cases must be represented. Since the source does not specify their full priority interaction, expose them as a policy decision/configuration item and do not invent invisible behavior.
- If conflicting records exist, return a diagnosable validation/status warning instead of silently hiding it. Log the underlying facts used to calculate status where useful for audit/debugging.
- Write unit tests for all combinations and ensure the summary totals do not double-count people.

---

## 8. Roster and duty-allocation workflow

Implement the complete flow from PDF pages 10–12 and the Stage C build steps:

1. Maintain the staff register.
2. SI Admin creates a daily, weekly or monthly roster draft using only approved/configured rules. Do not generate an automatic rotation when rules remain unconfirmed.
3. Show availability before allocating: current status, attendance confirmation, approved leave, rest status, existing assignments, attachment, current movement and conflicts.
4. Show required strength, allocated strength, remaining vacancies and over-allocation per duty and shift.
5. Allow authorized manual allocation against duty requirements. Enforce eligible designations where explicitly defined (e.g. PC constraints for Summons/Warrants/JFCM and ASI/HC constraints for Sessions Court).
6. Before a save, run and display clear validation warnings for:
   - duplicate assignment;
   - overlapping shift-time or duty-time conflicts;
   - insufficient rest according to confirmed policy;
   - approved leave;
   - existing commitment/assignment;
   - vacant or insufficient required strength;
   - unconfirmed availability;
   - unauthorized or invalid designation for a duty.
7. Show the exact person, shift, duty, affected time period, validation rule and explanation; where helpful, suggest a replacement from currently eligible staff. Suggestions are only suggestions.
8. Do not let a user bypass a hard validation silently. If the approved policy allows an exception, require the appropriate authorizer, explicit reason, warning acknowledgement and audit record. Never treat ordinary UI confirmation as authorized approval.
9. Save drafts with a reason and author. Every material change creates a new roster version; previous versions stay viewable and comparison is available.
10. Route a version to the authorized officer/SHO for approval. Record prepared by, modified by, approved by, timestamps and approval comments.
11. Approval locks the submitted version. Publishing makes that version visible to the relevant staff; drafts must remain invisible to staff as stated in the guide.
12. A later change creates a new draft/version rather than editing the historical published record in place. Keep a comparison view showing additions, removals and changed assignments.
13. Coverage impact from approved leave, emergency deployment or an approved reassignment should refresh vacancies and alerts.

Acceptance example from PDF page 18: if 4 Beat Constables are required and only 3 are validly assigned, show one vacancy. Do not claim coverage is complete because 4 staff records exist if only 3 are eligible/assigned.

---

## 9. Attendance and task operations

### Attendance (PDF pages 10–11 and Stage D)

- Permit staff to submit attendance for the relevant configured shift.
- Record who submitted it and the timestamp.
- Permit a suitably authorized officer to verify/confirm it.
- Show `Scheduled` and `Confirmed` counts/statuses separately; never treat roster scheduling as proof of attendance.
- Validate that the shift and staff are appropriate and avoid duplicate submissions where the policy disallows them.
- Update calculated availability after submission/verification.

### Tasks

- Store description, assignee, start time, expected completion, reporting officer, status and completion time.
- Use exactly the five source statuses: `Not Started`, `In Progress`, `Completed`, `On Hold`, `Cancelled`.
- Provide create/edit/assign/status-update flows according to role.
- Flag tasks past expected completion; scheduler must highlight stalled or overdue tasks as supported by the source.
- Recalculate availability only from the approved task/duty rules; do not assume every task status alone determines availability.

---

## 10. Outside movement lifecycle

Implement the source lifecycle with a clear history/timeline:

1. Enter staff member, purpose, destination, expected return and any relevant reference/remarks.
2. Route authorization to the designated approver according to configured station policy.
3. Record actual departure and authorization; show the staff member as `Outside on Official Duty` while the movement is open.
4. Record actual return, close the movement and recalculate availability.
5. If expected return passes and the movement remains open, highlight it on the dashboard and approvals/alerts screen, and notify the SI Admin/authorized roles according to configuration.

Do not create an authorized movement merely because attendance is missing. Support cancellation/closure only through auditable, permission-checked actions. Keep expected and actual return distinct and display duration/overdue state.

---

## 11. Leave, duty-off/rest and attachments

### Leave lifecycle

- Staff create a leave request with leave type, start/end dates, reference number where applicable and remarks.
- States are exactly `Pending`, `Approved`, `Rejected`, `Cancelled`.
- Route to the configured approver; preserve approver, decision, date/time and remarks.
- Approved leave affects eligibility, roster coverage and the vacancy list; send/display an alert to the SI Admin.
- Pending/rejected/cancelled leave must not be treated as approved absence.
- Provide a **leave impact preview** showing affected assignments, shortages and possible alternatives before a decision. Alternative dates are advisory only.

### Rest / duty-off

- Show recent shifts, configured mandatory-rest windows, planned rest/duty-off and policy warnings.
- Do not calculate official eligibility from an invented rule. When the SHO has not confirmed the policy, show rest-validation as `Policy unconfirmed` and prevent roster publish.

### Attachments

- Record parent unit, attached wing, order/reference, start, expected end and reporting officer.
- Staff attached to another wing count in total station strength but should not be offered for routine assignment while the attachment is active.
- Support end/return of an attachment, with authority, dates and audit history.

---

## 12. Dashboard, required screens and user experience

The PDF lists the modules below. Implement them as actual routes/views with working interactions, loading/error/empty states and permission-aware actions. The dashboard is not just static cards.

### Dashboard: 14 summary cards

Provide cards for:
1. Total staff.
2. Scheduled for current shift.
3. Present.
4. On duty.
5. Available.
6. Field duty.
7. Court duty.
8. Patrol / beat duty.
9. On leave.
10. Duty off/rest.
11. Attached to other wing.
12. Official movement.
13. Absent.
14. Vacant positions.

Each card must open a corresponding filtered staff/position list. Define the counts clearly, avoid mutually exclusive double counts, and have dashboard values come from the API/availability service rather than hardcoded front-end arrays. Present distinct current-shift, rest/upcoming-shift and vacancy/shortage views.

### Screens/modules (PDF page 13; PDF refers to a 13-screen demo)

1. **Login** — staff ID/password, validation, lockout and safe error messaging.
2. **Dashboard** — summary cards, current shift, rest/upcoming shifts, vacancies and alerts.
3. **Staff register** — create/edit/deactivate profiles, search, filters, attachment details.
4. **Shift roster** — daily/weekly/monthly A/B/C view, version history, change reason, compare versions.
5. **Duty allocation** — required/allocated/vacant strength, eligible staff, warnings and assignment management.
6. **Attendance** — staff submit, authorized officer verifies, scheduled-vs-confirmed distinction.
7. **Tasks** — current task/person, lifecycle statuses and overdue flags.
8. **Outside movements** — open/recent movements, approval, departure/return recording, overdue highlight.
9. **Leave and rest** — requests, approvals, rest/duty-off calculations and leave impact preview.
10. **Attachments** — other wing/department attachment orders and end dates.
11. **Approvals and alerts** — authorization queue; vacancy, overdue, conflict and stalled-approval alerts.
12. **Reports** — shift, daily, vacancy and workload reports, PDF/Excel exports.
13. **Android preview / responsive staff view** — staff attendance, own requests and published roster. Clearly label native Android as later unless actually implemented.

Also include an **in-app workflow guide** for the four principal flows: duty allocation, status update, outside movement, and leave. Include configuration/policy confirmation, user/role management and audit history in a secure admin area as supporting screens.

### Dashboard and register filters

Implement working filters for designation, sector, section, shift, duty category and current status. Ensure filters operate against real records and preserve valid query parameters. Sector SI views must be scoped to their authorized sector. Every card/list must support useful sorting/searching and show why a person appears in a result.

### Visual design direction from the PowerPoint

Use the deck's restrained government-operations style: dark navy for primary/cover areas, light cool-gray page surfaces, white cards, strong but limited blue accents, clean table/card layouts, thin separators, clear hierarchy, and connector/process diagrams where useful. The reference deck uses straightforward architecture boxes and workflow cards, not flashy AI visuals. Keep the application professional, fast to scan, accessible, and suitable for long operational shifts. Avoid neon gradients, gratuitous animations, overuse of glassmorphism, chatbot-first layouts and giant text blocks. Make desktop the primary admin experience and responsive mobile the staff experience. Include accessible contrast, visible keyboard focus, descriptive labels, validation feedback, and confirmation for consequential actions.

---

## 13. Approvals, notifications, scheduler and audit

### Approvals and alerts

- Central approvals inbox showing item type, subject/staff, submitted by, submitted time, status, appropriate approver, due/overdue indicator and supported actions.
- Include leave and movement requests plus roster approval/publishing and any authorized exception approval.
- Only the designated role can approve or reject; require remarks where the policy demands them and always store the decision-maker and timestamp.
- Alerts for duty vacancies/shortage, conflicts, movement overdue, task overdue/stalled, stalled approvals and approved leave affecting coverage.
- Avoid sending real SMS/WhatsApp/email in the prototype unless expressly configured; an in-app alert center is sufficient and safer by default.

### Scheduler

Implement a real scheduled job (or a reliable manual `Run checks now` action plus documented schedule) that evaluates overdue open movements, tasks beyond expected completion, and stalled approvals. Avoid duplicate alert spam by tracking alert instances/state and allowing resolution/acknowledgement. Test time-bound behavior with controllable times or fixtures.

### Audit trail

- Append an audit event for each create, update, approval, rejection, publish, roster version, policy change, authentication attempt/lockout/logout and authorized exception.
- Capture actor, action, timestamp, entity/type/id, old and new values where applicable, authorizer, exception reason, and relevant correlation/request ID.
- Prevent ordinary application users from editing/deleting audit records. Preserve audit history when records are deactivated/archived.
- Provide a permission-protected search/filter view and exports only for authorized roles.
- Never log passwords, raw session tokens or sensitive secrets.

---

## 14. Reports and exports

Generate server-side reports from the same domain services as the dashboard. At minimum provide:

- Shift-end report.
- Daily report.
- Vacancy/shortage report.
- Workload report.
- Roster version/change report and an audit/history report for authorized users.

Provide clear date/shift/sector filters; generated-at timestamp; parameters used; and totals that reconcile with the dashboard for the same shift. Support PDF and Excel downloads. Validate exports for permission scope—e.g. Sector SI exports cannot include other sectors. Never fabricate a report result when no records exist; show a meaningful empty-state message or a valid empty report.

---

## 15. AI features — gated, explainable, draft-only

The core product is rules-based; AI features are layered on top only after the core application is stable and data is clean. Make the boundary explicit in the UI and code. **No external AI calls by default.** Use a provider interface so an approved local/on-premise/department-approved model can be configured later. Never transmit personal or operational data to an unapproved service. The AI component must retrieve information through the same role-checked API as other clients and must not write directly to the database.

Implement these features in sensible order, and label unavailable ones honestly:

1. **Roster suggestions** — later phase; OR-Tools CP-SAT can propose a roster only against SHO-signed rotation/rest rules and required staffing. It must not automatically assign/publish. Every proposal shows why each assignment was suggested, the rules used and any shortage that cannot be filled. SI Admin edits; authorized officer approves.
2. **Smart warnings** — code rules identify the problem; a language model may explain it and propose a replacement. Re-run all hard checks on any candidate. Reject suggestions that fail checks.
3. **Natural-language assistant** — examples: “Who is available for C shift tomorrow?” or “Which duties are vacant in Shift B?” Answer from current role-authorized data only. Show time/shift scope and explain how a count was determined. If live AI provider configuration is absent, provide a deterministic rules-based demo query experience and label it as such; never pretend an LLM is connected.
4. **Leave impact preview** — rules calculate affected coverage; model can summarize impact/options. Decision always stays with the approver.
5. **Overdue movement alerts** — start with deterministic scheduler rules/statistics; machine learning is a later option.
6. **Anomaly flags** — rules first for repeated late entries, conflicting status vs movement/leave, and inconsistent records. ML only after sufficient clean data and officer review.
7. **Shortage forecast** — a seven-day vacancy projection only when enough real historical data exists; otherwise show `Insufficient history` or seeded demo forecast clearly marked. Do not invent predictive accuracy.
8. **Report summaries** — optional plain-language summaries over already authorized report data.

### AI guardrails (PDF pages 14–16 and presentation slide 6)

- Every AI output is a draft; human approval by the SI Admin, SHO or authorized officer remains required.
- Use only rules approved/signed off by the SHO; if not confirmed, do not produce authoritative roster eligibility/suggestions.
- Each suggestion must show a reason and the rule/policy version involved.
- Log each suggestion, input/context identifiers (avoid unnecessarily duplicating personal data), generated result, provider/model if any, time, and whether accepted, edited, rejected or overridden.
- Run hard checks after a suggestion. No AI can bypass validation or authorization.
- AI has read-only access through role-checked endpoints.
- Default to no external AI provider and no sensitive-data transmission. Provide a configuration flag and documentation for approved on-premise/provider setup.
- Do not train models on station records. Do not infer misconduct or treat an anomaly score as proof; all anomaly flags require officer review.

---

## 16. Security and privacy requirements

Implement and document:

- Role-based authorization enforced on the API and row/sector/self scope checks.
- Proper password hashing (never plaintext); lockout after configurable repeated failures; neutral error messages; optional OTP integration only if configured.
- Secure session/token handling; first-login password change; inactivity timeout; server-side invalidation on logout; preserve drafts on logout; audit login attempts, lockouts and logout.
- Input validation, output escaping, safe errors, rate limiting on login and sensitive endpoints, CSRF protection where cookie sessions are used, safe CORS defaults, and secure headers as appropriate.
- HTTPS expectation for deployment; local development may use localhost, clearly documented.
- Restricted database credentials and access; secrets only from environment variables, never committed to Git.
- Encrypted backups and a tested restore procedure documented for deployment.
- Contact details visible only where authorized.
- Append-only audit behavior and authorization requirement for all overrides.
- No real credentials, real service IDs, or actual operational records in the seed data or screenshots.
- Environment example file with dummy values, `.gitignore`, no secrets, and an explicit warning that default demo accounts are not production-safe.
- A deployment checklist requiring the department's security review, approved hosting, approved AI provider (if any), and SHO-confirmed policy before production.

Do not claim the prototype is production secure or department-approved solely because these controls have been implemented in a demo.

---

## 17. Seven stages and 33-step blueprint — preserve the source's gates

Use the PDF's staged build plan as the implementation sequence. Track progress in a checklist, but do not stop after producing the checklist: implement the highest feasible end-to-end path and make the remaining statuses honest.

### Stage A — Prepare (Phase 0), steps 1–3
1. Capture SHO decisions for rotation, rest, approvals and exceptions; done when a signed/configured rules record exists. In a prototype, distinguish real sign-off from demo-only policy acknowledgement.
2. Obtain/record the missing SOP section 10 and finalize the role/permission matrix; if unavailable, keep roles explicitly provisional and configurable.
3. Set up Git repository, Docker, PostgreSQL and CI; app starts via documented commands and CI runs tests.

### Stage B — Foundation (Phase 1), steps 4–10
4. Reversible migrations for users, roles, staff, shift config, duty master, rotation rules and audit log.
5. Load editable configuration for A/B/C shifts, duty requirements, sectors, sections and status lists; no business config hard-coded only in the UI.
6. Authentication: hashed passwords, first-login password change, lockout, optional OTP, session token, logout and inactivity timeout; logout preserves drafts and is audited.
7. API role checks and Sector SI scoping; a Sector SI cannot read another sector.
8. Append-only audit service used on every write; each create/update/approval records user, time and old/new values as applicable.
9. Staff register CRUD/filtering/attachment details; Admin SI can add and find a profile by sector/designation.
10. React shell, login, role-based navigation and all main views ported in the design language of the guide/deck.

### Stage C — Roster and allocation (Phase 2), steps 11–15 — gated by signed policy
11. Roster and assignments with versions; changing a roster creates a new version with reason and keeps the original viewable.
12. Duty allocation view shows required, allocated and vacant strengths per duty.
13. Test all validation rules: duplicate assignment, time conflict, insufficient rest, approved leave, existing commitments and unconfirmed availability.
14. Show warnings before save; exceptions require authorizer and audit entry.
15. Approval/publish records preparer, modifier and approver; draft is invisible to staff until published.

### Stage D — Daily operations (Phase 3), steps 16–21
16. Attendance submission, officer verification, scheduled vs confirmed.
17. Task lifecycle with assignee, start, expected completion, reporting officer and five source statuses; late tasks flagged.
18. Outside movements with purpose, destination, authorizer, expected/actual return; open movement shows Outside on Official Duty and overdue movement highlighted.
19. Leave request lifecycle and approver; only approved leave changes eligibility; pending remains visible.
20. Other-wing attachments with order reference, dates and reporting officer; count in total strength but exclude from routine deployment while active.
21. Approvals inbox, alerts and scheduler jobs for overdue movement and stalled approval.

### Stage E — Availability and dashboards (Phase 4), steps 22–25
22. Availability engine uses the confirmed status priority; tests prove one status per person.
23. Fourteen summary cards; each opens its staff list and no person is counted in two mutually exclusive status totals.
24. Current shift/rest/upcoming shift/vacancy views and functional designation/sector/section/shift/duty/status filters.
25. Shift-end/daily/vacancy/workload reports with PDF/Excel export; report reconciles with dashboard for the same filter.

### Stage F — Mobile and release (Phases 5–6), steps 26–30
26. Staff mobile view for attendance, requests and published roster. Native Android can be marked later if not actually built.
27. Unit, scenario and role tests pass in CI. Required scenarios: emergency deployment, leave approved mid-roster, late movement return and shift-change-pending.
28. Security review, HTTPS expectations, encrypted backups and restore drill. For the prototype provide documented commands/checklist and test restore where feasible.
29. Pilot workflow with one shift using synthetic data first; the SI Admin should be able to manage the demo shift from the application.
30. Train-the-user guide and deployment/rollout checklist; review reports and audit log. Real station pilot requires authorization and SHO sign-off.

### Stage G — AI (after core stability), steps 31–33
31. OR-Tools roster suggestions on SHO-approved rules plus smart replacement warnings; every suggestion explains its reason and logs acceptance/override.
32. Natural-language assistant, leave impact preview, overdue alerts and report summaries; responses come only from role-checked data.
33. Anomaly flags and shortage forecast only after sufficient clean historical data; officers review flags before any action.

**Gate:** Nothing in Stage C starts until step 1 is signed/explicitly demo-simulated. Stage G starts only after Stages A–F are functional and data is clean. You can build module scaffolding earlier, but do not enable operational roster publishing or authoritative AI outputs while policy is unconfirmed.

---

## 18. Required testing strategy and acceptance scenarios

Create automated tests—not just a manual checklist. Use appropriate backend unit/integration tests (e.g. pytest) and frontend end-to-end tests (e.g. Playwright) if supported by the environment.

### Business logic tests
- One and only one current availability status per active staff member under combinations of attendance, shifts, assignments, leave, movement, attachment and rest.
- Pending leave does not equal approved leave; approved leave prevents relevant allocation.
- Open movement wins according to confirmed/configured priority and remains open until a recorded return/formal close.
- Patrol/beat/court/field assignment prevents free-available status until authorized reassignment/closure.
- Sector/section scope, staff eligibility and shift timing validation.
- Cross-midnight Shift C calculations from 20:00 to 08:00 next day.
- Duplicate assignment and overlapping time conflict rejected/warned before save.
- Rest checks are unavailable/blocked pending policy confirmation, not guessed.
- Four required Beat Constables and three allocated results in one vacancy.
- Version history: changing an approved/published roster creates a new version; old version and change reason remain accessible.
- Draft visibility: staff cannot read drafts; they can read only published versions in scope.
- Exceptions require approved authorizer/reason and generate immutable audit records.
- Audit log written for every required action; no ordinary user can edit/delete it.
- Report totals reconcile with dashboard for identical parameters.
- Scheduler correctly flags overdue movement/task/stalled approval without duplicate alert spam.

### Required scenario tests from the guide
1. Emergency deployment.
2. Leave approved after a roster has been prepared/published; vacancy/eligibility is updated and alert raised without erasing history.
3. Movement return later than the expected time.
4. Shift change pending.
5. Wrong password lockout, session invalidation on logout, inactivity timeout.
6. Role tests for every role; Sector SI tries to fetch another sector; staff tries an admin action.
7. Failed/invalid roster proposal is rejected by hard rules.
8. A failed database transaction must not leave half-written roster or missing audit event; define transaction strategy.

### Definition of done
Do not declare the application complete until:
- A fresh local setup from the README can run migrations and seed data.
- A user can sign in using documented demo credentials, see the role-appropriate experience, and log out.
- Main CRUD forms save and reload from PostgreSQL, not just browser memory.
- The main roster-to-approval-to-publish flow works in explicitly labeled demo-policy mode and remains gated otherwise.
- Attendance, task, leave, movement and attachment flows update the calculated dashboard/alerts.
- Server-side permission and sector scope checks work.
- Reports download and their totals match the data.
- Automated tests run and pass, or failures are reported precisely.
- No buttons are decorative/dead. Every visible action works or is disabled with a clear explanation.
- No hidden mock values are presented as live data; mocked/deterministic AI is labeled clearly.

---

## 19. PDF page-by-page coverage checklist (21 pages)

Use this checklist to confirm that every PDF page informed the implementation. Do not skip a page because it looks repetitive.

- **PDF p.1 — Purpose/scope:** centralized web app, Android later; exact operational questions; real app adds login, database, approvals, validation, roster versioning and audit trail; demo's in-memory behavior versus real persistence; incomplete SOP section 10 caveat.
- **PDF p.2 — Problems solved and boundaries:** conflict warnings, calculated availability, exclusive status, movement records/overdue return, pre-shift staffing coverage, versioned rosters, approved-leave effects, generated reports; no automatic shift assignment from assumed rules or approval replacement.
- **PDF p.3 — Hierarchy/roles:** SHO, DI, Admin SI, Sector SI 1–5, DSI, staff categories, operational groups, role permission table and API-side enforcement.
- **PDF p.4 — Shifts/duties:** exact A/B/C start/end/duration and the first set of staffing requirements; shifts editable only by authorized administrators.
- **PDF p.5 — Remaining duty requirements and states:** Section In-charges, patrol vehicles and beat strengths; sectors/drivers/attachments; complete status/leave/task/movement labels.
- **PDF p.6 — Architecture diagram/components:** four layers, eight service areas; API entry point; availability engine feeds dashboard/warnings; AI only suggests.
- **PDF p.7 — Responsibilities/design principles/stack beginning:** responsibilities of roster, attendance, leave/movement, availability, reports/audit, scheduler, AI service; store vs calculate; versioning; traceability; code-level hard rules; frontend recommendation.
- **PDF p.8 — Tech stack and data model:** React/TypeScript, later Android, FastAPI, PostgreSQL, auth, background jobs, OR-Tools, approved LLM, PDF/Excel, private hosting, Git/CI/tests/Docker; initial table list.
- **PDF p.9 — Data tables and availability priority:** every data table's fields and proposed seven-state priority; every person has one current status while assignments remain separate; no free availability while on patrol/beat.
- **PDF p.10 — Login/session and start of duty workflow:** password/OTP, lockout/audit, role/session, dashboard, verified attendance, approval of leave/movement, roster allocate/validate/approve/publish, return/review/logout; allocation steps 1–3.
- **PDF p.11 — Allocation steps 4–9:** allocating, duplicate/time/rest/leave/commitment/vacancy/unconfirmed-availability checks, warnings, authorized exceptions, approval/publishing metadata, scheduled/confirmed attendance, monitoring, changes/emergencies.
- **PDF p.12 — Allocation steps 10–11 and lifecycle rules:** task/movement completion, reports, status update sequence, complete outside movement lifecycle, leave workflow and alerts.
- **PDF p.13 — Screen/module inventory:** all modules, 14 dashboard summary metrics, filters by designation/sector/section/shift/duty/status, workflow guide and later Android preview.
- **PDF p.14 — AI features/guardrails:** roster suggestions, smart warnings, natural-language queries, leave preview, overdue alerts, anomaly flags, forecast, report summaries; human decision and approved rules.
- **PDF p.15 — Remaining AI guardrails, security and build phases:** audit accept/override; hard checks after suggestions; AI read-only via authorized API; no unapproved external data transmission; RBAC, password/session, HTTPS/backups, append-only audit, authorized exceptions; stages 0–4.
- **PDF p.16 — Build plan continued and open decisions:** stages 5–6 and AI 1–3; convert demo arrays to API/backend validation/auth/audit; all eight SHO confirmation questions; test/rollout plan.
- **PDF p.17 — Testing and Stage A/B start:** unit/scenario/role test requirements; pilot/training/monthly review; Stage A steps 1–3 and Stage B migration start.
- **PDF p.18 — Stage B completion and Stage C:** editable config; auth/session; API scoping; audit; staff register; React role menus; roster versioning; staffing counts; all validation rules and override audits.
- **PDF p.19 — Stage C close, Stage D, Stage E start:** approval/publish and draft visibility; attendance, tasks, movement, leave, attachments, approvals/scheduler; availability engine and 14 cards.
- **PDF p.20 — Stage E/F and AI start:** shift/rest/upcoming views and filters; PDF/Excel reports; Android/mobile view; tests/security/backup/restore/pilot/training; AI roster suggestions and assistant/preview/summary stage.
- **PDF p.21 — Stage G close:** anomaly flags and shortage forecast after months of data; confirm that AI is gated until core stages are live and data clean.

---

## 20. PowerPoint slide-by-slide coverage checklist (7 slides)

Use every slide as a summary/visual reference and cross-check it against the PDF's deeper requirements.

- **Slide 1 — Title:** Panjagutta Police Station AI Duty Management Application; architecture, hierarchy, tech stack and end-to-end workflow. Carry the station-specific context and professional title/navigation into the product.
- **Slide 2 — What the application solves:** memory-based allocation → pre-save conflict warnings; present ≠ available; recorded movements/overdue highlighting; check required vs allocated strength before shift; versioned rosters/full audit log. These must be evident in working workflows, not only a marketing page.
- **Slide 3 — Station hierarchy and roles:** SHO, DI, Admin SI, Sector SIs 1–5, DSI; register designations ASI/HC/PC/ARPC/HGS/SPO; sector staff/writers; reception/court/patrol; drivers/attached personnel. Reflect in navigation and role scope.
- **Slide 4 — Architecture:** React web, later Android staff attendance/requests, FastAPI API layer for login/session/RBAC/validation/sector scope, services for staff/config, roster/allocation, attendance/tasks, leave/movements, availability, reports/audit, scheduler and later AI, with PostgreSQL storage. Use a comparable separation of concerns in code and optionally an in-app architecture/health page for demo.
- **Slide 5 — End-to-end workflow:** login → role/session → dashboard → attendance/verification → leave/movement requests/approval/record → roster allocation/validation/approval/publication → return/review → logout with token revoked and event logged. Test the sequence.
- **Slide 6 — Tech stack and AI:** React/TypeScript, later Android, FastAPI, PostgreSQL, RBAC/tokens/optional OTP, Celery or APScheduler, on-prem/private cloud; OR-Tools suggestions, smart warnings, natural-language questions, leave preview, overdue alerts, anomaly flags/forecast; AI proposes only, approved rules, reason shown, acceptance/override logged.
- **Slide 7 — Seven stages:** A Prepare, B Foundation, C Roster, D Operations, E Dashboards, F Release, G AI; Stage C gated on SHO-signed rotation/rest rules; confirm rotation, minimum rest/36-hour duty-off question, approvers, exceptions and full SOP section 10 roles. Use this phase order in documentation and do not activate AI ahead of the stable core.

---

## 21. Developer experience, documentation and delivery package

Deliver a repository that a developer can actually run and maintain. Include, as applicable:

- `README.md` with architecture, prerequisites, exact setup, database initialization/migrations, seeding/reset, start commands, tests, build commands, Docker commands, demo accounts, known gaps and policy/security warnings.
- `.env.example` with placeholders only.
- `.gitignore` that excludes secrets, local databases, generated files and virtual environments.
- Backend source grouped into API routes, schemas, domain/service logic, models/repositories, auth/RBAC, scheduler, reporting and tests.
- Frontend source grouped into pages, reusable components, API client, auth/role guard, form validation, tables, filters and types.
- Database migrations and deterministic demo seeds.
- Automated unit/integration tests and, where possible, end-to-end tests.
- Generated API/OpenAPI docs available through FastAPI in development.
- `docs/requirements-traceability.md` mapping PDF pages/slides to implementation files and tests.
- `docs/policy-confirmation.md` listing every open SHO/department decision and whether it is confirmed, demo-simulated or blocked.
- `docs/security-and-deployment.md` with secure deployment checklist, backup/restore and no-external-AI-by-default notes.
- `docs/user-guide.md` for SHO/Admin SI/Sector SI/staff workflows.
- A concise final build report listing what works, what was tested, commands/results, gaps, and what needs real department confirmation.

If a feature cannot be completed in this iteration, do not make a dead button or pretend it works. Implement the core path first, show a clear `Not configured`/`Later phase` state, and list the limitation in the final report.

---

## 22. Execution instructions — work in this order

1. Inspect the attached PDF and PowerPoint completely. Create a brief internal/source traceability checklist before implementation.
2. Inspect the available repository/environment and choose the simplest stack consistent with the spec. Keep the frontend/backend/database split described above.
3. Create the database schema, migrations, configuration seed, fabricated demo data and environment setup.
4. Build authentication, role checks, sector scoping and audit trail before sensitive operational modules.
5. Build staff/configuration, then the deterministic availability engine and its tests.
6. Build roster draft/versioning, allocation/validation and approval/publish gate. Do not invent confirmed rotation/rest rules.
7. Build attendance, tasks, leave, movement and attachments; connect all to the availability engine and audit history.
8. Build the dashboard, filters, approvals/alerts, scheduler and reports on real backend data.
9. Add a clearly marked responsive staff/Android preview; then add only AI scaffolding/features supported safely by the configured data and policy.
10. Run database migrations, seed, lint/type checks, tests and production build. Fix errors you discover instead of simply listing them.
11. Exercise a complete demo scenario from login through roster publication (using only explicit demo-policy mode), attendance, leave approval that creates a vacancy, overdue movement alert, report export and logout. Verify role boundaries with a Sector SI and staff account.
12. Compare the finished product against Sections 19 and 20 above. Update the traceability matrix with real file/test evidence and honestly identify anything blocked or deferred.
13. Respond with the runnable project, concise architecture summary, setup commands, demo credentials, test results, known limitations and required station policy confirmations. Do not return only a plan or a set of isolated snippets.

### Final quality bar

The best result is a clean, professional, reliable **working prototype** that faithfully follows the supplied documents, has sensible seeded demo data, real persistence, complete core workflows, visible and tested policy gates, server-side permission enforcement, explainable deterministic business rules, auditability, and clear run/test instructions. Correctness, traceability and human authorization matter more than adding flashy AI features.
