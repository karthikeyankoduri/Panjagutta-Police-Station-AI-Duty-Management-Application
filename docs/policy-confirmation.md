# SHO Rules Sheet — Items to Confirm Before Operational Use

**Purpose:** Build Guide §14 and blueprint step 1 require the SHO's answers to every open rule before rosters are used operationally ("A signed rules sheet exists"). The system currently runs on the **provisional** values below. Once this sheet is signed, the SHO enters the confirmed values on **Policy & Shifts → SHO Rotation Policy Sign-Off**; the system records the confirmation, the SHO's account and the time in the audit log, and the policy banner changes to *Confirmed*.

Until then the policy gate blocks roster drafting unless **Demo Simulation Mode** is enabled. Demo mode is for evaluation only; rosters made under it are marked *Demo*.

---

## 1. Decisions required (Build Guide §14)

| # | Question | Provisional value in the system | Where it is used | SHO decision |
|:-:|:--|:--|:--|:--|
| 1 | Exact rotation sequence between Shifts A, B and C | A → B → C | Shown on the policy screen; rest checks | |
| 2 | Minimum rest after each shift; is ~36 h duty-off after Shift B a fixed rule? | 16 h rest after any shift; 24 h duty-off after Shift B (guide suggests ~36 h) | Allocation rest check (blocking), Duty Off / Rest status, rest view | |
| 3 | Mandatory rest periods, permitted exceptions, and who may authorize them | Exceptions allowed with reason; authorized by SHO or Admin SI (never the allocating officer) | Exception override in duty allocation; audit entry per exception | |
| 4 | Who approves which leave types and movements | Leave: SHO and Admin SI (all types). Movement: SHO, Admin SI, own Sector SI | Leave and movement routing and approval rights | |
| 5 | Status priority order (guide §8) | Leave → Attached → Duty Off/Rest → Official Movement → Patrol/Beat/Court/Field/On Duty → Present-Available → Absent | Availability engine, dashboard cards, reports | |
| 6 | Full user roles and access rules (SOP §10) | See [role-matrix-for-sho.md](role-matrix-for-sho.md) | Every API permission | |
| 7 | Maintain vehicle details (number, driver, staff)? | Not built (optional in the guide) | — | |
| 8 | Personal Android devices; department policy on AI deployment | Staff may install the app on personal phones; AI copilot is rule-based, on-premise only. See [mobile-device-policy-draft.md](mobile-device-policy-draft.md) | Android app; AI copilot | |

### Configuration values to confirm at the same time

| Item | Value loaded from the Build Guide §4 | Confirm / correct |
|:--|:--|:--|
| Shift A | 08:00 – 14:00 (6 h) | |
| Shift B | 14:00 – 20:00 (6 h) | |
| Shift C | 20:00 – 08:00 next day (12 h) | |
| Summons / Warrants / JFCM staff | 2 PCs each | |
| Sessions Court | 2 ASIs/HCs | |
| Reception / eCOPS / CCTNS | 2 / 2 / 1 | |
| Section in-charges | 3 | |
| Patrol vehicles / Beat constables | 3 / 4 per shift | |
| SHO / DI / Pilot driver, Station writer | Strength not set (shown as "not configured") | |

Shift timings and duty requirements are editable by the SHO and Admin SI on **Policy & Shifts** and **Configuration**; every change is audited.

---

## 2. Sign-off

I confirm the decisions recorded in the right-hand columns above for operational use at Panjagutta Police Station.

| | |
|:--|:--|
| Station House Officer (name, rank) | |
| Signature | |
| Date | |
| Effective from | |
| Copy filed with (Admin SI) | |

After signing: SHO signs in → **Policy & Shifts** → enters the rotation, rest, duty-off, exception authorizer, permitted exceptions and effective date → **Officially Confirm Policy (SHO)**.

---

## 3. Handover checklist

- [ ] This sheet signed and filed; values entered in the system by the SHO.
- [ ] SOP section 10 obtained and the role matrix reconciled.
- [ ] Sector SIs confirm sector boundaries and key static duty points.
- [ ] Admin SI validates service numbers against the official station muster roll and replaces the evaluation staff data.
- [ ] Every imported officer has signed in once and set their own password.
- [ ] Backup schedule running and first restore drill passed ([security-and-deployment.md](security-and-deployment.md) §5).
- [ ] Pilot completed ([pilot-and-rollout-plan.md](pilot-and-rollout-plan.md)).
