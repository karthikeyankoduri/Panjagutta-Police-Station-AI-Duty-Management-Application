"use client";
import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
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
  Sector,
  DutyItem,
  StaffMember,
  ValidationIssue,
  ApiError,
  getStaff,
  getDashboardSummary,
  getDuties,
  getActiveDraft,
  getSectors,
  getAuthorizers,
  updateRosterAssignments,
  validateRoster,
  saveDraft,
  loadDraft,
  getDutyChangeRequests,
  submitDutyChangeRequest,
  approveDutyChangeRequest,
  rejectDutyChangeRequest,
  withdrawDutyChangeRequest,
  DutyChangeRequest,
} from "@/lib/api";

type OuterTab = "rosters" | "allocation" | "requests";
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

interface AllocatedOfficer {
  staff_id: number;
  name: string;
  designation: string;
  service_number: string;
  sector_id?: number | null;
  is_exception?: boolean;
  exception_reason?: string;
  exception_authorized_by_id?: number;
}

interface DutySlotWithAllocations extends DutyItem {
  assigned_staff: AllocatedOfficer[];
}

type SavedAllocation = { duty_master_id: number; officers: AllocatedOfficer[] }[];

export default function UnifiedRosterPage() {
  const { token, user } = useAuth();
  const todayIso = useToday();

  // Outer tab state
  const [activeTab, setActiveTab] = useState<OuterTab>("rosters");
  const [shifts, setShifts] = useState<ShiftInfo[]>([]);
  const [pendingChangeCount, setPendingChangeCount] = useState<number>(0);

  // Cross-tab handover state
  const [allocationTarget, setAllocationTarget] = useState<{ date: string; shift: string } | null>(null);
  const [prefilledChange, setPrefilledChange] = useState<{
    roster_id: number;
    current_roster_date: string;
    current_shift_code: string;
    current_duty_category: string;
  } | null>(null);

  const labels = shiftLabels(shifts);
  const isSho = user?.role === "SHO" || user?.role === "SUPER_ADMIN";
  const isAdminSi = user?.role === "ADMIN_SI" || user?.role === "SUPER_ADMIN";
  const isShoOrAdmin = isSho || isAdminSi;
  const canAllocate = isShoOrAdmin || user?.role === "SECTOR_SI";
  const isStaff = user?.role === "STAFF";

  // URL query parameter synchronization
  useEffect(() => {
    if (typeof window === "undefined") return;
    const qs = new URLSearchParams(window.location.search);
    const tabParam = qs.get("tab");
    if (tabParam === "allocation" && canAllocate) {
      setActiveTab("allocation");
      const d = qs.get("date");
      const s = qs.get("shift");
      if (d || s) {
        setAllocationTarget({ date: d || "", shift: s || "A" });
      }
    } else if (tabParam === "requests") {
      setActiveTab("requests");
    } else if (tabParam === "rosters") {
      setActiveTab("rosters");
    }
  }, [canAllocate]);

  // Load shifts policy and pending requests count
  useEffect(() => {
    if (!token) return;
    getPolicyStatus(token).then((p) => setShifts(p.shifts)).catch(() => null);
    getDutyChangeRequests(token, { status: "pending" })
      .then((reqs) => setPendingChangeCount(reqs.length))
      .catch(() => null);
  }, [token]);

  const switchTab = (tab: OuterTab) => {
    setActiveTab(tab);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", tab);
      window.history.replaceState({}, "", url.toString());
    }
  };

  return (
    <AppShell>
      <div className="page-header" style={{ marginBottom: 12 }}>
        <div>
          <h1 className="page-title">Roster &amp; Duty Management</h1>
          <div className="page-subtitle">
            Plan shift rosters, allocate personnel to duty points, and manage duty change requests in one place.
          </div>
        </div>
      </div>

      {/* Main Tab Navigation */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__body" style={{ padding: "8px 12px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className={`btn btn-sm ${activeTab === "rosters" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => switchTab("rosters")}
          >
            📅 Shift Rosters
          </button>

          {canAllocate && (
            <button
              type="button"
              className={`btn btn-sm ${activeTab === "allocation" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => switchTab("allocation")}
            >
              🧩 Duty Allocation
            </button>
          )}

          <button
            type="button"
            className={`btn btn-sm ${activeTab === "requests" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => switchTab("requests")}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <span>🔄 Change Requests</span>
            {pendingChangeCount > 0 && (
              <span className="badge badge-warning" style={{ fontSize: 10, padding: "2px 6px" }}>
                {pendingChangeCount}
              </span>
            )}
          </button>

          <span className="text-muted" style={{ fontSize: 12, marginLeft: "auto" }}>
            {Object.entries(labels).map(([k, v]) => `${k} ${v}`).join(" · ")}
          </span>
        </div>
      </div>

      {/* Tab 1: Rosters */}
      {activeTab === "rosters" && (
        <RostersPanel
          token={token!}
          user={user}
          shifts={shifts}
          labels={labels}
          todayIso={todayIso}
          isSho={isSho}
          isAdminSi={isAdminSi}
          isShoOrAdmin={isShoOrAdmin}
          canAllocate={canAllocate}
          onOpenAllocation={(date, shift) => {
            setAllocationTarget({ date, shift });
            switchTab("allocation");
          }}
          onRequestChange={(duty) => {
            setPrefilledChange({
              roster_id: duty.roster_id,
              current_roster_date: duty.duty_date,
              current_shift_code: duty.shift_code || "A",
              current_duty_category: duty.duty_category,
            });
            switchTab("requests");
          }}
        />
      )}

      {/* Tab 2: Duty Allocation */}
      {activeTab === "allocation" && canAllocate && (
        <DutyAllocationPanel
          token={token!}
          user={user}
          shifts={shifts}
          labels={labels}
          todayIso={todayIso}
          isSho={isSho}
          isAdminSi={isAdminSi}
          initialDate={allocationTarget?.date}
          initialShift={allocationTarget?.shift}
        />
      )}

      {/* Tab 3: Change Requests */}
      {activeTab === "requests" && (
        <DutyChangeRequestsPanel
          token={token!}
          user={user}
          shifts={shifts}
          labels={labels}
          prefill={prefilledChange}
          onClearPrefill={() => setPrefilledChange(null)}
          onCountChange={(cnt) => setPendingChangeCount(cnt)}
        />
      )}
    </AppShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 1: ROSTERS PANEL
// ─────────────────────────────────────────────────────────────────────────────

function RostersPanel({
  token,
  user,
  shifts,
  labels,
  todayIso,
  isSho,
  isAdminSi,
  isShoOrAdmin,
  canAllocate,
  onOpenAllocation,
  onRequestChange,
}: {
  token: string;
  user: any;
  shifts: ShiftInfo[];
  labels: Record<string, string>;
  todayIso: string;
  isSho: boolean;
  isAdminSi: boolean;
  isShoOrAdmin: boolean;
  canAllocate: boolean;
  onOpenAllocation: (date: string, shift: string) => void;
  onRequestChange: (duty: any) => void;
}) {
  const [rosters, setRosters] = useState<RosterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("week");
  const [newDate, setNewDate] = useState<string>("");
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
    getMyDuties(token).then(setMyDuties).catch(() => null);
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
        <button className="btn btn-secondary btn-sm" onClick={() => run(() => submitRoster(token, r.id), `Roster #${r.id} submitted for SHO approval.`, r.id)}>Submit</button>
      )}
      {r.status === "submitted" && isSho && (
        <>
          <button className="btn btn-primary btn-sm" onClick={() => { setDecision({ kind: "approve", id: r.id }); setDecisionText(""); }}>Approve (SHO)</button>
          <button className="btn btn-secondary btn-sm" onClick={() => { setDecision({ kind: "reject", id: r.id }); setDecisionText(""); }}>Return</button>
        </>
      )}
      {r.status === "approved" && isShoOrAdmin && (
        <button className="btn btn-success btn-sm" onClick={() => run(() => publishRoster(token, r.id), `Roster #${r.id} published; assigned staff notified.`, r.id)}>Publish</button>
      )}
      {(r.status === "approved" || r.status === "published") && isShoOrAdmin && r.is_latest !== false && (
        <button className="btn btn-secondary btn-sm" onClick={() => { setDecision({ kind: "revise", id: r.id }); setDecisionText(""); }}>✏️ Revise (new version)</button>
      )}
    </div>
  );

  const days = Array.from({ length: range.days }, (_, i) => addDays(range.start, i));
  const cellFor = (d: string, s: string) => calendar.find((c) => c.date === d && c.shift_code === s);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Shift Rosters</h2>
        {isShoOrAdmin && (
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreateModal(true)} id="btn-new-roster">+ Create Roster Draft</button>
        )}
      </div>

      {error && <div role="alert" className="alert-banner alert-banner--warning" style={{ marginBottom: 16 }}>{error}</div>}
      {success && <div className="alert-banner alert-banner--info" style={{ marginBottom: 16 }}>{success}</div>}

      {/* Staff's My Published Duties banner with Request Change shortcut */}
      {myDuties.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card__header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="card__title">📌 My Published Duties</span>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>Assignments in published station rosters</span>
          </div>
          <div className="card__body" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {myDuties.slice(0, 6).map((d: any) => (
              <div key={`${d.roster_id}-${d.duty_category}`} style={{ border: "1px solid var(--color-border, #e2e8f0)", borderRadius: 8, padding: "10px 14px", minWidth: 200, background: d.duty_date === todayIso ? "var(--color-blue-50, #eff6ff)" : undefined }}>
                <div style={{ fontWeight: 700 }}>{d.duty_date === todayIso ? "Today" : d.duty_date} · Shift {d.shift_name}</div>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{d.duty_category}</div>
                <div className="text-muted" style={{ fontSize: 12 }}>{d.start_time}–{d.end_time}{d.current_task ? ` · ${d.current_task}` : ""}</div>
                <div style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: 11, padding: "2px 8px" }}
                    onClick={() => onRequestChange(d)}
                  >
                    🔄 Request Shift/Duty Change
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {user?.role === "STAFF" && myDuties.length === 0 && !loading && (
        <div className="alert-banner alert-banner--info" style={{ marginBottom: 16 }}>No published duty is assigned to you yet.</div>
      )}

      {/* Controls for Week/Month/List views */}
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

      {/* Roster Details Modal */}
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
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  const d = detail.roster_date;
                  const s = detail.shift_code;
                  setDetail(null);
                  onOpenAllocation(d, s);
                }}
              >
                ✏️ Open in Duty Allocation
              </button>
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

      {/* Version History Modal */}
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

      {/* Decision Modal (Approve / Return / Revise) */}
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

      {/* Create Roster Draft Modal */}
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

      {/* AI Explain Advisory Modal */}
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
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 2: DUTY ALLOCATION PANEL
// ─────────────────────────────────────────────────────────────────────────────

