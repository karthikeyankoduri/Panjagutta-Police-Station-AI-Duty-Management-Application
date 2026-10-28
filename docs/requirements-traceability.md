# Requirements Traceability Matrix — Panjagutta Police Station Duty Management

This document provides complete traceability between the source specification documents (21-page PDF Build Guide and 7-slide Presentation Deck) and the implementation source files, database models, and test scenarios.

---

## 1. PDF Page-by-Page Traceability (Pages 1 to 21)

| PDF Page | Topic / Specification Requirement | Implementation Code / File | Verification & Test Evidence | Status |
|:---|:---|:---|:---|:---:|
| **Page 1** | Cover & Project Vision: AI-assisted duty management for Panjagutta PS | `backend/app/main.py`<br>`frontend/src/app/page.tsx` | App startup & root health endpoints | Complete |
| **Page 2** | Executive Summary & High-Level Architecture | `docker-compose.yml`<br>`backend/app/core/config.py` | PostgreSQL + FastAPI + Next.js orchestration | Complete |
| **Page 3** | Station Hierarchy: SHO &rarr; DI &rarr; Admin SI &rarr; Sector SIs &rarr; DSI &rarr; Staff | `backend/app/models/models.py` (`UserRoleEnum`, `Sector`, `Staff`) | Role definitions & sector scoping | Complete |
| **Page 4** | Shift Definitions (Shift A 07:00-15:00, Shift B 15:00-23:00, Shift C 23:00-07:00) | `backend/app/models/models.py` (`ShiftConfig`)<br>`backend/app/api/routes/policy.py` | `test_shift_config_matches_spec` | Complete |
| **Page 5** | 12 Staff Statuses, 4 Leave States, 5 Task States, Designation hierarchy | `backend/app/models/models.py` (`StaffStatus`, `LeaveStatus`, `TaskStatus`) | `test_status_enum_values_match_spec`<br>`test_leave_status_enum_matches_spec`<br>`test_task_status_enum_matches_spec` | Complete |
| **Page 6** | Recommended Technology Stack: FastAPI, Next.js, PostgreSQL, APScheduler | `backend/requirements.txt`<br>`frontend/package.json` | Dependency manifests and build scripts | Complete |
| **Page 7** | Eight Service Areas & Core Design Principles | `backend/app/services/`<br>`backend/app/api/routes/` | Availability engine, scheduler, audit trail | Complete |
| **Page 8** | Data Architecture: Staff Register & Service Number uniqueness | `backend/app/models/models.py` (`Staff.service_number`) | Unique constraint on service number | Complete |
| **Page 9** | Immutable Audit Log & Append-Only Recordkeeping | `backend/app/models/models.py` (`AuditLog`)<br>`backend/app/services/audit.py` | `log_event()` with actor, diff, IP, request ID | Complete |
| **Page 10** | Roster Versioning & Shift Scheduling | `backend/app/models/models.py` (`Roster`, `RosterAssignment`)<br>`backend/app/api/routes/roster.py` | Version increment on update; draft/submit/publish | Complete |
| **Page 11** | Attendance Verification (Scheduled vs Confirmed separation) | `backend/app/models/models.py` (`Attendance`)<br>`backend/app/api/routes/operations.py` | Roll-call verification endpoints & bulk confirm | Complete |
| **Page 12** | Outside Movements (Log out, expected return, overdue tracking) | `backend/app/models/models.py` (`Movement`)<br>`backend/app/services/scheduler.py` | APScheduler 60-second overdue detection job | Complete |
| **Page 13** | Leave & Rest Management, Attachment Orders | `backend/app/models/models.py` (`LeaveRequest`, `AttachmentOrder`)<br>`backend/app/api/routes/operations.py`<br>`backend/app/api/routes/attachments.py` | Availability Engine excludes on approved leave | Complete |
| **Page 14** | 14 Dashboard KPI Summary Cards & Shift-End Handover Report | `backend/app/api/routes/dashboard.py`<br>`backend/app/api/routes/reports.py` | 14-card metric calculation & CSV report export | Complete |
| **Page 15** | Mobile / Sector SI Experience & Responsive Layout | `frontend/src/app/globals.css`<br>`frontend/src/components/AppShell.tsx` | Mobile-first CSS & responsive flex/grid shells | Complete |
| **Page 16** | Unresolved Station Policy Gate (Section 1 Gate) | `backend/app/models/models.py` (`RotationRule`, `PolicyStatus`)<br>`backend/app/api/routes/policy.py` | `is_demo_policy` check blocking publish if unconfirmed | Complete |
| **Page 17** | Role-Based Access Control (RBAC) & Scope Guarding | `backend/app/auth/dependencies.py` (`require_roles`, `get_current_user`) | Token verification & sector ID scoping | Complete |
| **Page 18** | Security & Session Lockout Protection | `backend/app/models/models.py` (`User.failed_login_attempts`)<br>`backend/app/api/routes/auth.py` | 5 failed attempts locks user for 15 minutes | Complete |
| **Page 19** | Testing Strategy & Scenario Matrix | `backend/tests/test_availability.py` | Pytest suite testing all core scenarios | Complete |
| **Page 20** | Deployment & Operational Runbook | `docker-compose.yml`<br>`docs/security-and-deployment.md` | Single-command Docker startup & backup steps | Complete |
| **Page 21** | Summary & Definition of Done | `README.md`<br>`docs/policy-confirmation.md` | Final delivery verification checklist | Complete |

---

## 2. PowerPoint Slide-by-Slide Traceability (7 Slides)

| Slide # | Slide Title & Key Visuals | Implementation Mapping | Notes |
|:---|:---|:---|:---|
| **Slide 1** | Title: Panjagutta Police Station Duty Management | Root Landing & Login Header | Official badge styling, prototype disclaimer |
| **Slide 2** | Operational Pain Points: Manual registers, missed overdues | Dashboard Alerts & Overdue Movement monitoring | Automated highlight banners for overdue movements |
| **Slide 3** | Station Organization & Hierarchy | `backend/app/db/seed.py` | Fabricated 5 Sectors, SHO, DI, SIs, PCs, WPCs, HCs |
| **Slide 4** | Recommended Stack Architecture | FastAPI + Next.js App Router + PostgreSQL + APScheduler | All layers decoupled and strictly typed |
| **Slide 5** | 13 Screens / Modules Walkthrough | `frontend/src/app/` (all 13 route directories) | Complete UI with functional forms, tables, modals |
| **Slide 6** | AI Guardrails & Human-in-the-Loop | `backend/app/api/routes/ai.py`<br>`frontend/src/app/roster/page.tsx` | AI is draft-only; mandatory warning disclaimers |
| **Slide 7** | Implementation Roadmap (Stages A to G) | `docs/requirements-traceability.md`<br>`docs/policy-confirmation.md` | Stages A through G covered with explicit gates |
