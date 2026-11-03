"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import {
  getInbox,
  approveRoster,
  rejectRoster,
  approveLeave,
  rejectLeave,
  authorizeMovement,
  rejectMovement,
  verifyAttendance,
  resolveAlert,
  askAI,
  formatApiError,
  InboxData,
} from "@/lib/api";

export default function ApprovalsPage() {
  const { token, user } = useAuth();
  const [inbox, setInbox] = useState<InboxData | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ text: string; type: "info" | "warning" } | null>(null);

  // AI Copilot Query Box
  const [aiQueryText, setAiQueryText] = useState("");
  const [aiResponse, setAiResponse] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const isSho = user?.role === "SHO" || user?.role === "SUPER_ADMIN";
  const canDecideLeave = ["SHO", "ADMIN_SI", "SUPER_ADMIN"].includes(user?.role || "");
  const canSupervise = ["SHO", "ADMIN_SI", "SECTOR_SI", "SUPER_ADMIN"].includes(user?.role || "");

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      setInbox(await getInbox(token));
    } catch (err: any) {
      setMessage({ text: formatApiError(err, "Failed to load approvals"), type: "warning" });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { loadData(); }, [loadData]);

  const act = async (fn: () => Promise<any>, ok: string) => {
    try {
      await fn();
      setMessage({ text: ok, type: "info" });
      loadData();
    } catch (err: any) {
      setMessage({ text: formatApiError(err, "Action failed"), type: "warning" });
    }
  };

  const ask = (q: string) => window.prompt(q) ?? null;

  const handleAskAI = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !aiQueryText.trim()) return;
    setAiLoading(true);
    setAiResponse(null);
    try {
      setAiResponse(await askAI(token, aiQueryText));
    } catch (err: any) {
      setMessage({ text: err.message, type: "warning" });
    } finally {
      setAiLoading(false);
    }
  };

  const c = inbox?.counts;

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Approvals &amp; Alerts</h1>
          <div className="page-subtitle">Everything waiting on you: roster approvals, leave decisions, movement authorizations, attendance verification and alerts.</div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={loadData}>↻ Refresh</button>
      </div>

      {message && (
        <div role={message.type === "warning" ? "alert" : "status"} className={`alert-banner alert-banner--${message.type === "warning" ? "warning" : "info"}`} style={{ marginBottom: 16 }}>
          {message.text}
        </div>
      )}

      {/* AI Advisory Query Assistant */}
      <div className="card" style={{ marginBottom: 24, borderColor: "#0284c7" }}>
        <div className="card__header" style={{ background: "rgba(2, 132, 199, 0.1)" }}>
          <span className="card__title" style={{ color: "#38bdf8" }}>🤖 AI Station Copilot &middot; Natural Language Query</span>
          <span style={{ fontSize: 12, color: "#94a3b8" }}>On-Premises &middot; Explainable</span>
        </div>
        <div className="card__body">
          <form onSubmit={handleAskAI} style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            <input type="text" className="form-control" value={aiQueryText} onChange={(e) => setAiQueryText(e.target.value)}
              placeholder="Ask station copilot: 'Who is on leave today?', 'Are there overdue movements?', 'What is Sector 1 strength?'..."
              style={{ flex: 1, minWidth: 220 }} aria-label="Ask the station copilot" />
            <button type="submit" className="btn btn-primary" disabled={aiLoading}>{aiLoading ? "Querying..." : "Ask Copilot"}</button>
          </form>
          {aiResponse && (
            <div style={{ border: "1px solid #1e293b", borderRadius: 6, padding: 14, marginTop: 12 }}>
              <div style={{ fontSize: 14, lineHeight: 1.5 }}>{aiResponse.response}</div>
              <div style={{ fontSize: 11, color: "#eab308", marginTop: 8 }}>{aiResponse.disclaimer}</div>
            </div>
          )}
        </div>
      </div>

      <div className="stats-grid-4">
        {[
          ["Total waiting", c?.total ?? 0, (c?.total ?? 0) > 0 ? "#eab308" : "#22c55e"],
          ["Rosters to approve", c?.rosters ?? 0, "#38bdf8"],
          ["Leave decisions", c?.leave ?? 0, "#eab308"],
          ["Movements to authorize", c?.movements ?? 0, "#f97316"],
          ["Attendance to verify", c?.attendance ?? 0, "#22c55e"],
          ["Open alerts", c?.alerts ?? 0, (c?.alerts ?? 0) > 0 ? "#ef4444" : "#22c55e"],
        ].map(([label, n, color]) => (
          <div className="card" key={label as string}>
            <div className="card__body" style={{ textAlign: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: color as string }}>{n as number}</div>
              <div style={{ fontSize: 12, color: "#94a3b8" }}>{label as string}</div>
            </div>
          </div>
        ))}
      </div>

      {loading && !inbox ? <div className="loading-overlay"><div className="spinner" /> Loading…</div> : inbox && (
        <>
          {isSho && (
            <Section title={`Rosters awaiting SHO approval (${inbox.rosters.length})`} empty="No submitted rosters." show={true} count={inbox.rosters.length}>
              <table className="table">
                <thead><tr><th>Roster</th><th>Date / Shift</th><th>Version</th><th>Reason</th><th>Waiting since</th><th>Action</th></tr></thead>
                <tbody>
                  {inbox.rosters.map((r) => (
                    <tr key={r.id}>
                      <td><Link href="/roster">#{r.id}</Link></td>
                      <td>{r.date} · Shift {r.shift_code}</td>
                      <td>v{r.version}</td>
                      <td>{r.change_reason || "—"}</td>
                      <td style={{ fontSize: 12 }}>{r.waiting_since ? new Date(r.waiting_since).toLocaleString() : "—"}</td>
                      <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button className="btn btn-primary btn-sm" onClick={() => {
                          const comments = ask("Approval comments (optional):");
                          if (comments !== null) act(() => approveRoster(token!, r.id, comments || undefined), `Roster #${r.id} approved.`);
                        }}>Approve</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => {
                          const comments = ask("What must change? (required)");
                          if (comments) act(() => rejectRoster(token!, r.id, comments), `Roster #${r.id} returned to the Admin SI.`);
                        }}>Return</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {canDecideLeave && (
            <Section title={`Leave requests (${inbox.leave.length})`} empty="No pending leave requests." show={true} count={inbox.leave.length}>
              <table className="table">
                <thead><tr><th>Reference</th><th>Officer</th><th>Type</th><th>Dates</th><th>Action</th></tr></thead>
                <tbody>
                  {inbox.leave.map((l) => (
                    <tr key={l.id}>
                      <td>{l.reference_number || `#${l.id}`}</td>
                      <td><strong>{l.staff_name || `Staff #${l.staff_id}`}</strong><div className="text-muted" style={{ fontSize: 11 }}>{l.service_number}</div></td>
                      <td><span className="badge badge-default">{l.leave_type}</span></td>
                      <td>{l.start_date} to {l.end_date}</td>
                      <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <Link className="btn btn-success btn-sm" href="/leave">Review &amp; approve</Link>
                        <button className="btn btn-danger btn-sm" onClick={() => {
                          const remarks = ask("Reason for rejection (required, shown to the officer):");
                          if (remarks) act(() => rejectLeave(token!, l.id, remarks), `Leave ${l.reference_number || l.id} rejected.`);
                        }}>Reject</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => {
                          const remarks = ask("Approval remarks (optional). Check the roster impact on the Leave page for vacancies:");
                          if (remarks !== null) act(() => approveLeave(token!, l.id, remarks || undefined), `Leave ${l.reference_number || l.id} approved.`);
                        }}>Quick approve</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {canSupervise && (
            <Section title={`Movement requests awaiting authorization (${inbox.movements.length})`} empty="No pending movement requests." show={true} count={inbox.movements.length}>
              <table className="table">
                <thead><tr><th>#</th><th>Officer</th><th>Destination</th><th>Purpose</th><th>Expected return</th><th>Action</th></tr></thead>
                <tbody>
                  {inbox.movements.map((m) => (
                    <tr key={m.id}>
                      <td>#{m.id}</td>
                      <td><strong>{m.staff_name || `Staff #${m.staff_id}`}</strong></td>
                      <td>{m.destination}</td>
                      <td>{m.purpose}</td>
                      <td style={{ fontSize: 12 }}>{m.expected_return ? new Date(m.expected_return).toLocaleString() : "—"}</td>
                      <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button className="btn btn-primary btn-sm" onClick={() => act(() => authorizeMovement(token!, m.id), `Movement #${m.id} authorized.`)}>Authorize</button>
                        <button className="btn btn-danger btn-sm" onClick={() => {
                          const notes = ask("Reason for not authorizing:");
                          if (notes !== null) act(() => rejectMovement(token!, m.id, notes || undefined), `Movement #${m.id} rejected.`);
                        }}>Reject</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {canSupervise && (
            <Section title={`Attendance submitted, awaiting verification (${inbox.attendance.length})`} empty="No attendance awaiting verification this month." show={true} count={inbox.attendance.length}>
              <table className="table">
                <thead><tr><th>Officer</th><th>Date</th><th>Shift</th><th>Action</th></tr></thead>
                <tbody>
                  {inbox.attendance.map((a) => (
                    <tr key={a.id}>
                      <td><strong>{a.staff_name || `Staff #${a.staff_id}`}</strong><div className="text-muted" style={{ fontSize: 11 }}>{a.service_number}</div></td>
                      <td>{a.date}</td>
                      <td>{a.shift_code}</td>
                      <td><button className="btn btn-success btn-sm" onClick={() => act(() => verifyAttendance(token!, a.id), "Attendance verified.")}>Verify</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          <Section title={`Alerts (${inbox.alerts.length})`} empty="All background checks clear." show={true} count={inbox.alerts.length}>
            <table className="table">
              <thead><tr><th>Severity</th><th>Type</th><th>Details</th><th>Raised</th><th></th></tr></thead>
              <tbody>
                {inbox.alerts.map((a) => (
                  <tr key={a.id}>
                    <td><span className={`badge ${a.severity === "critical" ? "badge-danger" : a.severity === "warning" ? "badge-warning" : "badge-info"}`}>{a.severity.toUpperCase()}</span></td>
                    <td><strong>{a.alert_type.replace(/_/g, " ")}</strong></td>
                    <td>{a.message}</td>
                    <td style={{ fontSize: 12, color: "#94a3b8" }}>{new Date(a.created_at).toLocaleString()}</td>
                    <td>{canSupervise && <button className="btn btn-secondary btn-sm" onClick={() => act(() => resolveAlert(token!, a.id), "Alert resolved.")}>Resolve</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </>
      )}
    </AppShell>
  );
}

function Section({ title, empty, count, children }: { title: string; empty: string; show: boolean; count: number; children: React.ReactNode }) {
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card__header"><span className="card__title">{title}</span></div>
      <div className="card__body" style={{ padding: 0 }}>
        {count === 0 ? <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>{empty}</div> : <div className="table-container">{children}</div>}
      </div>
    </div>
  );
}
