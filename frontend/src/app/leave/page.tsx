"use client";
import { useEffect, useState, useCallback } from "react";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import { useToday } from "@/lib/use-today";
import {
  getLeaveRequests,
  createLeaveRequest,
  approveLeave,
  rejectLeave,
  cancelLeave,
  getLeaveImpact,
  getStaff,
  getConfigLists,
  getPolicyStatus,
  getDashboardViews,
  formatApiError,
  LeaveRequest,
  StaffMember,
  ListItem,
  PolicyStatusData,
  DashboardViews,
} from "@/lib/api";

const STATUS_CLASS: Record<string, string> = {
  Approved: "badge-success", Rejected: "badge-danger", Cancelled: "badge-default", Pending: "badge-warning",
};

export default function LeavePage() {
  const { token, user } = useAuth();
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<ListItem[]>([]);
  const [policy, setPolicy] = useState<PolicyStatusData | null>(null);
  const [rest, setRest] = useState<DashboardViews["rest"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [showApplyModal, setShowApplyModal] = useState(false);
  const [staffId, setStaffId] = useState<string>("");
  const [leaveType, setLeaveType] = useState<string>("CL");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [refNum, setRefNum] = useState<string>("");
  const [remarks, setRemarks] = useState<string>("");

  const [decision, setDecision] = useState<{ leave: LeaveRequest; kind: "approve" | "reject" | "cancel" } | null>(null);
  const [decisionRemarks, setDecisionRemarks] = useState("");
  const [impact, setImpact] = useState<Awaited<ReturnType<typeof getLeaveImpact>> | null>(null);

  const isStaff = user?.role === "STAFF";
  const isApprover = ["SHO", "ADMIN_SI", "SUPER_ADMIN"].includes(user?.role || "");
  const isOfficer = !isStaff;

  const today = useToday();
  useEffect(() => {
    if (!today) return;
    if (!startDate) setStartDate(today);
    if (!endDate) setEndDate(today);
  }, [today, startDate, endDate]);

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [leavesData, staffData] = await Promise.all([
        getLeaveRequests(token),
        isStaff ? Promise.resolve([] as StaffMember[]) : getStaff(token, { is_active: true }),
      ]);
      setLeaves(leavesData);
      setStaffList(staffData);
    } catch (err: any) {
      setError(err.message || "Failed to load leave records");
    } finally {
      setLoading(false);
    }
  }, [token, isStaff]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!token) return;
    getConfigLists(token).then((l) => setLeaveTypes((l.leave_type || []).filter((t) => t.is_active)));
    getPolicyStatus(token).then(setPolicy).catch(() => null);
    if (isOfficer) getDashboardViews(token).then((v) => setRest(v.rest)).catch(() => null);
  }, [token, isOfficer]);

  useEffect(() => {
    if (isStaff && user?.staff_id) setStaffId(String(user.staff_id));
  }, [isStaff, user?.staff_id]);

  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setError(null);
    if (endDate < startDate) {
      setError("The end date cannot be before the start date.");
      return;
    }
    try {
      const res = await createLeaveRequest(token, {
        staff_id: staffId ? parseInt(staffId, 10) : undefined,
        leave_type: leaveType,
        start_date: startDate,
        end_date: endDate,
        reference_number: refNum || null,
        remarks: remarks || null,
      });
      setSuccess(`Leave request ${res.reference_number} submitted and routed to the SHO / Admin SI for a decision.`);
      setShowApplyModal(false);
      setRemarks("");
      setRefNum("");
      fetchData();
    } catch (err: any) {
      setError(formatApiError(err, "Failed to submit leave application"));
    }
  };

  const openDecision = async (leave: LeaveRequest, kind: "approve" | "reject" | "cancel") => {
    setDecision({ leave, kind });
    setDecisionRemarks("");
    setImpact(null);
    if (kind === "approve" && token) {
      try { setImpact(await getLeaveImpact(token, leave.id)); } catch { /* preview is optional */ }
    }
  };

  const submitDecision = async () => {
    if (!token || !decision) return;
    const { leave, kind } = decision;
    try {
      if (kind === "approve") {
        const res = await approveLeave(token, leave.id, decisionRemarks || undefined);
        setSuccess(`Leave ${leave.reference_number || leave.id} approved.${res.replacement_alerts?.length ? ` ${res.replacement_alerts.length} roster vacancy alert(s) raised for the Admin SI.` : ""}`);
      } else if (kind === "reject") {
        await rejectLeave(token, leave.id, decisionRemarks);
        setSuccess(`Leave ${leave.reference_number || leave.id} rejected.`);
      } else {
        await cancelLeave(token, leave.id, decisionRemarks || undefined);
        setSuccess(`Leave ${leave.reference_number || leave.id} cancelled.`);
      }
      setDecision(null);
      fetchData();
    } catch (err: any) {
      setError(formatApiError(err, "Action failed"));
    }
  };

  const canCancel = (l: LeaveRequest) =>
    (l.status === "Pending" && (isApprover || l.staff_id === user?.staff_id)) ||
    (l.status === "Approved" && (isApprover || (l.staff_id === user?.staff_id && l.start_date > today)));

  const pendingLeaves = leaves.filter((l) => l.status === "Pending");
  const historyLeaves = leaves.filter((l) => l.status !== "Pending");
  const typeLabel = (code: string) => leaveTypes.find((t) => t.code === code)?.label || code;

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Leave &amp; Rest Management</h1>
          <div className="page-subtitle">
            Only approved leave removes a person from roster eligibility. Pending requests stay visible but do not count.
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowApplyModal(true)} id="btn-apply-leave">
          + {isStaff ? "Request Leave" : "Submit Leave Application"}
        </button>
      </div>

      {error && <div role="alert" className="alert-banner alert-banner--warning" style={{ marginBottom: 16 }}>{error}</div>}
      {success && <div className="alert-banner alert-banner--info" style={{ marginBottom: 16 }}>{success}</div>}

      {policy && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card__header"><span className="card__title">Rest &amp; duty-off rules</span>
            <span className={`badge ${policy.policy_status === "confirmed" ? "badge-success" : "badge-warning"}`}>{policy.policy_status.replace("_", " ")}</span>
          </div>
          <div className="card__body" style={{ fontSize: 13 }}>
            {policy.policy_status === "unconfirmed" ? (
              <>Rest and duty-off are not calculated until the SHO confirms the rotation rules.</>
            ) : (
              <>Rotation {policy.rotation_sequence} · minimum <strong>{policy.min_rest_hours_after_shift}h</strong> rest after each shift · <strong>{policy.duty_off_after_shift_b_hours}h</strong> duty-off after Shift B.</>
            )}
            {isOfficer && rest.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <strong>Currently on rest ({rest.length}):</strong>{" "}
                {rest.slice(0, 12).map((r) => `${r.name}${r.rest_until ? ` until ${new Date(r.rest_until).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}` : ""}`).join(" · ")}
                {rest.length > 12 ? " …" : ""}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card__header" style={{ display: "flex", justifyContent: "space-between" }}>
          <span className="card__title">Pending Leave Requests ({pendingLeaves.length})</span>
          <span style={{ fontSize: 12, color: "#eab308" }}>Decided by the SHO / Admin SI</span>
        </div>
        <div className="card__body" style={{ padding: 0 }}>
          {pendingLeaves.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>No pending leave requests.</div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead><tr><th>Reference</th><th>Staff Officer</th><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Remarks</th><th>Actions</th></tr></thead>
                <tbody>
                  {pendingLeaves.map((l) => (
                    <tr key={l.id}>
                      <td><strong>{l.reference_number || `#${l.id}`}</strong></td>
                      <td><strong>{l.staff_name || `Staff #${l.staff_id}`}</strong><div style={{ fontSize: 11, color: "#64748b" }}>{l.service_number}</div></td>
                      <td><span className="badge badge-default">{typeLabel(l.leave_type)}</span></td>
                      <td>{l.start_date}</td>
                      <td>{l.end_date}</td>
                      <td>{l.days ?? "—"}</td>
                      <td style={{ fontSize: 12, color: "#64748b", maxWidth: 200 }}>{l.remarks || "—"}</td>
                      <td>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {isApprover && (
                            <>
                              <button className="btn btn-success btn-sm" onClick={() => openDecision(l, "approve")}>Approve</button>
                              <button className="btn btn-danger btn-sm" onClick={() => openDecision(l, "reject")}>Reject</button>
                            </>
                          )}
                          {canCancel(l) && <button className="btn btn-secondary btn-sm" onClick={() => openDecision(l, "cancel")}>Cancel</button>}
                          {!isApprover && !canCancel(l) && <span style={{ fontSize: 12, color: "#94a3b8" }}>Awaiting decision</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card__header"><span className="card__title">Leave History &amp; Records ({historyLeaves.length})</span></div>
        <div className="card__body" style={{ padding: 0 }}>
          {loading ? (
            <div style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>Loading records...</div>
          ) : historyLeaves.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>No historical leave records.</div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead><tr><th>Reference</th><th>Staff Officer</th><th>Type</th><th>Period</th><th>Status</th><th>Decided by</th><th>Remarks</th><th></th></tr></thead>
                <tbody>
                  {historyLeaves.map((l) => (
                    <tr key={l.id}>
                      <td>{l.reference_number || `#${l.id}`}</td>
                      <td><strong>{l.staff_name || `Staff #${l.staff_id}`}</strong><div style={{ fontSize: 11, color: "#64748b" }}>{l.service_number}</div></td>
                      <td>{typeLabel(l.leave_type)}</td>
                      <td>{l.start_date} to {l.end_date}</td>
                      <td><span className={`badge ${STATUS_CLASS[l.status] || "badge-default"}`}>{l.status}</span></td>
                      <td style={{ fontSize: 12 }}>
                        {l.approver_username || "—"}
                        {l.decision_at && <div className="text-muted">{new Date(l.decision_at).toLocaleString()}</div>}
                      </td>
                      <td style={{ fontSize: 12, color: "#64748b", maxWidth: 220 }}>{l.approver_remarks || "—"}</td>
                      <td>{canCancel(l) && <button className="btn btn-secondary btn-sm" onClick={() => openDecision(l, "cancel")}>Cancel</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {decision && (
        <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.7)", padding: 12, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div className="card" style={{ width: "100%", maxWidth: "min(95vw, 560px)" }}>
            <div className="card__header">
              <span className="card__title">
                {decision.kind === "approve" ? "Approve" : decision.kind === "reject" ? "Reject" : "Cancel"} leave {decision.leave.reference_number || `#${decision.leave.id}`}
              </span>
              <button className="btn btn-secondary btn-sm" onClick={() => setDecision(null)} aria-label="Close">✕</button>
            </div>
            <div className="card__body">
              <p style={{ marginTop: 0, fontSize: 13 }}>
                <strong>{decision.leave.staff_name}</strong> · {typeLabel(decision.leave.leave_type)} · {decision.leave.start_date} to {decision.leave.end_date}
              </p>
              {decision.kind === "approve" && (
                impact ? (
                  impact.vacancies_if_approved > 0 ? (
                    <div className="alert-banner alert-banner--warning" style={{ fontSize: 12, marginBottom: 12 }}>
                      Approving creates {impact.vacancies_if_approved} roster vacancy(ies):
                      <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                        {impact.affected_assignments.map((a) => (
                          <li key={`${a.roster_id}-${a.duty}`}>{a.date} Shift {a.shift} — {a.duty} (roster v{a.version}, {a.status})</li>
                        ))}
                      </ul>
                    </div>
                  ) : <div className="alert-banner alert-banner--info" style={{ fontSize: 12, marginBottom: 12 }}>No submitted, approved or published roster duty is affected.</div>
                ) : <div className="text-muted" style={{ fontSize: 12, marginBottom: 12 }}>Checking roster impact…</div>
              )}
              <label className="form-label" htmlFor="decision-remarks">
                {decision.kind === "reject" ? "Reason (required, shown to the officer)" : "Remarks (optional)"}
              </label>
              <textarea id="decision-remarks" className="form-control" rows={3} value={decisionRemarks} onChange={(e) => setDecisionRemarks(e.target.value)} />
            </div>
            <div className="card__footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => setDecision(null)}>Back</button>
              <button className={`btn ${decision.kind === "approve" ? "btn-success" : decision.kind === "reject" ? "btn-danger" : "btn-primary"}`}
                disabled={decision.kind === "reject" && !decisionRemarks.trim()} onClick={submitDecision}>
                Confirm {decision.kind}
              </button>
            </div>
          </div>
        </div>
      )}

      {showApplyModal && (
        <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.7)", padding: 12, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div className="card" style={{ width: "100%", maxWidth: "min(95vw, 650px)" }}>
            <div className="card__header">
              <span className="card__title">Apply for Leave / Duty-Off</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowApplyModal(false)} aria-label="Close">✕</button>
            </div>
            <form onSubmit={handleApply} className="card__body">
              {!isStaff && (
                <div className="form-group" style={{ marginBottom: 16 }}>
                  <label className="form-label" htmlFor="lv-staff">Staff officer</label>
                  <select id="lv-staff" className="form-control" required value={staffId} onChange={(e) => setStaffId(e.target.value)}>
                    <option value="">-- Select officer --</option>
                    {staffList.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.service_number} · {s.designation})</option>)}
                  </select>
                </div>
              )}
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="form-label" htmlFor="lv-type">Leave type</label>
                <select id="lv-type" className="form-control" value={leaveType} onChange={(e) => setLeaveType(e.target.value)}>
                  {(leaveTypes.length ? leaveTypes : [{ code: "CL", label: "Casual Leave" } as ListItem]).map((t) => (
                    <option key={t.code} value={t.code}>{t.label} ({t.code})</option>
                  ))}
                </select>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 16 }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="lv-from">From date</label>
                  <input id="lv-from" type="date" className="form-control" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="lv-to">To date</label>
                  <input id="lv-to" type="date" className="form-control" required min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="form-label" htmlFor="lv-ref">Order reference (optional — one is generated if blank)</label>
                <input id="lv-ref" type="text" className="form-control" value={refNum} onChange={(e) => setRefNum(e.target.value)} />
              </div>
              <div className="form-group" style={{ marginBottom: 20 }}>
                <label className="form-label" htmlFor="lv-remarks">Reason / remarks</label>
                <textarea id="lv-remarks" className="form-control" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowApplyModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Submit request</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
