# Security & Deployment Guide — Panjagutta Police Station Duty Management

How access is controlled, how the audit trail is protected, and how to deploy, back up and restore the system. Everything below describes the code as it is; items that still need a department decision are marked **Decision pending**.

---

## 1. Role-based access (enforced in the API)

Every permission is checked on the server (`backend/app/auth/dependencies.py`: `require_roles`, `ensure_staff_in_scope`, `sector_scope`, `can_view_contact`). The web and Android menus only hide what a role cannot use. The matrix is **provisional** until reconciled with SOP section 10 (Build Guide §14 item 6); see [role-matrix-for-sho.md](role-matrix-for-sho.md).

| Capability | SHO | Admin SI | Sector SI | DI / DSI | Staff |
|:--|:-:|:-:|:-:|:-:|:-:|
| Dashboard, shift views, alerts, reports | All | All | Own sector | All (read) | — |
| Staff register: view | All | All | Own sector | All | Names only |
| Contact phone / notes | ✓ | ✓ | Own sector | — | Own only |
| Add / edit staff, reset passwords | ✓ | ✓ | — | — | — |
| Create / edit draft roster, allocate duties | ✓ | ✓ | View drafts | — | — |
| Submit roster for approval | — | ✓ | — | — | — |
| Approve / return roster | ✓ | — | — | — | — |
| Publish roster, create new version | ✓ | ✓ | — | — | — |
| See unpublished (draft/submitted/approved) rosters | ✓ | ✓ | ✓ | — | — |
| Authorize a rule exception (set in rotation rule) | ✓ | ✓* | — | — | — |
| Attendance: submit own | ✓ | ✓ | ✓ | ✓ | ✓ |
| Attendance: verify / roll-call / bulk confirm | ✓ | ✓ | Own sector | Roll-call only | — |
| Leave: request | For anyone | For anyone | Own sector | Own | Own |
| Leave: approve / reject | ✓ | ✓ | — | — | — |
| Leave: cancel | ✓ | ✓ | — | Own | Own (pending, or approved before it starts) |
| Movement: request | — | — | — | — | Own (needs authorization) |
| Movement: log (pre-authorized) | ✓ | ✓ | Own sector | ✓ | — |
| Movement: authorize / reject | ✓ | ✓ | Own sector | — | — |
| Movement: record return | ✓ | ✓ | Own sector | ✓ | Own |
| Tasks: create, reassign, set reporting officer | ✓ | ✓ | Own sector | — | — |
| Tasks: update progress | ✓ | ✓ | Own sector | — | Own (cannot cancel) |
| Attachments: view | ✓ | ✓ | Own sector | ✓ | — |
| Attachments: create / end | ✓ | ✓ | — | — | — |
| Policy gate, rotation rules | Confirm | Demo mode only | — | — | — |
| Shift timings, duty requirements, sectors, sections, lists | ✓ | ✓ | — | — | — |
| Audit log | ✓ | ✓ | — | — | — |
| AI copilot (read-only) | ✓ | ✓ | ✓ | ✓ | — |

\* Only when the confirmed rotation rule names Admin SI as an exception authorizer; by default SHO and Admin SI may authorize, and an Admin SI can never authorize their own allocation.

---

## 2. Authentication and sessions

- **Passwords** are hashed with salted bcrypt (`backend/app/auth/jwt.py`, `bcrypt` library). Plaintext passwords are never stored or written to the audit log (`app/services/audit.py` strips keys containing password, token, secret, hashed or otp).
- **Password rules:** at least 10 characters, letters and numbers, must not contain the username, must differ from the current and the shared default password.
- **First-time and reset passwords:** accounts created or reset by an administrator, and any account signing in with the shared provisioning password, are flagged *must change password*. Until it is changed the API refuses every request except password change, profile and logout (HTTP 403 with `X-Password-Change-Required`). The web app and the Android app open the change-password screen automatically.
- **Lockout:** 5 consecutive failed attempts lock the account for 15 minutes (`AUTH_MAX_FAILED_ATTEMPTS`, `AUTH_LOCKOUT_MINUTES`).
- **Rate limit:** 20 sign-in attempts per IP address per 5 minutes on `/api/auth/login` (in-memory; use a shared store if several API workers run).
- **Every attempt is audited:** success, wrong password, unknown username, blocked (locked or inactive) and lockout.
- **Tokens:** JWT with a unique `jti` recorded in `user_sessions`. Logout (web and Android) invalidates the session on the server; the token cannot be reused.
- **Inactivity timeout:** the server expires a session after `AUTH_INACTIVITY_TIMEOUT_MINUTES` (default 60; 30 in the Docker template) and audits it. The web app warns one minute before and signs out; the Android app signs out when reopened after the limit.
- **Drafts survive logout:** unsaved duty allocations are stored server-side per user (`/api/auth/drafts`) and offered for restore on the next sign-in.
- **No backdoor passwords:** the earlier demo password aliases (`admin123`, `staff123`, etc.) were removed. Demo accounts exist only when `SEED_DEMO_DATA=true` outside production.
- **Production guard:** with `APP_ENV=production` the API refuses to start if `JWT_SECRET_KEY` is shorter than 32 characters or a placeholder, `SEED_DEMO_DATA` is true, `APP_DEBUG` is true, or the database is SQLite.
- **OTP:** optional in the Build Guide; **not implemented** (Decision pending: whether OTP is required, and which SMS/authenticator channel is approved).