function DutyAllocationPanel({
  token,
  user,
  shifts,
  labels,
  todayIso,
  isSho,
  isAdminSi,
  initialDate,
  initialShift,
}: {
  token: string;
  user: any;
  shifts: ShiftInfo[];
  labels: Record<string, string>;
  todayIso: string;
  isSho: boolean;
  isAdminSi: boolean;
  initialDate?: string;
  initialShift?: string;
}) {
  const [duties, setDuties] = useState<DutySlotWithAllocations[]>([]);
  const [activeRoster, setActiveRoster] = useState<RosterDetail | null>(null);
  const [availableStaff, setAvailableStaff] = useState<StaffMember[]>([]);
  const [staffStatusMap, setStaffStatusMap] = useState<Record<number, string>>({});
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [authorizers, setAuthorizers] = useState<Array<{ user_id: number; username: string; role: string; name: string; is_self: boolean }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedShift, setSelectedShift] = useState(initialShift || "A");
  const [selectedDate, setSelectedDate] = useState(initialDate || todayIso);
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState<string>("");
  const [sectorFilter, setSectorFilter] = useState<string>("ALL");
  const [sectionFilter, setSectionFilter] = useState<string>("ALL");

  const [isException, setIsException] = useState(false);
  const [exceptionReason, setExceptionReason] = useState("");
  const [authorizerId, setAuthorizerId] = useState<string>("");
  const [changeReason, setChangeReason] = useState("Routine daily duty allocation update");

  const [message, setMessage] = useState<{ text: string; type: "info" | "warning" | "success" } | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [validating, setValidating] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [restorable, setRestorable] = useState<SavedAllocation | null>(null);
  const validateTimer = useRef<number | undefined>(undefined);

  const canEdit = isSho || isAdminSi;
  const draftKey = `alloc:${selectedDate}:${selectedShift}`;

  useEffect(() => {
    if (initialDate) setSelectedDate(initialDate);
    if (initialShift && ["A", "B", "C"].includes(initialShift)) setSelectedShift(initialShift);
  }, [initialDate, initialShift]);

  useEffect(() => {
    if (!token) return;
    getSectors(token).then(setSectors).catch(() => null);
    getAuthorizers(token).then(setAuthorizers).catch(() => null);
  }, [token]);

  const toPayload = (slots: DutySlotWithAllocations[]) =>
    slots.flatMap((slot) =>
      slot.assigned_staff.map((asg) => ({
        duty_master_id: slot.id,
        staff_id: asg.staff_id,
        notes: asg.exception_reason || null,
        is_exception: !!asg.is_exception,
        exception_reason: asg.exception_reason || null,
        exception_authorized_by_id: asg.exception_authorized_by_id ?? null,
      }))
    );

  const loadWorkspace = useCallback(async () => {
    if (!token || !selectedDate) return;
    setLoading(true);
    setMessage(null);
    try {
      const [staffList, summary, dutiesList, draftRes] = await Promise.all([
        getStaff(token, { is_active: true }),
        getDashboardSummary(token, selectedDate, selectedShift),
        getDuties(token, { shift_code: selectedShift, active_only: true }),
        getActiveDraft(token, selectedDate, selectedShift),
      ]);
      setAvailableStaff(staffList);
      const statusMap: Record<number, string> = {};
      summary.staff_status_list?.forEach((s) => { statusMap[s.staff_id] = s.status; });
      setStaffStatusMap(statusMap);

      const rosterData = draftRes?.roster || null;
      setActiveRoster(rosterData);

      const byDuty: Record<number, AllocatedOfficer[]> = {};
      rosterData?.assignments?.forEach((asg) => {
        (byDuty[asg.duty_master_id] ||= []).push({
          staff_id: asg.staff_id,
          name: asg.staff_name,
          designation: asg.designation,
          service_number: asg.service_number,
          sector_id: asg.sector_id,
          is_exception: asg.is_exception,
          exception_reason: asg.exception_reason,
          exception_authorized_by_id: asg.exception_authorized_by_id,
        });
      });
      const merged = dutiesList.map((d) => ({ ...d, assigned_staff: byDuty[d.id] || [] }));
      setDuties(merged);
      setDirty(false);
      setIssues([]);
      setSelectedSlotId((cur) => (cur && merged.some((m) => m.id === cur) ? cur : merged[0]?.id ?? null));

      // Offer to restore an unsaved draft kept on the server (survives logout).
      const saved = await loadDraft<SavedAllocation>(token, `alloc:${selectedDate}:${selectedShift}`);
      const serverSig = JSON.stringify(merged.map((d) => [d.id, d.assigned_staff.map((a) => a.staff_id).sort()]));
      const savedSig = saved ? JSON.stringify(merged.map((d) => [d.id, (saved.find((s) => s.duty_master_id === d.id)?.officers || []).map((a) => a.staff_id).sort()])) : serverSig;
      setRestorable(rosterData?.status === "draft" && saved && savedSig !== serverSig ? saved : null);
    } catch (err: any) {
      setMessage({ text: formatApiError(err, "Failed to load duty workspace"), type: "warning" });
    } finally {
      setLoading(false);
    }
  }, [token, selectedDate, selectedShift]);

  useEffect(() => { loadWorkspace(); }, [loadWorkspace]);

  const runValidation = useCallback(async (slots: DutySlotWithAllocations[]) => {
    if (!token || !selectedDate) return null;
    setValidating(true);
    try {
      const res = await validateRoster(token, { roster_date: selectedDate, shift_code: selectedShift, assignments: toPayload(slots) });
      setIssues(res.issues);
      return res;
    } catch {
      return null;
    } finally {
      setValidating(false);
    }
  }, [token, selectedDate, selectedShift]);

  useEffect(() => {
    if (!dirty || !token) return;
    window.clearTimeout(validateTimer.current);
    validateTimer.current = window.setTimeout(() => {
      runValidation(duties);
      saveDraft(token, draftKey, duties.map((d) => ({ duty_master_id: d.id, officers: d.assigned_staff })));
    }, 600);
    return () => window.clearTimeout(validateTimer.current);
  }, [duties, dirty, token, draftKey, runValidation]);

  const updateDuties = (fn: (prev: DutySlotWithAllocations[]) => DutySlotWithAllocations[]) => {
    setDuties(fn);
    setDirty(true);
  };

  const restoreDraft = () => {
    if (!restorable) return;
    updateDuties((prev) => prev.map((d) => ({ ...d, assigned_staff: restorable.find((s) => s.duty_master_id === d.id)?.officers || [] })));
    setRestorable(null);
    setMessage({ text: "Restored your unsaved allocation draft. Review and save it.", type: "info" });
  };

  const handleCreateDraft = async () => {
    if (!token) return;
    setSaving(true);
    try {
      await createRoster(token, {
        roster_date: selectedDate,
        shift_code: selectedShift,
        change_reason: changeReason || `Draft for Shift ${selectedShift} on ${selectedDate}`,
        assignments: [],
      });
      setMessage({ text: `Draft roster created for Shift ${selectedShift}.`, type: "success" });
      await loadWorkspace();
    } catch (err: any) {
      setMessage({ text: formatApiError(err, "Failed to create draft roster"), type: "warning" });
    } finally {
      setSaving(false);
    }
  };

  const handleAssignOfficer = () => {
    if (!selectedSlotId || !selectedStaffId) {
      setMessage({ text: "Select a duty point and an officer first.", type: "warning" });
      return;
    }
    const staffId = parseInt(selectedStaffId, 10);
    const staffObj = availableStaff.find((s) => s.id === staffId);
    const targetDuty = duties.find((d) => d.id === selectedSlotId);
    if (!staffObj || !targetDuty) return;

    const alreadyAssignedSlot = duties.find((d) => d.assigned_staff.some((asg) => asg.staff_id === staffId));
    if (alreadyAssignedSlot) {
      setMessage({ text: `${staffObj.name} is already assigned to "${alreadyAssignedSlot.category}". Remove them first to reallocate.`, type: "warning" });
      return;
    }

    const eligible = targetDuty.eligible_designations || [];
    if (eligible.length && !eligible.includes(staffObj.designation) && !isException) {
      setMessage({ text: `Rank mismatch: ${staffObj.name} (${staffObj.designation}) is not in [${eligible.join(", ")}]. Tick "Authorized exception" to override.`, type: "warning" });
      return;
    }
    if (isException && (!exceptionReason.trim() || !authorizerId)) {
      setMessage({ text: "An exception needs a reason and the authorizing officer.", type: "warning" });
      return;
    }

    updateDuties((prev) => prev.map((slot) => slot.id !== selectedSlotId ? slot : {
      ...slot,
      assigned_staff: [...slot.assigned_staff, {
        staff_id: staffObj.id,
        name: staffObj.name,
        designation: staffObj.designation,
        service_number: staffObj.service_number,
        sector_id: staffObj.sector_id,
        is_exception: isException,
        exception_reason: isException ? exceptionReason.trim() : undefined,
        exception_authorized_by_id: isException ? Number(authorizerId) : undefined,
      }],
    }));
    setMessage({ text: `Allocated ${staffObj.name} to ${targetDuty.category}${isException ? " (authorized exception)" : ""}. Checks run automatically; save when ready.`, type: "info" });
    setSelectedStaffId("");
    setIsException(false);
    setExceptionReason("");
    setAuthorizerId("");
  };

  const handleRemoveOfficer = (slotId: number, staffId: number) =>
    updateDuties((prev) => prev.map((slot) => slot.id === slotId ? { ...slot, assigned_staff: slot.assigned_staff.filter((a) => a.staff_id !== staffId) } : slot));

  const authorizeExisting = (slotId: number, staffId: number, reason: string, authId: number) =>
    updateDuties((prev) => prev.map((slot) => slot.id !== slotId ? slot : {
      ...slot,
      assigned_staff: slot.assigned_staff.map((a) => a.staff_id === staffId ? { ...a, is_exception: true, exception_reason: reason, exception_authorized_by_id: authId } : a),
    }));

  const handleSaveAllocations = async () => {
    if (!token) return;
    if (!activeRoster) {
      setMessage({ text: "Create a draft roster first.", type: "warning" });
      return;
    }
    setSaving(true);
    setMessage(null);
    const check = await runValidation(duties);
    if (check && !check.can_save) {
      setMessage({ text: `${check.blocking_count} rule violation(s) must be fixed or authorized as exceptions before saving. See the checks panel.`, type: "warning" });
      setSaving(false);
      return;
    }
    try {
      const res = await updateRosterAssignments(token, activeRoster.id, { change_reason: changeReason, assignments: toPayload(duties) });
      setMessage({ text: `Allocations saved to Roster #${activeRoster.id} (v${res.roster.version}).`, type: "success" });
      await saveDraft(token, draftKey, null);
      await loadWorkspace();
      setIssues(res.issues || []);
    } catch (err: any) {
      if (err instanceof ApiError && err.detail?.issues) setIssues(err.detail.issues);
      setMessage({ text: formatApiError(err, "Failed to save duty allocations"), type: "warning" });
    } finally {
      setSaving(false);
    }
  };

  const act = async (fn: () => Promise<any>, ok: string) => {
    if (!token || !activeRoster) return;
    if (dirty && !window.confirm("You have unsaved allocation changes. Continue without saving them?")) return;
    setSaving(true);
    try {
      await fn();
      setMessage({ text: ok, type: "success" });
      await loadWorkspace();
    } catch (err: any) {
      setMessage({ text: formatApiError(err, "Action failed"), type: "warning" });
    } finally {
      setSaving(false);
    }
  };

  const sections = useMemo(() => Array.from(new Set(duties.map((d) => d.section).filter(Boolean))) as string[], [duties]);
  const filteredDuties = duties.filter((d) => sectionFilter === "ALL" || d.section === sectionFilter);
  const poolStaff = availableStaff.filter((s) => sectorFilter === "ALL" || (sectorFilter === "STATION" ? !s.sector_id : String(s.sector_id) === sectorFilter));
  const selectedSlot = duties.find((d) => d.id === selectedSlotId);
  const totalRequired = duties.reduce((acc, d) => acc + (d.required_strength || 0), 0);
  const totalAllocated = duties.reduce((acc, d) => acc + d.assigned_staff.length, 0);
  const totalVacant = duties.reduce((acc, d) => acc + Math.max(0, (d.required_strength || 0) - d.assigned_staff.length), 0);
  const issuesFor = (staffId: number) => issues.filter((i) => i.staff_id === staffId && i.code !== "VACANCY");
  const blocking = issues.filter((i) => i.blocking);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Duty Allocation Workspace</h2>
          <div className="text-muted" style={{ fontSize: 12 }}>
            Shift {selectedShift}{labels[selectedShift] ? ` (${labels[selectedShift]})` : ""} on {selectedDate} &middot; allocate staff to duty points
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn btn-secondary btn-sm" onClick={loadWorkspace} disabled={loading || saving}>↻ Refresh</button>
          {!activeRoster ? (
            canEdit && <button className="btn btn-primary btn-sm" onClick={handleCreateDraft} disabled={loading || saving}>+ Initialize Draft Roster</button>
          ) : (
            <>
              {activeRoster.status === "draft" && canEdit && (
                <>
                  <button className="btn btn-primary btn-sm" onClick={handleSaveAllocations} disabled={saving || validating}>
                    💾 Save Allocation Draft{dirty ? " *" : ""}
                  </button>
                  {isAdminSi && (
                    <button className="btn btn-secondary btn-sm" onClick={() => act(() => submitRoster(token, activeRoster.id), `Roster #${activeRoster.id} submitted for SHO approval.`)} disabled={saving}>
                      📤 Submit for Approval
                    </button>
                  )}
                </>
              )}
              {activeRoster.status === "submitted" && isSho && (
                <button className="btn btn-primary btn-sm" onClick={() => act(() => approveRoster(token, activeRoster.id), `Roster #${activeRoster.id} approved.`)} disabled={saving}>✓ Approve Roster (SHO)</button>
              )}
              {activeRoster.status === "approved" && canEdit && (
                <button className="btn btn-success btn-sm" onClick={() => act(() => publishRoster(token, activeRoster.id), `Roster #${activeRoster.id} published.`)} disabled={saving}>📢 Publish Roster</button>
              )}
            </>
          )}
        </div>
      </div>

      {message && (
        <div role={message.type === "warning" ? "alert" : "status"} className={`alert-banner alert-banner--${message.type === "warning" ? "warning" : "info"}`} style={{ marginBottom: 16 }}>
          {message.text}
        </div>
      )}

      {restorable && (
        <div className="alert-banner alert-banner--info" style={{ marginBottom: 16, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          You have an unsaved allocation draft for this shift from an earlier session.
          <button className="btn btn-primary btn-sm" onClick={restoreDraft}>Restore it</button>
          <button className="btn btn-secondary btn-sm" onClick={() => { setRestorable(null); if (token) saveDraft(token, draftKey, null); }}>Discard</button>
        </div>
      )}

      {/* Filter and roster status bar */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__body" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, padding: "12px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <label style={{ fontSize: 12, color: "#94a3b8" }}>Date{" "}
              <input type="date" className="form-control" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} style={{ width: 150, display: "inline-block", padding: "4px 8px", fontSize: 13 }} />
            </label>
            <label style={{ fontSize: 12, color: "#94a3b8" }}>Shift{" "}
              <select className="form-control" value={selectedShift} onChange={(e) => setSelectedShift(e.target.value)} style={{ width: 170, display: "inline-block", padding: "4px 8px", fontSize: 13 }}>
                {["A", "B", "C"].map((s) => <option key={s} value={s}>Shift {s}{labels[s] ? ` (${labels[s]})` : ""}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12, color: "#94a3b8" }}>Section{" "}
              <select className="form-control" value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)} style={{ width: 150, display: "inline-block", padding: "4px 8px", fontSize: 13 }}>
                <option value="ALL">All sections</option>
                {sections.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12, color: "#94a3b8" }}>Staff pool{" "}
              <select className="form-control" value={sectorFilter} onChange={(e) => setSectorFilter(e.target.value)} style={{ width: 150, display: "inline-block", padding: "4px 8px", fontSize: 13 }}>
                <option value="ALL">All sectors</option>
                <option value="STATION">Station (no sector)</option>
                {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {activeRoster ? (
              <>
                <span className="badge badge-default">Roster #{activeRoster.id} (v{activeRoster.version})</span>
                <span className={`badge ${activeRoster.status === "published" ? "badge-success" : activeRoster.status === "approved" ? "badge-info" : activeRoster.status === "submitted" ? "badge-warning" : "badge-default"}`} style={{ textTransform: "capitalize" }}>
                  {activeRoster.status}
                </span>
              </>
            ) : <span className="badge badge-warning">No draft roster for this shift</span>}
            <span style={{ fontSize: 12 }}>Required <strong>{totalRequired}</strong> · Allocated <strong>{totalAllocated}</strong> · <span style={{ color: totalVacant ? "#d97706" : "#16a34a" }}>Vacant <strong>{totalVacant}</strong></span></span>
          </div>
        </div>
        {activeRoster?.status === "draft" && canEdit && (
          <div className="card__body" style={{ paddingTop: 0 }}>
            <label className="form-label" htmlFor="change-reason" style={{ fontSize: 12 }}>Reason for this change (recorded in the audit log)</label>
            <input id="change-reason" className="form-control" value={changeReason} onChange={(e) => setChangeReason(e.target.value)} />
          </div>
        )}
      </div>

      {(issues.length > 0 || validating) && (
        <div className={`alert-banner alert-banner--${blocking.length ? "warning" : "info"}`} style={{ marginBottom: 16 }} aria-live="polite">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {validating ? "Checking rules…" : blocking.length ? `⛔ ${blocking.length} violation(s) block saving` : "✓ No blocking violations"}
            {!validating && ` · ${issues.length - blocking.length} advisory note(s)`}
          </div>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12 }}>
            {issues.map((i, idx) => (
              <li key={idx} style={{ color: i.blocking ? "#b91c1c" : undefined }}>
                <strong>{i.code.replace(/_/g, " ")}</strong>{i.overridden ? " (authorized exception)" : ""}: {i.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="duty-allocation-grid">
        <div className="card">
          <div className="card__header" style={{ display: "flex", justifyContent: "space-between" }}>
            <span className="card__title">Duty Points ({filteredDuties.length})</span>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>Click a row to allocate</span>
          </div>
          <div className="card__body" style={{ padding: 0 }}>
            {loading ? (
              <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading duties...</div>
            ) : filteredDuties.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>No active duty points for Shift {selectedShift}.</div>
            ) : (
              <div className="table-container">
                <table className="table">
                  <thead><tr><th>Duty point</th><th>Required</th><th>Allocated</th><th>Vacant</th><th>Personnel</th></tr></thead>
                  <tbody>
                    {filteredDuties.map((slot) => {
                      const req = slot.required_strength || 0;
                      const count = slot.assigned_staff.length;
                      const vacant = Math.max(0, req - count);
                      const isSelected = selectedSlotId === slot.id;
                      return (
                        <tr key={slot.id}
                          style={{ backgroundColor: isSelected ? "rgba(56, 189, 248, 0.08)" : undefined, borderLeft: isSelected ? "3px solid #38bdf8" : undefined, cursor: "pointer" }}
                          onClick={() => setSelectedSlotId(slot.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setSelectedSlotId(slot.id)} aria-selected={isSelected}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{slot.category}</div>
                            {slot.section && <div style={{ fontSize: 11, color: "#94a3b8" }}>Section: {slot.section}</div>}
                            <div style={{ fontSize: 11, color: "#64748b" }}>Eligible: {(slot.eligible_designations || []).join(", ") || "All ranks"}</div>
                            {!slot.is_configured && <div style={{ fontSize: 11, color: "#d97706" }}>Strength not configured</div>}
                          </td>
                          <td>{slot.is_configured ? req : "—"}</td>
                          <td>{count}</td>
                          <td>{slot.is_configured ? (vacant ? <span className="badge badge-warning">{vacant} vacant</span> : <span className="badge badge-success">Filled</span>) : "—"}</td>
                          <td>
                            {count === 0 ? <span style={{ fontSize: 12, color: "#ef4444" }}>Unassigned</span> : (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {slot.assigned_staff.map((asg) => {
                                  const own = issuesFor(asg.staff_id);
                                  const bad = own.some((i) => i.blocking);
                                  return (
                                    <span key={asg.staff_id} className={`badge ${bad ? "badge-danger badge-red" : asg.is_exception ? "badge-warning" : "badge-default"}`}
                                      style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}
                                      title={own.map((i) => i.message).join("\n") || (asg.is_exception ? `Exception: ${asg.exception_reason}` : undefined)}>
                                      <span>{asg.name} ({asg.designation}){bad ? " ⛔" : asg.is_exception ? " ⚠️" : own.length ? " ⓘ" : ""}</span>
                                      {canEdit && activeRoster?.status === "draft" && bad && !asg.is_exception && (
                                        <button type="button" className="btn btn-secondary btn-sm" style={{ padding: "0 6px", fontSize: 10 }}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const reason = window.prompt(`Exception reason for ${asg.name}:\n${own.filter((i) => i.blocking).map((i) => i.message).join("\n")}`);
                                            if (!reason) return;
                                            const options = authorizers.filter((a) => !a.is_self || user?.role === "SHO");
                                            const pick = window.prompt(`Authorizing officer (enter number):\n${options.map((a, n) => `${n + 1}. ${a.name} (${a.role})`).join("\n")}`);
                                            const chosen = options[Number(pick) - 1];
                                            if (chosen) authorizeExisting(slot.id, asg.staff_id, reason, chosen.user_id);
                                          }}>Authorize</button>
                                      )}
                                      {canEdit && activeRoster?.status === "draft" && (
                                        <button type="button" onClick={(e) => { e.stopPropagation(); handleRemoveOfficer(slot.id, asg.staff_id); }}
                                          style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", padding: "0 2px", fontWeight: "bold" }}
                                          aria-label={`Remove ${asg.name}`}>✕</button>
                                      )}
                                    </span>
                                  );
                                })}
                              </div>
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

        <div>
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card__header"><span className="card__title">Allocate Officer to Duty</span></div>
            <div className="card__body">
              {selectedSlot ? (
                <div style={{ padding: 12, borderRadius: 6, marginBottom: 16, border: "1px solid var(--color-border, #1e293b)" }}>
                  <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase" }}>Selected duty point</div>
                  <div style={{ fontWeight: 600, fontSize: 15, marginTop: 2 }}>{selectedSlot.category}</div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                    Required {selectedSlot.required_strength ?? "—"} · Allocated {selectedSlot.assigned_staff.length} · Vacant {Math.max(0, (selectedSlot.required_strength || 0) - selectedSlot.assigned_staff.length)}
                  </div>
                  <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>Eligible ranks: {(selectedSlot.eligible_designations || []).join(", ") || "All ranks"}</div>
                </div>
              ) : <div style={{ padding: 12, color: "#94a3b8", fontSize: 13 }}>Select a duty point on the left.</div>}

              {canEdit && activeRoster?.status === "draft" ? (
                <>
                  <div className="form-group" style={{ marginBottom: 14 }}>
                    <label className="form-label" htmlFor="pick-officer">Select officer</label>
                    <select id="pick-officer" className="form-control" value={selectedStaffId} onChange={(e) => setSelectedStaffId(e.target.value)}>
                      <option value="">-- Choose officer --</option>
                      {poolStaff.map((s) => {
                        const status = staffStatusMap[s.id] || "Unknown";
                        const isAssigned = duties.some((d) => d.assigned_staff.some((a) => a.staff_id === s.id));
                        return (
                          <option key={s.id} value={s.id} disabled={isAssigned}>
                            {s.name} ({s.designation}) — {status}{s.attached_to ? " · attached" : ""}{isAssigned ? " (already assigned)" : ""}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", marginBottom: 14 }}>
                    <input type="checkbox" checked={isException} onChange={(e) => setIsException(e.target.checked)} />
                    <span>Authorized exception (needs a reason and an authorizing officer)</span>
                  </label>
                  {isException && (
                    <>
                      <div className="form-group" style={{ marginBottom: 10 }}>
                        <label className="form-label" htmlFor="exc-reason" style={{ color: "#f59e0b" }}>Exception justification *</label>
                        <textarea id="exc-reason" className="form-control" rows={2} placeholder="e.g. Emergency deployment for VIP bandobast" value={exceptionReason} onChange={(e) => setExceptionReason(e.target.value)} />
                      </div>
                      <div className="form-group" style={{ marginBottom: 14 }}>
                        <label className="form-label" htmlFor="exc-auth" style={{ color: "#f59e0b" }}>Authorizing officer *</label>
                        <select id="exc-auth" className="form-control" value={authorizerId} onChange={(e) => setAuthorizerId(e.target.value)}>
                          <option value="">-- Select officer --</option>
                          {authorizers.filter((a) => !a.is_self || user?.role === "SHO").map((a) => (
                            <option key={a.user_id} value={a.user_id}>{a.name} ({a.role})</option>
                          ))}
                        </select>
                        <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>The authorizer is recorded in the audit log with the reason.</div>
                      </div>
                    </>
                  )}
                  <button className="btn btn-primary" style={{ width: "100%" }} onClick={handleAssignOfficer} disabled={!selectedSlotId || !selectedStaffId}>
                    + Assign to {selectedSlot ? selectedSlot.category : "duty"}
                  </button>
                </>
              ) : (
                <div style={{ fontSize: 13, color: "#94a3b8", padding: "8px 0" }}>
                  {activeRoster && activeRoster.status !== "draft"
                    ? `This roster is ${activeRoster.status}. Use "Revise" on the roster tab to start a new version.`
                    : canEdit ? "Create a draft roster on the Rosters tab to start allocating." : "Only the SHO or Admin SI can allocate duties. You can review the allocation here."}
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card__header"><span className="card__title">Staff pool ({poolStaff.length})</span></div>
            <div className="card__body" style={{ maxHeight: 360, overflowY: "auto", padding: 0 }}>
              <div className="table-container">
                <table className="table" style={{ fontSize: 12 }}>
                  <thead><tr><th>Name / #</th><th>Rank</th><th>Status</th></tr></thead>
                  <tbody>
                    {poolStaff.map((s) => {
                      const status = staffStatusMap[s.id] || "Unknown";
                      const isAssigned = duties.some((d) => d.assigned_staff.some((a) => a.staff_id === s.id));
                      return (
                        <tr key={s.id}>
                          <td><strong>{s.name}</strong><div style={{ color: "#64748b", fontSize: 10 }}>{s.service_number}{s.sector_id ? ` · Sector ${s.sector_id}` : ""}</div></td>
                          <td>{s.designation}</td>
                          <td>
                            {isAssigned ? <span className="badge badge-info">Assigned</span> :
                              <span className={`badge ${status === "Present - Available" ? "badge-success" : "badge-default"}`}>{status}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 3: DUTY CHANGE REQUESTS PANEL
// ─────────────────────────────────────────────────────────────────────────────

function DutyChangeRequestsPanel({
  token,
  user,
  shifts,
  labels,
  prefill,
  onClearPrefill,
  onCountChange,
}: {
  token: string;
  user: any;
  shifts: ShiftInfo[];
  labels: Record<string, string>;
  prefill: {
    roster_id: number;
    current_roster_date: string;
    current_shift_code: string;
    current_duty_category: string;
  } | null;
  onClearPrefill: () => void;
  onCountChange: (count: number) => void;
}) {
  const [requests, setRequests] = useState<DutyChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [formData, setFormData] = useState({
    roster_id: 0,
    current_roster_date: "",
    current_shift_code: "A",
    current_duty_category: "",
    requested_shift_code: "",
    requested_duty_category: "",
    reason: "",
  });

  const isSupervisor = ["SHO", "ADMIN_SI", "SUPER_ADMIN", "SECTOR_SI"].includes(user?.role || "");
  const canDecide = ["SHO", "ADMIN_SI", "SUPER_ADMIN"].includes(user?.role || "");

  // When prefill arrives, populate form and open modal
  useEffect(() => {
    if (prefill) {
      setFormData({
        roster_id: prefill.roster_id,
        current_roster_date: prefill.current_roster_date,
        current_shift_code: prefill.current_shift_code,
        current_duty_category: prefill.current_duty_category,
        requested_shift_code: prefill.current_shift_code === "A" ? "B" : "A",
        requested_duty_category: "",
        reason: "",
      });
      setShowSubmitModal(true);
      onClearPrefill();
    }
  }, [prefill, onClearPrefill]);

  const loadRequests = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const param = statusFilter === "all" ? undefined : { status: statusFilter };
      const res = await getDutyChangeRequests(token, param);
      setRequests(res);
      const pendingCount = res.filter((r) => r.status === "pending").length;
      onCountChange(pendingCount);
    } catch (err: any) {
      setError(formatApiError(err, "Failed to load duty change requests"));
    } finally {
      setLoading(false);
    }
  }, [token, statusFilter, onCountChange]);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (!formData.reason.trim()) {
      setError("Please provide a reason why this duty or shift is infeasible.");
      return;
    }
    setError(null);
    try {
      await submitDutyChangeRequest(token, {
        roster_id: Number(formData.roster_id),
        current_roster_date: formData.current_roster_date,
        current_shift_code: formData.current_shift_code,
        current_duty_category: formData.current_duty_category || undefined,
        requested_shift_code: formData.requested_shift_code || undefined,
        requested_duty_category: formData.requested_duty_category || undefined,
        reason: formData.reason.trim(),
      });
      setSuccess("Duty change request submitted successfully. Waiting for SHO / Admin SI review.");
      setShowSubmitModal(false);
      loadRequests();
    } catch (err: any) {
      setError(formatApiError(err, "Failed to submit request"));
    }
  };

  const handleApprove = async (id: number) => {
    if (!token) return;
    const remarks = window.prompt("Approval remarks / reassignment notes (optional):");
    if (remarks === null) return;
    try {
      await approveDutyChangeRequest(token, id, remarks || undefined);
      setSuccess(`Request #${id} approved successfully.`);
      loadRequests();
    } catch (err: any) {
      setError(formatApiError(err, "Failed to approve request"));
    }
  };

  const handleReject = async (id: number) => {
    if (!token) return;
    const remarks = window.prompt("Reason for rejecting this change request (required):");
    if (!remarks) return;
    try {
      await rejectDutyChangeRequest(token, id, remarks);
      setSuccess(`Request #${id} rejected.`);
      loadRequests();
    } catch (err: any) {
      setError(formatApiError(err, "Failed to reject request"));
    }
  };

  const handleWithdraw = async (id: number) => {
    if (!token) return;
    if (!window.confirm("Are you sure you want to withdraw this duty change request?")) return;
    try {
      await withdrawDutyChangeRequest(token, id);
      setSuccess(`Request #${id} withdrawn.`);
      loadRequests();
    } catch (err: any) {
      setError(formatApiError(err, "Failed to withdraw request"));
    }
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Duty &amp; Shift Change Requests</h2>
          <div className="text-muted" style={{ fontSize: 12 }}>
            {isSupervisor
              ? "Review and approve/reject change requests submitted by staff when rostered duties are infeasible."
              : "Request a shift or duty reassignment when your rostered assignment is infeasible."}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <select
            className="form-control"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ width: 140, fontSize: 13, padding: "4px 8px" }}
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="withdrawn">Withdrawn</option>
          </select>

          <button className="btn btn-secondary btn-sm" onClick={loadRequests}>↻ Refresh</button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowSubmitModal(true)}>+ New Change Request</button>
        </div>
      </div>

      {error && <div role="alert" className="alert-banner alert-banner--warning" style={{ marginBottom: 16 }}>{error}</div>}
      {success && <div className="alert-banner alert-banner--info" style={{ marginBottom: 16 }}>{success}</div>}

      <div className="card">
        <div className="card__header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="card__title">Change Requests ({requests.length})</span>
          <span style={{ fontSize: 12, color: "#94a3b8" }}>
            {requests.filter((r) => r.status === "pending").length} pending review
          </span>
        </div>
        <div className="card__body" style={{ padding: 0 }}>
          {loading ? (
            <div style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>Loading change requests...</div>
          ) : requests.length === 0 ? (
            <div className="empty-state" style={{ padding: 40 }}>
              <div className="empty-state__icon">🔄</div>
              <div className="empty-state__title">No Change Requests Found</div>
              <div className="empty-state__text">
                {statusFilter !== "all"
                  ? `No requests match status "${statusFilter}".`
                  : "No duty change requests have been recorded."}
              </div>
            </div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>ID</th>
                    {isSupervisor && <th>Officer</th>}
                    <th>Current Assignment</th>
                    <th>Requested Change</th>
                    <th>Reason / Justification</th>
                    <th>Status</th>
                    <th>Reviewer Notes</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((req) => (
                    <tr key={req.id}>
                      <td><strong>#{req.id}</strong></td>
                      {isSupervisor && (
                        <td>
                          <strong>{req.officer_name}</strong>
                          <div className="text-muted" style={{ fontSize: 11 }}>{req.service_number}</div>
                        </td>
                      )}
                      <td>
                        <div><strong>{req.current_roster_date}</strong> · Shift {req.current_shift_code}</div>
                        <div className="text-muted" style={{ fontSize: 11 }}>
                          {req.current_duty_category || "General / Unassigned"} (Roster #{req.roster_id})
                        </div>
                      </td>
                      <td>
                        <div>Shift {req.requested_shift_code || req.current_shift_code}</div>
                        <div className="text-muted" style={{ fontSize: 11 }}>
                          {req.requested_duty_category || "Any suitable duty point"}
                        </div>
                      </td>
                      <td style={{ fontSize: 12, maxWidth: 220 }}>
                        <div>{req.reason}</div>
                        <div className="text-muted" style={{ fontSize: 10, marginTop: 4 }}>
                          Submitted: {new Date(req.submitted_at).toLocaleString()}
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${
                          req.status === "approved" ? "badge-success" :
                          req.status === "pending" ? "badge-warning" :
                          req.status === "rejected" ? "badge-danger" : "badge-default"
                        }`} style={{ textTransform: "capitalize" }}>
                          {req.status}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, maxWidth: 180 }}>
                        {req.reviewer_remarks ? (
                          <div>
                            <div>{req.reviewer_remarks}</div>
                            <div className="text-muted" style={{ fontSize: 10 }}>by {req.reviewed_by}</div>
                          </div>
                        ) : "—"}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {canDecide && req.status === "pending" && (
                            <>
                              <button className="btn btn-success btn-sm" onClick={() => handleApprove(req.id)}>Approve</button>
                              <button className="btn btn-danger btn-sm" onClick={() => handleReject(req.id)}>Reject</button>
                            </>
                          )}
                          {!canDecide && req.status === "pending" && (
                            <button className="btn btn-secondary btn-sm" onClick={() => handleWithdraw(req.id)}>Withdraw</button>
                          )}
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

      {/* New Request Modal */}
      {showSubmitModal && (
        <Modal
          title="Submit Duty / Shift Change Request"
          onClose={() => setShowSubmitModal(false)}
          width={540}
        >
          <form onSubmit={handleSubmit}>
            <p className="text-muted" style={{ fontSize: 13, marginTop: 0 }}>
              Use this form when your rostered shift or duty allocation cannot be fulfilled due to unavoidable medical, personal, or operational conflicts.
            </p>

            <div className="form-group" style={{ marginBottom: 14 }}>
              <label className="form-label" htmlFor="req-roster-id">Roster ID *</label>
              <input
                id="req-roster-id"
                type="number"
                className="form-control"
                required
                value={formData.roster_id || ""}
                onChange={(e) => setFormData({ ...formData, roster_id: Number(e.target.value) })}
                placeholder="e.g. 1 (check Shift Rosters tab)"
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
              <div className="form-group">
                <label className="form-label" htmlFor="req-curr-date">Current Date *</label>
                <input
                  id="req-curr-date"
                  type="date"
                  className="form-control"
                  required
                  value={formData.current_roster_date}
                  onChange={(e) => setFormData({ ...formData, current_roster_date: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="req-curr-shift">Current Shift *</label>
                <select
                  id="req-curr-shift"
                  className="form-control"
                  value={formData.current_shift_code}
                  onChange={(e) => setFormData({ ...formData, current_shift_code: e.target.value })}
                >
                  {["A", "B", "C"].map((s) => (
                    <option key={s} value={s}>Shift {s}{labels[s] ? ` (${labels[s]})` : ""}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 14 }}>
              <label className="form-label" htmlFor="req-curr-duty">Current Duty Category</label>
              <input
                id="req-curr-duty"
                type="text"
                className="form-control"
                value={formData.current_duty_category}
                onChange={(e) => setFormData({ ...formData, current_duty_category: e.target.value })}
                placeholder="e.g. Law & Order Patrol, Station Writer, etc."
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
              <div className="form-group">
                <label className="form-label" htmlFor="req-target-shift">Requested Shift</label>
                <select
                  id="req-target-shift"
                  className="form-control"
                  value={formData.requested_shift_code}
                  onChange={(e) => setFormData({ ...formData, requested_shift_code: e.target.value })}
                >
                  <option value="">-- Keep Current Shift --</option>
                  {["A", "B", "C"].map((s) => (
                    <option key={s} value={s}>Shift {s}{labels[s] ? ` (${labels[s]})` : ""}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="req-target-duty">Requested Duty Point</label>
                <input
                  id="req-target-duty"
                  type="text"
                  className="form-control"
                  value={formData.requested_duty_category}
                  onChange={(e) => setFormData({ ...formData, requested_duty_category: e.target.value })}
                  placeholder="Optional preferred duty"
                />
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 20 }}>
              <label className="form-label" htmlFor="req-reason">
                Reason for Infeasibility *
              </label>
              <textarea
                id="req-reason"
                className="form-control"
                rows={3}
                required
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                placeholder="Explain why this assignment is not feasible (e.g. urgent court appearance, sudden sickness, bereavement, transportation issue)..."
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowSubmitModal(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Submit Change Request</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
