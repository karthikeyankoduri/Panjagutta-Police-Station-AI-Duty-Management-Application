# Security & Deployment Guide — Panjagutta Police Station Duty Management

This document outlines the security architecture, role-based access control (RBAC), on-premises deployment instructions, and data protection practices for the Panjagutta Police Station application.

---

## 1. Role-Based Access Control (RBAC) Matrix

The system implements strict server-side authorization checks using FastAPI dependencies (`require_roles`):

| Module / Capability | SHO | DI | Admin SI | Sector SI | DSI | Staff |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Station Dashboard** | Full | Full | Full | Sector Only | Station Wide | Station Wide |
| **Staff Register (View)** | Full | Full | Full | Sector Only | Full | Full |
| **Add / Edit Staff Profile** | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| **Draft Roster** | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| **Submit Roster** | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| **Approve Roster** | ✓ (SHO Only) | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Publish Roster** | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| **Duty Allocation** | ✓ | ✓ | ✓ | Sector Patrols | ✗ | ✗ |
| **Attendance (Roll-Call)** | ✓ | ✓ | ✓ | Sector Roll | ✓ | View Own |
| **Leave Approval** | ✓ | ✗ | ✓ (CL) | ✗ | ✗ | Apply Own |
| **Outside Movement Auth** | ✓ | ✓ | ✓ | ✓ | ✗ | Log Own |
| **Task Assignment** | ✓ | ✓ | ✓ | Sector Tasks | ✗ | Update Status |
| **Attachment Orders** | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| **Station Policy Gate** | ✓ (SHO Only) | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Audit Trail Inspection** | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| **Reports & CSV Export** | ✓ | ✓ | ✓ | Sector Reports | ✓ | ✗ |

---

## 2. Authentication & Credential Security

1. **Password Hashing:**
   - Passwords are encrypted using salted `bcrypt` algorithms (`passlib.context.CryptContext`). Plaintext passwords are never stored or logged.
2. **Account Lockout Protection:**
   - The application monitors failed login attempts. After **5 consecutive failed attempts**, the account is locked for **15 minutes** to prevent brute-force attacks.
3. **JWT Session Revocation:**
   - Access tokens use a unique JWT identifier (`jti`). When a user logs out, their session is invalidated server-side in the `user_sessions` table.
4. **Rate Limiting:**
   - Auth endpoints are rate-limited per IP (20 attempts per 5-minute sliding window) to prevent automated credential stuffing.

---

## 3. Immutable Audit Trail

All sensitive state transitions are logged to the `audit_log` table:
- **Captured Data:** Timestamp (UTC), Actor username, User ID, Action code, Entity Type, Entity ID, JSON diff of old values, JSON diff of new values, Client IP address, and unique `X-Request-ID`.
- **Immutability:** No API endpoint exists to update or delete audit records. Ordinary database users are granted `SELECT` and `INSERT` privileges only.

---

## 4. On-Premises & Private Cloud Deployment

The application is designed for complete self-containment with **zero external internet dependencies**:
- **Local Database:** PostgreSQL 15 on local server or dedicated station network.
- **AI Operations:** The AI Advisory and Natural Language Query Copilot operates entirely locally with rule-based heuristics and local mock fallbacks. No police operational data or officer PII is ever transmitted to external third-party cloud APIs.
- **Air-Gapped Operation:** Can run completely within the Telangana Police internal intranet (CCTNS network).

### Production Docker Deployment Commands

```bash
# 1. Clone repository into station deployment server
cd "panjagutta ai application"

# 2. Configure environment secrets
cp backend/.env.example backend/.env
# Edit .env with strong production database passwords and SECRET_KEY

# 3. Build and launch services in background
docker compose up -d --build

# 4. Run database migrations
docker compose exec backend alembic upgrade head

# 5. Seed initial configuration and demo accounts
docker compose exec backend python -m app.db.seed

# 6. Verify health
curl http://localhost:8000/api/health
```

---

## 5. Backup and Disaster Recovery

### Automated Nightly Database Dump

```bash
# Backup command
docker compose exec -T db pg_dump -U postgres -d panjagutta_duty_db > "backup_panjagutta_$(date +%Y%m%d_%H%M%S).sql"

# Restore command
docker compose exec -T db psql -U postgres -d panjagutta_duty_db < backup_panjagutta_YYYYMMDD.sql
```
