# Station Policy & Open Decisions Confirmation — Panjagutta Police Station

This document tracks all policy decisions, statutory guidelines (Telangana Police Standing Orders), and parameters that require formal human authorization from the Station House Officer (SHO) or Hyderabad City Police Commissionerate.

---

## 1. Executive Summary & Section 1 Policy Gate

The Panjagutta Duty Management System strictly implements the **Section 1 Policy Gate**:
Operational rosters **cannot** be published for field duty deployment without formal SHO sign-off, or explicit acknowledgement of **Demo Simulation Mode**.

| Policy Parameter | Standard Prototype Default | Operational SOP Status | Required Action / Confirmation |
|:---|:---|:---:|:---|
| **Shift Timing Configuration** | Shift A: 07:00–15:00<br>Shift B: 15:00–23:00<br>Shift C: 23:00–07:00 | **Simulated / Configurable** | Confirmed 3x 8-hour continuous cycle. Editable by Admin SI in `shift_config`. |
| **Shift Rotation Sequence** | A &rarr; B &rarr; C (Morning to Evening to Night) | **Provisional** | Standard Telangana Police rotational sequence. |
| **Minimum Rest Between Shifts** | 16 hours continuous rest | **Provisional (16 hrs)** | Requires SHO confirmation on whether 16h or 24h rest is mandated before Shift C. |
| **Weekly Duty-Off / Rest Day** | Mandatory 24 hours rest after completing Shift B cycle | **Provisional (24 hrs)** | Standing order guidelines suggest 24h weekly rest; subject to station emergency deployment. |
| **Minimum Sector Staffing** | 12 personnel per sector (5 sectors = 60 sector strength) | **Simulated Target** | Target benchmark. System warns of deficit if sector active count < 12. |
| **Exception Override Role** | SHO or Admin SI | **Provisional** | Who is authorized to override minimum rest hours during VVIP bandobast or law & order exigency. |
| **Leave Approval Authority** | SHO (all leaves) / Admin SI (Casual Leave up to 2 days) | **Provisional** | Casual Leave approval authority delegation. |

---

## 2. Policy Gate Modes & UI Indicators

The application supports three distinct operational policy states:

### 1. `unconfirmed` (Default Initial State)
- **Gate Behavior:** Roster publication is **blocked**.
- **UI Warning:** Prominent yellow warning banner on the Station Dashboard and Policy screen:
  > *"🔒 Policy Unconfirmed: Operational duty rosters cannot be published without formal SHO authorization or explicit demo mode acknowledgement."*
- **Allowed Actions:** Admins can draft and simulate allocations, but cannot publish to station staff.

### 2. `demo_simulated` (Prototype Evaluation Mode)
- **Gate Behavior:** Roster drafting, approval, and publication are permitted for demonstration and testing purposes.
- **UI Warning:** High-contrast `DEMO MODE` badge displayed in the navigation header and on every roster view.
- **Acknowledgement:** Recorded in `rotation_rules` with timestamp and user snapshot.

### 3. `confirmed` (Formal Production Deployment)
- **Gate Behavior:** Formal operational status. Roster publication fully enabled.
- **Authorization:** Only the `SHO` user role can transition policy to `confirmed`.
- **Audit:** Immutable entry logged in `audit_log` with SHO digital signature snapshot, IP, and timestamp.

---

## 3. Checklist for Departmental Handover

Before transitioning this prototype to live operational deployment at Panjagutta Police Station:

- [ ] Station House Officer (SHO) reviews and signs off on `docs/policy-confirmation.md`.
- [ ] Sector SIs confirm sector boundaries and key static duty points (Nagarjuna Circle, Punjagutta Circle, Somajiguda).
- [ ] Admin SI validates service numbers against the official station muster roll.
- [ ] Backup power and local server network redundancy verified for 24/7 continuous uptime.
- [ ] Biometric attendance hardware integration specs finalized for automated roll-call reconciliation.
