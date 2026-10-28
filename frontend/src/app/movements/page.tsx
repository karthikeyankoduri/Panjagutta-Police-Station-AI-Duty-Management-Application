"use client";
import { useEffect, useState, useCallback } from "react";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import {
  getMovements,
  createMovement,
  returnMovement,
  getStaff,
  Movement,
  StaffMember,
} from "@/lib/api";

export default function MovementsPage() {
  const { token, user } = useAuth();
  const [movements, setMovements] = useState<Movement[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form State for Log Out
  const [showLogOutModal, setShowLogOutModal] = useState(false);
  const [staffId, setStaffId] = useState<string>("");
  const [purpose, setPurpose] = useState<string>("Court evidence deposition");
  const [destination, setDestination] = useState<string>("Nampally Criminal Court Complex");
  const [expectedReturn, setExpectedReturn] = useState<string>("");

  // Return Modal
  const [returnMovementId, setReturnMovementId] = useState<number | null>(null);
  const [returnRemarks, setReturnRemarks] = useState<string>("");

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
      setError(err.message || "Failed to load movement records");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleLogOut = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setError(null);
    try {
      await createMovement(token, {
        staff_id: parseInt(staffId, 10),
        purpose,
        destination,
        expected_return: expectedReturn ? new Date(expectedReturn).toISOString() : null,
      });
      setSuccess("Staff member logged out for official movement.");
      setShowLogOutModal(false);
      fetchData();
    } catch (err: any) {
      setError(err.message || "Failed to log movement");
    }
  };

  const handleReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !returnMovementId) return;
    try {
      await returnMovement(token, returnMovementId, returnRemarks || "Returned to station duty.");
      setSuccess("Movement closed. Officer marked returned to station.");
      setReturnMovementId(null);
      setReturnRemarks("");
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const activeMovements = movements.filter((m) => m.status === "open" || m.status === "authorized");
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
        <button
          className="btn btn-primary"
          onClick={() => setShowLogOutModal(true)}
          id="btn-log-out"
        >
          + Log Out Movement
        </button>
      </div>

      {error && <div className="alert-banner alert-banner--warning" style={{ marginBottom: "16px" }}>{error}</div>}
      {success && <div className="alert-banner alert-banner--info" style={{ marginBottom: "16px" }}>{success}</div>}

      {/* Summary KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "20px" }}>
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
              No staff members are currently logged out on external movement.
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
                              <div>{new Date(m.expected_return).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
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
                            <span className="badge badge-info">Outside</span>
                          )}
                        </td>
                        <td>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => setReturnMovementId(m.id)}
                          >
                            Mark Returned
                          </button>
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
                        <td>#{m.id}</td>
                        <td>
                          <strong>{st?.name || `Staff #${m.staff_id}`}</strong>
                          <div style={{ fontSize: "11px", color: "#64748b" }}>{st?.service_number}</div>
                        </td>
                        <td>{m.destination}</td>
                        <td>{m.purpose}</td>
                        <td style={{ fontSize: "12px", color: "#94a3b8" }}>
                          {m.actual_return ? new Date(m.actual_return).toLocaleString() : "Returned"}
                        </td>
                        <td>
                          <span className="badge badge-success">Returned</span>
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

      {/* Log Out Modal */}
      {showLogOutModal && (
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
              <span className="card__title">Log Out Movement</span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowLogOutModal(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleLogOut} className="card__body">
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
                  placeholder="e.g. Evidence deposition in Cr. No. 128/2024..."
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
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Authorize &amp; Log Out
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
            backgroundColor: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div className="card" style={{ width: "420px", maxWidth: "90vw" }}>
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
                  placeholder="e.g. Warrant executed, deposition concluded, returned safe."
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setReturnMovementId(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Confirm Return
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
