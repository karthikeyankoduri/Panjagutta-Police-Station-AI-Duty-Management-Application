"use client";
import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import { useToday } from "@/lib/use-today";
import {
  getRosters,
  getRosterDetail,
  getRosterCalendar,
  getRosterVersions,
  getPolicyStatus,
  getMyDuties,
  createRoster,
  submitRoster,
  approveRoster,
  rejectRoster,
  reviseRoster,
  publishRoster,
  explainRoster,
  formatApiError,
  shiftLabels,
  RosterItem,
  RosterDetail,
  ShiftInfo,
} from "@/lib/api";

type ViewMode = "list" | "week" | "month";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

function statusClass(status: string) {
  return status === "published" ? "badge-success" : status === "approved" ? "badge-info" : status === "submitted" ? "badge-warning" : "badge-default";
}

function Modal({ title, onClose, children, footer, width = 650 }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; width?: number }) {
  return (
    <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.7)", padding: 12, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
      onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="card" style={{ width: "100%", maxWidth: `min(95vw, ${width}px)`, maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div className="card__header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="card__title">{title}</div>
          <button className="btn btn-secondary btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="card__body" style={{ overflowY: "auto" }}>{children}</div>
        {footer && <div className="card__footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>{footer}</div>}
      </div>
    </div>
  );
}

export default function RosterPage() {
  const { token, user } = useAuth();
  const [rosters, setRosters] = useState<RosterItem[]>([]);
  const [shifts, setShifts] = useState<ShiftInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("week");
  const [newDate, setNewDate] = useState<string>("");
  const todayIso = useToday();
  const [anchor, setAnchor] = useState<Date>(() => new Date(2000, 0, 1));
  useEffect(() => {
    if (todayIso) {
      const [y, m, d] = todayIso.split("-").map(Number);
      setAnchor(new Date(y, m - 1, d));
      setNewDate((cur) => cur || todayIso);
    }
  }, [todayIso]);
  const [calendar, setCalendar] = useState<Array<RosterItem & { date: string }>>([]);
  const [myDuties, setMyDuties] = useState<any[]>([]);

  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedShift, setSelectedShift] = useState<string>("");

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newShift, setNewShift] = useState<string>("A");
  const [newReason, setNewReason] = useState<string>("Routine daily roster preparation");

  const [detail, setDetail] = useState<RosterDetail | null>(null);
  const [versions, setVersions] = useState<RosterItem[] | null>(null);
  const [decision, setDecision] = useState<{ kind: "approve" | "reject" | "revise"; id: number } | null>(null);
  const [decisionText, setDecisionText] = useState("");

  const [showAiModal, setShowAiModal] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<any>(null);

  const labels = shiftLabels(shifts);
  const isSho = user?.role === "SHO" || user?.role === "SUPER_ADMIN";
  const isAdminSi = user?.role === "ADMIN_SI" || user?.role === "SUPER_ADMIN";
  const isShoOrAdmin = isSho || isAdminSi;
  const canAllocate = isShoOrAdmin || user?.role === "SECTOR_SI";

  const range = useMemo(() => {
    if (view === "month") {
      const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const start = addDays(first, -first.getDay());
      return { start, days: 42 };
    }
    const start = addDays(anchor, -anchor.getDay());
    return { start, days: 7 };
  }, [view, anchor]);

  const fetchRosters = useCallback(async () => {
    if (!token || (view !== "list" && !todayIso)) return;
    setLoading(true);
    setError(null);
    try {
      if (view === "list") {
        setRosters(await getRosters(token, { roster_date: selectedDate || undefined, shift_code: selectedShift || undefined }));
      } else {
        const res = await getRosterCalendar(token, iso(range.start), iso(addDays(range.start, range.days - 1)));
        setCalendar(res.cells);
      }
    } catch (err: any) {
      setError(formatApiError(err, "Failed to load rosters"));
    } finally {
      setLoading(false);
    }
  }, [token, view, selectedDate, selectedShift, range, todayIso]);

  useEffect(() => { fetchRosters(); }, [fetchRosters]);

  useEffect(() => {
    if (!token) return;
    getPolicyStatus(token).then((p) => setShifts(p.shifts)).catch(() => null);
    getMyDuties(token).then(setMyDuties);
  }, [token]);

  const refreshAll = (id?: number) => {
    fetchRosters();
    if (id && detail?.id === id) openDetail(id);
  };

  const openDetail = async (id: number) => {
    if (!token) return;
    try {
      setDetail(await getRosterDetail(token, id));
    } catch (err: any) {
      setError(formatApiError(err, `Failed to load Roster #${id}`));
    }
  };

  const openVersions = async (id: number) => {
    if (!token) return;
    try {
      setVersions(await getRosterVersions(token, id));
    } catch (err: any) {
      setError(formatApiError(err, "Failed to load versions"));
    }
  };

  const run = async (fn: () => Promise<any>, ok: string, id?: number) => {
    setError(null);
    try {
      const res = await fn();
      setSuccess(res?.detail ? `${ok} ${res.detail}` : ok);
      refreshAll(id);
      return res;
    } catch (err: any) {
      setError(formatApiError(err, "Action failed"));
    }
  };

  const handleCreateRoster = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const res = await run(() => createRoster(token, { roster_date: newDate, shift_code: newShift, change_reason: newReason, assignments: [] }), "Draft created.");
    if (res) setShowCreateModal(false);
  };

  const submitDecision = async () => {
    if (!token || !decision) return;
    const { kind, id } = decision;
    if (kind === "approve") await run(() => approveRoster(token, id, decisionText || undefined), `Roster #${id} approved.`, id);
    if (kind === "reject") await run(() => rejectRoster(token, id, decisionText), `Roster #${id} returned to the Admin SI.`, id);
    if (kind === "revise") {
      const res = await run(() => reviseRoster(token, id, decisionText), "New version created.");
      if (res?.id) setDetail(null);
    }
    setDecision(null);
    setDecisionText("");
  };

  const handleExplain = async (id: number) => {
    if (!token) return;
    setAiLoading(true);
    setShowAiModal(true);
    setAiResult(null);
    try {
      setAiResult(await explainRoster(token, id));
    } catch (err: any) {
      setError(formatApiError(err, "Failed to explain roster"));
      setShowAiModal(false);
    } finally {
      setAiLoading(false);
    }
  };

  const actions = (r: RosterItem) => (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      <button className="btn btn-secondary btn-sm" onClick={() => openDetail(r.id)}>📋 Allocations</button>
      <button className="btn btn-secondary btn-sm" onClick={() => openVersions(r.id)}>🕘 Versions</button>
      {user?.role !== "STAFF" && (
        <button className="btn btn-secondary btn-sm" onClick={() => handleExplain(r.id)} title="Ask AI Copilot to explain allocation decisions">🤖 AI Explain</button>
      )}
      {r.status === "draft" && isAdminSi && (
        <button className="btn btn-secondary btn-sm" onClick={() => run(() => submitRoster(token!, r.id), `Roster #${r.id} submitted for SHO approval.`, r.id)}>Submit</button>
      )}
      {r.status === "submitted" && isSho && (
        <>
          <button className="btn btn-primary btn-sm" onClick={() => { setDecision({ kind: "approve", id: r.id }); setDecisionText(""); }}>Approve (SHO)</button>
          <button className="btn btn-secondary btn-sm" onClick={() => { setDecision({ kind: "reject", id: r.id }); setDecisionText(""); }}>Return</button>
        </>
      )}
      {r.status === "approved" && isShoOrAdmin && (
        <button className="btn btn-success btn-sm" onClick={() => run(() => publishRoster(token!, r.id), `Roster #${r.id} published; assigned staff notified.`, r.id)}>Publish</button>
      )}
      {(r.status === "approved" || r.status === "published") && isShoOrAdmin && r.is_latest !== false && (
        <button className="btn btn-secondary btn-sm" onClick={() => { setDecision({ kind: "revise", id: r.id }); setDecisionText(""); }}>✏️ Revise (new version)</button>
      )}
    </div>
  );

  const days = Array.from({ length: range.days }, (_, i) => addDays(range.start, i));
  const cellFor = (d: string, s: string) => calendar.find((c) => c.date === d && c.shift_code === s);
  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Duty Roster</h1>
          <div className="page-subtitle">
            Daily, weekly and monthly rosters for Shifts A, B and C · every change is a new version with a reason.
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {isShoOrAdmin && (
            <button className="btn btn-primary" onClick={() => setShowCreateModal(true)} id="btn-new-roster">+ Create Roster Draft</button>
          )}
        </div>
      </div>

      {error && <div role="alert" className="alert-banner alert-banner--warning" style={{ marginBottom: 16 }}>{error}</div>}
      {success && <div className="alert-banner alert-banner--info" style={{ marginBottom: 16 }}>{success}</div>}

      {myDuties.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card__header"><span className="card__title">📌 My published duty</span></div>
          <div className="card__body" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {myDuties.slice(0, 6).map((d: any) => (
              <div key={`${d.roster_id}-${d.duty_category}`} style={{ border: "1px solid var(--color-border, #e2e8f0)", borderRadius: 8, padding: "8px 12px", minWidth: 180, background: d.duty_date === todayIso ? "var(--color-blue-50, #eff6ff)" : undefined }}>
                <div style={{ fontWeight: 700 }}>{d.duty_date === todayIso ? "Today" : d.duty_date} · Shift {d.shift_name}</div>
                <div style={{ fontSize: 13 }}>{d.duty_category}</div>
                <div className="text-muted" style={{ fontSize: 12 }}>{d.start_time}–{d.end_time}{d.current_task ? ` · ${d.current_task}` : ""}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {user?.role === "STAFF" && myDuties.length === 0 && !loading && (
        <div className="alert-banner alert-banner--info" style={{ marginBottom: 16 }}>No published duty is assigned to you yet.</div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card__body" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div role="tablist" aria-label="Roster view" style={{ display: "flex", gap: 6 }}>
            {(["week", "month", "list"] as ViewMode[]).map((m) => (
              <button key={m} role="tab" aria-selected={view === m} className={`btn btn-sm ${view === m ? "btn-primary" : "btn-secondary"}`} onClick={() => setView(m)}>
                {m === "week" ? "Week" : m === "month" ? "Month" : "List / day"}
              </button>
            ))}
          </div>
          {view !== "list" ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button className="btn btn-secondary btn-sm" aria-label="Previous" onClick={() => setAnchor(view === "month" ? new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1) : addDays(anchor, -7))}>‹</button>
              <strong style={{ minWidth: 160, textAlign: "center" }}>
                {view === "month"
                  ? anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
                  : `${range.start.toLocaleDateString()} – ${addDays(range.start, 6).toLocaleDateString()}`}
              </strong>
              <button className="btn btn-secondary btn-sm" aria-label="Next" onClick={() => setAnchor(view === "month" ? new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1) : addDays(anchor, 7))}>›</button>
              <button className="btn btn-secondary btn-sm" onClick={() => { const [y, m, d] = todayIso.split("-").map(Number); setAnchor(new Date(y, m - 1, d)); }}>Today</button>
            </div>
          ) : (
            <>
              <label style={{ fontSize: 13, fontWeight: 600 }} htmlFor="flt-date">Date</label>
              <input id="flt-date" type="date" className="form-control" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} style={{ width: 160 }} />
              <label style={{ fontSize: 13, fontWeight: 600 }} htmlFor="flt-shift">Shift</label>
              <select id="flt-shift" className="form-control" value={selectedShift} onChange={(e) => setSelectedShift(e.target.value)} style={{ width: 170 }}>
                <option value="">All Shifts</option>
                {["A", "B", "C"].map((s) => <option key={s} value={s}>Shift {s}{labels[s] ? ` (${labels[s]})` : ""}</option>)}
              </select>
              {(selectedDate || selectedShift) && (
                <button className="btn btn-secondary btn-sm" onClick={() => { setSelectedDate(""); setSelectedShift(""); }}>Reset</button>
              )}
            </>
          )}
          <span className="text-muted" style={{ fontSize: 12, marginLeft: "auto" }}>
            {Object.entries(labels).map(([k, v]) => `${k} ${v}`).join(" · ")}
          </span>
        </div>
      </div>

      {view !== "list" ? (
        <div className="card">
          <div className="card__body" style={{ overflowX: "auto", padding: 8 }}>
            {loading ? <div className="text-muted" style={{ padding: 30, textAlign: "center" }}>Loading roster calendar…</div> : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(120px, 1fr))", gap: 6, minWidth: 860 }}>
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <div key={d} style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textAlign: "center" }}>{d}</div>
                ))}
                {days.map((d) => {
                  const ds = iso(d);
                  const outside = view === "month" && d.getMonth() !== anchor.getMonth();
                  return (
                    <div key={ds} style={{ border: "1px solid var(--color-border, #e2e8f0)", borderRadius: 8, padding: 6, minHeight: view === "month" ? 96 : 140, opacity: outside ? 0.45 : 1, background: ds === todayIso ? "var(--color-blue-50, #eff6ff)" : undefined }}>
                      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{d.getDate()}</div>
                      {["A", "B", "C"].map((s) => {
                        const c = cellFor(ds, s);
                        return c ? (
                          <button key={s} onClick={() => openDetail(c.id)} className={`badge ${statusClass(c.status)}`}
                            style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 3, cursor: "pointer", border: 0, fontSize: 11 }}
                            title={`Shift ${s} v${c.version} · ${c.status} · ${c.assignment_count ?? 0} assigned`}>
                            {s} · v{c.version} · {c.status}{c.assignment_count ? ` · ${c.assignment_count}` : ""}
                          </button>
                        ) : (
                          <div key={s} style={{ fontSize: 11, color: "#94a3b8", marginBottom: 3 }}>
                            {s} · —
                            {isShoOrAdmin && (
                              <button className="btn btn-secondary btn-sm" style={{ padding: "0 6px", marginLeft: 4, fontSize: 10 }}
                                onClick={() => { setNewDate(ds); setNewShift(s); setShowCreateModal(true); }} aria-label={`Create shift ${s} roster for ${ds}`}>+</button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card__header" style={{ display: "flex", justifyContent: "space-between" }}>
            <span className="card__title">Rosters (all versions)</span>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>{rosters.length} records</span>
          </div>
          <div className="card__body" style={{ padding: 0 }}>
            {loading ? (
              <div style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>Loading rosters...</div>
            ) : rosters.length === 0 ? (
              <div className="empty-state" style={{ padding: 40 }}>
                <div className="empty-state__icon">📅</div>
                <div className="empty-state__title">No Rosters Found</div>
                <div className="empty-state__text">No rosters match your filters.</div>
              </div>
            ) : (
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr><th>ID</th><th>Date</th><th>Shift</th><th>Version</th><th>Status</th><th>Prepared / Approved</th><th>Reason</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {rosters.map((r) => (
                      <tr key={r.id} style={r.is_latest === false ? { opacity: 0.7 } : undefined}>
                        <td><strong>#{r.id}</strong></td>
                        <td>{r.roster_date}</td>
                        <td><strong>Shift {r.shift_code}</strong><div className="text-muted" style={{ fontSize: 11 }}>{labels[r.shift_code]}</div></td>
                        <td>
                          <span className="badge">v{r.version}</span>
                          {r.is_latest === false && <div className="text-muted" style={{ fontSize: 10 }}>superseded</div>}
                        </td>
                        <td>
                          <span className={`badge ${statusClass(r.status)}`} style={{ textTransform: "capitalize" }}>{r.status}</span>
                          {r.is_demo_policy && <span className="badge-demo" style={{ marginLeft: 4 }}>Demo</span>}
                        </td>
                        <td style={{ fontSize: 12 }}>{r.prepared_by || "—"}<br /><span className="text-muted">{r.approved_by || ""}</span></td>
                        <td style={{ fontSize: 12, color: "#94a3b8", maxWidth: 200 }}>{r.change_reason || "Initial preparation"}</td>
                        <td>{actions(r)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {detail && (
        <Modal
          width={760}
          onClose={() => setDetail(null)}
          title={<>Roster #{detail.id} — {detail.roster_date} · Shift {detail.shift_code} {labels[detail.shift_code] ? `(${labels[detail.shift_code]})` : ""}
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4, fontWeight: 400 }}>
              v{detail.version}{detail.is_latest === false ? " (superseded)" : ""} · <span style={{ textTransform: "capitalize" }}>{detail.status}</span>
              {detail.prepared_by ? ` · prepared by ${detail.prepared_by}` : ""}
              {detail.modified_by ? ` · modified by ${detail.modified_by}` : ""}
              {detail.approved_by ? ` · approved by ${detail.approved_by}` : ""}
            </div></>}
          footer={<>
            {detail.status === "draft" && canAllocate && (
              <Link href={`/duty-allocation?date=${detail.roster_date}&shift=${detail.shift_code}`} className="btn btn-primary btn-sm">✏️ Open in Duty Allocation</Link>
            )}
            {actions(detail)}
            <button className="btn btn-secondary" onClick={() => setDetail(null)}>Close</button>
          </>}
        >
          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            <div className="badge badge-success" style={{ padding: "8px 12px" }}>Assigned: {detail.total_assigned}</div>
            <div className={`badge ${detail.total_vacancies ? "badge-warning" : "badge-default"}`} style={{ padding: "8px 12px" }}>Vacant: {detail.total_vacancies}</div>
            <div style={{ flex: 1, fontSize: 13 }}><strong>Reason:</strong> {detail.change_reason || "None recorded"}
              {detail.approval_comments && <div><strong>SHO comments:</strong> {detail.approval_comments}</div>}
            </div>
          </div>
          {detail.vacancies_by_duty && detail.vacancies_by_duty.some((v) => v.vacant) && (
            <div className="alert-banner alert-banner--warning" style={{ marginBottom: 12, fontSize: 12 }}>
              Vacancies: {detail.vacancies_by_duty.filter((v) => v.vacant).map((v) => `${v.category} ${v.allocated}/${v.required}`).join(" · ")}
            </div>
          )}
          <div className="table-container">
            <table className="table" style={{ fontSize: 12 }}>
              <thead><tr><th>Duty</th><th>Officer</th><th>Rank</th><th>Service #</th><th>Sector</th><th>Exception</th></tr></thead>
              <tbody>
                {detail.assignments.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: "center", padding: 20, color: "#94a3b8" }}>No duty points allocated yet.</td></tr>
                ) : detail.assignments.map((a) => (
                  <tr key={a.id}>
                    <td><strong>{a.duty_category}</strong>{a.duty_section && <div style={{ color: "#64748b", fontSize: 10 }}>{a.duty_section}</div>}</td>
                    <td><strong>{a.staff_name}</strong></td>
                    <td>{a.designation}</td>
                    <td><code>{a.service_number}</code></td>
                    <td>{a.sector_id ? `Sector ${a.sector_id}` : "Station"}</td>
                    <td>
                      {a.is_exception ? (
                        <span className="badge badge-warning" title={a.exception_reason || ""}>
                          ⚠ {a.exception_reason}{a.exception_authorized_by ? ` — authorized by ${a.exception_authorized_by}` : ""}
                        </span>
                      ) : <span className="badge badge-default">Standard</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {versions && (
        <Modal title="Version history" onClose={() => setVersions(null)} footer={<button className="btn btn-secondary" onClick={() => setVersions(null)}>Close</button>}>
          <p className="text-muted" style={{ fontSize: 13, marginTop: 0 }}>Rosters are never overwritten. Each change is kept as a version with its reason.</p>
          <table className="table" style={{ fontSize: 12 }}>
            <thead><tr><th>Version</th><th>Status</th><th>Reason</th><th>Prepared</th><th>Approved</th><th>Assigned</th><th></th></tr></thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id}>
                  <td>v{v.version}{v.is_latest ? " (latest)" : ""}</td>
                  <td><span className={`badge ${statusClass(v.status)}`}>{v.status}</span></td>
                  <td>{v.change_reason || "—"}</td>
                  <td>{v.prepared_by || "—"}<div className="text-muted">{new Date(v.created_at).toLocaleString()}</div></td>
                  <td>{v.approved_by || "—"}</td>
                  <td>{v.assignment_count ?? 0}</td>
                  <td><button className="btn btn-secondary btn-sm" onClick={() => { setVersions(null); openDetail(v.id); }}>View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}

      {decision && (
        <Modal
          width={480}
          title={decision.kind === "approve" ? `Approve Roster #${decision.id}` : decision.kind === "reject" ? `Return Roster #${decision.id} for changes` : `Create a new version from Roster #${decision.id}`}
          onClose={() => setDecision(null)}
          footer={<>
            <button className="btn btn-secondary" onClick={() => setDecision(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={decision.kind !== "approve" && !decisionText.trim()} onClick={submitDecision}>
              {decision.kind === "approve" ? "Approve" : decision.kind === "reject" ? "Return to Admin SI" : "Create draft version"}
            </button>
          </>}
        >
          <label className="form-label" htmlFor="decision-text">
            {decision.kind === "approve" ? "Comments (optional)" : decision.kind === "reject" ? "What must change? (required)" : "Reason for the change (required)"}
          </label>
          <textarea id="decision-text" className="form-control" rows={3} value={decisionText} onChange={(e) => setDecisionText(e.target.value)} autoFocus />
          {decision.kind === "revise" && (
            <p className="text-muted" style={{ fontSize: 12 }}>The current version stays on record and remains in force until the new version is approved and published.</p>
          )}
        </Modal>
      )}

      {showCreateModal && (
        <Modal title="Create New Roster Draft" onClose={() => setShowCreateModal(false)}>
          <form onSubmit={handleCreateRoster}>
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label" htmlFor="new-date">Roster Date</label>
              <input id="new-date" type="date" className="form-control" required value={newDate} onChange={(e) => setNewDate(e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label" htmlFor="new-shift">Shift</label>
              <select id="new-shift" className="form-control" value={newShift} onChange={(e) => setNewShift(e.target.value)}>
                {["A", "B", "C"].map((s) => <option key={s} value={s}>Shift {s}{labels[s] ? ` (${labels[s]})` : ""}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 20 }}>
              <label className="form-label" htmlFor="new-reason">Reason / Change Note</label>
              <textarea id="new-reason" className="form-control" rows={3} value={newReason} onChange={(e) => setNewReason(e.target.value)}
                placeholder="Required when a roster already exists for this date and shift" />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Create Draft</button>
            </div>
          </form>
        </Modal>
      )}

      {showAiModal && (
        <Modal width={560} title="🤖 AI Roster Explainability & Advisory" onClose={() => setShowAiModal(false)}
          footer={<button className="btn btn-secondary" onClick={() => setShowAiModal(false)}>Close Advisory</button>}>
          {aiLoading ? (
            <div style={{ padding: 30, textAlign: "center" }}>Analyzing rotation rules, rest hours, and leave records...</div>
          ) : aiResult ? (
            <div>
              <div style={{ backgroundColor: "rgba(234, 179, 8, 0.1)", border: "1px solid #ca8a04", padding: 10, borderRadius: 6, fontSize: 12, marginBottom: 16 }}>
                {aiResult.disclaimer}
              </div>
              <h3 style={{ fontSize: 15, marginBottom: 8 }}>Allocation Analysis &amp; Constraints</h3>
              <ul style={{ paddingLeft: 20, fontSize: 13, lineHeight: 1.6 }}>
                {aiResult.key_reasons?.map((r: string, idx: number) => <li key={idx} style={{ marginBottom: 6 }}>{r}</li>)}
              </ul>
              <div style={{ marginTop: 16, fontSize: 12, color: "#94a3b8" }}>
                <strong>Excluded on Leave:</strong> {aiResult.excluded_on_leave} officers &middot;&nbsp;
                <strong>Active Assigned:</strong> {aiResult.total_assignments}
              </div>
            </div>
          ) : null}
        </Modal>
      )}
    </AppShell>
  );
}
