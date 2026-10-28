"use client";
import { useEffect, useState, useCallback } from "react";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import {
  getAlerts,
  getRosters,
  getLeaveRequests,
  getMovements,
  approveRoster,
  approveLeave,
  rejectLeave,
  askAI,
  Alert,
  RosterItem,
  LeaveRequest,
  Movement,
} from "@/lib/api";

export default function ApprovalsPage() {
  const { token, user } = useAuth();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [pendingRosters, setPendingRosters] = useState<RosterItem[]>([]);
  const [pendingLeaves, setPendingLeaves] = useState<LeaveRequest[]>([]);
  const [overdueMovements, setOverdueMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ text: string; type: "info" | "warning" } | null>(null);

  // AI Copilot Query Box
  const [aiQueryText, setAiQueryText] = useState("");
  const [aiResponse, setAiResponse] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [alertsData, rostersData, leavesData, movData] = await Promise.all([
        getAlerts(token),
        getRosters(token, { roster_status: "submitted" }),
        getLeaveRequests(token, { leave_status: "Pending" }),
        getMovements(token),
      ]);
      setAlerts(alertsData);
      setPendingRosters(rostersData);
      setPendingLeaves(leavesData);
      setOverdueMovements(movData.filter((m) => m.is_overdue));
    } catch (err: any) {
      setMessage({ text: err.message || "Failed to load approval center data", type: "warning" });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleApproveRoster = async (id: number) => {
    if (!token) return;
    try {
      await approveRoster(token, id, "Approved via Approvals & Alerts Center by SHO.");
      setMessage({ text: `Roster #${id} officially approved.`, type: "info" });
      loadData();
    } catch (err: any) {
      setMessage({ text: err.message, type: "warning" });
    }
  };

  const handleApproveLeave = async (id: number) => {
    if (!token) return;
    try {
      await approveLeave(token, id, "Approved via Approvals Center.");
      setMessage({ text: `Leave application #${id} approved.`, type: "info" });
      loadData();
    } catch (err: any) {
      setMessage({ text: err.message, type: "warning" });
    }
  };

  const handleAskAI = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !aiQueryText.trim()) return;
    setAiLoading(true);
    setAiResponse(null);
    try {
      const res = await askAI(token, aiQueryText);
      setAiResponse(res);
    } catch (err: any) {
      setMessage({ text: err.message, type: "warning" });
    } finally {
      setAiLoading(false);
    }
  };

  const totalPending = pendingRosters.length + pendingLeaves.length + overdueMovements.length + alerts.length;

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Approvals &amp; Alerts Command Center</h1>
          <div className="page-subtitle">
            Centralized operational triage: review pending rosters, authorize leave requests, and resolve active alerts.
          </div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={loadData}>
          ↻ Refresh Alerts
        </button>
      </div>

      {message && (
        <div
          className={`alert-banner alert-banner--${message.type === "warning" ? "warning" : "info"}`}
          style={{ marginBottom: "16px" }}
        >
          {message.text}
        </div>
      )}

      {/* AI Advisory Query Assistant */}
      <div className="card" style={{ marginBottom: "24px", borderColor: "#0284c7" }}>
        <div className="card__header" style={{ background: "rgba(2, 132, 199, 0.1)" }}>
          <span className="card__title" style={{ color: "#38bdf8" }}>
            🤖 AI Station Copilot &middot; Natural Language Query
          </span>
          <span style={{ fontSize: "12px", color: "#94a3b8" }}>On-Premises &middot; Explainable</span>
        </div>
        <div className="card__body">
          <form onSubmit={handleAskAI} style={{ display: "flex", gap: "10px", marginBottom: "12px" }}>
            <input
              type="text"
              className="form-control"
              value={aiQueryText}
              onChange={(e) => setAiQueryText(e.target.value)}
              placeholder="Ask station copilot: 'Who is on leave today?', 'Are there overdue movements?', 'What is Sector 1 strength?'..."
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn btn-primary" disabled={aiLoading}>
              {aiLoading ? "Querying..." : "Ask Copilot"}
            </button>
          </form>

          {aiResponse && (
            <div
              style={{
                background: "#0f172a",
                border: "1px solid #1e293b",
                borderRadius: "6px",
                padding: "14px",
                marginTop: "12px",
              }}
            >
              <div style={{ fontSize: "14px", color: "#f8fafc", lineHeight: "1.5" }}>
                {aiResponse.response}
              </div>
              <div style={{ fontSize: "11px", color: "#eab308", marginTop: "8px" }}>
                {aiResponse.disclaimer}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Triage Overview Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "24px" }}>
        <div className="card">
          <div className="card__body" style={{ textAlign: "center" }}>
            <div style={{ fontSize: "24px", fontWeight: 700, color: totalPending > 0 ? "#eab308" : "#22c55e" }}>
              {totalPending}
            </div>
            <div style={{ fontSize: "12px", color: "#94a3b8" }}>Total Pending Items</div>
          </div>
        </div>
        <div className="card">
          <div className="card__body" style={{ textAlign: "center" }}>
            <div style={{ fontSize: "24px", fontWeight: 700, color: pendingRosters.length > 0 ? "#38bdf8" : "#94a3b8" }}>
              {pendingRosters.length}
            </div>
            <div style={{ fontSize: "12px", color: "#94a3b8" }}>Submitted Rosters</div>
          </div>
        </div>
        <div className="card">
          <div className="card__body" style={{ textAlign: "center" }}>
            <div style={{ fontSize: "24px", fontWeight: 700, color: pendingLeaves.length > 0 ? "#eab308" : "#94a3b8" }}>
              {pendingLeaves.length}
            </div>
            <div style={{ fontSize: "12px", color: "#94a3b8" }}>Pending Leaves</div>
          </div>
        </div>
        <div className="card">
          <div className="card__body" style={{ textAlign: "center" }}>
            <div style={{ fontSize: "24px", fontWeight: 700, color: overdueMovements.length > 0 ? "#ef4444" : "#22c55e" }}>
              {overdueMovements.length}
            </div>
            <div style={{ fontSize: "12px", color: "#94a3b8" }}>Overdue Movement Alerts</div>
          </div>
        </div>
      </div>

      {/* 1. Submitted Rosters Awaiting SHO Approval */}
      <div className="card" style={{ marginBottom: "20px" }}>
        <div className="card__header">
          <span className="card__title">Submitted Rosters Requiring SHO Approval ({pendingRosters.length})</span>
        </div>
        <div className="card__body" style={{ padding: 0 }}>
          {pendingRosters.length === 0 ? (
            <div style={{ padding: "20px", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>
              No submitted rosters awaiting approval.
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
                    <th>Reason</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingRosters.map((r) => (
                    <tr key={r.id}>
                      <td><strong>#{r.id}</strong></td>
                      <td>{r.roster_date}</td>
                      <td>Shift {r.shift_code}</td>
                      <td><span className="badge">v{r.version}</span></td>
                      <td>{r.change_reason || "Scheduled duty plan"}</td>
                      <td>
                        {user?.role === "SHO" ? (
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => handleApproveRoster(r.id)}
                          >
                            Approve (SHO)
                          </button>
                        ) : (
                          <span style={{ fontSize: "12px", color: "#94a3b8" }}>Awaiting SHO</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 2. Pending Leave Applications */}
      <div className="card" style={{ marginBottom: "20px" }}>
        <div className="card__header">
          <span className="card__title">Leave Applications Requiring Sign-Off ({pendingLeaves.length})</span>
        </div>
        <div className="card__body" style={{ padding: 0 }}>
          {pendingLeaves.length === 0 ? (
            <div style={{ padding: "20px", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>
              No pending leave applications.
            </div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Req #</th>
                    <th>Staff Officer</th>
                    <th>Type</th>
                    <th>Date Range</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingLeaves.map((l) => (
                    <tr key={l.id}>
                      <td>#{l.id}</td>
                      <td><strong>Officer #{l.staff_id}</strong></td>
                      <td><span className="badge badge-default">{l.leave_type}</span></td>
                      <td>{l.start_date} to {l.end_date}</td>
                      <td>
                        <button
                          className="btn btn-success btn-sm"
                          onClick={() => handleApproveLeave(l.id)}
                        >
                          Approve Leave
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 3. System Alerts from APScheduler */}
      <div className="card">
        <div className="card__header">
          <span className="card__title">Automated Background Alerts ({alerts.length})</span>
        </div>
        <div className="card__body" style={{ padding: 0 }}>
          {alerts.length === 0 ? (
            <div style={{ padding: "20px", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>
              All background checks clear. No active threshold violations.
            </div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Severity</th>
                    <th>Alert Type</th>
                    <th>Details</th>
                    <th>Recorded At</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <span
                          className={`badge ${
                            a.severity === "critical"
                              ? "badge-danger"
                              : a.severity === "warning"
                              ? "badge-warning"
                              : "badge-info"
                          }`}
                        >
                          {a.severity.toUpperCase()}
                        </span>
                      </td>
                      <td><strong>{a.alert_type}</strong></td>
                      <td>{a.message}</td>
                      <td style={{ fontSize: "12px", color: "#94a3b8" }}>
                        {new Date(a.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
