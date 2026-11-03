# Panjagutta Police Station AI Duty Management Application
## Comprehensive Operational Manual & End-to-End Role Testing Guide

> **Station Classification:** Law & Order Police Station — Hyderabad City Police  
> **Jurisdiction:** Central Zone, Hyderabad (Sectors 1 to 5)  
> **System Scope:** SOP Section 8 Duty Allocation & Section 3.2 Role Matrix Compliance  
> **Live Web Application:** `http://localhost:3000` (Local) | `http://172.16.173.205:3000` (LAN)  
> **Interactive Swagger API:** `http://localhost:8000/api/docs`

---

## Table of Contents

1. [System Overview & Architecture](#1-system-overview--architecture)
2. [Cold-Start & Data Bootstrap Guide (Post-Wipe Setup)](#2-cold-start--data-bootstrap-guide-post-wipe-setup)
3. [Master Credentials & Role Matrix Reference Table](#3-master-credentials--role-matrix-reference-table)
4. [The Operational Narrative: "A Day in the Life at Panjagutta PS"](#4-the-operational-narrative-a-day-in-the-life-at-panjagutta-ps)
5. [Step-by-Step Manual Testing Walkthrough by Role](#5-step-by-step-manual-testing-walkthrough-by-role)
   - [Phase 1: Super Admin / Admin SI — Bootstrapping & CSV Staff Onboarding](#phase-1-super-admin--admin-si--bootstrapping--csv-staff-onboarding)
   - [Phase 2: Station House Officer (SHO) — Policy Gate Sign-Off & Shift Timings](#phase-2-station-house-officer-sho--policy-gate-sign-off--shift-timings)
   - [Phase 3: Admin SI — Morning Roll-Call & Duty Allocation Workspace](#phase-3-admin-si--morning-roll-call--duty-allocation-workspace)
   - [Phase 4: SHO & Admin SI — Human-in-the-Loop Approval & Publication](#phase-4-sho--admin-si--human-in-the-loop-approval--publication)
   - [Phase 5: Station Staff (Constable) — Self-Service Schedule & Outside Movement](#phase-5-station-staff-constable--self-service-schedule--outside-movement)
   - [Phase 6: Sector Sub-Inspector (Sector SI) — Field Beat & Patrol Scoping](#phase-6-sector-sub-inspector-sector-si--field-beat--patrol-scoping)
   - [Phase 7: Detective Inspector (DI) — Investigation Tasks & Movement Authorization](#phase-7-detective-inspector-di--investigation-tasks--movement-authorization)
   - [Phase 8: Emergency Leave Vacancy & Automatic Replacement Alert](#phase-8-emergency-leave-vacancy--automatic-replacement-alert)
   - [Phase 9: Shift-End Handover Report & Station Audit Log](#phase-9-shift-end-handover-report--station-audit-log)
6. [RBAC Security & Negative Access Control Verification](#6-rbac-security--negative-access-control-verification)
7. [Troubleshooting & Station Administrator FAQs](#7-troubleshooting--station-administrator-faqs)

---

## 1. System Overview & Architecture

The Panjagutta Duty Management System digitizes and enforces the **Telangana Police Standing Orders (SOP Section 8)** for 140+ station personnel across three 8-hour continuous deployment cycles:

- **Shift A (Morning):** `08:00 – 14:00` (6 h)
- **Shift B (Evening):** `14:00 – 20:00` (6 h)
- **Shift C (Night):** `20:00 – 08:00` next day (12 h, crosses midnight)

These are the Build Guide §4.1 values loaded at first start. They are editable on **Policy & Shifts** and every screen (dashboard, roster, attendance, reports, Android app) reads them from there.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Local Area Network (LAN)                        │
│                http://172.16.173.205:3000 (Next.js 16)                │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
              ┌────────────────────┴────────────────────┐
              ▼                                         ▼
   ┌──────────────────────┐                  ┌──────────────────────┐
   │ Administrative Roles │                  │  Self-Service Roles  │
   │  SHO, Admin SI, DI,  │                  │   Beat Constables,   │
   │    Sector SIs 1-5    │                  │  WPCs, ARPCs, HGS    │
   └──────────┬───────────┘                  └──────────┬───────────┘
              │                                         │
              └────────────────────┬────────────────────┘
                                   │ JWT Bearer Auth (/api/auth/login)
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│               FastAPI Production Backend (Port 8000)                  │
│   • RBAC Dependencies    • SOP Validation Engine   • Scheduler Service │
│   • Availability Engine  • Exception Overrides     • Audit Logger      │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ AsyncPG Engine
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│           PostgreSQL 15 Relational Database (panjagutta_db)           │
│   • duty_master          • shift_config            • rosters           │
│   • roster_assignments   • staff & users           • attendance        │
│   • movements            • leave_requests          • alerts & audit    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Cold-Start & Data Bootstrap Guide (Post-Wipe Setup)

When the database is freshly initialized or wiped, the application requires essential master tables (Sectors, Shifts, Sanctioned Duty Points, and Admin Credentials) before operations can begin.

You can initialize the system using **either** of the two methods below:

### Method A: Automated One-Line Seed (Recommended for Immediate Testing)

Open PowerShell on the host machine and run:
```powershell
docker exec -it panjagutta_backend python -m app.db.seed --reset
```
This single command automatically:
1. Re-creates all relational schema tables.
2. Seeds **5 Geographic Sectors** (`Sector 1` to `Sector 5`).
3. Provisions the **3 Standard Shifts** (A, B, C) in `shift_config`.
4. Populates all **18 Sanctioned Station Duty Points** (General Diary, Lockup Sentry, Blue Colts beats, Mobile Patrols, Courts, Station Reserve) in `duty_master`.
5. Establishes the default **SHO Rotation Rule** (`A -> B -> C`, minimum 16h rest).
6. Creates standard demo officer accounts with verified credentials.

### Method B: Clean Manual Bootstrap via CSV Staff Import

If you want to test from absolute zero without pre-made officers:
1. Ensure the database tables are created:
   ```powershell
   docker exec -it panjagutta_backend python -m app.db.seed
   ```
2. Open your browser and navigate to `http://localhost:3000/login` (or LAN IP `http://172.16.173.205:3000/login`).
3. Log in with the primary administrator account:
   - **Username:** `admin_si_demo`
   - **Password:** `Demo@AdminSI#2024!`
4. Go to **Staff Register** (`/staff`) &rarr; click **CSV Import**.
5. Upload your station personnel roster CSV (matching columns: `service_number,name,designation,category,sector_id,contact_phone`).
6. All personnel are instantly registered, linked to login accounts, and assigned the provisioning password (`Password@PJ2024!`). Each officer must choose a new password at first sign-in (web or Android).

---

## 3. Master Credentials & Role Matrix Reference Table

The system enforces strict **Role-Based Access Control (RBAC)** according to Section 3.2 of the Build Guide:

| Role Code | Operational Title | Primary Persona | Default Login ID | Default Password | Granted Privileges & Scopes |
|:---|:---|:---|:---|:---|:---|
| **SUPER_ADMIN** | System Administrator | IT In-Charge | `pg_004` *(or `admin`)* | `Password@PJ2024!`  | Full administrative power; staff CRUD; system role reassignments; audit log inspection. |
| **SHO** | Station House Officer | Inspector R. Sharma | `pg_001` *(or `sho_demo`)* | `Password@PJ2024!` *(or `Demo@SHO#2024!`)* | Station Head; formal Roster Approval (`submitted` &rarr; `approved`); Policy Gate Confirmation; Roster Publication; Supervisory Reports. |
| **ADMIN_SI** | Admin Sub-Inspector | SI Venkatesh Reddy | `admin_si_demo` | `Demo@AdminSI#2024!` | Core operator; drafts rosters; duty point allocations; exception justification overrides; daily attendance; shift timing configuration. |
| **SECTOR_SI** | Sector Sub-Inspector | SI Priya Devi (Sector 1) | `sector1_si_demo` | `Demo@Sec1SI#2024!` | Scoped to designated sector; view sector beat deployments; inspect Sector Blue Colts/Patrols; assign sector tasks; self-service movements. |
| **DI / DSI** | Detective Inspector (Crime) | Inspector Crime | `pg_002` *(or `di_demo`)* | `Password@PJ2024!` *(or `Demo@DI#2024!`)* | Crime wing oversight; movement authorizations for crime scene/investigation; read-only roster views; task assignments. |
| **STAFF** | Beat Constable / WPC | PC Rajesh Babu | `pg_005` *(or `staff_demo`)* | `Password@PJ2024!` *(or `Demo@Staff#2024!`)* | Self-service only; personal roster view; outside movement requests (`pending_authorization`); leave requests. Administrative tools hidden. |

---

## 4. The Operational Narrative: "A Day in the Life at Panjagutta PS"

To experience the system as real police officers do, follow this operational scenario:

> **Date:** *Today / Test Date*  
> **Shift:** *Shift A (Morning — 08:00 to 14:00)*  
> **Station Atmosphere:** Panjagutta is one of Hyderabad's busiest commercial and transit junctions covering Somajiguda, Raj Bhavan Road, Nagarjuna Circle, and Punjagutta flyover.
>
> - **06:30 AM (Turnover & Roll-Call):** Admin SI arrives at the station. Physical headcount is taken. Staff marked "Present" become eligible in the duty allocation pool.
> - **06:45 AM (Policy Gate):** The SHO reviews statutory rotation policies and confirms the Section 1 Policy Gate, unlocking operational roster publishing.
> - **07:30 AM (Duty Allocation & Conflict Override):** Admin SI opens the Duty Allocation Workspace. Beat points (Blue Colts, Lockup Sentry, Station Writer) are filled. A sudden VIP convoy requires drafting an officer with a rank constraint; Admin SI invokes an **Authorized Exception Override** with a mandatory justification note.
> - **07:15 AM (SHO Sign-Off):** SHO inspects allocations via the **Allocations Inspector**, reviews the AI Copilot advisory, and approves the roster. The roster is published to station digital notice boards.
> - **09:30 AM (Field Movement):** A beat constable is summoned by Nampally Court. The constable submits an Outside Movement request from their mobile; the supervisory officer authorizes departure and logs return.
> - **11:00 AM (Emergency Vacancy):** A lockup guard reports a medical emergency. Leave is approved, instantly triggering an urgent **Roster Vacancy Replacement Alert** to the Admin SI.
> - **14:00 (Shift Handover):** Admin SI generates the Shift-End Handover Report for the General Diary (GD). Supervisory reports remain blocked to unauthorized staff.

---

## 5. Step-by-Step Manual Testing Walkthrough by Role

Follow these 9 phases sequentially to test every single feature of the application from end to end.

---

### Phase 1: Super Admin / Admin SI — Bootstrapping & CSV Staff Onboarding

#### Goal:
Verify that personnel profiles can be registered, edited, and given appropriate system roles.

#### Steps:
1. Open browser: `http://localhost:3000/login` (or LAN IP).
2. Enter Credentials:
   - **Username:** `admin_si_demo` *(or `pg_004`)*
   - **Password:** `Demo@AdminSI#2024!` *(or `Password@PJ2024!`)*
3. Click **"Sign In"**. You are redirected to `/dashboard`.
4. From the left navigation sidebar, click **"Staff Register"** (`/staff`).
5. **Add a Single Staff Member:**
   - Click the **"+ Add Staff Member"** button.
   - Fill in:
     - **Service Number:** `PC-9999`
     - **Full Name:** `K. Vikram Goud`
     - **Designation:** `PC` (Police Constable)
     - **Category:** `SECTOR_STAFF`
     - **Sector:** `Sector 1`
     - **Phone:** `9876543210`
   - Click **"Save Staff Member"**.
   - **Verification:** Confirm `K. Vikram Goud` appears in the staff table with badge `Sector 1`.
6. **Edit System Role of an Employee:**
   - Locate any row in the table (e.g., `pg_005`).
   - Click **"Edit"** &rarr; change System Role dropdown from `STAFF` to `SECTOR_SI` (or vice-versa).
   - Click **"Save Changes"**.
   - **Verification:** Notice the alert displays a clean text message (no `[object Object]` error) and the updated role reflects in the table.

---

### Phase 2: Station House Officer (SHO) — Policy Gate Sign-Off & Shift Timings

#### Goal:
Verify that the statutory Section 1 Policy Gate works and that shift timings can be configured dynamically.

#### Steps:
1. Log out or open a private/incognito browser window.
2. Sign in as Station House Officer:
   - **Username:** `pg_001` *(or `sho_demo`)*
   - **Password:** `Password@PJ2024!` *(or `Demo@SHO#2024!`)*
3. Notice the top navigation bar displays the persona badge: `Station House Officer (SHO)`.
4. Click **"Policy Config"** (`/policy`) in the sidebar.
5. **Inspect Current Policy Gate Banner:**
   - If unconfirmed or in demo mode, the amber/yellow banner states: *"🔒 Policy Unconfirmed — Roster Publication Gate is Blocked"* or *"⚠ Demo Simulation Mode Active"*.
6. **Adjust Statutory Parameters:**
   - **Rotation Sequence:** Confirm `A->B->C`.
   - **Minimum Rest Hours:** Set to `16.0` hours.
   - **Duty-Off After Shift B:** Set to `24.0` hours.
   - **SHO Authorization Remarks:** Type *"Formally authorized by Station House Officer Ramesh Kumar Sharma"*.
   - Click **"✓ Officially Confirm Policy (SHO)"**.
   - **Verification:** Success banner appears: *"Station duty rotation policy formally confirmed by SHO. Policy Gate cleared."*
7. **Configure Station Shift Timings (PDF Page 4):**
   - On the right card **"Station Shift Timings"**, locate **Shift A**.
   - Click the **"Edit"** button in that row.
   - Adjust Start Time to `08:00` and End Time to `14:00` (the duration is calculated automatically).
   - Click **"Save"**.
   - **Verification:** Timings update to `08:00 – 14:00 (6 hrs)`, a success banner appears, and the change is recorded in the audit log.

---

### Phase 3: Admin SI — Morning Roll-Call & Duty Allocation Workspace

#### Goal:
Verify daily attendance headcount, dynamic Duty Master retrieval, and live duty allocation with authorized exception justification.

#### Steps:
1. Log in as **Admin SI**:
   - **Username:** `admin_si_demo`
   - **Password:** `Demo@AdminSI#2024!`
2. **Reconcile Daily Roll-Call Attendance:**
   - In the sidebar, click **"Daily Attendance"** (`/attendance`).
   - Select today's date and Shift `A`.
   - Notice the staff table. Click **"✓ Bulk Confirm Scheduled Present"** or click **"✓ Present"** next to individual officers.
   - **Verification:** Their status updates to `Present - Available`, making them eligible in the duty allocation pool.
3. **Open Duty Allocation Workspace:**
   - Click **"Duty Allocation"** (`/duty-allocation`) in the sidebar.
   - Select **Roster Date** (e.g. `2026-11-05` or today) and **Active Shift** `Shift A`.
4. **Initialize Draft Roster (if not yet started):**
   - If no draft exists for that date/shift, click **"+ Initialize Draft Roster"**.
   - **Verification:** Top status bar updates to: `Roster #ID (v1) | Status: draft`.
5. **Inspect Dynamic Sanctioned Duty Points:**
   - Notice the left table lists dynamic station duty points fetched from `duty_master`:
     - *Station Writer / General Diary* (Required: 1, Eligible: ASI, HC)
     - *Station Sentry & Lockup Guard* (Required: 2, Eligible: PC, HC, ARPC)
     - *Reception & Public Grievance Desk* (Required: 1, Eligible: WPC, WHC, PC)
     - *Sector 1 — Blue Colts Motorcycle Beat* (Required: 2)
     - *Sector 1 — Patrol Mobile Car* (Required: 2)
     - *Court Duty & Summons (Nampally Courts)* (Required: 2)
     - *Law & Order Emergency Reserve* (Required: 4)
6. **Standard Allocation (Normal Flow):**
   - Click on the row **"Station Writer / General Diary"**.
   - In the right-hand panel, open the **"Select Staff Officer"** dropdown.
   - Pick an eligible officer marked `Present - Available` (e.g. an ASI or HC).
   - Click **"+ Assign to Duty"**.
   - **Verification:** The officer's name appears with a blue badge under "Assigned Personnel".
7. **Exception Allocation (Authorized Override — SOP Section 8):**
   - Click on **"Sector 1 — Blue Colts Motorcycle Beat"**.
   - Select an officer who has a rank mismatch or emergency assignment.
   - Check the box: **"☑ Override as Authorized Exception (SOP Section 8)"**.
   - In the **"Exception Justification Reason"** text box, type:
     *"Authorized emergency deployment for VIP convoy security route coverage by Admin SI."*
   - Click **"+ Assign to Duty"**.
   - **Verification:** The officer badge displays an amber warning icon `⚠️ Exception: Authorized emergency deployment...`.
8. **Save Allocations to Database:**
   - Click the top button: **"💾 Save Allocation Draft"**.
   - **Verification:** Green notification displays: *"Allocations saved successfully for Roster #ID (v2)"*. Any rest-hour warnings appear in the rule validation banner.

---

### Phase 4: SHO & Admin SI — Human-in-the-Loop Approval & Publication

#### Goal:
Verify the human-in-the-loop approval gate: Draft submission, Allocation Inspection Drawer, AI explainability advisory, SHO approval, and publication.

#### Steps:
1. Still as **Admin SI** on `/duty-allocation` (or on `/roster`):
   - Click the **"📤 Submit for Approval"** button.
   - **Verification:** Roster status changes from `draft` to `submitted`.
2. **Switch to Station House Officer (SHO):**
   - Sign in as `pg_001` (Password: `Password@PJ2024!`).
   - Navigate to **"Duty Rosters"** (`/roster`).
3. **Inspect Allocations Drawer:**
   - In the table row for the submitted roster, click **"📋 Allocations"**.
   - **Verification:** A modal opens showing:
     - *Summary Cards:* Total Assigned vs Vacant Positions.
     - *Rule Warnings:* Cross-shift or rest-hour warnings (if any).
     - *Allocations Table:* Every duty point with assigned officer, service number, rank, sector, and exception justification note.
   - Click **"Close"**.
4. **Trigger AI Advisory (Copilot Explainability):**
   - On the same roster row, click **"🤖 AI Explain"**.
   - A modal appears analyzing rest-hours adherence, leave exclusions, and rotation fairness.
   - Review the explanation and click **"Close Advisory"**.
5. **Approve Roster (SHO Exclusive):**
   - Click the **"Approve (SHO)"** button on the row.
   - **Verification:** Status badge transitions to `approved` (light blue).
6. **Publish Roster (Release to Station Personnel):**
   - Click the **"Publish Roster"** button.
   - **Verification:** Status badge changes to `published` (emerald green). The roster is now official and visible to all beat officers.

---

### Phase 5: Station Staff (Constable) — Self-Service Schedule & Outside Movement

#### Goal:
Verify that general constables have a focused, self-service experience with administrative tools hidden, and can request outside movements.

#### Steps:
1. Log out and sign in as a Constable:
   - **Username:** `pg_005` *(or `staff_demo`)*
   - **Password:** `Password@PJ2024!` *(or `Demo@Staff#2024!`)*
2. **Verify Role Isolation in Navigation:**
   - Notice the sidebar: **Administrative items are hidden** (Staff Register, Policy Config, and System Audit do NOT appear).
3. **Review Personal Deployment:**
   - Open **"Duty Rosters"** (`/roster`).
   - Click **"📋 Allocations"** on the published roster to view today's station beats.
4. **Submit an Outside Movement Request:**
   - In the sidebar, click **"Outside Movements"** (`/movements`).
   - Click **"+ Log Out Movement"**.
   - Fill in:
     - **Purpose:** `Court summons service at Nampally Criminal Courts`
     - **Destination:** `Nampally Metropolitan Magistrate Courts`
     - **Expected Return:** Pick today's date and time `16:00`.
   - Click **"Submit Movement"**.
   - **Verification:** The record is created with status **`pending_authorization`**.
5. **Verify Scoping:**
   - Notice that the Constable can **only** see their own movement records in the table. Other officers' movements are filtered out.
6. **Supervisory Authorization:**
   - Sign in as Admin SI (`admin_si_demo`) or DI (`pg_002`).
   - Go to `/movements` &rarr; locate the pending request &rarr; click **"Authorize Departure"**.
   - Status updates to `dispatched`.
   - When the constable returns, click **"Mark Returned"**. Status becomes `completed`.

---

### Phase 6: Sector Sub-Inspector (Sector SI) — Field Beat & Patrol Scoping

#### Goal:
Verify that Sector SIs can manage and monitor their assigned geographic sector beats and patrols.

#### Steps:
1. Sign in as **Sector 1 SI**:
   - **Username:** `sector1_si_demo`
   - **Password:** `Demo@Sec1SI#2024!`
2. **Dashboard Sector Filtering:**
   - Go to **"Dashboard"** (`/dashboard`).
   - Notice the badge says `Sector 1 Scoped`. The summary numbers (Present, On Duty, Patrol Beat) represent only Sector 1 personnel.
3. **Sector Beat Monitoring in Duty Allocation:**
   - Navigate to **"Duty Allocation"** (`/duty-allocation`).
   - In the **Sector Filter** dropdown, select **"Sector 1"**.
   - **Verification:** The table immediately filters to show only Sector 1 beats:
     - *Sector 1 — Blue Colts Motorcycle Beat*
     - *Sector 1 — Patrol Mobile Car*
4. **Assign a Sector Task:**
   - Click **"Task Management"** (`/tasks`).
   - Click **"+ Assign New Task"**.
   - Enter:
     - **Assignee:** Select a Sector 1 Constable.
     - **Description:** *"Evening vehicle checking checkpoint at Nagarjuna Circle"*.
     - **Expected Completion:** Today `20:00`.
   - Click **"Create Task"**.

---

### Phase 7: Detective Inspector (DI) — Investigation Tasks & Movement Authorization

#### Goal:
Verify that Crime Wing inspectors can dispatch investigation tasks, authorize crime movements, and inspect duty deployments.

#### Steps:
1. Sign in as **Detective Inspector (DI)**:
   - **Username:** `pg_002` *(or `di_demo`)*
   - **Password:** `Password@PJ2024!` *(or `Demo@DI#2024!`)*
2. **Authorize Crime Investigation Movement:**
   - Click **"Outside Movements"** (`/movements`).
   - Click **"+ Log Out Movement"**.
   - Enter:
     - **Staff Member:** Select a crime constable or head constable.
     - **Purpose:** `Crime scene inspection / FSL sample delivery`
     - **Destination:** `FSL Red Hills / Nampally`
   - Click **"Submit"**.
   - Because a DI has supervisory authority, the movement is directly marked `dispatched`.
3. **Roster Read-Only Verification:**
   - Click **"Duty Rosters"** (`/roster`).
   - Click **"📋 Allocations"** on any roster. DI can view all assignments and exceptions across the station, but cannot approve rosters (that privilege is reserved exclusively for the SHO).

---

### Phase 8: Emergency Leave Vacancy & Automatic Replacement Alert

#### Goal:
Verify SOP Step 11: When an officer assigned to an active roster is granted leave, the system automatically detects the conflict and raises an immediate replacement alert for the Admin SI.

#### Steps:
1. Sign in as **Constable** (`pg_005`):
   - Go to **"Leave Requests"** (`/leave`).
   - Click **"+ Apply for Leave"**.
   - Select Leave Type: `Casual Leave`.
   - Dates: Set to the exact date of the active published roster (e.g. `2026-11-05`).
   - Reason: *"Acute food poisoning / emergency hospitalization"*.
   - Click **"Submit Leave Request"**.
2. **Approve Leave as Station House Officer (SHO):**
   - Log in as SHO (`pg_001`).
   - Open `/leave` &rarr; locate the pending leave request from `pg_005`.
   - Click **"Approve"**.
   - **Verification:** Leave status changes to `approved`.
3. **Verify Automatic Alert Dispatch to Admin SI:**
   - Log in as Admin SI (`admin_si_demo`).
   - Look at the top alert banners or navigate to **"Approvals & Alerts"** (`/approvals`).
   - **Verification:** An urgent alert is present:
     > `⚠️ ROSTER_VACANCY_REPLACEMENT_NEEDED: Approved leave created a vacancy in Roster #ID (Date, Shift A) for duty '...'. Immediate replacement allocation required.`
4. **Resolve the Vacancy:**
   - Admin SI opens `/duty-allocation` for that date and shift.
   - The duty slot reflects `Deficit` (e.g. 1/2 filled).
   - Admin SI allocates an available station reserve officer to fill the spot, clicks **"Save Allocation Draft"**, and resolves the vacancy.

---

### Phase 9: Shift-End Handover Report & Station Audit Log

#### Goal:
Verify that the shift conclusion generates the mandatory General Diary (GD) handover report and logs all actions immutably.

#### Steps:
1. Sign in as **Admin SI** (`admin_si_demo`):
   - Navigate to **"Reports"** (`/reports`).
   - Select report date and shift (`Shift A`).
   - Review the generated **Shift-End Handover Report**:
     - *Roll-Call Strength:* Total present, absent, on duty, on leave, attached.
     - *Sector Patrol Coverage:* Blue Colts deployments and patrol mobile mileage.
     - *Duty Point Fulfillment:* Status of sentries, reception desk, lockup guards.
     - *Outside Movement Log:* Personnel dispatched and overdue items.
   - Click **"⬇ Export CSV"** or **"🖨 Print Report"** for physical station GD register filing.
2. **Inspect the Immutable Audit Trail:**
   - In the sidebar, click **"Audit Log"** (`/audit`).
   - Inspect the chronological trail of events:
     - `ROSTER_ASSIGNMENTS_UPDATED` (with version number and actor `admin_si_demo`)
     - `ROSTER_APPROVED` (actor `pg_001` / SHO)
     - `ROSTER_PUBLISHED`
     - `LEAVE_APPROVED`
     - `MOVEMENT_CREATED`
   - Notice each entry records the exact UTC timestamp, actor username, IP address, and changed JSON values.

---

## 6. RBAC Security & Negative Access Control Verification

To guarantee compliance with police security protocols, perform these negative tests to verify that permissions cannot be breached:

| Test Scenario | Acting Persona | Target Action / URL | Expected System Behavior | Compliance Verification |
|:---|:---|:---|:---|:---|
| **Confidential Reports Access** | Constable (`pg_005` / `staff_demo`) | Directly navigate to `http://localhost:3000/reports` or call `GET /api/reports/shift-end` | **HTTP 403 Forbidden** — The backend rejects the request with *"Access forbidden: insufficient role privileges"*. The frontend navigation hides the Reports menu entirely. | **[PASS]** |
| **Unauthorized Roster Approval** | Admin SI (`admin_si_demo`) or DI (`pg_002`) | Attempt to trigger `POST /api/rosters/{id}/approve` | **HTTP 403 Forbidden** — Only `SHO` role is authorized to execute formal approvals. | **[PASS]** |
| **Tampering with Other Officers' Movements** | Constable (`pg_005`) | Attempt to call `POST /api/movements/` with another officer's `staff_id` | **HTTP 403 Forbidden** — Staff is restricted to submitting their own movements (`target_staff_id == current_user.staff_id`). | **[PASS]** |
| **Movement Scoping Leakage** | Constable (`pg_005`) | Call `GET /api/movements/` | Backend returns **only** records where `staff_id == 762`. Other officers' movements are not returned. | **[PASS]** |
| **Unconfirmed Policy Publication Gate** | Admin SI or SHO | Attempt to publish a roster while Policy Gate is `unconfirmed` | **HTTP 403 Forbidden** — Roster publishing is strictly gated until SHO confirms policy or activates explicit Demo Simulation mode. | **[PASS]** |

---

## 7. Troubleshooting & Station Administrator FAQs

### Q1: How do I access the application from other police station computers or tablets on the LAN?
- **Answer:** Ensure the client device is connected to the same Wi-Fi or station ethernet switch.
- Open Chrome or Edge on the device and navigate to:
  ```
  http://172.16.173.205:3000
  ```
- If the page does not load, run the following command in PowerShell on the host machine to permit incoming connections:
  ```powershell
  New-NetFirewallRule -DisplayName "Panjagutta App" -Direction Inbound -LocalPort 3000,8000 -Protocol TCP -Action Allow
  ```

### Q2: I wiped the database and cannot log in with any account. What should I do?
- **Answer:** Run the fast seed command inside the backend container:
  ```powershell
  docker exec -it panjagutta_backend python -m app.db.seed --reset
  ```
  This immediately repopulates all master sectors, duty points, rotation rules, and standard accounts (`pg_001`, `admin_si_demo`, `pg_005`).

### Q3: How do I change an officer's shift timing or rest interval permanently?
- **Answer:** Log in as **SHO** (`pg_001`), navigate to **Policy Config** (`/policy`), adjust the start/end times in the Station Shift Timings table, and click **Save**. The changes take effect immediately for all subsequent roster allocations.

### Q4: An officer is marked as "Absent" on the dashboard even after uploading CSV staff. Why?
- **Answer:** When personnel are first imported, they are not yet recorded for today's physical headcount. Go to **Daily Attendance** (`/attendance`), filter by today's date and Shift A, and click **"✓ Bulk Confirm Scheduled Present"**. The dashboard status will immediately reflect **Present - Available**.

---

*Document Version:* `2.0.0-PROD-SOP8`  
*Maintained by:* Panjagutta Police Station IT & Duty Automation Cell  
*Approved by:* Station House Officer, Panjagutta PS, Hyderabad City Police

---

## 8. What changed in version 0.2 (remediation of the Build Guide review)

| Area | What you will notice |
|:--|:--|
| Sign-in | First sign-in with a provisioning or reset password opens **Set your password**. Five wrong passwords lock the account for 15 minutes. You are warned a minute before being signed out for inactivity. |
| Notifications | The 🔔 bell (web) and the bell on the Android header show published duties, decisions on your requests, new tasks and alerts for officers. |
| Dashboard | Clicking a card lists exactly the staff counted in it. Filters for designation, sector, section, duty category and status. **Shift Views**: current shift deployment, upcoming shift, people on rest, vacancy & shortage per duty. The Vacant Positions card opens the vacancy view. |
| Duty allocation | Rules are checked while you allocate (duplicates, overlapping shifts, rest, approved leave, attachments, open movements, open tasks, unconfirmed attendance, vacancies). Violations block saving unless recorded as an **authorized exception** with a reason and a different authorizing officer. Unsaved work is kept even if you sign out. |
| Roster | Week and month calendars, **Versions** history, **Revise (new version)** for approved or published rosters, SHO **Return** with comments. Publishing notifies assigned staff and supersedes the previous version. |
| Leave | Cancel, overlap check, generated reference numbers, approver and remarks shown, roster-impact preview before approval, rest and duty-off panel. |
| Movements | Reject (with reason) and cancel; the authorizing officer and departure time are shown. |
| Tasks | Reporting officer, **Current task per person** view; staff update only their own tasks. |
| Attendance | Staff submit their own attendance on the web; **Scheduled vs Confirmed** tab with Verify. |
| Approvals & Alerts | One inbox for rosters, leave, movements, attendance verification and alerts, with actions and **Resolve**. |
| Reports | Shift-end, Daily, Vacancy and Workload reports; download as PDF, Excel or CSV. |
| Configuration | New page for duty requirements, sectors, sections and status/leave-type lists. |
| Workflow Guide | New in-app page summarising the four main workflows. |

## 9. Android app guide (staff)

1. **Install** the APK provided by the Admin SI. The app connects to the station server over HTTPS.
2. **Sign in** with your station ID and temporary password, then set your own password (at least 10 characters, letters and numbers).
3. **Home** shows today's duty with a *Submit attendance* button, upcoming shifts, your open tasks (*Start* / *Mark completed*) and your latest leave request.
4. **Calendar** shows your duty diary by month; tap a date for the shift, duty, task and attendance record.
5. **Roster** lists your published shifts.
6. **Attendance** shows today's duty and your last 30 days (verified, awaiting verification, not submitted).
7. **Requests**: switch between *Leave / rest* and *Outside movement*. Pending requests can be cancelled. For an open movement, tap *I have returned* when back.
8. **Bell**: notifications about published duties and decisions. Allow notifications when Android asks so you are alerted while the app is open.
9. **Profile** (tap your initial): your details, *Change password* and *Sign out*. The app signs you out after a period of inactivity.
