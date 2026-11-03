"use client";
import { useEffect, useState, useCallback } from "react";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import {
  getMovements,
  createMovement,
  authorizeMovement,
  rejectMovement,
  cancelMovement,
  returnMovement,
  getStaff,
  formatApiError,
  Movement,
  StaffMember,
} from "@/lib/api";

export default function MovementsPage() {
  const { token, user } = useAuth();
  const [movements, setMovements] = useState<Movement[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form State for Log Out
  const [showLogOutModal, setShowLogOutModal] = useState(false);
  const [staffId, setStaffId] = useState<string>("");
  const [purpose, setPurpose] = useState<string>("Court summons service / evidence deposition");
  const [destination, setDestination] = useState<string>("Nampally Criminal Court Complex");
  const [expectedReturn, setExpectedReturn] = useState<string>("");

  // Return Modal
  const [returnMovementId, setReturnMovementId] = useState<number | null>(null);
  const [returnRemarks, setReturnRemarks] = useState<string>("");

  const isStaff = user?.role === "STAFF";
  const isSupervisor =
    user?.role === "SHO" ||
    user?.role === "ADMIN_SI" ||
    user?.role === "DI" ||
    user?.role === "DSI" ||
    user?.role === "SECTOR_SI" ||
    user?.role === "SUPER_ADMIN";

  // Resolve current logged-in staff member profile
  const myStaff = staffList.find(
    (s) =>
      s.user_username === user?.username ||
      s.service_number === user?.username ||
      s.id === (user as any)?.staff_id
  );

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [movData, staffData] = await Promise.all([
        getMovements(token),
        getStaff(token, { is_active: true }),
      ]);
      setMovements(movData);
      setStaffList(staffData);
    } catch (err: any) {
      setError(formatApiError(err, "Failed to load movement records"));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Pre-fill staffId when staff opens the modal
  const handleOpenModal = () => {
    setError(null);
    setSuccess(null);
    if (isStaff && myStaff) {
      setStaffId(String(myStaff.id));
    } else if (!isStaff && staffList.length > 0 && !staffId) {
      setStaffId(String(staffList[0].id));
    }
    // Default expected return to 4 hours from now
    const now = new Date();
    now.setHours(now.getHours() + 4);
    const tzOffset = now.getTimezoneOffset() * 60000;
    const localISOTime = new Date(now.getTime() - tzOffset).toISOString().slice(0, 16);
    setExpectedReturn(localISOTime);
    setShowLogOutModal(true);
  };

  const handleLogOut = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setSuccess(null);
    setActionLoading(true);
    try {
      const targetStaffId = isStaff ? (myStaff?.id || undefined) : (staffId ? parseInt(staffId, 10) : undefined);
      const res = await createMovement(token, {
        staff_id: targetStaffId,
        purpose,
        destination,
        expected_return: expectedReturn ? new Date(expectedReturn).toISOString() : null,
      });

      if (res.status === "pending_authorization" || isStaff) {
        setSuccess("Outside movement request submitted. Awaiting supervisor departure authorization.");
      } else {
        setSuccess("Staff member authorized and logged out for official movement.");
      }
      setShowLogOutModal(false);
      await fetchData();
    } catch (err: any) {
      setError(formatApiError(err, "Failed to log movement"));
    } finally {
      setActionLoading(false);
    }
  };

  const handleAuthorize = async (movementId: number) => {
    if (!token) return;
    setError(null);
    setSuccess(null);
    setActionLoading(true);
    try {
      await authorizeMovement(token, movementId);
      setSuccess(`Movement #${movementId} authorized and departure recorded.`);
      await fetchData();
    } catch (err: any) {
      setError(formatApiError(err, `Failed to authorize movement #${movementId}`));
    } finally {
      setActionLoading(false);
    }
  };

  const canAuthorize = ["SHO", "ADMIN_SI", "SECTOR_SI", "SUPER_ADMIN"].includes(user?.role || "");

  const handleReject = async (movementId: number) => {
    if (!token) return;
    const notes = window.prompt("Reason for not authorizing this movement (shown to the officer):");
    if (notes === null) return;
    setActionLoading(true);
    try {
      await rejectMovement(token, movementId, notes || undefined);
      setSuccess(`Movement #${movementId} was not authorized. The officer has been notified.`);
      await fetchData();
    } catch (err: any) {
      setError(formatApiError(err, "Failed to reject movement"));
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async (movementId: number) => {
    if (!token || !window.confirm(`Cancel movement #${movementId}?`)) return;
    setActionLoading(true);
    try {
      await cancelMovement(token, movementId);
      setSuccess(`Movement #${movementId} cancelled.`);
      await fetchData();
    } catch (err: any) {
      setError(formatApiError(err, "Failed to cancel movement"));
    } finally {
      setActionLoading(false);
    }
  };

  const handleReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !returnMovementId) return;
    setError(null);
    setSuccess(null);
    setActionLoading(true);
    try {
      await returnMovement(token, returnMovementId, returnRemarks || "Returned to station duty.");
      setSuccess(`Movement #${returnMovementId} closed. Officer safely marked returned to station.`);
      setReturnMovementId(null);
      setReturnRemarks("");
      await fetchData();
    } catch (err: any) {
      setError(formatApiError(err, "Failed to close movement"));
    } finally {
      setActionLoading(false);
    }
  };

  const pendingMovements = movements.filter((m) => m.status === "pending_authorization");
  const activeMovements = movements.filter(
    (m) => m.status === "open" || m.status === "authorized" || m.status === "dispatched"
  );
  const overdueMovements = activeMovements.filter((m) => m.is_overdue);
  const closedMovements = movements.filter((m) => m.status === "returned");

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Outside Movement Register</h1>
          <div className="page-subtitle">
            Log departure, track expected return schedules, and monitor overdue alerts for court, crime, and field duties.
          </div>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button className="btn btn-secondary btn-sm" onClick={fetchData} disabled={loading || actionLoading}>
            ↻ Refresh
          </button>
          <button
            className="btn btn-primary"
            onClick={handleOpenModal}
            id="btn-log-out"
            disabled={actionLoading}
          >
            + {isStaff ? "Request Outside Movement" : "Log Out Movement"}
          </button>
        </div>
      </div>

      {error && <div className="alert-banner alert-banner--warning" style={{ marginBottom: "16px" }}>{error}</div>}
      {success && <div className="alert-banner alert-banner--info" style={{ marginBottom: "16px" }}>{success}</div>}

      {/* Summary KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "20px" }}>
        <div className="card" style={{ borderColor: pendingMovements.length > 0 ? "#f59e0b" : undefined }}>
          <div className="card__body" style={{ textAlign: "center" }}>
            <div style={{ fontSize: "24px", fontWeight: 700, color: pendingMovements.length > 0 ? "#f59e0b" : "#94a3b8" }}>
              {pendingMovements.length}
            </div>
            <div style={{ fontSize: "13px", color: "#94a3b8" }}>Pending Authorization</div>
          </div>
        </div>

        <div className="card">
          <div className="card__body" style={{ textAlign: "center" }}>
            <div style={{ fontSize: "24px", fontWeight: 700, color: "#38bdf8" }}>
              {activeMovements.length}
            </div>
            <div style={{ fontSize: "13px", color: "#94a3b8" }}>Currently Outside Station</div>
          </div>
        </div>

        <div className="card" style={{ borderColor: overdueMovements.length > 0 ? "#ef4444" : undefined }}>
          <div className="card__body" style={{ textAlign: "center" }}>
            <div style={{ fontSize: "24px", fontWeight: 700, color: overdueMovements.length > 0 ? "#ef4444" : "#22c55e" }}>
              {overdueMovements.length}
            </div>
            <div style={{ fontSize: "13px", color: "#94a3b8" }}>Overdue Movement Alerts</div>
          </div>
        </div>

        <div className="card">
          <div className="card__body" style={{ textAlign: "center" }}>
            <div style={{ fontSize: "24px", fontWeight: 700, color: "#22c55e" }}>
              {closedMovements.length}
            </div>
            <div style={{ fontSize: "13px", color: "#94a3b8" }}>Safely Returned &amp; Closed</div>
          </div>
        </div>
      </div>

      {/* Pending Authorization Requests Section */}
      <div className="card" style={{ marginBottom: "24px", borderColor: pendingMovements.length > 0 ? "#f59e0b" : undefined }}>
        <div className="card__header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="card__title" style={{ color: pendingMovements.length > 0 ? "#f59e0b" : undefined }}>
            ⏳ Pending Departure Authorization Requests ({pendingMovements.length})
          </span>
          {pendingMovements.length > 0 && (
            <span className="badge badge-warning">Action Required</span>
          )}
        </div>
        <div className="card__body" style={{ padding: 0 }}>
          {pendingMovements.length === 0 ? (
            <div style={{ padding: "20px", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>
              No pending movement requests awaiting authorization.
            </div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Log #</th>
                    <th>Officer</th>
                    <th>Destination</th>
                    <th>Official Purpose</th>
                    <th>Expected Return</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingMovements.map((m) => {
                    const st = staffList.find((s) => s.id === m.staff_id);
                    return (
                      <tr key={m.id} style={{ backgroundColor: "rgba(245, 158, 11, 0.05)" }}>
                        <td><strong>#{m.id}</strong></td>
                        <td>
                          <strong>{st?.name || `Staff #${m.staff_id}`}</strong>
                          <div style={{ fontSize: "11px", color: "#64748b" }}>
                            {st?.service_number} &middot; {st?.designation} {st?.sector_id ? `(Sector ${st.sector_id})` : ""}
                          </div>
                        </td>
                        <td>{m.destination}</td>
                        <td style={{ fontSize: "13px", color: "#e2e8f0" }}>{m.purpose}</td>
                        <td>
                          {m.expected_return ? (
                            <div>
                              <div>{new Date(m.expected_return).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                              <div style={{ fontSize: "11px", color: "#64748b" }}>
                                {new Date(m.expected_return).toLocaleDateString()}
                              </div>
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          <span className="badge badge-warning">Pending Approval</span>
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {canAuthorize ? (
                              <>
                                <button
                                  className="btn btn-primary btn-sm"
                                  onClick={() => handleAuthorize(m.id)}
                                  disabled={actionLoading}
                                >
                                  ✓ Authorize Departure
                                </button>
                                <button className="btn btn-danger btn-sm" onClick={() => handleReject(m.id)} disabled={actionLoading}>
                                  ✗ Reject
                                </button>
                              </>
                            ) : (
                              <span style={{ fontSize: "12px", color: "#94a3b8" }}>Awaiting authorizing officer</span>
                            )}
                            {isStaff && myStaff && m.staff_id === myStaff.id && (
                              <button className="btn btn-secondary btn-sm" onClick={() => handleCancel(m.id)} disabled={actionLoading}>Cancel request</button>
                            )}
                          </div>
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

      {/* Active Movements Table */}
      <div className="card" style={{ marginBottom: "24px" }}>
        <div className="card__header" style={{ display: "flex", justifyContent: "space-between" }}>
          <span className="card__title">Active Movements Outside Station ({activeMovements.length})</span>
          {overdueMovements.length > 0 && (
            <span className="badge badge-danger">⚠ {overdueMovements.length} Overdue</span>
          )}
        </div>
        <div className="card__body" style={{ padding: 0 }}>
          {activeMovements.length === 0 ? (
            <div style={{ padding: "24px", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>
              No staff members are currently outside the station on authorized movement.
            </div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Log #</th>
                    <th>Officer</th>
                    <th>Destination</th>
                    <th>Official Purpose</th>
                    <th>Expected Return</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {activeMovements.map((m) => {
                    const st = staffList.find((s) => s.id === m.staff_id);
                    const canReturn = isSupervisor || (isStaff && myStaff && m.staff_id === myStaff.id);
                    return (
                      <tr
                        key={m.id}
                        style={{
                          backgroundColor: m.is_overdue ? "rgba(239, 68, 68, 0.08)" : undefined,
                        }}
                      >
                        <td><strong>#{m.id}</strong></td>
                        <td>
                          <strong>{st?.name || `Staff #${m.staff_id}`}</strong>
                          <div style={{ fontSize: "11px", color: "#64748b" }}>
                            {st?.service_number} &middot; {st?.designation}
                          </div>
                        </td>
                        <td>{m.destination}</td>
                        <td style={{ fontSize: "13px", color: "#e2e8f0" }}>{m.purpose}</td>
                        <td>
                          {m.expected_return ? (
                            <div>
                              <div>{new Date(m.expected_return).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                              <div style={{ fontSize: "11px", color: "#64748b" }}>
                                {new Date(m.expected_return).toLocaleDateString()}
                              </div>
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          {m.is_overdue ? (
                            <span className="badge badge-danger">OVERDUE</span>
                          ) : (
                            <span className="badge badge-info">Outside Duty</span>
                          )}
                          <div style={{ fontSize: "11px", color: "#64748b", marginTop: 4 }}>
                            {m.authorizing_officer ? `Authorized by ${m.authorizing_officer}` : ""}
                            {m.actual_departure ? <><br />Departed {new Date(m.actual_departure).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</> : null}
                          </div>
                        </td>
                        <td>
                          {canReturn ? (
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => setReturnMovementId(m.id)}
                              disabled={actionLoading}
                            >
                              Mark Returned
                            </button>
                          ) : (
                            <span style={{ fontSize: "12px", color: "#94a3b8" }}>On Duty</span>
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

      {/* Completed Movements */}
      <div className="card">
        <div className="card__header">
          <span className="card__title">Completed Movement History ({closedMovements.length})</span>
        </div>
        <div className="card__body" style={{ padding: 0 }}>
          {closedMovements.length === 0 ? (
            <div style={{ padding: "20px", textAlign: "center", color: "#94a3b8" }}>No closed movement history.</div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Log #</th>
                    <th>Officer</th>
                    <th>Destination</th>
                    <th>Purpose</th>
                    <th>Actual Return</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {closedMovements.map((m) => {
                    const st = staffList.find((s) => s.id === m.staff_id);
                    return (
                      <tr key={m.id}>
                        <td><strong>#{m.id}</strong></td>
                        <td>
                          <strong>{st?.name || `Staff #${m.staff_id}`}</strong>
                          <div style={{ fontSize: "11px", color: "#64748b" }}>
                            {st?.service_number} &middot; {st?.designation}
                          </div>
                        </td>
                        <td>{m.destination}</td>
                        <td style={{ fontSize: "13px", color: "#94a3b8" }}>{m.purpose}</td>
                        <td>
                          {m.actual_return ? (
                            <div>
                              <div>{new Date(m.actual_return).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                              <div style={{ fontSize: "11px", color: "#64748b" }}>
                                {new Date(m.actual_return).toLocaleDateString()}
                              </div>
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          <span className="badge badge-success">Completed</span>
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

      {/* Log Out Movement Modal */}
      {showLogOutModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.7)", padding: "12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div className="card" style={{ width: "100%", maxWidth: "min(95vw, 650px)" }}>
            <div className="card__header">
              <span className="card__title">
                {isStaff ? "Submit Outside Movement Request" : "Log Out Official Movement"}
              </span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowLogOutModal(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleLogOut} className="card__body">
              {isStaff ? (
                <div
                  style={{
                    background: "#0f172a",
                    border: "1px solid #1e293b",
                    padding: "12px",
                    borderRadius: "6px",
                    marginBottom: "16px",
                  }}
                >
                  <div style={{ fontSize: "11px", color: "#94a3b8", textTransform: "uppercase" }}>
                    Applicant Staff Officer
                  </div>
                  <div style={{ fontWeight: 600, color: "#38bdf8", fontSize: "14px", marginTop: "2px" }}>
                    {myStaff ? `${myStaff.name} (${myStaff.service_number} · ${myStaff.designation})` : user?.username}
                  </div>
                  <div style={{ fontSize: "11px", color: "#64748b", marginTop: "4px" }}>
                    Your request will be submitted for supervisory departure authorization.
                  </div>
                </div>
              ) : (
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
              )}

              <div className="form-group" style={{ marginBottom: "16px" }}>
                <label className="form-label">Destination</label>
                <input
                  type="text"
                  className="form-control"
                  required
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="e.g. Nampally Criminal Courts, Gandhi Hospital, Cyberabad..."
                />
              </div>

              <div className="form-group" style={{ marginBottom: "16px" }}>
                <label className="form-label">Official Purpose</label>
                <input
                  type="text"
                  className="form-control"
                  required
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder="e.g. Evidence deposition in Cr. No. 128/2024, summons service..."
                />
              </div>

              <div className="form-group" style={{ marginBottom: "20px" }}>
                <label className="form-label">Expected Return Date &amp; Time</label>
                <input
                  type="datetime-local"
                  className="form-control"
                  required
                  value={expectedReturn}
                  onChange={(e) => setExpectedReturn(e.target.value)}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowLogOutModal(false)}
                  disabled={actionLoading}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={actionLoading}>
                  {actionLoading ? "Submitting..." : isStaff ? "Submit Movement Request" : "Authorize & Log Out"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Return Movement Modal */}
      {returnMovementId && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.7)", padding: "12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div className="card" style={{ width: "100%", maxWidth: "min(95vw, 650px)" }}>
            <div className="card__header">
              <span className="card__title">Close Movement Log #{returnMovementId}</span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setReturnMovementId(null)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleReturn} className="card__body">
              <div className="form-group" style={{ marginBottom: "16px" }}>
                <label className="form-label">Return Notes / Outcome</label>
                <textarea
                  className="form-control"
                  rows={3}
                  value={returnRemarks}
                  onChange={(e) => setReturnRemarks(e.target.value)}
                  placeholder="e.g. Warrant executed, court deposition concluded, returned safe."
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setReturnMovementId(null)}
                  disabled={actionLoading}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={actionLoading}>
                  {actionLoading ? "Closing..." : "Confirm Return"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
