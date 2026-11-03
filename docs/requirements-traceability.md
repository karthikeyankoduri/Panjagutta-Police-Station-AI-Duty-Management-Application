# Requirements Traceability — Build Guide to Implementation

Maps each Build Guide section and blueprint step to the code and to the automated test that proves it. Status is **Done** (implemented and tested), **Done (untested)** or **Needs SHO** (blocked on a decision). For the full gap analysis see [build-guide-compliance-report.md](build-guide-compliance-report.md).

Test files are in `backend/tests/`. Run them with `cd backend && python -m pytest -q`.

## Build Guide sections

| Guide § | Requirement | Implementation | Evidence | Status |
|:--|:--|:--|:--|:--|
| 3.2, 12 | Permissions enforced in the API; sector scoping | `app/auth/dependencies.py`, every route | `test_roles.py` | Done |
| 4.1 | Shifts A/B/C in an editable table | `ShiftConfig`, `app/services/shifts.py`, `PUT /policy/shifts/{code}` | `test_validation.py::test_shift_time_overlap_uses_configured_times` | Done |
| 4.2 | Duty requirements editable | `DutyMaster`, `/duties` (create, edit), Configuration page | — | Done (untested) |
| 4.3 | Status and state lists in tables | `config_list_items`, `/config/lists` | — | Done (untested) |
| 5.3 #1 | Availability calculated, never typed | `app/services/availability.py` | `test_availability.py` | Done |
| 5.3 #3 | Never delete a roster; versions with reason | `/rosters/{id}/revise`, `/versions`, superseded on publish | `test_scenarios.py::test_full_roster_lifecycle_with_versions` | Done |
| 5.3 #4 | Traceable to user and authorizer | `audit_log` incl. authorizer, exception reason | `test_validation.py::test_save_refused_without_authorizer_and_audited_with_one` | Done |
| 7 | Data model | `app/models/models.py`, `migrations/versions/0001_baseline.py` | Migration up/down in CI | Done (vehicle table not built — optional, Needs SHO) |
| 8 | One status per person, priority order | `resolve_status`, `compute_statuses` | `test_availability.py` (128 combinations + DB cases) | Done — order Needs SHO |
| 9.1 | Session: lockout, first-time password, logout, timeout, drafts | `routes/auth.py`, `dependencies.py`, web `auth-context.tsx`, Android | `test_auth_audit.py` | Done (OTP not built) |
| 9.2 step 5 | Validation before saving; authorized exceptions | `app/services/validation.py`, `/rosters/validate` | `test_validation.py` | Done |
| 9.4 | Movement lifecycle and overdue | `operations.py` movement routes, scheduler | `test_scenarios.py::test_late_return_from_movement` | Done |
| 9.5 | Leave lifecycle incl. cancel and routing | `operations.py` leave routes, notifications | `test_scenarios.py::test_leave_routing_cancel_and_overlap` | Done |
| 10 | Screens | `frontend/src/app/*` | `npm run build` in CI | Done (Android preview screen superseded by the real app) |
| 10 | Dashboard filters and views | `/dashboard/summary`, `/dashboard/views` | `test_scenarios.py::test_dashboard_cards_are_exclusive` | Done |
| 11 | AI features | `routes/ai.py` (keyword copilot, explain) | — | Not built beyond the prototype (out of scope for this phase) |
| 12 | HTTPS, encrypted backups | `docker/nginx.conf`, `scripts/backup.sh`, `scripts/restore.sh` | Restore drill log | Done (department certificate and drill Needs IT) |
| 14 | SHO decisions | [policy-confirmation.md](policy-confirmation.md) | — | Needs SHO |

## Blueprint steps

| Step | Done when | Evidence | Status |
|:-:|:--|:--|:--|
| 1 | Signed rules sheet exists | [policy-confirmation.md](policy-confirmation.md) | Needs SHO |
| 2 | Role matrix agreed | [role-matrix-for-sho.md](role-matrix-for-sho.md) | Needs SHO |
| 3 | One command start; CI runs tests | `docker compose up -d --build`; `.github/workflows/ci.yml` | Done |
| 4 | Migrations create and roll back | CI job runs upgrade → downgrade → upgrade on PostgreSQL | Done |
| 5 | Admin can view/edit every config value | Policy & Shifts, Configuration pages | Done |
| 6 | Wrong password locks; logout kills token | `test_wrong_password_locks_account`, `test_logout_makes_token_unusable` | Done |
| 7 | Sector SI cannot read another sector | `test_sector_si_cannot_read_other_sector` | Done |
| 8 | Every write audited, append-only | `test_every_login_attempt_is_audited`, `test_audit_rows_cannot_be_modified_through_the_app` | Done (wipe tool exception noted) |
| 9 | Add staff; find by sector/designation | Staff page, `GET /staff` filters | Done |
| 10 | Each role sees only its menu | `AppShell.tsx` + server checks | Done |
| 11 | Original roster viewable after change | `test_full_roster_lifecycle_with_versions` | Done |
| 12 | 4 required, 3 assigned → 1 vacancy | `test_vacancy_reported_against_required_strength` | Done |
| 13 | Each rule has a failing-without-it test | `test_validation.py` (one test per rule) | Done |
| 14 | Override needs an authorizer | `test_override_requires_distinct_authorized_officer` | Done |
| 15 | Draft invisible until published | `test_drafts_hidden_from_staff_and_di` | Done |
| 16 | Scheduled and confirmed shown separately | `GET /attendance/scheduled`, Attendance → Scheduled vs Confirmed | Done (untested) |
| 17 | Late task flagged | Scheduler `check_overdue_tasks` | Done (untested) |
| 18 | Open movement → Outside; late highlighted | `test_late_return_from_movement` | Done |
| 19 | Only approved leave removes eligibility | `test_pending_leave_does_not_count_but_approved_does` | Done |
| 20 | Attached count in strength, not deployment | `test_attachment_and_attendance`, validation `ATTACHED` | Done |
| 21 | Right officer alerted when overdue/stalled | `test_stalled_leave_raises_alert` | Done |
| 22 | One status across every combination | `test_every_combination_yields_exactly_one_status_in_priority_order` | Done |
| 23 | No one in two exclusive totals | `test_dashboard_cards_are_exclusive` | Done |
| 24 | All dashboard filters work | `/dashboard/summary` filters | Done (untested) |
| 25 | Reports with PDF and Excel | `test_report_exports_csv_xlsx_pdf_with_auth` | Done |
| 26 | Mark attendance and request leave from a phone | Android app; `test_mobile.py`, `test_mobile_movement_request_and_password_change` | Done |
| 27 | Unit, scenario, role tests pass in CI | `.github/workflows/ci.yml` | Done |
| 28 | Security review, HTTPS, backups, restore drill | Tooling in place | Needs IT / department |
| 29 | Pilot with one shift | [pilot-and-rollout-plan.md](pilot-and-rollout-plan.md) | Needs SHO |
| 30 | Training and one-month review | [pilot-and-rollout-plan.md](pilot-and-rollout-plan.md), in-app Workflow Guide | Needs SHO |
| 31–33 | AI stages | — | Out of scope for this phase |
