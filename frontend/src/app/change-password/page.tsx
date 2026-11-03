"use client";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { changePassword } from "@/lib/api";

function problem(pw: string, username: string): string | null {
  if (pw.length < 10) return "At least 10 characters";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "Use both letters and numbers";
  if (username && pw.toLowerCase().includes(username.toLowerCase())) return "Must not contain your username";
  return null;
}

export default function ChangePasswordPage() {
  const { token, user, isLoading, markPasswordChanged, logout } = useAuth();
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isLoading && !token) router.replace("/login");
  }, [isLoading, token, router]);

  const rule = next ? problem(next, user?.username || "") : null;
  const mismatch = confirm && next !== confirm;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (rule || mismatch) return;
    setSaving(true);
    setError("");
    try {
      await changePassword(token, current, next);
      markPasswordChanged();
      router.replace(user?.role === "STAFF" ? "/roster" : "/dashboard");
    } catch (err: any) {
      setError(err.message || "Could not change password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-card__logo">
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔐</div>
          <div className="login-card__station-name">Set your password</div>
          <div className="login-card__system-name">
            {user?.must_change_password ? "Required before you can continue" : "Change your password"}
          </div>
        </div>
        <form onSubmit={submit} noValidate>
          <div className="form-group">
            <label className="form-label" htmlFor="current">Current (temporary) password</label>
            <input id="current" type="password" className="form-input" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="new">New password</label>
            <input id="new" type="password" className="form-input" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" aria-describedby="pw-rules" required />
            <div id="pw-rules" style={{ fontSize: 12, marginTop: 4, color: rule ? "#b45309" : "#16a34a" }}>
              {next ? (rule ? `✗ ${rule}` : "✓ Meets the password rules") : "At least 10 characters, letters and numbers, not your username."}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="confirm">Confirm new password</label>
            <input id="confirm" type="password" className="form-input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
            {mismatch && <div style={{ fontSize: 12, marginTop: 4, color: "#b91c1c" }}>Passwords do not match</div>}
          </div>
          {error && <div role="alert" className="alert-banner alert-banner--warning" style={{ marginBottom: 12 }}>{error}</div>}
          <button type="submit" className="btn btn-primary btn-lg" style={{ width: "100%", justifyContent: "center" }}
            disabled={saving || !current || !next || !confirm || Boolean(rule) || Boolean(mismatch)}>
            {saving ? "Saving…" : "Save new password"}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" style={{ width: "100%", justifyContent: "center", marginTop: 10 }}
            onClick={async () => { await logout(); router.replace("/login"); }}>
            Sign out instead
          </button>
        </form>
      </div>
    </div>
  );
}
