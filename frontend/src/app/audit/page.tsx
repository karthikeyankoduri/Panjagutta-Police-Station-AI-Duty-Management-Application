"use client";
import { useEffect, useState, useCallback } from "react";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import { getAuditLogs, AuditItem } from "@/lib/api";

export default function AuditPage() {
  const { token, user } = useAuth();
  const [logs, setLogs] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [actorFilter, setActorFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [exceptionsOnly, setExceptionsOnly] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE = 50;

  const fetchLogs = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getAuditLogs(token, {
        actor: actorFilter || undefined,
        action: actionFilter || undefined,
        entity: entityFilter || undefined,
        exceptions_only: exceptionsOnly || undefined,
        limit: PAGE,
        offset: page * PAGE,
      });
      setLogs(data);
    } catch (err: any) {
      setError(err.message || "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }, [token, actorFilter, actionFilter, entityFilter, exceptionsOnly, page]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Immutable Audit Trail &amp; Integrity Log</h1>
          <div className="page-subtitle">
            Append-only record of every sign-in, change, approval and authorized exception: who, what, when, old and new values, and who authorized it.
          </div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={fetchLogs}>
          ↻ Refresh Logs
        </button>
      </div>

      {error && <div className="alert-banner alert-banner--warning" style={{ marginBottom: "16px" }}>{error}</div>}

      {/* Filter Bar */}
      <div className="card" style={{ marginBottom: "20px" }}>
        <div className="card__body" style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <label style={{ fontSize: "13px", fontWeight: 600 }}>Actor:</label>
            <input
              type="text"
              className="form-control"
              placeholder="e.g. sho_demo"
              value={actorFilter}
              onChange={(e) => setActorFilter(e.target.value)}
              style={{ width: "140px" }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <label style={{ fontSize: "13px", fontWeight: 600 }}>Action:</label>
            <input
              type="text"
              className="form-control"
              placeholder="e.g. ROSTER_APPROVED"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              style={{ width: "160px" }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <label style={{ fontSize: "13px", fontWeight: 600 }}>Entity:</label>
            <input
              type="text"
              className="form-control"
              placeholder="e.g. Roster, LeaveRequest"
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
              style={{ width: "150px" }}
            />
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={exceptionsOnly} onChange={(e) => { setExceptionsOnly(e.target.checked); setPage(0); }} />
            Authorized exceptions only
          </label>

          {(actorFilter || actionFilter || entityFilter) && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setActorFilter("");
                setActionFilter("");
                setEntityFilter("");
              }}
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="card">
        <div className="card__header" style={{ display: "flex", justifyContent: "space-between" }}>
          <span className="card__title">Audit Trail Records ({logs.length})</span>
          <span style={{ fontSize: "12px", color: "#22c55e" }}>🔒 Read-Only &middot; Append-Only</span>
        </div>
        <div className="card__body" style={{ padding: 0 }}>
          {loading ? (
            <div style={{ padding: "30px", textAlign: "center", color: "#94a3b8" }}>Loading audit records...</div>
          ) : logs.length === 0 ? (
            <div style={{ padding: "30px", textAlign: "center", color: "#94a3b8" }}>
              No audit log entries match your criteria.
            </div>
          ) : (
            <div className="table-container">
              <table className="table" style={{ fontSize: "12px" }}>
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Entity</th>
                    <th>Authorized by / Reason</th>
                    <th>Modifications / Values</th>
                    <th>Request ID / IP</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id}>
                      <td style={{ whiteSpace: "nowrap", color: "#94a3b8" }}>
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td>
                        <strong style={{ color: "#38bdf8" }}>{log.actor_username}</strong>
                      </td>
                      <td>
                        <span className="badge badge-info">{log.action}</span>
                      </td>
                      <td>
                        {log.entity_type} {log.entity_id ? `(#${log.entity_id})` : ""}
                      </td>
                      <td style={{ fontSize: "11px", maxWidth: 200 }}>
                        {log.authorizer_username ? <strong>{log.authorizer_username}</strong> : "—"}
                        {log.exception_reason && <div style={{ color: "#d97706" }}>{log.exception_reason}</div>}
                      </td>
                      <td style={{ maxWidth: "320px", wordBreak: "break-all" }}>
                        {log.new_values && (
                          <div style={{ color: "#22c55e", fontSize: "11px" }}>
                            <strong>New:</strong> {JSON.stringify(log.new_values)}
                          </div>
                        )}
                        {log.old_values && (
                          <div style={{ color: "#ef4444", fontSize: "11px" }}>
                            <strong>Old:</strong> {JSON.stringify(log.old_values)}
                          </div>
                        )}
                      </td>
                      <td style={{ fontSize: "11px", color: "#64748b" }}>
                        <div>{log.ip_address || "—"}</div>
                        <div style={{ fontFamily: "monospace", fontSize: "10px" }}>
                          {log.request_id ? log.request_id.substring(0, 8) + "..." : ""}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="card__footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button className="btn btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>‹ Newer</button>
          <span style={{ fontSize: 12 }}>Page {page + 1}</span>
          <button className="btn btn-secondary btn-sm" disabled={logs.length < PAGE} onClick={() => setPage((p) => p + 1)}>Older ›</button>
        </div>
      </div>
    </AppShell>
  );
}
