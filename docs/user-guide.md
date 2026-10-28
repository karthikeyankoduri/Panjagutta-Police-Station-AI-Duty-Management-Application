# User Guide — Panjagutta Police Station Duty Management

This guide provides operational workflows and step-by-step instructions for station officers according to their assigned roles.

---

## 1. Demo User Accounts & Passwords

The system comes pre-seeded with deterministic demo accounts representing all station roles:

| Role | Username | Password | Operational Scope |
|:---|:---|:---|:---|
| **SHO** (Station House Officer) | `sho_demo` | `Demo@SHO#2024` | Complete station authority; approves rosters; policy gate sign-off. |
| **DI** (Detective Inspector / Crime) | `di_demo` | `Demo@DI#2024` | Crime wing oversight; movement authorizations; task assignments. |
| **Admin SI** (General Administration) | `admin_si_demo` | `Demo@AdminSI#2024` | Drafts rosters; manages staff register; reconciles daily roll-call. |
| **Sector 1 SI** (Field Sector In-Charge) | `sector1_si_demo` | `Demo@Sector1#2024` | Sector 1 personnel; Blue Colts beats; patrol mobiles. |
| **Sector 2 SI** (Field Sector In-Charge) | `sector2_si_demo` | `Demo@Sector2#2024` | Sector 2 personnel; commercial beat monitoring. |
| **Duty SI** (General Station Duty) | `dsi_demo` | `Demo@DSI#2024` | Roll-call logging; sentry changes; GD entry oversight. |
| **Staff Officer** (Beat Constable) | `staff_demo` | `Demo@Staff#2024` | Personal duty schedule; apply for leave; log movement return. |

---

## 2. Key Officer Workflows

### A. Station House Officer (SHO) Daily Workflow
1. **Morning Briefing & KPI Review:**
   - Log in as `sho_demo`.
   - Open **Dashboard**: Review the 14 summary cards (Active Strength, Patrol Coverage, Vacancies).
2. **Review & Sign-Off Station Policy:**
   - Navigate to **Policy Config**.
   - Review shift rotation intervals (A &rarr; B &rarr; C) and rest hours.
   - Click **"Officially Confirm Policy (SHO)"** to unlock the production publication gate.
3. **Approve Shift Rosters:**
   - Navigate to **Approvals & Alerts** or **Shift Roster**.
   - Inspect submitted draft roster for tomorrow.
   - Use the **"AI Explain"** advisory button to review coverage rationale.
   - Click **"Approve (SHO)"**, then click **"Publish Roster"**.
4. **Monitor Triage & Overdues:**
   - In the **Outside Movements** tab, check for any overdue alerts highlighted in red.
   - Review pending Earned/Medical Leave applications and click **Approve** or **Reject**.

---

### B. Admin SI (Administration & Roster Drafting)
1. **Staff Profile Management:**
   - Open **Staff Register**.
   - Click **"+ Add Staff Member"** to onboard newly transferred constables, recording service number, designation, category, and sector.
2. **Drafting a Shift Roster:**
   - Navigate to **Shift Roster**.
   - Click **"+ Create Roster Draft"**, selecting the date and shift (A, B, or C).
3. **Duty Allocation Workspace:**
   - Open **Duty Allocation**.
   - Select duty points (Station Writer, Sentry, Blue Colts, Sector Patrols).
   - Check the staff availability badge (prevents assigning personnel on approved leave or outside movements).
   - Allocate personnel and click **"Save Allocation Draft"**.
4. **Submit for Approval:**
   - Return to **Shift Roster** and click **"Submit"** to send the draft to the SHO.

---

### C. Sector SI (Sector Beat & Patrol Management)
1. **Sector Scoped Visibility:**
   - Log in as `sector1_si_demo`.
   - The Dashboard automatically filters metrics and staff lists to **Sector 1** personnel only.
2. **Assigning Sector Tasks & Bandobast:**
   - Navigate to **Tasks**.
   - Click **"+ Assign New Task"** to assign summon services or patrol checkpoints to beat constables.
   - Track completion deadlines and overdue flags.

---

### D. Station Writer / General Duty Staff (Roll-Call & Movements)
1. **Daily Roll-Call Verification:**
   - Open **Attendance**.
   - Filter by current date and shift.
   - Inspect scheduled officers vs physical headcount.
   - Click **"✓ Present"** or **"✗ Absent"** for each officer, or use **"✓ Bulk Confirm Scheduled Present"**.
2. **Logging Outside Movements:**
   - Open **Outside Movements**.
   - When an officer departs for court or crime investigation, click **"+ Log Out Movement"**.
   - Enter destination and expected return time.
   - When the officer returns, click **"Mark Returned"** and record close notes.
3. **Generating Shift-End Handover Report:**
   - Open **Reports**.
   - Select **Shift-End Handover Report** for the completed shift.
   - Click **"⬇ Export to CSV"** or **"🖨 Print Report"** for physical station GD filing.
