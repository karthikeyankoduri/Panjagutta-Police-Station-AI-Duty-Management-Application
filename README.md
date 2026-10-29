# Panjagutta Police Station — AI Duty Management System

> **⚠ PROTOTYPE EVALUATION NOTICE:**  
> This software is a functional prototype built strictly to the specifications of the Panjagutta Police Station 21-page Build Guide and 7-slide Architecture Presentation. All personnel profiles, names, service numbers, and operational events included in the default seeds are **entirely fabricated for demonstration purposes**. Formal security and compliance review by the Telangana Police Department is required prior to live operational deployment.

---

## 1. Overview & Architecture

The **Panjagutta Police Station Duty Management System** is a centralized, role-governed operational platform designed to automate shift scheduling, enforce mandatory rest periods, track outside court/crime movements, reconcile physical attendance against rosters, and prevent coverage deficits across the station's five sectors.

```
┌─────────────────────────────────────────────────────────────┐
│                 Next.js 16 (App Router)                     │
│    13 Reactive Operational Screens + Tailwind/Vanilla CSS   │
│   (Dashboard, Staff, Roster, Allocation, Attendance, etc.)  │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTPS / JSON REST API (JWT)
┌──────────────────────────────▼──────────────────────────────┐
│                    FastAPI Backend Core                     │
│    RBAC Dependencies • Lifespan Scheduler • Audit Engine     │
│   Availability Service • Reports Generator • AI Copilot     │
└──────────────┬──────────────────────────────┬───────────────┘
               │ SQLAlchemy Async ORM         │ APScheduler
┌──────────────▼──────────────┐┌──────────────▼───────────────┐
│        PostgreSQL 15        ││    Background Job Runner     │
│  Staff, Rosters, Movements, ││ Overdue Movement Detection,  │
│  Attendance, Immutable Logs ││ Stalled Approvals Alerting   │
└─────────────────────────────┘└──────────────────────────────┘
```

### Technology Stack
- **Frontend:** Next.js 16 (App Router) + TypeScript + React 19 + Vanilla CSS Design Tokens
- **Backend:** Python 3.11+ + FastAPI + Pydantic v2
- **Database:** PostgreSQL 15 + SQLAlchemy 2.0 (Asyncpg) + Alembic
- **Authentication:** JWT Bearer tokens + RBAC + account lockout protection
- **Background Jobs:** APScheduler (overdue movement detection & stalled approval monitoring)
- **AI / LLM Layer:** Explainable, on-premises rule-based heuristics & local draft advisory copilot
- **Reporting:** Server-side CSV & printable shift-end handover and vacancy reports
- **Containerization:** Multi-stage Docker & Docker Compose

---

## 2. Default Seed Accounts (Demo Logins)

The system includes pre-configured demo user accounts mapped to the station hierarchy:

| Role | Username | Password | Operational Responsibility |
|:---|:---|:---|:---|
| **SHO** (Station House Officer) | `sho_demo` | `Demo@SHO#2024!` | Station Commander; formal policy confirmation; approves final rosters. |
| **DI** (Detective Inspector / Crime) | `di_demo` | `Demo@DI#2024!` | Crime division in-charge; authorizes investigative movements & tasks. |
| **Admin SI** (General Administration) | `admin_si_demo` | `Demo@AdminSI#2024!` | Prepares draft rosters; manages muster roll; assigns duty points. |
| **Sector 1 SI** (Field Sector In-Charge)| `sector1_si_demo`| `Demo@Sec1SI#2024!` | Scoped to Sector 1; monitors Blue Colts motorcycle beats & patrols. |
| **Sector 2 SI** (Field Sector In-Charge)| `sector2_si_demo`| `Demo@Sec2SI#2024!` | Scoped to Sector 2; monitors commercial beat patrols. |
| **Duty SI** (Station Duty Officer) | `dsi_demo` | `Demo@DSI#2024!` | Oversees daily roll-call; logs physical attendance; sentry checks. |
| **Staff Officer** (Beat Constable) | `staff_demo` | `Demo@Staff#2024!` | Views personal duty allocations; submits leave requests. |

---

## 3. Quick Start (Docker Compose — Recommended)

