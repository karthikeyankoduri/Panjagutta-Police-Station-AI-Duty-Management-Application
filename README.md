# Panjagutta Police Station — Duty Management System

Centralized duty management for Panjagutta Police Station, Hyderabad City Police: staff register, versioned shift rosters with rule checks and SHO approval, attendance, leave, outside movements, tasks, attachments, a live availability dashboard, reports and an audit trail. Staff use the web app or the Android app.

> **Before operational use:** the rotation, rest and approval rules are provisional until the SHO signs [docs/policy-confirmation.md](docs/policy-confirmation.md), and the bundled staff data is for evaluation. A department security review is required ([docs/security-and-deployment.md](docs/security-and-deployment.md)).

## Architecture

```
Browser (Next.js 16)        Android app (Java)
        │  HTTPS                    │  HTTPS
        └────────────┬──────────────┘
              nginx (TLS, /  and /api)
                     │
             FastAPI backend ── APScheduler jobs (overdue, stalled, expired attachments)
                     │
              PostgreSQL 15 (Alembic migrations, append-only audit trigger)
```

| Layer | Technology |
|:--|:--|
| Web | Next.js 16 (App Router), React 19, TypeScript |
| Android | Native Java, minSdk 23, targetSdk 35 |
| API | Python 3.11, FastAPI, SQLAlchemy 2 (async), Pydantic 2 |
| Database | PostgreSQL 15 (SQLite for local development only) |
| Jobs | APScheduler |
| Reports | Server-side PDF (ReportLab), Excel (openpyxl), CSV |
| Deployment | Docker Compose with an nginx HTTPS proxy |

## Quick start (Docker — one command)

```bash
cp .env.example .env          # set every CHANGE value; generate secrets with: openssl rand -base64 48
docker compose up -d --build
```

Open `https://localhost/` (a self-signed certificate is created for evaluation; install the department certificate in `docker/certs/` for real use). The API docs are at `https://localhost/api/docs`.

On first start the backend applies migrations and loads the Build Guide §4 configuration (sectors, shifts, duty requirements, lists). With `SEED_DEMO_DATA=false` (the default in `.env.example`) no demo accounts exist — import the staff register as the first administrator, or set `SEED_DEMO_DATA=true` and `APP_ENV=development` on an evaluation server.

## Local development

```bash
# Backend
cd backend
python -m venv .venv && .venv\Scripts\activate      # Linux/macOS: source .venv/bin/activate
pip install -r requirements-dev.txt
copy .env.example .env                                # SQLite works: DATABASE_URL=sqlite+aiosqlite:///./panjagutta_local.db
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
python -m app.db.seed                                 # optional demo staff and accounts (development only)

# Web
cd frontend
npm install
npm run dev                                           # http://localhost:3000 (calls the API on port 8000)

# Android (debug build may use http:// for a development server)
cd mobile-android
./gradlew assembleDebug -PAPI_BASE_URL=http://<your-pc-ip>:8000
```

### Demo accounts (development only, `SEED_DEMO_DATA=true`)

| Role | Username | Password |
|:--|:--|:--|
| SHO | `sho_demo` / `sho_panjagutta` | `Demo@SHO#2024!` / `Password@PJ2024!` |
| Admin SI | `admin_si_demo` | `Demo@AdminSI#2024!` |
| Sector 1 SI | `sector1_si_demo` | `Demo@Sec1SI#2024!` |
| DI | `di_demo` | `Demo@DI#2024!` |
| DSI | `dsi_demo` | `Demo@DSI#2024!` |
| Staff | `staff_demo` | `Demo@Staff#2024!` |

Imported staff sign in with their station ID and the provisioning password, and must set their own password at first sign-in. Demo accounts are never created when `APP_ENV=production`.

## Tests and CI

```bash
cd backend && python -m pytest -q          # 200+ tests: availability engine, every validation rule, roles, scenarios, auth, audit, exports
cd frontend && npm run lint && npm run build
cd mobile-android && ./gradlew assembleDebug
```

GitHub Actions (`.github/workflows/ci.yml`) runs all three on every push, plus an Alembic upgrade/downgrade/upgrade check against PostgreSQL.

## Backups

```bash
scripts/backup.sh                                        # encrypted (AES-256) nightly dump
scripts/restore.sh backups/<file>.sql.gz.gpg --drill     # restore drill into a scratch database
```

## Documentation

- [Build Guide](docs/Panjagutta%20AI%20Application%20Police%20Station%20Staff%20Duty%20Management%20Application%20Build%20Guide.md) — the specification
- [Compliance report](docs/build-guide-compliance-report.md) — what is implemented against the guide
- [Requirements traceability](docs/requirements-traceability.md) — guide sections and blueprint steps → code → tests
- [SHO rules sheet](docs/policy-confirmation.md) — decisions to sign before operational use
- [Role matrix for SOP §10](docs/role-matrix-for-sho.md)
- [Security and deployment](docs/security-and-deployment.md) — access control, audit, HTTPS, backups, hardening checklist
- [Pilot and rollout plan](docs/pilot-and-rollout-plan.md)
- [Mobile device policy (draft)](docs/mobile-device-policy-draft.md)
- [User guide](docs/user-guide.md) — and the in-app **Workflow Guide**