---

## 3. Audit trail

- `audit_log` records actor, action, entity, timestamp, old and new values, authorizer, exception reason, client IP and request ID.
- Writes covered: sign-in/out, password change, staff, rosters (create, assignment changes with added/removed lists, submit, approve, return, revise, publish with superseded versions), every authorized rule exception (one row each, with the authorizing officer and reason), attendance (including bulk confirmation), leave, movements, tasks, attachments, policy, shift timings, duty requirements, sectors, sections, list labels, alert raise/resolve, scheduler flags.
- **Protection layers:**
  1. No API route updates or deletes audit rows.
  2. An application-level guard refuses any ORM update or delete of an `AuditLog` row.
  3. The Alembic baseline installs a PostgreSQL trigger that rejects `UPDATE` on `audit_log`.
  4. Run the application with a database role that has only `SELECT, INSERT` on `audit_log` (see §6).
- **Known exception:** the *Wipe Demo Data* tool on the Staff page clears the audit log together with demo records. It is kept as requested for evaluation use; do not use it on an operational system, and consider removing it before go-live.

---

## 4. Deployment (Docker, one command)

```bash
cp .env.example .env          # then set every CHANGE value (generate with: openssl rand -base64 48)
docker compose up -d --build  # db + backend + frontend + HTTPS proxy
```

On first start the backend applies migrations (`alembic upgrade head`), creates any missing tables and loads the Build Guide §4 configuration (5 sectors, shifts A/B/C, duty requirements, sections, status lists, an **unconfirmed** rotation rule). No seed step is needed. Open `https://<server>/`.

- **HTTPS:** the `proxy` service (nginx) terminates TLS on 443 and redirects 80 → 443, adds HSTS and security headers, and serves the web app on `/` and the API on `/api`. Put the department certificate in `docker/certs/server.crt` and `server.key`; if none is present a self-signed certificate is generated for evaluation only.
- **Database isolation:** PostgreSQL is not published on the host; only the backend can reach it.
- **Containers:** the backend runs as an unprivileged user.
- **First administrator:** create the SHO / Admin SI accounts through the staff import or `python -m app.db.seed` on a non-production copy; with `SEED_DEMO_DATA=false` no demo accounts are created.
- **Android app:** build with `./gradlew assembleRelease -PAPI_BASE_URL=https://<server>`. Release builds only connect over HTTPS (network security config + in-app check); the session token is encrypted with an Android Keystore key.

### Existing databases

A database created before migrations were introduced can adopt them with `alembic stamp 0001_baseline`. New tables (notifications, sections, configuration lists) are created automatically at startup.

---

## 5. Encrypted backups and restore drill

```bash
scripts/backup.sh                                   # pg_dump | gzip | gpg AES-256 → backups/*.sql.gz.gpg (+ .sha256)
scripts/restore.sh backups/<file>.sql.gz.gpg --drill # restores into a scratch DB, prints row counts, drops it
scripts/restore.sh backups/<file>.sql.gz.gpg         # restores into the live DB (asks for confirmation)
```

- Schedule `backup.sh` nightly with cron on the host (example in the script header). Retention defaults to 30 days (`KEEP_DAYS`).
- Keep `BACKUP_PASSPHRASE` offline as well as in `.env`; without it the backups cannot be read.
- Copy the `backups/` folder to separate storage each day.
- **Restore drill:** run `restore.sh --drill` monthly; each run is appended to `backups/restore-drills.log`. Blueprint step 28 is "done" when a drill restores to a working system.

---

## 6. Hardening checklist before go-live

- [ ] Department TLS certificate installed; self-signed certificate removed.
- [ ] `.env` secrets generated and stored by IT; `.env` not in Git.
- [ ] Application database role limited to `SELECT, INSERT` on `audit_log` (example below).
- [ ] *Wipe Demo Data* tool removed or disabled; `SEED_DEMO_DATA=false`; frontend built with `NEXT_PUBLIC_DEMO_MODE=false` (the Docker build does this).
- [ ] Shared provisioning password changed for every imported account (enforced at first sign-in).
- [ ] Nightly backup scheduled and first restore drill passed.
- [ ] Security review by the department (Build Guide step 28).

```sql
-- Run as the database owner after migrations. 'panjagutta_app' is the role the API connects as.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM panjagutta_app;
GRANT SELECT, INSERT ON audit_log TO panjagutta_app;
GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq TO panjagutta_app;
```

---

## 7. Data protection and AI

- The system runs entirely on department infrastructure; nothing is sent to external services.
- The AI copilot is rule-based, read-only and restricted to officers. No external language model is configured (`AI_PROVIDER=none`). Any future model must be on-premise or department-approved (Build Guide §11 guardrail 7).
- Contact details are returned only to the SHO, Admin SI, the person's own Sector SI and the person themselves.
- Staff data files containing personal details must not be placed in the web app's public folder. The proforma template is now served only through the API (`/api/staff/download-template`), but that endpoint does **not** yet require sign-in and returns `backend/data/panjagutta_140_police_staff.csv`, which contains personal details and a password column. Replace that file with a blank template, or require sign-in on the endpoint, before go-live.
- The staff CSV removed from `frontend/public/` remains in earlier Git commits; purge it from history (for example with `git filter-repo --path frontend/public/panjagutta_140_police_staff.csv --invert-paths`) before the repository is shared further.