The simplest way to spin up the complete application stack (PostgreSQL, Backend API, Frontend UI) is using Docker Compose:

```bash
# 1. Clone repository and navigate to root
cd "panjagutta ai application"

# 2. Build and launch all containers
docker compose up -d --build

# 3. Initialize database tables and run migrations
docker compose exec backend alembic upgrade head

# 4. Seed fabricated demo personnel and shift configuration
docker compose exec backend python -m app.db.seed

# 5. Access the application:
#    - Frontend Dashboard: http://localhost:3000
#    - FastAPI Swagger Docs: http://localhost:8000/api/docs
#    - Backend Health Check: http://localhost:8000/api/health
```

---

## Native Android Staff App

The `mobile-android` project contains the native Java staff app. It uses the same FastAPI backend and authenticates through `/api/auth/login`. The staff-only API routes are under `/api/mobile`: profile, published assigned shifts, date-bounded duty diary, attendance submission, and leave requests/history. Each mobile request is authorized against the signed-in user's linked active staff record.

### Build a debug APK

Install Android Studio with Android SDK 35 and JDK 17, then from PowerShell:

```powershell
cd mobile-android
.\gradlew.bat assembleDebug "-PAPI_BASE_URL=https://api.example.gov"
```

Replace the example with the approved backend origin (scheme and hostname, with an optional port; do not append `/api`). The app adds `/api` to its requests. For trusted local Wi-Fi development only, use the computer's reachable LAN origin, such as `http://192.168.1.20:8000`. Without a configured origin, enter one in **API CONNECTION SETTINGS**. A private LAN address cannot be reached over mobile data.

The debug APK is written to `mobile-android\app\build\outputs\apk\debug\app-debug.apk`. Release builds disable cleartext HTTP and require HTTPS. Do not distribute a debug build as a production app. Mobile-data use requires the API to be deployed at an authorized HTTPS address; building the APK alone does not host or publish the backend. Create staff user accounts through the authorized staff-management workflow and link each account to its staff record; do not hardcode real credentials in the app.

---

## 4. Local Development Setup (Manual)

### Prerequisites
- Python 3.11+
- Node.js v18+ & npm
- PostgreSQL 14+ running locally (or SQLite for local lightweight testing)

### Step 1: Backend Setup
```bash
cd backend

# Create and activate python virtual environment
python -m venv .venv
# On Windows:
.venv\Scripts\activate
# On Linux/macOS:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Copy environment variables
copy .env.example .env

# Run database migrations
alembic upgrade head

# Seed initial configuration and demo users
python -m app.db.seed

# Start FastAPI server
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### Step 2: Frontend Setup
```bash
cd frontend

# Install npm dependencies
npm install

# Start Next.js development server
npm run dev

# Open http://localhost:3000 in your browser
```

---

## 5. Running Automated Tests

A dedicated test suite validates the deterministic **Availability Engine**, status priority ordering, leave exclusions, and shift configuration consistency:

```bash
cd backend
pytest tests/ -v
```

---

## 6. Detailed Documentation Index

Extensive technical specifications and operational runbooks are located in the `docs/` directory:

- [Requirements Traceability Matrix](file:///c:/Users/karthu/Desktop/HCP%20Projects/panjagutta%20ai%20application/docs/requirements-traceability.md): Complete mapping of PDF pages 1–21 and Presentation slides 1–7 to source code and tests.
- [Station Policy Confirmation](file:///c:/Users/karthu/Desktop/HCP%20Projects/panjagutta%20ai%20application/docs/policy-confirmation.md): Details of the Section 1 Policy Gate, rest intervals, and open SHO decisions.
- [Security & Deployment Runbook](file:///c:/Users/karthu/Desktop/HCP%20Projects/panjagutta%20ai%20application/docs/security-and-deployment.md): Role matrix, password hashing, session revocation, immutable audit logs, and on-premises air-gapped guidelines.
- [Station User Guide](file:///c:/Users/karthu/Desktop/HCP%20Projects/panjagutta%20ai%20application/docs/user-guide.md): Step-by-step instructions for SHO, Admin SI, Sector SI, and Staff workflows.

---

## 7. License & Compliance

Developed strictly for police operations research and demonstration prototyping under the Hyderabad City Police modernization initiative. All rights reserved.
