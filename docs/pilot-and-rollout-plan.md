# Pilot and Rollout Plan

Covers Build Guide §15 and blueprint steps 29–30. Nothing here can start until the SHO rules sheet is signed ([policy-confirmation.md](policy-confirmation.md)).

## 1. Preconditions

- Rules sheet signed and confirmed in the system; role matrix agreed.
- Real station staff register imported and checked against the muster roll (replace the evaluation data).
- Production deployment on department infrastructure with HTTPS, nightly encrypted backups and one passed restore drill.
- CI green (backend tests, frontend build, Android build).

## 2. Pilot — one shift, two weeks

| Week | Activity | Owner | Exit check |
|:--|:--|:--|:--|
| 0 | Train the Admin SI (allocation, exceptions, publishing, reports) | Project team | Admin SI publishes a practice roster unaided |
| 1 | Run **Shift A** only from the system, in parallel with the paper register | Admin SI | Daily comparison: system shift-end report vs register — no unexplained difference |
| 1 | Staff on Shift A submit attendance and leave from the Android app or web | Staff, Sector SIs | ≥ 90 % of Shift A attendance submitted in the system |
| 2 | Shift A run from the system alone (paper as backup only) | Admin SI, SHO | SHO approves each roster in the system; all exceptions carry an authorizer |
| 2 | Review issues, fix, re-test | Project team | Issue list closed or accepted by the SHO |

**Pilot exit criterion (step 29):** the Admin SI runs a full Shift A week from the application alone and the shift-end reports match the dashboard for the same shifts.

## 3. Rollout

1. Extend to Shifts B and C (one week each), same checks.
2. Train officers (Sector SIs, DI, DSI): dashboard, approvals inbox, attendance verification, movements.
3. Train staff: sign-in and password change, attendance, leave and movement requests, notifications. Use the in-app **Workflow Guide** and [user-guide.md](user-guide.md).
4. Retire the paper register for the station.

## 4. First-month review (step 30)

After one month of full operation the SHO and Admin SI review together:

- Daily and vacancy reports for the month, and the workload report for fairness of night and heavy duties.
- Audit log filtered to **Authorized exceptions only** — how many, why, who authorized.
- Overdue movement and stalled-approval alerts — response times.
- Any rule that needs changing (re-confirm the policy so a new version is recorded).

Signed off by the SHO: ____________________  Date: ____________

## 5. Support

- Incidents: Admin SI → station IT contact. Quote the request ID shown in error messages.
- Backups: checked weekly by IT; restore drill monthly.
- Password resets: Admin SI resets on the Staff page; the officer must choose a new password at next sign-in.
