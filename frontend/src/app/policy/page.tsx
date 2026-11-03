"use client";
import { useEffect, useState, useCallback } from "react";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import {
  getPolicyStatus,
  confirmPolicy,
  enableDemoMode,
  updateShiftConfig,
  formatApiError,
  PolicyStatusData,
} from "@/lib/api";

export default function PolicyPage() {
  const { token, user } = useAuth();
  const [policy, setPolicy] = useState<PolicyStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingShift, setSavingShift] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form State
  const [rotationSeq, setRotationSeq] = useState("A->B->C");
  const [minRestHours, setMinRestHours] = useState(16.0);
  const [dutyOffHours, setDutyOffHours] = useState(24.0);
  const [policyNotes, setPolicyNotes] = useState(
    "Station House Officer formal approval of shift rotation rules and mandatory rest intervals."
  );
  const [permittedExceptions, setPermittedExceptions] = useState("");
  const [authorizerRole, setAuthorizerRole] = useState("SHO");
  const [effectiveFrom, setEffectiveFrom] = useState("");

  // Shift Timing Editing State
  const [editingShiftCode, setEditingShiftCode] = useState<string | null>(null);
  const [editStartTime, setEditStartTime] = useState("");
  const [editEndTime, setEditEndTime] = useState("");

  const fetchPolicy = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await getPolicyStatus(token);
      setPolicy(data);
      if (data.rotation_sequence) setRotationSeq(data.rotation_sequence);
      if (data.min_rest_hours_after_shift) setMinRestHours(data.min_rest_hours_after_shift);
      if (data.duty_off_after_shift_b_hours) setDutyOffHours(data.duty_off_after_shift_b_hours);
      if (data.permitted_exceptions) setPermittedExceptions(data.permitted_exceptions);
      if (data.exception_authorizer_role) setAuthorizerRole(data.exception_authorizer_role);
      if (data.effective_from) setEffectiveFrom(data.effective_from);
    } catch (err: any) {
      setError(formatApiError(err, "Failed to load policy data"));
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
    setSuccess(null);
    try {
      await confirmPolicy(token, {
        rotation_sequence: rotationSeq,
        min_rest_hours_after_shift: minRestHours,
        duty_off_after_shift_b_hours: dutyOffHours,
        permitted_exceptions: permittedExceptions || null,
        exception_authorizer_role: authorizerRole || null,
        effective_from: effectiveFrom || null,
        notes: policyNotes,
      });
      setSuccess("Station duty rotation policy formally confirmed by SHO. Policy Gate cleared.");
      fetchPolicy();
    } catch (err: any) {
      setError(formatApiError(err, "Failed to confirm policy"));
    }
  };

  const handleEnableDemo = async () => {
    if (!token) return;
    setError(null);
    setSuccess(null);
    try {
      await enableDemoMode(token);
      setSuccess("Demo simulation mode activated. Prototype notice banner displayed.");
      fetchPolicy();
    } catch (err: any) {
      setError(formatApiError(err, "Failed to activate demo mode"));
    }
  };

  const handleStartEditShift = (shift: { shift_code: string; start_time: string; end_time: string }) => {
    setEditingShiftCode(shift.shift_code);
    setEditStartTime(shift.start_time.slice(0, 5));
    setEditEndTime(shift.end_time.slice(0, 5));
  };

  const handleSaveShiftTiming = async (shiftCode: string) => {
    if (!token) return;
    setSavingShift(true);
    setError(null);
    setSuccess(null);
    try {
      const [sh, sm] = editStartTime.split(":").map(Number);
      const [eh, em] = editEndTime.split(":").map(Number);
      const minutes = ((eh * 60 + em) - (sh * 60 + sm) + 24 * 60) % (24 * 60) || 24 * 60;
      await updateShiftConfig(token, shiftCode, {
        start_time: editStartTime,
        end_time: editEndTime,
        duration_hours: minutes / 60,
      });
      setSuccess(`Shift ${shiftCode} timings successfully updated to ${editStartTime} - ${editEndTime}.`);
      setEditingShiftCode(null);
      fetchPolicy();
    } catch (err: any) {
      setError(formatApiError(err, `Failed to update Shift ${shiftCode} timings`));
    } finally {
      setSavingShift(false);
    }
  };

  const isSho = user?.role === "SHO" || user?.role === "SUPER_ADMIN";
  const isAdminSi = user?.role === "ADMIN_SI" || user?.role === "SUPER_ADMIN";
  const canEditShifts = isSho || isAdminSi;

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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "20px" }}>
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

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "16px" }}>
              <div className="form-group">
                <label className="form-label" htmlFor="pol-auth">Who may authorize exceptions</label>
                <select id="pol-auth" className="form-control" value={authorizerRole} onChange={(e) => setAuthorizerRole(e.target.value)} disabled={!isSho}>
                  <option value="SHO">SHO only</option>
                  <option value="ADMIN_SI">Admin SI</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="pol-eff">Effective from</label>
                <input id="pol-eff" type="date" className="form-control" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} disabled={!isSho} />
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: "16px" }}>
              <label className="form-label" htmlFor="pol-exc">Permitted exceptions to rest rules</label>
              <textarea id="pol-exc" className="form-control" rows={2} value={permittedExceptions} onChange={(e) => setPermittedExceptions(e.target.value)} disabled={!isSho}
                placeholder="e.g. Emergency deployment, VIP bandobast, law and order situations" />
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

            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
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
                    {canEditShifts && <th>Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {policy?.shifts?.map((s) => {
                    const isEditing = editingShiftCode === s.shift_code;
                    return (
                      <tr key={s.shift_code}>
                        <td><strong style={{ color: "#38bdf8" }}>Shift {s.shift_code}</strong></td>
                        <td>
                          {isEditing ? (
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <input
                                type="time"
                                className="form-control"
                                value={editStartTime}
                                onChange={(e) => setEditStartTime(e.target.value)}
                                style={{ width: "95px", padding: "2px 6px", fontSize: "12px" }}
                              />
                              <span>&ndash;</span>
                              <input
                                type="time"
                                className="form-control"
                                value={editEndTime}
                                onChange={(e) => setEditEndTime(e.target.value)}
                                style={{ width: "95px", padding: "2px 6px", fontSize: "12px" }}
                              />
                            </div>
                          ) : (
                            <span>{s.start_time.slice(0, 5)} &ndash; {s.end_time.slice(0, 5)}</span>
                          )}
                        </td>
                        <td>{s.duration_hours} hrs</td>
                        <td>{s.crosses_midnight ? <span className="badge badge-warning">Yes</span> : "No"}</td>
                        {canEditShifts && (
                          <td>
                            {isEditing ? (
                              <div style={{ display: "flex", gap: "4px" }}>
                                <button
                                  className="btn btn-primary btn-sm"
                                  onClick={() => handleSaveShiftTiming(s.shift_code)}
                                  disabled={savingShift}
                                  style={{ padding: "2px 8px", fontSize: "11px" }}
                                >
                                  Save
                                </button>
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => setEditingShiftCode(null)}
                                  disabled={savingShift}
                                  style={{ padding: "2px 6px", fontSize: "11px" }}
                                >
                                  ✕
                                </button>
                              </div>
                            ) : (
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => handleStartEditShift(s)}
                                style={{ padding: "2px 8px", fontSize: "11px" }}
                              >
                                Edit
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ padding: "16px", borderTop: "1px solid #1e293b", fontSize: "12px", color: "#94a3b8" }}>
              <strong>Station Architecture Note:</strong><br />
              Shift timings are stored centrally and used everywhere (dashboard, roster, attendance, rest and overlap checks, reports and the Android app). Every change is versioned and written to the audit log; it applies to rest and conflict checks from the next validation.
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
