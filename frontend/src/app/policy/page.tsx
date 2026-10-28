"use client";
import { useEffect, useState, useCallback } from "react";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import {
  getPolicyStatus,
  confirmPolicy,
  enableDemoMode,
  PolicyStatusData,
} from "@/lib/api";

export default function PolicyPage() {
  const { token, user } = useAuth();
  const [policy, setPolicy] = useState<PolicyStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form State
  const [rotationSeq, setRotationSeq] = useState("A->B->C");
  const [minRestHours, setMinRestHours] = useState(16.0);
  const [dutyOffHours, setDutyOffHours] = useState(24.0);
  const [policyNotes, setPolicyNotes] = useState(
    "Station House Officer formal approval of shift rotation rules and mandatory rest intervals."
  );

  const fetchPolicy = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await getPolicyStatus(token);
      setPolicy(data);
      if (data.rotation_sequence) setRotationSeq(data.rotation_sequence);
      if (data.min_rest_hours_after_shift) setMinRestHours(data.min_rest_hours_after_shift);
      if (data.duty_off_after_shift_b_hours) setDutyOffHours(data.duty_off_after_shift_b_hours);
    } catch (err: any) {
      setError(err.message || "Failed to load policy data");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchPolicy();
  }, [fetchPolicy]);

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setError(null);
    try {
      await confirmPolicy(token, {
        rotation_sequence: rotationSeq,
        min_rest_hours_after_shift: minRestHours,
        duty_off_after_shift_b_hours: dutyOffHours,
        notes: policyNotes,
      });
      setSuccess("Station duty rotation policy formally confirmed by SHO. Policy Gate cleared.");
      fetchPolicy();
    } catch (err: any) {
      setError(err.message || "Failed to confirm policy");
    }
  };

  const handleEnableDemo = async () => {
    if (!token) return;
    setError(null);
    try {
      await enableDemoMode(token);
      setSuccess("Demo simulation mode activated. Prototype notice banner displayed.");
      fetchPolicy();
    } catch (err: any) {
      setError(err.message || "Failed to activate demo mode");
    }
  };

  const isSho = user?.role === "SHO";

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Station Policy &amp; Parameters</h1>
          <div className="page-subtitle">
            Statutory shift timings, rotation intervals, and mandatory Section 1 Policy Gate sign-off.
          </div>
        </div>
      </div>

      {error && <div className="alert-banner alert-banner--warning" style={{ marginBottom: "16px" }}>{error}</div>}
      {success && <div className="alert-banner alert-banner--info" style={{ marginBottom: "16px" }}>{success}</div>}

      {/* Policy Gate Status Banner */}
      {policy && (
        <div
          className={`alert-banner ${
            policy.policy_status === "confirmed"
              ? "alert-banner--info"
              : policy.policy_status === "demo_simulated"
              ? "alert-banner--warning"
              : "alert-banner--warning"
          }`}
          style={{ marginBottom: "20px" }}
        >
          <div style={{ fontWeight: 600, fontSize: "14px" }}>
            {policy.policy_status === "confirmed" && "✓ Policy Confirmed by SHO — Roster Publication Unlocked"}
            {policy.policy_status === "demo_simulated" && "⚠ Demo Simulation Mode Active — For Prototype Evaluation Only"}
            {policy.policy_status === "unconfirmed" && "🔒 Policy Unconfirmed — Roster Publication Gate is Blocked"}
          </div>
          <div style={{ fontSize: "12px", marginTop: "4px" }}>
            {policy.policy_status === "confirmed"
              ? `Formal sign-off recorded at ${policy.confirmed_at ? new Date(policy.confirmed_at).toLocaleString() : "Confirmed"}.`
              : "According to Telangana Police Standing Orders and Section 1 of the spec, operational duty rosters require formal SHO authorization or explicit demo mode acknowledgement."}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "20px" }}>
        {/* Left: Policy Sign-Off Form */}
        <div className="card">
          <div className="card__header">
            <span className="card__title">SHO Rotation Policy Sign-Off</span>
          </div>
          <form onSubmit={handleConfirm} className="card__body">
            <div className="form-group" style={{ marginBottom: "16px" }}>
              <label className="form-label">Duty Rotation Sequence</label>
              <input
                type="text"
                className="form-control"
                value={rotationSeq}
                onChange={(e) => setRotationSeq(e.target.value)}
                disabled={!isSho}
              />
              <div style={{ fontSize: "11px", color: "#64748b", marginTop: "4px" }}>
                Default: Shift A (Morning) &rarr; Shift B (Evening) &rarr; Shift C (Night)
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
              <div className="form-group">
                <label className="form-label">Minimum Rest Hours (Between Shifts)</label>
                <input
                  type="number"
                  step="0.5"
                  className="form-control"
                  value={minRestHours}
                  onChange={(e) => setMinRestHours(parseFloat(e.target.value))}
                  disabled={!isSho}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Duty-Off After Shift B (Hours)</label>
                <input
                  type="number"
                  step="0.5"
                  className="form-control"
                  value={dutyOffHours}
                  onChange={(e) => setDutyOffHours(parseFloat(e.target.value))}
                  disabled={!isSho}
                />
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: "20px" }}>
              <label className="form-label">SHO Authorization Remarks</label>
              <textarea
                className="form-control"
                rows={3}
                value={policyNotes}
                onChange={(e) => setPolicyNotes(e.target.value)}
                disabled={!isSho}
              />
            </div>

            <div style={{ display: "flex", gap: "12px" }}>
              {isSho ? (
                <button type="submit" className="btn btn-primary" id="btn-confirm-policy">
                  ✓ Officially Confirm Policy (SHO)
                </button>
              ) : (
                <div style={{ fontSize: "12px", color: "#94a3b8", alignSelf: "center" }}>
                  Only Station House Officer (SHO) can execute formal policy confirmation.
                </div>
              )}

              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleEnableDemo}
                id="btn-demo-mode"
              >
                Toggle Demo Simulation Mode
              </button>
            </div>
          </form>
        </div>

        {/* Right: Station Shifts Configuration */}
        <div className="card">
          <div className="card__header">
            <span className="card__title">Station Shift Timings (PDF Page 4)</span>
          </div>
          <div className="card__body" style={{ padding: 0 }}>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Shift</th>
                    <th>Hours</th>
                    <th>Duration</th>
                    <th>Crosses Midnight</th>
                  </tr>
                </thead>
                <tbody>
                  {policy?.shifts?.map((s) => (
                    <tr key={s.shift_code}>
                      <td><strong style={{ color: "#38bdf8" }}>Shift {s.shift_code}</strong></td>
                      <td>{s.start_time} &ndash; {s.end_time}</td>
                      <td>{s.duration_hours} hrs</td>
                      <td>{s.crosses_midnight ? <span className="badge badge-warning">Yes</span> : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ padding: "16px", borderTop: "1px solid #1e293b", fontSize: "12px", color: "#94a3b8" }}>
              <strong>Station Architecture Note:</strong><br />
              Shifts are 8-hour continuous deployments across 3 cycles per 24 hours. The shift definitions are stored centrally in the database to prevent hardcoded client-side assumptions.
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
