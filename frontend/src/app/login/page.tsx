"use client";
import { useEffect, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

// Evaluation shortcuts. Hidden when the frontend is built with NEXT_PUBLIC_DEMO_MODE=false (production).
const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
const QUICK_ACCOUNTS = [
  { username: "admin_si_demo", label: "Admin SI", password: "Demo@AdminSI#2024!" },
  { username: "sho_panjagutta", label: "Station SHO", password: "Password@PJ2024!" },
  { username: "staff_demo", label: "Staff Demo", password: "Demo@Staff#2024!" },
];

function landingFor(user: { role: string; must_change_password: boolean }) {
  if (user.must_change_password) return "/change-password";
  return user.role === "STAFF" ? "/roster" : "/dashboard";
}

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("expired")) {
      setNotice("Your session ended (signed out or inactive). Please sign in again.");
    }
  }, []);

  const doLogin = async (u: string, p: string) => {
    setError("");
    setLoading(true);
    try {
      const loggedInUser = await login(u, p);
      router.push(landingFor(loggedInUser));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed. Check credentials.");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("Enter your station ID and password.");
      return;
    }
    doLogin(username.trim(), password);
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-card__logo">
          <div style={{ fontSize: 36, marginBottom: 8 }}>🚔</div>
          <div className="login-card__station-name">Panjagutta Police Station</div>
          <div className="login-card__system-name">Hyderabad City Police · Duty Management</div>
        </div>

        <div className="login-card__demo-notice">
          <strong>AUTHORIZED PERSONNEL ONLY</strong><br />
          Sign in with your assigned credentials. Every sign-in attempt is recorded.
        </div>

        {notice && (
          <div role="status" className="alert-banner alert-banner--info" style={{ marginBottom: 12 }}>{notice}</div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label className="form-label" htmlFor="username">Station ID / Username / Service Number</label>
            <input
              id="username"
              type="text"
              className="form-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. pg-001"
              autoComplete="username"
              required
              disabled={loading}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoComplete="current-password"
              required
              disabled={loading}
            />
          </div>

          {error && (
            <div role="alert" style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", color: "#991b1b", fontSize: 13, marginBottom: 16 }}>
              {error.toLowerCase().includes("locked") && <strong>🔒 Account locked. </strong>}
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-lg"
            style={{ width: "100%", justifyContent: "center" }}
            disabled={loading || !username || !password}
            id="login-submit"
          >
            {loading ? <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Signing in...</> : "Sign In"}
          </button>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 10, textAlign: "center" }}>
            Accounts lock after 5 failed attempts. First-time users must set a new password.
          </div>
        </form>

        {DEMO_MODE && (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10, textAlign: "center" }}>
              Evaluation accounts (demo builds only)
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
              {QUICK_ACCOUNTS.map((acc) => (
                <button
                  key={acc.username}
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => { setUsername(acc.username); setPassword(acc.password); doLogin(acc.username, acc.password); }}
                  disabled={loading}
                  style={{ justifyContent: "center", fontSize: 11, padding: "6px 4px" }}
                  id={`demo-${acc.username}`}
                  title={`Login as ${acc.label} (${acc.username})`}
                >
                  {acc.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
