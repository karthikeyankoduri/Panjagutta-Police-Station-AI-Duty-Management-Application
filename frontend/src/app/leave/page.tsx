"use client";
import { useEffect, useState, useCallback } from "react";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import {
  getLeaveRequests,
  createLeaveRequest,
  approveLeave,
  rejectLeave,
  getStaff,
  LeaveRequest,
  StaffMember,
} from "@/lib/api";

export default function LeavePage() {
  const { token, user } = useAuth();
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form State
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [staffId, setStaffId] = useState<string>("");
  const [leaveType, setLeaveType] = useState<string>("CL");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [refNum, setRefNum] = useState<string>("");
  const [remarks, setRemarks] = useState<string>("");

  useEffect(() => {
    const today = new Date().toISOString().split("T")[0];
    if (!startDate) setStartDate(today);
    if (!endDate) setEndDate(today);
  }, [startDate, endDate]);

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [leavesData, staffData] = await Promise.all([
        getLeaveRequests(token),
        getStaff(token, { is_active: true }),
      ]);
      setLeaves(leavesData);
      setStaffList(staffData);
    } catch (err: any) {
      setError(err.message || "Failed to load leave records");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setError(null);
    try {
      await createLeaveRequest(token, {
        staff_id: parseInt(staffId, 10),
        leave_type: leaveType,
        start_date: startDate,
        end_date: endDate,
        reference_number: refNum || null,
        remarks: remarks || null,
      });
      setSuccess("Leave application submitted successfully.");
      setShowApplyModal(false);
      setRemarks("");
      fetchData();
    } catch (err: any) {
      setError(err.message || "Failed to submit leave application");
    }
  };

  const handleApprove = async (id: number) => {
    if (!token) return;
    try {
      await approveLeave(token, id, "Approved by SHO. Coverage vacancy flagged.");
      setSuccess(`Leave #${id} approved. Roster availability updated automatically.`);
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleReject = async (id: number) => {
    if (!token) return;
    try {
      await rejectLeave(token, id, "Rejected due to operational exigency/bandobast duty.");
      setSuccess(`Leave #${id} rejected.`);
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const isShoOrAdmin = user?.role === "SHO" || user?.role === "ADMIN_SI";
  const pendingLeaves = leaves.filter((l) => l.status === "Pending");
  const historyLeaves = leaves.filter((l) => l.status !== "Pending");

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Leave &amp; Rest Management</h1>
          <div className="page-subtitle">
            Officer leave approvals, casual/earned leaves, and automated availability recalculations.
          </div>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setShowApplyModal(true)}
          id="btn-apply-leave"
        >
          + Submit Leave Application
        </button>
      </div>

      {error && <div className="alert-banner alert-banner--warning" style={{ marginBottom: "16px" }}>{error}</div>}
      {success && <div className="alert-banner alert-banner--info" style={{ marginBottom: "16px" }}>{success}</div>}

      {/* Pending Approvals Section for SHO/Admin SI */}
      <div className="card" style={{ marginBottom: "24px" }}>
        <div className="card__header" style={{ display: "flex", justifyContent: "space-between" }}>
          <span className="card__title">Pending Leave Requests ({pendingLeaves.length})</span>
          <span style={{ fontSize: "12px", color: "#eab308" }}>Requires SHO / Admin SI Decision</span>
        </div>
        <div className="card__body" style={{ padding: 0 }}>
          {pendingLeaves.length === 0 ? (
            <div style={{ padding: "24px", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>
              No pending leave applications requiring approval.
            </div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Req #</th>
                    <th>Staff Officer</th>
                    <th>Leave Type</th>
                    <th>From Date</th>
                    <th>To Date</th>
                    <th>Reference</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingLeaves.map((l) => {
                    const st = staffList.find((s) => s.id === l.staff_id);
                    return (
                      <tr key={l.id}>
                        <td><strong>#{l.id}</strong></td>
                        <td>
                          <strong>{st?.name || `Staff #${l.staff_id}`}</strong>
                          <div style={{ fontSize: "11px", color: "#64748b" }}>
                            {st?.service_number} &middot; {st?.designation}
                          </div>
                        </td>
                        <td>
                          <span className="badge badge-default">{l.leave_type}</span>
                        </td>
                        <td>{l.start_date}</td>
                        <td>{l.end_date}</td>
                        <td style={{ fontSize: "12px", color: "#94a3b8" }}>{l.reference_number || "None"}</td>
                        <td>
                          {isShoOrAdmin ? (
                            <div style={{ display: "flex", gap: "6px" }}>
                              <button
                                className="btn btn-success btn-sm"
                                onClick={() => handleApprove(l.id)}
                              >
                                Approve
                              </button>
                              <button
                                className="btn btn-danger btn-sm"
                                onClick={() => handleReject(l.id)}
                              >
                                Reject
                              </button>
                            </div>
                          ) : (
                            <span style={{ fontSize: "12px", color: "#94a3b8" }}>Awaiting SHO</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Historical Leave Register */}
      <div className="card">
        <div className="card__header">
          <span className="card__title">Leave History &amp; Records ({historyLeaves.length})</span>
        </div>
        <div className="card__body" style={{ padding: 0 }}>
          {loading ? (
            <div style={{ padding: "30px", textAlign: "center", color: "#94a3b8" }}>Loading records...</div>
          ) : historyLeaves.length === 0 ? (
            <div style={{ padding: "24px", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>
              No historical leave records.
            </div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Req #</th>
                    <th>Staff Officer</th>
                    <th>Type</th>
                    <th>Period</th>
                    <th>Status</th>
                    <th>Submission Time</th>
                  </tr>
                </thead>
                <tbody>
                  {historyLeaves.map((l) => {
                    const st = staffList.find((s) => s.id === l.staff_id);
                    const statusClass =
                      l.status === "Approved"
                        ? "badge-success"
                        : l.status === "Rejected"
                        ? "badge-danger"
                        : "badge-default";

                    return (
                      <tr key={l.id}>
                        <td>#{l.id}</td>
                        <td>
                          <strong>{st?.name || `Staff #${l.staff_id}`}</strong>
                          <div style={{ fontSize: "11px", color: "#64748b" }}>{st?.service_number}</div>
                        </td>
                        <td>{l.leave_type}</td>
                        <td>
                          {l.start_date} to {l.end_date}
                        </td>
                        <td>
                          <span className={`badge ${statusClass}`}>{l.status}</span>
                        </td>
                        <td style={{ fontSize: "12px", color: "#94a3b8" }}>
                          {l.submitted_at ? new Date(l.submitted_at).toLocaleDateString() : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Apply Leave Modal */}
      {showApplyModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div className="card" style={{ width: "480px", maxWidth: "90vw" }}>
            <div className="card__header">
              <span className="card__title">Apply for Leave / Duty-Off</span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowApplyModal(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleApply} className="card__body">
              <div className="form-group" style={{ marginBottom: "16px" }}>
                <label className="form-label">Staff Officer</label>
                <select
                  className="form-control"
                  required
                  value={staffId}
                  onChange={(e) => setStaffId(e.target.value)}
                >
                  <option value="">-- Select Officer --</option>
                  {staffList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.service_number} &middot; {s.designation})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: "16px" }}>
                <label className="form-label">Leave Type</label>
                <select
                  className="form-control"
                  value={leaveType}
                  onChange={(e) => setLeaveType(e.target.value)}
                >
                  <option value="CL">Casual Leave (CL)</option>
                  <option value="EL">Earned Leave (EL)</option>
                  <option value="ML">Medical Leave (ML)</option>
                  <option value="DUTY_OFF">Weekly Duty-Off / Rest</option>
                  <option value="SPECIAL">Special Leave / Ex-Gratia</option>
                </select>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
                <div className="form-group">
                  <label className="form-label">From Date</label>
                  <input
                    type="date"
                    className="form-control"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">To Date</label>
                  <input
                    type="date"
                    className="form-control"
                    required
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: "16px" }}>
                <label className="form-label">Reference / Order # (Optional)</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="e.g. DPO/HYD/LEAVE/2024/491"
                  value={refNum}
                  onChange={(e) => setRefNum(e.target.value)}
                />
              </div>

              <div className="form-group" style={{ marginBottom: "20px" }}>
                <label className="form-label">Reason / Remarks</label>
                <textarea
                  className="form-control"
                  rows={2}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Reason for leave application..."
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowApplyModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Submit Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
