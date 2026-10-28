"use client";
import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

const QUICK_ACCOUNTS = [
  { username: "admin_si_demo", label: "Admin SI", password: "Demo@AdminSI#2024!" },
  { username: "pg-001", label: "Station SHO (pg-001)", password: "Password@PJ2024!" },
];

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
      router.push("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed. Check credentials.");
    } finally {
      setLoading(false);
    }
  };

  const handleQuickLogin = async (acc: typeof QUICK_ACCOUNTS[0]) => {
    setUsername(acc.username);
    setPassword(acc.password);
    setError("");
    setLoading(true);
    try {
      await login(acc.username, acc.password);
      router.push("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed. Check credentials.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Logo / Header */}
        <div className="login-card__logo">
          <div style={{ fontSize: 36, marginBottom: 8 }}>🚔</div>
          <div className="login-card__station-name">Panjagutta Police Station</div>
          <div className="login-card__system-name">AI Duty Management System</div>
        </div>

        {/* Demo warning */}
        <div className="login-card__demo-notice">
          ⚠ <strong>PANJAGUTTA POLICE STATION PORTAL</strong><br />
          Sign in using your assigned credentials or Station ID.
        </div>

        {/* Login form */}
        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label className="form-label" htmlFor="username">
              Station ID / Username / Employee ID / Email
            </label>
            <input
              id="username"
              type="text"
              className="form-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. pg-001, 1417195, or admin_si_demo"
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

          {/* Credential Helper Info */}
          <div
            style={{
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              borderRadius: 8,
              padding: "10px 12px",
              marginBottom: 16,
              fontSize: 12,
              color: "#1e40af",
              lineHeight: 1.5,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 2 }}>🔑 Imported Personnel Credentials:</div>
            <div>• <strong>Login ID:</strong> Station ID (e.g. <code>pg-001</code>), HRMS Employee ID, or Email</div>
            <div>• <strong>Default Password:</strong> <code>Password@PJ2024!</code></div>
          </div>

          {error && (
            <div role="alert" style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", color: "#991b1b", fontSize: 13, marginBottom: 16 }}>
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
        </form>

        {/* Quick Login Shortcuts */}
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10, textAlign: "center" }}>
            Quick Access Logins
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {QUICK_ACCOUNTS.map((acc) => (
              <button
                key={acc.username}
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => handleQuickLogin(acc)}
                disabled={loading}
                style={{ justifyContent: "center", fontSize: 11, padding: "6px 8px" }}
                id={`demo-${acc.username}`}
                title={`Login as ${acc.label} (${acc.username})`}
              >
                {acc.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
