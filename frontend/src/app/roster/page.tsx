"use client";
import { useEffect, useState, useCallback } from "react";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import {
  getRosters,
  createRoster,
  submitRoster,
  approveRoster,
  publishRoster,
  explainRoster,
  RosterItem,
} from "@/lib/api";

export default function RosterPage() {
  const { token, user } = useAuth();
  const [rosters, setRosters] = useState<RosterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Filters
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedShift, setSelectedShift] = useState<string>("");

  // Create Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newDate, setNewDate] = useState<string>("");
  const [newShift, setNewShift] = useState<string>("A");
  const [newReason, setNewReason] = useState<string>("Routine daily roster preparation");

  useEffect(() => {
    if (!newDate) setNewDate(new Date().toISOString().split("T")[0]);
  }, [newDate]);

  // AI Explain Modal
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<any>(null);

  const fetchRosters = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getRosters(token, {
        roster_date: selectedDate || undefined,
        shift_code: selectedShift || undefined,
      });
      setRosters(data);
    } catch (err: any) {
      setError(err.message || "Failed to load rosters");
    } finally {
      setLoading(false);
    }
  }, [token, selectedDate, selectedShift]);

  useEffect(() => {
    fetchRosters();
  }, [fetchRosters]);

  const handleCreateRoster = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setError(null);
    try {
      await createRoster(token, {
        roster_date: newDate,
        shift_code: newShift,
        change_reason: newReason,
        assignments: [],
      });
      setSuccess("New roster draft created successfully.");
      setShowCreateModal(false);
      fetchRosters();
    } catch (err: any) {
      setError(err.message || "Failed to create roster draft");
    }
  };

  const handleSubmit = async (id: number) => {
    if (!token) return;
    try {
      await submitRoster(token, id);
      setSuccess(`Roster #${id} submitted for SHO approval.`);
      fetchRosters();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleApprove = async (id: number) => {
    if (!token) return;
    try {
      await approveRoster(token, id, "Approved by Station House Officer.");
      setSuccess(`Roster #${id} officially approved.`);
      fetchRosters();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handlePublish = async (id: number) => {
    if (!token) return;
    try {
      await publishRoster(token, id);
      setSuccess(`Roster #${id} published. Visible to all station personnel.`);
      fetchRosters();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleExplain = async (id: number) => {
    if (!token) return;
    setAiLoading(true);
    setShowAiModal(true);
    setAiResult(null);
    try {
      const res = await explainRoster(token, id);
      setAiResult(res);
    } catch (err: any) {
      setError(err.message);
      setShowAiModal(false);
    } finally {
      setAiLoading(false);
    }
  };

  const isShoOrAdmin = user?.role === "SHO" || user?.role === "ADMIN_SI";

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Duty Roster Management</h1>
          <div className="page-subtitle">
            Shift-wise station deployments, versioning history, and human-in-the-loop approval gates.
          </div>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          {isShoOrAdmin && (
            <button
              className="btn btn-primary"
              onClick={() => setShowCreateModal(true)}
              id="btn-new-roster"
            >
              + Create Roster Draft
            </button>
          )}
        </div>
      </div>

      {error && <div className="alert-banner alert-banner--warning" style={{ marginBottom: "16px" }}>{error}</div>}
      {success && <div className="alert-banner alert-banner--info" style={{ marginBottom: "16px" }}>{success}</div>}

      {/* Filters Bar */}
      <div className="card" style={{ marginBottom: "20px" }}>
        <div className="card__body" style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <label style={{ fontSize: "13px", fontWeight: 600 }}>Filter Date:</label>
            <input
              type="date"
              className="form-control"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              style={{ width: "160px" }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <label style={{ fontSize: "13px", fontWeight: 600 }}>Shift:</label>
            <select
              className="form-control"
              value={selectedShift}
              onChange={(e) => setSelectedShift(e.target.value)}
              style={{ width: "140px" }}
            >
              <option value="">All Shifts</option>
              <option value="A">Shift A (07:00 - 15:00)</option>
              <option value="B">Shift B (15:00 - 23:00)</option>
              <option value="C">Shift C (23:00 - 07:00)</option>
            </select>
          </div>

          {(selectedDate || selectedShift) && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setSelectedDate("");
                setSelectedShift("");
              }}
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Roster Table */}
      <div className="card">
        <div className="card__header" style={{ display: "flex", justifyContent: "space-between" }}>
          <span className="card__title">Scheduled &amp; Historical Rosters</span>
          <span style={{ fontSize: "12px", color: "#94a3b8" }}>{rosters.length} records found</span>
        </div>
        <div className="card__body" style={{ padding: 0 }}>
          {loading ? (
            <div style={{ padding: "30px", textAlign: "center", color: "#94a3b8" }}>Loading rosters...</div>
          ) : rosters.length === 0 ? (
            <div className="empty-state" style={{ padding: "40px" }}>
              <div className="empty-state__icon">📅</div>
              <div className="empty-state__title">No Rosters Found</div>
              <div className="empty-state__text">
                No duty rosters match your filters. Create a new draft roster to begin allocations.
              </div>
            </div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Roster ID</th>
                    <th>Date</th>
                    <th>Shift</th>
                    <th>Version</th>
                    <th>Status</th>
                    <th>Policy Mode</th>
                    <th>Reason / Notes</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rosters.map((r) => {
                    const statusClass =
                      r.status === "published"
                        ? "badge-success"
                        : r.status === "approved"
                        ? "badge-info"
                        : r.status === "submitted"
                        ? "badge-warning"
                        : "badge-default";

                    return (
                      <tr key={r.id}>
                        <td><strong>#{r.id}</strong></td>
                        <td>{r.roster_date}</td>
                        <td>
                          <span style={{ fontWeight: 600, color: "#38bdf8" }}>Shift {r.shift_code}</span>
                        </td>
                        <td><span className="badge">v{r.version}</span></td>
                        <td>
                          <span className={`badge ${statusClass}`} style={{ textTransform: "capitalize" }}>
                            {r.status}
                          </span>
                        </td>
                        <td>
                          {r.is_demo_policy ? (
                            <span className="badge-demo">Demo Simulated</span>
                          ) : (
                            <span className="badge badge-default">Standard</span>
                          )}
                        </td>
                        <td style={{ fontSize: "12px", color: "#94a3b8", maxWidth: "200px" }}>
                          {r.change_reason || "Initial preparation"}
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => handleExplain(r.id)}
                              title="Ask AI Copilot to explain allocation decisions"
                            >
                              🤖 AI Explain
                            </button>

                            {r.status === "draft" && (
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => handleSubmit(r.id)}
                              >
                                Submit
                              </button>
                            )}

                            {r.status === "submitted" && user?.role === "SHO" && (
                              <button
                                className="btn btn-primary btn-sm"
                                onClick={() => handleApprove(r.id)}
                              >
                                Approve (SHO)
                              </button>
                            )}

                            {r.status === "approved" && (user?.role === "SHO" || user?.role === "ADMIN_SI") && (
                              <button
                                className="btn btn-success btn-sm"
                                onClick={() => handlePublish(r.id)}
                              >
                                Publish Roster
                              </button>
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

      {/* Create Draft Modal */}
      {showCreateModal && (
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
              <span className="card__title">Create New Roster Draft</span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowCreateModal(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreateRoster} className="card__body">
              <div className="form-group" style={{ marginBottom: "16px" }}>
                <label className="form-label">Roster Date</label>
                <input
                  type="date"
                  className="form-control"
                  required
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                />
              </div>

              <div className="form-group" style={{ marginBottom: "16px" }}>
                <label className="form-label">Shift</label>
                <select
                  className="form-control"
                  value={newShift}
                  onChange={(e) => setNewShift(e.target.value)}
                >
                  <option value="A">Shift A (07:00 - 15:00) — Morning</option>
                  <option value="B">Shift B (15:00 - 23:00) — Evening</option>
                  <option value="C">Shift C (23:00 - 07:00) — Night</option>
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: "20px" }}>
                <label className="form-label">Reason / Change Note</label>
                <textarea
                  className="form-control"
                  rows={3}
                  value={newReason}
                  onChange={(e) => setNewReason(e.target.value)}
                  placeholder="e.g. Regular shift scheduling, VIP visit bandobast adjustment..."
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Create Draft
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AI Explanation Modal */}
      {showAiModal && (
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
          <div className="card" style={{ width: "560px", maxWidth: "90vw" }}>
            <div className="card__header">
              <span className="card__title">🤖 AI Roster Explainability &amp; Advisory</span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowAiModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="card__body">
              {aiLoading ? (
                <div style={{ padding: "30px", textAlign: "center" }}>
                  Analyzing rotation rules, rest hours, and leave records...
                </div>
              ) : aiResult ? (
                <div>
                  <div
                    style={{
                      backgroundColor: "rgba(234, 179, 8, 0.1)",
                      border: "1px solid #ca8a04",
                      padding: "10px",
                      borderRadius: "6px",
                      fontSize: "12px",
                      color: "#fef08a",
                      marginBottom: "16px",
                    }}
                  >
                    {aiResult.disclaimer}
                  </div>

                  <h3 style={{ fontSize: "15px", marginBottom: "8px", color: "#38bdf8" }}>
                    Allocation Analysis &amp; Constraints
                  </h3>
                  <ul style={{ paddingLeft: "20px", fontSize: "13px", lineHeight: "1.6" }}>
                    {aiResult.key_reasons?.map((r: string, idx: number) => (
                      <li key={idx} style={{ marginBottom: "6px" }}>{r}</li>
                    ))}
                  </ul>

                  <div style={{ marginTop: "16px", fontSize: "12px", color: "#94a3b8" }}>
                    <strong>Excluded on Leave:</strong> {aiResult.excluded_on_leave} officers &middot;&nbsp;
                    <strong>Active Assigned:</strong> {aiResult.total_assignments}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="card__footer" style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="btn btn-secondary" onClick={() => setShowAiModal(false)}>
                Close Advisory
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
