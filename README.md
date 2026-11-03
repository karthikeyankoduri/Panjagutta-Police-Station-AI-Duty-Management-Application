# 🚔 Panjagutta Police Station — AI Duty Management System

> **Centralised, role-aware duty management for Panjagutta Police Station, Hyderabad City Police.**  
> Staff register · Shift rosters · Attendance · Leave · Outside movements · Tasks · Attachments · Live operational dashboard · Reports · Audit trail · Android app

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [System Architecture](#2-system-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Prerequisites](#4-prerequisites)
5. [Setup Guide — Docker (Recommended)](#5-setup-guide--docker-recommended)
6. [Setup Guide — Local Development](#6-setup-guide--local-development)
7. [Setup Guide — Android Mobile App](#7-setup-guide--android-mobile-app)
8. [Environment Variables Reference](#8-environment-variables-reference)
9. [Role System & Access Control](#9-role-system--access-control)
10. [Demo Accounts](#10-demo-accounts)
11. [User Manual — Web Application](#11-user-manual--web-application)
    - [11.1 Login](#111-login)
    - [11.2 Operational Dashboard](#112-operational-dashboard)
    - [11.3 Staff Register](#113-staff-register)
    - [11.4 Roster Management](#114-roster-management)
    - [11.5 Attendance](#115-attendance)
    - [11.6 Leave Management](#116-leave-management)
    - [11.7 Outside Movements](#117-outside-movements)
    - [11.8 Task Management](#118-task-management)
    - [11.9 Duty Allocation](#119-duty-allocation)
    - [11.10 Approvals Queue](#1110-approvals-queue)
    - [11.11 Attachments](#1111-attachments)
    - [11.12 Reports](#1112-reports)
    - [11.13 Audit Log](#1113-audit-log)
    - [11.14 Policy & Workflow Guide](#1114-policy--workflow-guide)
    - [11.15 Configuration](#1115-configuration)
12. [User Manual — Android App](#12-user-manual--android-app)
13. [Backup & Restore](#13-backup--restore)
14. [CI / CD Pipeline](#14-ci--cd-pipeline)
15. [Project Directory Structure](#15-project-directory-structure)
16. [Troubleshooting](#16-troubleshooting)
17. [Security Notes](#17-security-notes)
18. [Contributing](#18-contributing)
19. [License & Disclaimer](#19-license--disclaimer)

---

## 1. Project Overview

The **Panjagutta Police Station AI Duty Management System** is a full-stack, role-gated application that digitises every step of station duty operations — from importing the staff register and publishing shift rosters all the way through to generating official PDF and Excel reports for headquarters. It replaces manual registers, disconnected spreadsheets, and paper-based approval workflows with a single, audited, web and mobile platform.

### Key capabilities at a glance

| Feature | Detail |
|---|---|
| **Staff register** | 88+ officers, photo, designation, sector, contact — import or add manually |
| **Shift rosters** | 3-shift (A/B/C 08-hour) versioned rosters with SHO approval gate |
| **Attendance** | Per-shift roll-call with bulk confirm; personal monthly calendar for staff |
| **Leave** | Submit, approve/reject with roster-vacancy alerts |
| **Outside movements** | Court, field duty, hospital, personal; supervisor authorises departure & return |
| **Tasks** | Assign to officers; track Not Started → In Progress → Completed |
| **Duty allocation** | Duty-master categories tied to rosters |
| **Attachments** | Upload documents to any entity (leave, movement, task) with expiry tracking |
| **Operational dashboard** | Live station strength, staff status grid, overdue tasks, recent alerts |
| **Reports** | Attendance register, roster, strength, movement, leave — PDF/Excel/CSV |
| **Audit trail** | Append-only record of every data change; searchable by actor/entity/date |
| **Android app** | Staff self-service: home dashboard, roster view, attendance calendar, leave form |

---

## 2. System Architecture

```
                        ┌─────────────────────────────────────┐
                        │           End Users                 │
                        │  Browser (PC / Tablet / Phone)      │
                        │  Android App (API 23+)              │
                        └────────────┬────────────────────────┘
                                     │ HTTPS
                        ┌────────────▼────────────────────────┐
                        │         nginx Reverse Proxy         │
                        │  • TLS termination (port 443/80)    │
                        │  • /api  → backend:8000             │
                        │  /      → frontend:3000             │
                        └────────────┬────────────────────────┘
                  ┌──────────────────┴──────────────────┐
                  ▼                                      ▼
   ┌──────────────────────────┐         ┌───────────────────────────┐
   │   Next.js 16 Frontend    │         │   FastAPI Backend (Python) │
   │   React 19 + TypeScript  │         │   SQLAlchemy 2 (async)    │
   │   App Router, SSR/Static │         │   Pydantic 2 schemas      │
   │   Port 3000              │         │   APScheduler background  │
   └──────────────────────────┘         │   jobs (port 8000)        │
                                        └──────────────┬────────────┘
                                                       │
                                        ┌──────────────▼────────────┐
                                        │  PostgreSQL 15 Database   │
                                        │  Alembic migrations       │
                                        │  Append-only audit table  │
                                        │  Port 5432 (internal)     │
                                        └───────────────────────────┘
```

### Container topology (Docker Compose)

| Container | Image | Exposes | Purpose |
|---|---|---|---|
| `panjagutta_proxy` | `nginx:1.27-alpine` | `80`, `443` → host | TLS termination, routing |
| `panjagutta_frontend` | Custom Next.js build | `3000` (internal) | Web UI |
| `panjagutta_backend` | Custom Python 3.11 build | `8000` (internal) | REST API + scheduler |
| `panjagutta_db` | `postgres:15-alpine` | `5432` (internal) | Database |

> The database port is **not** published to the host — only the backend can reach it, preventing direct external database access.

---

## 3. Technology Stack

| Layer | Technology | Version |
|---|---|---|
| **Web frontend** | Next.js (App Router), React, TypeScript | Next.js 16, React 19 |
| **Android app** | Native Java | minSdk 23, targetSdk 35 |
| **REST API** | FastAPI, Uvicorn | Python 3.11 |
| **ORM** | SQLAlchemy (async), Alembic migrations | 2.x |
| **Validation** | Pydantic | 2.x |
| **Database** | PostgreSQL | 15 |
| **Background jobs** | APScheduler | 3.x |
| **Reports** | ReportLab (PDF), openpyxl (Excel) | Latest |
| **Reverse proxy** | nginx | 1.27 |
| **Containerisation** | Docker, Docker Compose | 24+ |
| **Android build** | Gradle wrapper | 8.11.1 |
| **CI** | GitHub Actions | - |

---

## 4. Prerequisites

### For Docker setup (production / evaluation)

| Requirement | Minimum version | Check |
|---|---|---|
| **Docker Desktop** | 24.x | `docker --version` |
| **Docker Compose** | v2.x (bundled with Docker Desktop) | `docker compose version` |
| **Git** | Any recent | `git --version` |
| **RAM** | 4 GB free | - |
| **Disk** | 4 GB free | - |
| **OS** | Windows 10+, macOS 12+, Ubuntu 20.04+ | - |

### For local development (backend)

| Requirement | Version |
|---|---|
| Python | 3.11 |
| PostgreSQL | 15 (or use Docker just for DB) |
| Node.js | 20 LTS |
| npm | 10+ |

### For Android development

| Requirement | Version |
|---|---|
| Android Studio | Iguana / Jellyfish (2024+) |
| JDK | 17 or 21 (bundled with Android Studio) |
| Android SDK | API 35 |
| Gradle | 8.11.1 (wrapper bundled) |
| Android device or emulator | API 23 (Android 6.0)+ |

---

## 5. Setup Guide — Docker (Recommended)

This is the **fastest and most reliable** way to run the full application on any machine. All services start with a single command.

### Step 1 — Clone the repository

```bash
git clone https://github.com/karthikeyankoduri/Panjagutta-Police-Station-AI-Duty-Management-Application.git
cd "Panjagutta-Police-Station-AI-Duty-Management-Application"
```

### Step 2 — Create the environment file

```bash
# Windows (PowerShell)
Copy-Item .env.example .env

# macOS / Linux
cp .env.example .env
```

Now open `.env` in any text editor and **set these four values** (minimum required):

```env
POSTGRES_PASSWORD=choose_a_strong_password_here
JWT_SECRET_KEY=generate_with_openssl_rand_base64_48
APP_SECRET_KEY=generate_with_openssl_rand_base64_48
SEED_DEMO_DATA=true          # set to false for production; true to create demo accounts
```

**Generate secure secrets (macOS/Linux):**
```bash
openssl rand -base64 48   # run twice — one value for JWT_SECRET_KEY, one for APP_SECRET_KEY
```

**Generate secure secrets (Windows PowerShell):**
```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```

### Step 3 — Build and start all containers

```bash
docker compose up -d --build
```

This will:
1. Pull base images (`postgres:15-alpine`, `nginx:1.27-alpine`, `node:20-alpine`, `python:3.11-slim`)
2. Build the backend image (installs Python packages)
3. Build the frontend image (runs `npm ci` + `next build`)
4. Create a self-signed TLS certificate (for evaluation)
5. Apply Alembic database migrations
6. Bootstrap configuration data (sectors, shift codes, duty master)
7. Optionally seed demo accounts (if `SEED_DEMO_DATA=true`)

**Expected output:**
```
✔ Container panjagutta_db       Started
✔ Container panjagutta_backend  Started
✔ Container panjagutta_frontend Started
✔ Container panjagutta_proxy    Started
```

### Step 4 — Open the application

| URL | What you see |
|---|---|
| `https://localhost/` | Login page (accept the browser self-signed cert warning) |
| `https://localhost/api/docs` | FastAPI interactive API documentation (Swagger UI) |
| `https://localhost/api/redoc` | ReDoc API reference |

> **Windows users:** If port 443 is blocked by another service (e.g. IIS), change `HTTPS_PORT=8443` in `.env` and browse to `https://localhost:8443/`.

### Step 5 — Verify services are healthy

```bash
docker ps
```

All four containers should show **`Up`** status. The `panjagutta_backend` will show `(healthy)` after ~20 seconds.

```bash
docker logs panjagutta_backend --tail 30
```

Look for: `INFO: Application startup complete.` and `INFO: Uvicorn running on http://0.0.0.0:8000`

### Managing containers

```bash
# Stop all services
docker compose down

# Stop and delete all data (destructive — deletes the database volume)
docker compose down -v

# Rebuild only the backend after a code change
docker compose build backend && docker compose up -d backend

# Rebuild only the frontend after a code change
docker compose build frontend && docker compose up -d frontend

# View real-time logs
docker compose logs -f

# View backend logs only
docker logs panjagutta_backend -f
```

---

## 6. Setup Guide — Local Development

Use this when you want to actively develop and modify the code with hot-reload.

### 6.1 Database (PostgreSQL via Docker — easiest)

Start only the database container:
```bash
docker compose up -d db
```

Or install PostgreSQL 15 natively and create the database:
```sql
CREATE USER panjagutta WITH PASSWORD 'your_password';
CREATE DATABASE panjagutta_duty_db OWNER panjagutta;
```

### 6.2 Backend (FastAPI)

```bash
cd backend

# Create virtual environment
python -m venv .venv

# Activate (Windows PowerShell)
.venv\Scripts\Activate.ps1

# Activate (macOS / Linux)
source .venv/bin/activate

# Install dependencies (including test tools)
pip install -r requirements-dev.txt

# Copy environment file
copy .env.example .env        # Windows
cp .env.example .env          # macOS/Linux

# Edit .env — set DATABASE_URL to point to your PostgreSQL:
# DATABASE_URL=postgresql+asyncpg://panjagutta:your_password@localhost:5432/panjagutta_duty_db
# Or use SQLite for quick local testing:
# DATABASE_URL=sqlite+aiosqlite:///./panjagutta_local.db

# Run database migrations
alembic upgrade head

# (Optional) seed demo staff and accounts
python -m app.db.seed

# Start backend with hot reload
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Backend is now at: `http://localhost:8000/api/docs`

### 6.3 Frontend (Next.js)

Open a **new terminal**:
```bash
cd frontend

# Install Node.js dependencies
npm install

# Start development server with hot reload
npm run dev
```

Frontend is now at: `http://localhost:3000`

> The frontend proxies `/api` calls to `http://localhost:8000` automatically in development.

### 6.4 Running Tests

```bash
# Backend tests (200+ test cases)
cd backend
python -m pytest -q

# Run specific test file
python -m pytest tests/test_roles.py -v

# Frontend lint and type check
cd frontend
npm run lint
npm run build

# Android (verify APK builds)
cd mobile-android
.\gradlew.bat assembleDebug     # Windows
./gradlew assembleDebug          # macOS / Linux
```

---

## 7. Setup Guide — Android Mobile App

### Prerequisites

1. Install **Android Studio** (Iguana 2024.1 or later) from https://developer.android.com/studio
2. During setup, install **Android SDK API 35** and **Android SDK Build-Tools 35.0.0**
3. Create or start an **Android Virtual Device** (AVD) with API 23 or higher — or connect a physical Android phone with USB debugging enabled

### Step 1 — Open the project in Android Studio

1. Open Android Studio
2. Choose **Open** (not "New Project")
3. Navigate to the cloned repository → select the **`mobile-android`** folder
4. Android Studio will detect `build.gradle` and sync Gradle automatically

### Step 2 — Configure the API Base URL

The app reads the backend URL from a Gradle build property. You have two options:

**Option A — Edit `gradle.properties` (persistent):**
```properties
# mobile-android/gradle.properties
API_BASE_URL=http://192.168.1.100:8000    # Replace with your PC's LAN IP
```

**Option B — Pass at build time:**
```bash
./gradlew assembleDebug -PAPI_BASE_URL=http://192.168.1.100:8000
```

> **Finding your PC's LAN IP:**  
> Windows: `ipconfig` → look for IPv4 Address  
> macOS/Linux: `ifconfig` or `ip addr`

> **Note:** Android emulators use `10.0.2.2` to reach the host machine's localhost:  
> `API_BASE_URL=http://10.0.2.2:8000`

### Step 3 — Build and run

**In Android Studio:**
1. Click the green ▶ **Run** button (or press `Shift + F10`)
2. Select your emulator or connected device
3. The app will install and launch automatically

**From command line:**
```bash
cd mobile-android

# Debug APK
.\gradlew.bat assembleDebug          # Windows
./gradlew assembleDebug               # macOS / Linux

# Install on connected device
adb install app/build/outputs/apk/debug/app-debug.apk
```

The compiled APK is at: `mobile-android/app/build/outputs/apk/debug/app-debug.apk`

---

## 8. Environment Variables Reference

Copy `.env.example` to `.env` and set all values marked **CHANGE**.

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_USER` | `panjagutta` | PostgreSQL username |
| `POSTGRES_PASSWORD` | *(must set)* | PostgreSQL password — use a long random value |
| `POSTGRES_DB` | `panjagutta_duty_db` | Database name |
| `JWT_SECRET_KEY` | *(must set)* | JWT signing secret — at least 48 random characters |
| `APP_SECRET_KEY` | *(must set)* | Application secret — at least 48 random characters |
| `APP_ENV` | `production` | `development` or `production` |
| `SEED_DEMO_DATA` | `false` | `true` creates demo accounts on first start |
| `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | `480` | Session timeout (8 hours) |
| `AUTH_INACTIVITY_TIMEOUT_MINUTES` | `30` | Auto-logout after inactivity |
| `AUTH_MAX_FAILED_ATTEMPTS` | `5` | Lockout threshold |
| `AUTH_LOCKOUT_MINUTES` | `15` | Duration of lockout after failed attempts |
| `PUBLIC_ORIGIN` | `https://panjagutta-duty.local` | Browser-facing URL (used for CORS) |
| `HTTP_PORT` | `80` | nginx HTTP port |
| `HTTPS_PORT` | `443` | nginx HTTPS port |
| `BACKUP_PASSPHRASE` | *(must set)* | AES-256 passphrase for encrypted backups |
| `BACKUP_DIR` | `./backups` | Local backup destination directory |
| `AI_PROVIDER` | `none` | `none` / `openai` / `local` |
| `AI_API_KEY` | `NOT_SET` | API key if using OpenAI |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins |

---

## 9. Role System & Access Control

The system has **7 roles** in a strict hierarchy. Every API endpoint and every UI element is gated by role.

| Role | Code | Who | What they can do |
|---|---|---|---|
| **Super Admin** | `SUPER_ADMIN` | IT/System Admin | Full access to all features, all data, system configuration |
| **Admin SI** | `ADMIN_SI` | Station Administrator Sub-Inspector | All station management: staff, rosters, attendance, approvals, reports |
| **SHO** | `SHO` | Station House Officer | Roster approval authority, leave/movement approvals, full dashboard |
| **DI** | `DI` | Deputy Inspector | View dashboards, approve movements, view reports |
| **DSI** | `DSI` | Deputy Sub-Inspector | View dashboards, attendance roll-call, approve movements |
| **Sector SI** | `SECTOR_SI` | Sector Sub-Inspector | Manage own sector staff: attendance, movements, tasks |
| **Staff** | `STAFF` | Constable / PC / HC | View own records only: attendance, leave, roster, movements |

### Role-based feature matrix

| Feature | SUPER_ADMIN | ADMIN_SI | SHO | DI | DSI | SECTOR_SI | STAFF |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| View operational dashboard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Manage staff register | ✅ | ✅ | 👁 | 👁 | ❌ | 👁 | ❌ |
| Create/edit rosters | ✅ | ✅ | 👁 | ❌ | ❌ | ❌ | ❌ |
| Approve rosters (SHO gate) | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Station-wide attendance | ✅ | ✅ | ✅ | ✅ | ✅ | Sector | ❌ |
| Own attendance + calendar | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Approve leave | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Submit own leave | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Authorise movements | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Submit own movement | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Assign tasks | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| View own tasks | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Generate reports | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| View audit log | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| System configuration | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

> 👁 = read-only access

---

## 10. Demo Accounts

When `SEED_DEMO_DATA=true` in `.env`, these accounts are created automatically on first start. **Never use demo accounts in production.**

| Role | Username | Password | Alternate Password |
|---|---|---|---|
| Super Admin | `superadmin` | `SuperAdmin@2024!` | — |
| Admin SI | `admin_si_demo` | `Demo@AdminSI#2024!` | `admin123` |
| SHO | `sho_panjagutta` | `Password@PJ2024!` | — |
| SHO (alt) | `sho_demo` | `Demo@SHO#2024!` | — |
| Sector 1 SI | `sector1_si_demo` | `Demo@Sec1SI#2024!` | — |
| DI | `di_demo` | `Demo@DI#2024!` | — |
| DSI | `dsi_demo` | `Demo@DSI#2024!` | — |
| Staff | `staff_demo` | `Demo@Staff#2024!` | `staff123` |

> **Imported staff officers** sign in with their **service number** as the username and a provisioning password set by Admin SI. They must change their password on first login.

---

## 11. User Manual — Web Application

Open your browser and navigate to:
- **Docker setup:** `https://localhost/` (accept the self-signed certificate warning)
- **Local dev:** `http://localhost:3000/`

---

### 11.1 Login

**URL:** `/login`

1. Enter your **username** (or service number for field officers) and **password**.
2. Click **Sign In**.
3. If this is your **first login**, you will be redirected to the Change Password page. Set a new password following the policy (min. 8 characters, include uppercase, number, and symbol).
4. On success, you are taken to your role-appropriate home screen.

**If login fails:**
- Check Caps Lock — passwords are case-sensitive.
- After 5 failed attempts your account locks for 15 minutes. Contact Admin SI to unlock.
- If you see "Account is inactive", contact Admin SI.

---

### 11.2 Operational Dashboard

**URL:** `/dashboard`  
**Roles:** Super Admin, Admin SI, SHO, DI, DSI, Sector SI

The dashboard is the **command centre** of the station. It refreshes its data automatically.

#### Dashboard sections

**1. Station Strength Cards (top row)**
Five metric cards showing live counts:
- **Total Strength** — all active staff
- **On Duty Today** — officers confirmed present for today's active shift
- **On Leave** — officers with approved leave today
- **On Movement** — officers currently out of station on authorised movement
- **Available** — officers present and available for deployment

**2. Staff Status Grid**
A visual grid of every officer on duty. Each cell shows:
- Officer name and designation
- Current status (colour-coded): Present/Available (green), On Duty (blue), On Leave (amber), On Movement (purple), Absent (red)
- Click any officer cell to see full profile details

**3. Recent Alerts**
- Overdue tasks (past deadline, not completed)
- Pending roster approvals awaiting SHO
- Leave requests awaiting decision
- Expired or expiring attachments

**4. Quick Actions**
- Mark today's attendance (shortcut to Attendance page)
- Approve pending leave (shortcut to Approvals page)

> **Staff role:** Staff do not see the Operational Dashboard. They are redirected to their Attendance (personal view) page after login.

---

### 11.3 Staff Register

**URL:** `/staff`  
**Roles:** Super Admin, Admin SI (full edit); SHO, DI, Sector SI (read-only)

The staff register holds the permanent record of every officer at the station.

#### Viewing staff

- The staff list displays: Photo, Name, Service Number, Designation, Category, Sector, Active/Inactive status.
- Use the **search bar** to filter by name, service number, or designation.
- Click the **filter icon** to filter by Sector, Designation, Category, or Active status.

#### Adding a new staff member (Admin SI / Super Admin)

1. Click the **+ Add Officer** button.
2. Fill in the form:
   - **Service Number** — unique identifier (e.g. `PG/PC/001`)
   - **Name** — full name
   - **Designation** — select from: Inspector, SI, ASI, HC, PC, WPC, etc.
   - **Category** — Sector Staff, Section Duty, Driver, Attached
   - **Sector** — assign to Sector 1, 2, 3, 4, or unassigned
   - **Contact phone, address, date of joining** (optional)
3. Click **Save Officer**.
4. After saving, click **Create User Account** to give this officer a login. Set a temporary password; the officer must change it at first login.

#### Editing a staff member

1. Click the officer's row or the **Edit** (✏️) button.
2. Make changes and click **Save**.

#### Deactivating a staff member

1. Open the officer's profile.
2. Toggle **Active** to off.
3. Confirm. The officer can no longer log in and is excluded from rosters and attendance.

---

### 11.4 Roster Management

**URL:** `/roster`  
**Roles:** Admin SI, Super Admin (create/edit); SHO (approve); others (read-only)

Rosters define which officer works which shift on which date.

#### Understanding shifts

| Shift | Code | Hours |
|---|---|---|
| Morning | A | 07:00 – 15:00 |
| Evening | B | 15:00 – 23:00 |
| Night | C | 23:00 – 07:00 |

#### Creating a roster

1. Click **+ New Roster**.
2. Select the **Roster Date** and **Shift** (A / B / C).
3. The system loads all active staff. For each officer, assign a duty category from the dropdown (e.g. Beat Duty, Station Duty, Vehicle Patrol, Reserve).
4. The system checks **rule compliance** in real time:
   - ✅ Adequate rest between shifts (minimum 8 hours)
   - ✅ Maximum weekly duty hours
   - ⚠️ Warnings appear if rules are violated (you can override with a justification)
5. Click **Save Draft** to save without submitting.

#### Submitting a roster for SHO approval

1. Open a draft roster.
2. Review all assignments.
3. Click **Submit for Approval**.
4. Status changes from `Draft` → `Pending Approval`.

#### Approving a roster (SHO only)

1. Navigate to **Roster** or the **Approvals** page.
2. Click the pending roster.
3. Review all assignments and any rule warnings.
4. Click **Approve** or **Reject** (with remarks).
5. On approval, status changes to `Approved` → the roster becomes the official duty order.

#### Publishing a roster

After SHO approval, click **Publish** to make the roster visible to all staff.

#### Editing a published roster

Published rosters are locked. To make changes:
1. Click **Create Revision** — this creates a new draft version.
2. Edit and resubmit for SHO approval.
3. The previous version is archived (fully audited).

---

### 11.5 Attendance

**URL:** `/attendance`

Attendance tracking works differently depending on your role.

#### For Supervisors (Admin SI, SHO, DI, DSI, Sector SI)

You see **two tabs** at the top:

**Tab 1: 🏢 Station Roll-Call Console**

Used to record the daily parade/roll-call for the entire station.

1. Select the **Date** (defaults to today).
2. Select the **Shift** (A / B / C).
3. Click **Load Roll-Call**.
4. The table shows all active officers with their expected duty status.
5. For each officer:
   - Click **✅ Present** to mark them confirmed present.
   - Click **❌ Absent** to mark them absent.
6. **Bulk Confirm All Present** — confirms all displayed officers as Present in one click (useful at end of morning parade).
7. The **search bar** filters by name, service number, or designation.

**Strength Metrics Cards (top of table):**
- Station Strength, Scheduled, Present, Absent, Pending

**Tab 2: 👤 My Personal Attendance & Calendar**

Your own personal attendance record and monthly calendar.
- Navigate months using **◀ ▶** arrows.
- Click **Today** to jump to the current month.
- Each day shows a colour-coded pill:
  - 🟢 **Green** — Present/Confirmed
  - 🔴 **Red** — Absent/Not confirmed
  - 🟡 **Amber** — Scheduled but unconfirmed (Pending)
  - ⬜ **Grey** — No record / not scheduled
- **Click any day** to see the full duty detail card below the calendar:
  - Date, shift, confirmation status, verifying officer, verification time, and remarks.
- Below the calendar is the **History Ledger** — a table of all attendance records for the selected month.

#### For Staff (Constable / PC / HC)

You see **only** the personal attendance view — no station-wide data is ever accessible. The calendar and history ledger work exactly as described above but show **only your own records**.

> **Security note:** Even if a staff member manually modifies the URL to try to access another officer's records, the backend enforces strict scoping — it will only ever return the logged-in officer's own records.

---

### 11.6 Leave Management

**URL:** `/leave`

#### Submitting a leave request (all roles)

1. Navigate to **Leave**.
2. Click **+ Apply for Leave**.
3. Fill in:
   - **Leave Type** — Casual Leave (CL), Earned Leave (EL), Medical Leave (ML), Compensatory Off (CO), Special Leave
   - **From Date** and **To Date**
   - **Reason** — brief description
4. Click **Submit**.
5. Status is now **Pending**. You will see it in your leave list.

#### Approving / Rejecting leave (Admin SI, SHO, Super Admin)

1. Navigate to **Approvals** (or the Leave page — pending requests appear at the top).
2. Click the leave request to expand it.
3. Review the details: requester, dates, type, reason.
4. Click **Approve** or **Reject**.
5. If rejecting, enter a reason in the **Remarks** field.
6. Click **Confirm Decision**.

**Roster Vacancy Alert:** If the officer is rostered for a shift during the leave period, the system automatically creates an alert: *"Approved leave created a vacancy in Roster #X..."* This alert appears on the dashboard until a replacement is allocated.

#### Leave status meanings

| Status | Meaning |
|---|---|
| **Pending** | Submitted, awaiting supervisor decision |
| **Approved** | Approved by authorised supervisor |
| **Rejected** | Rejected with reason |
| **Cancelled** | Officer withdrew the request |

---

### 11.7 Outside Movements

**URL:** `/movements`

Records when an officer temporarily leaves the station for official or authorised personal reasons.

#### Submitting an outside movement request (all roles)

1. Navigate to **Movements**.
2. Click **+ New Movement**.
3. Fill in:
   - **Purpose** — describe the reason (e.g. "Court summons — Case No. 123/2024", "Medical check-up")
   - **Destination** — where the officer is going (e.g. "City Civil Court", "Gandhi Hospital")
   - **Expected Return** — date and time of expected return
   - **Reference/Remarks** — optional reference number or notes
4. Click **Submit Movement**.
5. Status is now **Pending Authorization**.

#### Authorising departure (Supervisor)

1. Navigate to **Movements** or **Approvals**.
2. Pending movements appear with an **⚠️ Awaiting Authorization** badge.
3. Click the movement record.
4. Click **Authorize Departure**.
5. Status changes to **Departed** — the officer is now officially out of station.

#### Recording return (Supervisor)

1. Navigate to **Movements**.
2. Find movements with status **Departed**.
3. Click the movement record.
4. Click **Record Return**.
5. Optionally add **Return Notes**.
6. Status changes to **Returned**.

#### Movement statuses

| Status | Meaning |
|---|---|
| **Pending Authorization** | Submitted, awaiting supervisor authorisation |
| **Departed** | Authorised and officer has left the station |
| **Returned** | Officer has returned, movement closed |
| **Cancelled** | Cancelled before departure |

---

### 11.8 Task Management

**URL:** `/tasks`

Assign and track action items assigned to officers.

#### Creating a task (Supervisors only)

1. Navigate to **Tasks**.
2. Click **+ New Task**.
3. Fill in:
   - **Title** — brief task name
   - **Description** — detailed instructions
   - **Assigned To** — select the officer
   - **Priority** — Low, Normal, High, Urgent
   - **Due Date** — task deadline
4. Click **Create Task**.

#### Updating task progress (assigned officer or supervisor)

1. Navigate to **Tasks** → **My Tasks** tab.
2. Click the task.
3. Change **Status**:
   - **Not Started** → **In Progress** (when you begin work)
   - **In Progress** → **Completed** (when done)
4. Add **Progress Notes** if needed.
5. Click **Save**.

**Overdue tasks** (past due date, not completed) automatically appear as alerts on the supervisor's dashboard.

#### Task views

- **All Tasks** (supervisors) — every task in the station
- **My Tasks** (staff) — only tasks assigned to you
- Filter by status, priority, assignee, or date range

---

### 11.9 Duty Allocation

**URL:** `/duty-allocation`  
**Roles:** Admin SI, Super Admin, SHO (view)

Manage the duty master — categories of duties that officers can be rostered for.

#### Viewing duty categories

The page lists all duty types (Beat Duty, Station Duty, Court Duty, Vehicle Patrol, etc.) with their requirements (minimum headcount per shift, sector association).

#### Adding a duty category (Admin SI / Super Admin)

1. Click **+ Add Duty**.
2. Enter:
   - **Category Name**
   - **Minimum Officers Required** per shift
   - **Sector** (if sector-specific)
   - **Description**
3. Click **Save**.

---

### 11.10 Approvals Queue

**URL:** `/approvals`  
**Roles:** Admin SI, SHO, DI, Super Admin

A unified inbox of all pending items requiring a decision.

The approvals page shows:
1. **Leave Requests** pending approval — sorted by submission date
2. **Movement Requests** pending authorisation
3. **Roster Submissions** awaiting SHO approval

Each card shows: requester name, type, date submitted, and a brief summary.

Click any card to expand it and see full details, then click **Approve** / **Reject** / **Authorise** as appropriate.

---

### 11.11 Attachments

**URL:** `/attachments`

Upload and manage documents linked to records (leave, movement, task, etc.).

#### Uploading an attachment

1. Navigate to the relevant record (e.g. a leave request or movement).
2. Scroll to the **Attachments** section.
3. Click **Upload Document**.
4. Select the file (PDF, JPG, PNG, DOCX — max 10 MB per file).
5. Set an **Expiry Date** if the document is time-limited (e.g. a medical certificate).
6. Click **Upload**.

#### Attachment management page

The standalone Attachments page (`/attachments`) lists all documents with:
- Document name and type
- Linked entity (leave request / movement / task)
- Upload date, expiry date
- Status: Active / Expiring Soon (within 7 days) / Expired

Expired attachments generate dashboard alerts automatically.

---

### 11.12 Reports

**URL:** `/reports`  
**Roles:** Super Admin, Admin SI, SHO, DI

Generate official reports for any date range, exportable as PDF, Excel, or CSV.

#### Available report types

| Report | Description |
|---|---|
| **Attendance Register** | Daily attendance for all officers, shift-wise, for a date range |
| **Station Strength Report** | Headcount by designation, sector, and category |
| **Roster Report** | Published rosters with all assignments for a date range |
| **Leave Report** | Leave records by officer, type, and status |
| **Movement Report** | All outside movements with departure and return times |
| **Task Status Report** | Task completion rates by priority and assignee |

#### Generating a report

1. Navigate to **Reports**.
2. Select the **Report Type** from the dropdown.
3. Set **From Date** and **To Date**.
4. (Optional) filter by Sector, Designation, or Shift.
5. Click **Generate Report**.
6. Preview the report on screen.
7. Click **Download PDF**, **Download Excel**, or **Download CSV**.

---

### 11.13 Audit Log

**URL:** `/audit`  
**Roles:** Super Admin, Admin SI, SHO

An append-only, tamper-evident record of every significant action in the system.

#### What is logged

Every create, update, approve, reject, login, logout, and export action is recorded with:
- **Timestamp** (UTC)
- **Actor** (username and role)
- **Action type** (e.g. `ROSTER_APPROVED`, `LEAVE_REJECTED`, `ATTENDANCE_VERIFIED`)
- **Entity** (what was affected, e.g. "RosterAssignment #42", "LeaveRequest #7")
- **Old values / New values** (JSON diff of what changed)
- **IP Address**

#### Searching the audit log

- Filter by **Actor** (username)
- Filter by **Action Type**
- Filter by **Entity Type** (Roster, Leave, Movement, Staff, etc.)
- Filter by **Date Range**
- Filter by **Entity ID**

The audit log is **read-only** — no user can delete or modify audit entries.

---

### 11.14 Policy & Workflow Guide

**URL:** `/policy`

The in-app policy page documents the operational rules governing this system:
- Shift rotation rules
- Leave entitlements by designation
- Movement authorisation chain
- Roster approval requirements
- Audit and accountability guidelines

A built-in **Workflow Guide** (visible to all roles) explains step-by-step how to use each feature relevant to the logged-in role.

---

### 11.15 Configuration

**URL:** `/config`  
**Roles:** Super Admin only

System-wide settings managed by the Super Admin:
- **Sectors** — add/edit/remove sectors and their SI assignments
- **Shift timings** — adjust shift start/end times
- **Duty categories** — manage the duty master list
- **Notifications** — configure alert thresholds (e.g. overdue task warning at X days)
- **Demo mode** — enable/disable demo accounts

---

## 12. User Manual — Android App

The Android app provides staff (and supervisors) with a mobile interface for the most frequently used features.

### First launch

1. Open the **Panjagutta Duty Management** app on your Android device.
2. On the **Server Configuration** screen, enter the backend API address:
   - If connecting to the Docker server on your office network: `http://192.168.x.x:8000` (replace with server IP)
   - The server address is saved automatically after first successful login.
3. Tap **Save**.

### Login

1. Enter your **username** and **password**.
2. Tap **Sign In**.
3. On success, you are taken to the **Home** tab.

### Home Tab

Displays a personal summary for the logged-in officer:
- **Today's shift** — shift code, timings, duty category assigned
- **Attendance status** — whether you are marked present for today
- **Pending leave** — count of leave requests awaiting decision
- **Active movements** — any open outside movements

### Roster Tab

- View your **personal duty schedule** for the current month.
- Tap any date to see the shift, duty category, and reporting time.

### Attendance Tab (Calendar)

- View your **monthly attendance** calendar.
- Each day shows Present (green), Absent (red), or No record (grey).
- Tap a day to see full details.

### Leave Tab

- View your **leave history** and status of pending requests.
- Tap **+ Apply Leave** to submit a new leave request.
- Fill in type, from/to dates, and reason, then tap **Submit**.

### Navigation

The bottom navigation bar has five tabs:
- 🏠 **Home** — personal summary
- 📅 **Roster** — duty schedule
- ✅ **Attendance** — attendance calendar
- 🗓️ **Leave** — leave management
- 🔔 **Notifications** — alerts and updates

### Signing out

Tap the **menu icon** (top right) → **Sign Out**.

---

## 13. Backup & Restore

### Automated backup

The `scripts/backup.sh` script creates an AES-256 encrypted, gzip-compressed PostgreSQL dump.

```bash
# Run manually
./scripts/backup.sh

# Output: backups/panjagutta_backup_YYYYMMDD_HHMMSS.sql.gz.gpg
```

**Schedule nightly backups with cron (Linux server):**
```bash
crontab -e
# Add this line:
0 2 * * * /path/to/scripts/backup.sh >> /var/log/panjagutta-backup.log 2>&1
```

### Restore (disaster recovery)

```bash
# Restore drill into a scratch database (safe — does not touch production)
./scripts/restore.sh backups/panjagutta_backup_20261103_020000.sql.gz.gpg --drill

# Full production restore (destructive — replaces the database)
./scripts/restore.sh backups/panjagutta_backup_20261103_020000.sql.gz.gpg
```

The restore script will prompt for the backup passphrase (from `BACKUP_PASSPHRASE` in `.env`).

---

## 14. CI / CD Pipeline

The repository includes a **GitHub Actions** workflow at `.github/workflows/ci.yml` that runs on every push and pull request to `main`.

### Pipeline stages

```
Push to main
    │
    ├── [Backend Tests]
    │       Install Python 3.11 + PostgreSQL 15
    │       Run Alembic upgrade, then downgrade, then upgrade (migration sanity)
    │       Run pytest (200+ tests)
    │
    ├── [Frontend Build]
    │       Install Node 20
    │       npm ci
    │       npm run lint
    │       npm run build (Next.js production build)
    │
    └── [Android Build]
            Set up JDK 17
            Run ./gradlew assembleDebug
```

All three stages must pass for a green build. Failures are reported directly in the GitHub PR.

---

## 15. Project Directory Structure

```
panjagutta-police-station/
│
├── backend/                          # FastAPI Python backend
│   ├── app/
│   │   ├── api/routes/               # All API route handlers
│   │   │   ├── auth.py               # Login, logout, change password, /me
│   │   │   ├── staff.py              # Staff register CRUD
│   │   │   ├── dashboard.py          # Operational dashboard summary
│   │   │   ├── roster.py             # Roster create/edit/approve/publish
│   │   │   ├── operations.py         # Attendance, Leave, Movements, Tasks
│   │   │   ├── duties.py             # Duty master categories
│   │   │   ├── attachments.py        # File upload/download
│   │   │   ├── reports.py            # PDF/Excel/CSV report generation
│   │   │   ├── audit.py              # Audit log query
│   │   │   ├── policy.py             # Policy document management
│   │   │   ├── mobile.py             # Mobile-optimised API endpoints
│   │   │   ├── notifications.py      # Alert and notification APIs
│   │   │   ├── config.py             # System configuration
│   │   │   └── ai.py                 # AI-assisted suggestions
│   │   ├── auth/
│   │   │   ├── dependencies.py       # FastAPI JWT auth dependencies
│   │   │   └── jwt.py                # JWT creation and verification
│   │   ├── db/
│   │   │   ├── database.py           # Async SQLAlchemy engine setup
│   │   │   ├── bootstrap.py          # First-run config data loader
│   │   │   ├── init_users.py         # Demo account auto-creation
│   │   │   └── seed.py               # Development seed data
│   │   ├── models/
│   │   │   └── models.py             # All SQLAlchemy ORM models
│   │   ├── services/
│   │   │   ├── availability.py       # Station strength calculation engine
│   │   │   ├── audit.py              # Audit log writer
│   │   │   ├── scheduler.py          # APScheduler background jobs
│   │   │   ├── shifts.py             # Shift time utilities
│   │   │   ├── notifications.py      # Alert generation
│   │   │   └── validation.py         # Business rule validation
│   │   └── main.py                   # FastAPI app, router registration, lifespan
│   ├── migrations/                   # Alembic migration scripts
│   ├── tests/                        # pytest test suite (200+ tests)
│   ├── requirements.txt              # Production Python dependencies
│   ├── requirements-dev.txt          # Dev + test dependencies
│   └── pytest.ini                    # Test configuration
│
├── frontend/                         # Next.js 16 web application
│   └── src/
│       ├── app/                      # App Router pages
│       │   ├── login/                # Login page
│       │   ├── dashboard/            # Operational dashboard
│       │   ├── staff/                # Staff register
│       │   ├── roster/               # Roster management
│       │   ├── attendance/           # Attendance + calendar
│       │   ├── leave/                # Leave management
│       │   ├── movements/            # Outside movements
│       │   ├── tasks/                # Task management
│       │   ├── duty-allocation/      # Duty master
│       │   ├── approvals/            # Approvals queue
│       │   ├── attachments/          # Document uploads
│       │   ├── reports/              # Report generation
│       │   ├── audit/                # Audit log viewer
│       │   ├── policy/               # Policy & workflow guide
│       │   ├── config/               # System configuration
│       │   ├── change-password/      # Password change
│       │   └── guide/                # In-app user guide
│       ├── components/
│       │   └── AppShell.tsx          # Navigation shell (sidebar + header)
│       └── lib/
│           ├── api.ts                # All backend API calls
│           ├── auth-context.tsx      # Authentication context + JWT storage
│           └── use-today.ts          # Client-side date hook
│
├── mobile-android/                   # Native Android application
│   ├── app/
│   │   └── src/main/
│   │       ├── java/com/panjagutta/dutymanagement/
│   │       │   ├── MainActivity.java  # Entire app: login, home, roster, attendance, leave
│   │       │   └── TokenStore.java    # Encrypted JWT storage on device
│   │       ├── res/
│   │       │   ├── drawable/          # Vector icons (attendance, roster, leave, etc.)
│   │       │   ├── mipmap-*/          # App launcher icons (all DPI densities)
│   │       │   └── values/            # strings.xml, styles.xml, launcher_colors.xml
│   │       └── AndroidManifest.xml
│   ├── build.gradle                   # Project-level Gradle config (AGP 8.7.0)
│   ├── app/build.gradle               # App-level Gradle config (API 23–35)
│   └── gradle/wrapper/                # Gradle 8.11.1 wrapper
│
├── docker/                           # Docker and proxy configuration
│   ├── Dockerfile.backend            # Python 3.11 multi-stage build
│   ├── Dockerfile.frontend           # Node 20 multi-stage build
│   ├── nginx.conf                    # nginx reverse proxy config
│   └── ensure-cert.sh                # Auto-generates self-signed TLS cert
│
├── docs/                             # Project documentation
│   ├── user-guide.md                 # Operational user guide
│   ├── security-and-deployment.md    # Hardening and deployment checklist
│   ├── policy-confirmation.md        # SHO sign-off sheet
│   ├── role-matrix-for-sho.md        # Role permissions matrix
│   ├── pilot-and-rollout-plan.md     # Phased deployment plan
│   ├── mobile-device-policy-draft.md # MDM policy for Android devices
│   └── build-guide-compliance-report.md
│
├── scripts/
│   ├── backup.sh                     # Encrypted nightly backup script
│   └── restore.sh                    # Decrypted restore with drill mode
│
├── .github/
│   └── workflows/ci.yml              # GitHub Actions CI pipeline
│
├── docker-compose.yml                # Full stack container definition
├── .env.example                      # Environment variable template
└── README.md                         # This file
```

---

## 16. Troubleshooting

### Docker: containers won't start

```bash
# Check what's running
docker ps -a

# View error logs
docker compose logs

# Rebuild from scratch
docker compose down -v
docker compose up -d --build
```

**Common cause:** `.env` file is missing or `POSTGRES_PASSWORD` / `JWT_SECRET_KEY` / `APP_SECRET_KEY` are not set.

---

### Backend: `Application startup complete` never appears

```bash
docker logs panjagutta_backend
```

Look for:
- `sqlalchemy.exc.OperationalError` — database connection failed. Check `POSTGRES_PASSWORD` matches in both `POSTGRES_PASSWORD` and `DATABASE_URL`.
- `JWT_SECRET_KEY is too short` — generate a longer secret (min. 32 chars).
- `Port already in use` — another service is using port 8000. Change the port mapping in `docker-compose.yml`.

---

### Frontend: blank page or API errors

1. Open browser DevTools (F12) → Console tab.
2. If you see `Failed to fetch` errors, the frontend cannot reach the backend.
3. In Docker: ensure `panjagutta_backend` is healthy — `docker ps` should show `(healthy)`.
4. In local dev: ensure `uvicorn` is running on port 8000 with no errors.

---

### Login fails with correct credentials

1. Verify `SEED_DEMO_DATA=true` was set **before** the first start.
2. Check if the account is locked: `docker logs panjagutta_backend | grep "locked"`.
3. If locked, wait 15 minutes or ask Super Admin to unlock.
4. Wipe demo data and re-seed:
   ```bash
   docker compose down -v
   # ensure SEED_DEMO_DATA=true in .env
   docker compose up -d
   ```

---

### Android: app shows "Connection refused"

1. Ensure the backend is running and accessible on the network.
2. If using an emulator, use `http://10.0.2.2:8000` (not `localhost`).
3. If using a physical device, use the PC's LAN IP (`ipconfig` / `ifconfig`).
4. Ensure the **firewall** allows port 8000 inbound on the server PC.
5. For Windows firewall:
   ```powershell
   New-NetFirewallRule -DisplayName "Panjagutta Backend" -Direction Inbound -LocalPort 8000 -Protocol TCP -Action Allow
   ```

---

### Gradle build fails: `Unsupported class file major version`

This means your JDK version is incompatible. The Gradle wrapper is set to 8.11.1 which requires JDK 17+.

1. In Android Studio: go to **File → Project Structure → SDK Location → Gradle JDK** and select JDK 17 or 21.
2. Or set `JAVA_HOME` to point to JDK 17/21 before running Gradle from the terminal.

---

### Port conflicts on Windows

If ports 80 or 443 are in use by IIS or another service:
```env
# In .env
HTTP_PORT=8080
HTTPS_PORT=8443
```
Then browse to `https://localhost:8443/`.

---

## 17. Security Notes

> **This system handles sensitive law enforcement staffing data. The following measures are essential before operational deployment.**

- **Change all default secrets** in `.env` before first use in any non-development environment.
- **Disable `SEED_DEMO_DATA`** in production. Set `SEED_DEMO_DATA=false`.
- **Install a proper TLS certificate** — replace the auto-generated self-signed cert in `docker/certs/` with a certificate from your department CA or a trusted CA.
- **Restrict database access** — the PostgreSQL port is not published to the host by default (correct). Do not change this.
- **Account lockout** is enabled after 5 failed attempts (15-minute lockout). Do not disable.
- **JWT tokens** expire after 8 hours of session time and 30 minutes of inactivity by default.
- **All API calls require authentication** — there are no public/anonymous endpoints except `/api/auth/login`.
- **Audit log** cannot be deleted or modified by any user role — it is enforced at the database trigger level.
- **Backup passphrases** must be stored securely offline (not in the same system as the backups).
- **Android app:** production builds use `allowCleartextTraffic=false` — officers must connect over HTTPS only.

---

## 18. Contributing

### Branching strategy

| Branch | Purpose |
|---|---|
| `main` | Production-ready code |
| `slides-and-mobile-application` | Mobile app and presentation assets |
| `feature/xxx` | Feature branches (merge to main via PR) |

### Development workflow

```bash
# 1. Fork the repo and clone
git clone https://github.com/YOUR_USERNAME/Panjagutta-Police-Station-AI-Duty-Management-Application.git

# 2. Create a feature branch
git checkout -b feature/your-feature-name

# 3. Make changes, run tests
cd backend && python -m pytest -q
cd frontend && npm run lint && npm run build

# 4. Commit with a clear message
git commit -m "feat(attendance): add monthly summary export to Excel"

# 5. Push and open a pull request
git push origin feature/your-feature-name
```

### Commit message convention

```
<type>(<scope>): <short description>

Types: feat | fix | docs | refactor | test | chore
Scopes: auth | staff | roster | attendance | leave | movement | task | reports | mobile | docker
```

---

## 19. License & Disclaimer

This application was built for **Panjagutta Police Station, Hyderabad City Police** as a duty management prototype.

> **Before operational use:** Shift rotation, rest period, and approval rules encoded in this system are provisional until formally signed off by the Station House Officer ([docs/policy-confirmation.md](docs/policy-confirmation.md)). A full department IT security review is required before handling live personnel data ([docs/security-and-deployment.md](docs/security-and-deployment.md)).

The bundled staff data in `backend/data/` is for evaluation and testing purposes only.

---

*Built with ❤️ for Hyderabad City Police — Panjagutta Police Station*
