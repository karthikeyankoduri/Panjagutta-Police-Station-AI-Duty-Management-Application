"use client";
/**
 * Weekly duty allocation: staff are rows, Monday–Sunday are columns, and every cell is one
 * (shift, duty point). Saving fans out to the per-day rosters on the server in one transaction,
 * so the normal rules (leave, rest, shift overlap, authorized exceptions) apply to every day.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  DutyItem,
  Sector,
  StaffMember,
  WeekCellIn,
  WeekGrid,
  WeekIssue,
  WeekSaveResult,
  formatApiError,
  getAuthorizers,
  getDuties,
  getRosterWeek,
  getSectors,
  getStaff,
  loadDraft,
  saveDraft,
  saveRosterWeek,
  validateRosterWeek,
} from "@/lib/api";

type Cell = {
  shift: string;
  dutyId: number | null;
  is_exception?: boolean;
  exception_reason?: string | null;
  exception_authorized_by_id?: number | null;
};
type Grid = Record<string, Cell>;
type Authorizer = { user_id: number; username: string; role: string; name: string; is_self: boolean };

const PAGE_SIZE = 40;
const SHIFTS = ["A", "B", "C"];

const cellKey = (staffId: number, date: string) => `${staffId}|${date}`;
const fromIso = (s: string) => new Date(`${s}T00:00:00`);
const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (s: string, n: number) => { const d = fromIso(s); d.setDate(d.getDate() + n); return toIso(d); };
const mondayOf = (s: string) => { const d = fromIso(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return toIso(d); };
const dayLabel = (s: string) => fromIso(s).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" });

/** Stable signature of the meaningful content of a grid, used for dirty checks. */
const signature = (g: Grid) =>
  JSON.stringify(
    Object.keys(g)
      .filter((k) => g[k].dutyId)
      .sort()
      .map((k) => [k, g[k].shift, g[k].dutyId, g[k].exception_authorized_by_id ?? null])
  );

function statusColour(status: string) {
  return status === "published" ? "badge-success" : status === "approved" ? "badge-info" : status === "submitted" ? "badge-warning" : "badge-default";
}

export default function WeeklyAllocationGrid({
  token,
  user,
  labels,
  todayIso,
  canEdit,
}: {
  token: string;
  user: any;
  labels: Record<string, string>;
  todayIso: string;
  canEdit: boolean;
}) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayIso));
  const [week, setWeek] = useState<WeekGrid | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [duties, setDuties] = useState<DutyItem[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [authorizers, setAuthorizers] = useState<Authorizer[]>([]);
  const [grid, setGrid] = useState<Grid>({});
  const [baseline, setBaseline] = useState("[]");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "info" | "warning" | "success" } | null>(null);
  const [issues, setIssues] = useState<WeekIssue[]>([]);
  const [issueByKey, setIssueByKey] = useState<Record<string, WeekIssue[]>>({});
  const [skipped, setSkipped] = useState<WeekSaveResult["days"]>([]);
  const [sectorFilter, setSectorFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [changeReason, setChangeReason] = useState("Weekly duty allocation");
  const [restorable, setRestorable] = useState<Grid | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const requestId = useRef(0);

  const draftKey = `alloc-week:${weekStart}`;
  const dirty = useMemo(() => signature(grid) !== baseline, [grid, baseline]);

  useEffect(() => {
    if (!token) return;
    Promise.all([getStaff(token, { is_active: true }), getDuties(token, { active_only: true })])
      .then(([s, d]) => { setStaff(s); setDuties(d); })
      .catch((err) => setMessage({ text: formatApiError(err, "Failed to load staff and duty points"), type: "warning" }));
    getSectors(token).then(setSectors).catch(() => null);
    getAuthorizers(token).then(setAuthorizers).catch(() => null);
  }, [token]);

  const loadWeek = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setIssues([]);
    setIssueByKey({});
    setSkipped([]);
    try {
      const w = await getRosterWeek(token, weekStart);
      const g: Grid = {};
      w.cells.forEach((c) => {
        g[cellKey(c.staff_id, c.date)] = {
          shift: c.shift_code,
          dutyId: c.duty_master_id,
          is_exception: c.is_exception,
          exception_reason: c.exception_reason,
          exception_authorized_by_id: c.exception_authorized_by_id,
        };
      });
      setWeek(w);
      setGrid(g);
      setBaseline(signature(g));
      const saved = canEdit ? await loadDraft<Grid>(token, `alloc-week:${weekStart}`) : null;
      setRestorable(saved && signature(saved) !== signature(g) ? saved : null);
    } catch (err: any) {
      setMessage({ text: formatApiError(err, "Failed to load the weekly allocation"), type: "warning" });
    } finally {
      setLoading(false);
    }
  }, [token, weekStart, canEdit]);

  useEffect(() => { loadWeek(); }, [loadWeek]);

  // Slots (date + shift) whose roster is approved/published can only be changed by revising it.
  const lockedSlots = useMemo(
    () => new Set((week?.rosters || []).filter((r) => !r.editable).map((r) => `${r.date}|${r.shift_code}`)),
    [week]
  );
  const isLocked = (date: string, shift: string) => lockedSlots.has(`${date}|${shift}`);

  const cells = useMemo(() => {
    const out: WeekCellIn[] = [];
    Object.keys(grid).sort().forEach((k) => {
      const c = grid[k];
      if (!c.dutyId || !c.shift) return;
      const [sid, date] = k.split("|");
      out.push({
        staff_id: Number(sid), date, shift_code: c.shift, duty_master_id: c.dutyId,
        is_exception: !!c.is_exception, exception_reason: c.exception_reason || null,
        exception_authorized_by_id: c.exception_authorized_by_id ?? null,
      });
    });
    return out;
  }, [grid]);
  const incomplete = Object.values(grid).filter((c) => c.shift && !c.dutyId).length;
  const body = useMemo(() => ({ week_start: weekStart, staff_ids: staff.map((s) => s.id), cells }), [weekStart, staff, cells]);

  const applyResult = useCallback((res: WeekSaveResult, sent: WeekCellIn[]) => {
    const byKey: Record<string, WeekIssue[]> = {};
    res.issues.forEach((i) => {
      if (i.cell_index == null || !sent[i.cell_index]) return;
      const k = cellKey(sent[i.cell_index].staff_id, sent[i.cell_index].date);
      (byKey[k] ||= []).push(i);
    });
    setIssues(res.issues);
    setIssueByKey(byKey);
    setSkipped(res.days.filter((d) => d.action === "skipped"));
  }, []);

  // Debounced dry-run so the rules are checked while the supervisor edits, before saving.
  useEffect(() => {
    if (!dirty || !token || !canEdit || staff.length === 0) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const id = ++requestId.current;
      setValidating(true);
      try {
        const res = await validateRosterWeek(token, body);
        if (id === requestId.current) applyResult(res, body.cells);
      } catch { /* keep the previous result; saving re-validates anyway */ }
      finally { if (id === requestId.current) setValidating(false); }
      saveDraft(token, draftKey, grid);
    }, 600);
    return () => window.clearTimeout(timer.current);
  }, [dirty, token, canEdit, staff.length, body, grid, draftKey, applyResult]);

  const setCell = (staffId: number, date: string, patch: Partial<Cell> | null) =>
    setGrid((prev) => {
      const k = cellKey(staffId, date);
      const next = { ...prev };
      if (patch === null) { delete next[k]; return next; }
      // Any change invalidates a previously authorized exception: it was granted for the old values.
      next[k] = { ...(prev[k] || { shift: "A", dutyId: null }), is_exception: false, exception_reason: null, exception_authorized_by_id: null, ...patch };
      return next;
    });

  const dutiesForShift = (shift: string) => duties.filter((d) => !d.shift_code || d.shift_code === shift);

  const changeShift = (staffId: number, date: string, shift: string) => {
    if (!shift) return setCell(staffId, date, null);
    const cur = grid[cellKey(staffId, date)];
    const curDuty = duties.find((d) => d.id === cur?.dutyId);
    const keep = curDuty && (!curDuty.shift_code || curDuty.shift_code === shift);
    setCell(staffId, date, { shift, dutyId: keep ? cur!.dutyId : null });
  };

  const fillRow = (staffId: number) => {
    const days = week?.days || [];
    const source = days.map((d) => grid[cellKey(staffId, d)]).find((c) => c && c.dutyId);
    if (!source) {
      setMessage({ text: "Set a shift and duty on one day first, then use Fill week to copy it across.", type: "info" });
      return;
    }
    days.forEach((d) => { if (!isLocked(d, source.shift) && !isLocked(d, grid[cellKey(staffId, d)]?.shift || "")) setCell(staffId, d, { shift: source.shift, dutyId: source.dutyId }); });
  };

  const clearRow = (staffId: number) =>
    (week?.days || []).forEach((d) => {
      const c = grid[cellKey(staffId, d)];
      if (c && !isLocked(d, c.shift)) setCell(staffId, d, null);
    });

  const authorize = (staffId: number, date: string, own: WeekIssue[]) => {
    const reason = window.prompt(`Exception reason:\n${own.filter((i) => i.blocking).map((i) => i.message).join("\n")}`);
    if (!reason) return;
    const options = authorizers.filter((a) => !a.is_self || user?.role === "SHO");
    const pick = window.prompt(`Authorizing officer (enter number):\n${options.map((a, n) => `${n + 1}. ${a.name} (${a.role})`).join("\n")}`);
    const chosen = options[Number(pick) - 1];
    if (!chosen) return;
    setGrid((prev) => {
      const k = cellKey(staffId, date);
      return prev[k] ? { ...prev, [k]: { ...prev[k], is_exception: true, exception_reason: reason, exception_authorized_by_id: chosen.user_id } } : prev;
    });
  };

  const gotoWeek = (next: string) => {
    if (dirty && !window.confirm("You have unsaved changes for this week. Discard them?")) return;
    setWeekStart(mondayOf(next));
  };

  const save = async () => {
    if (!token) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await saveRosterWeek(token, { ...body, change_reason: changeReason });
      await saveDraft(token, draftKey, null);
      setMessage({ text: res.detail || "Weekly allocation saved.", type: "success" });
      await loadWeek();
      setSkipped(res.days.filter((d) => d.action === "skipped"));
    } catch (err: any) {
      if (err instanceof ApiError && err.detail?.issues) applyResult(err.detail as WeekSaveResult, body.cells);
      setMessage({ text: formatApiError(err, "Failed to save the weekly allocation"), type: "warning" });
    } finally {
      setSaving(false);
    }
  };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return staff.filter((s) =>
      (sectorFilter === "ALL" || (sectorFilter === "STATION" ? !s.sector_id : String(s.sector_id) === sectorFilter)) &&
      (!q || s.name.toLowerCase().includes(q) || s.service_number.toLowerCase().includes(q)));
  }, [staff, sectorFilter, search]);

  const blocking = issues.filter((i) => i.blocking && i.cell_index != null);
  const advisory = issues.filter((i) => !i.blocking && i.cell_index != null).length;
  const days = week?.days || [];
  const assignedCount = cells.length;

  const renderCell = (s: StaffMember, date: string) => {
    const k = cellKey(s.id, date);
    const c = grid[k];
    const own = issueByKey[k] || [];
    const bad = own.some((i) => i.blocking);
    const locked = !!c && isLocked(date, c.shift);
    const duty = duties.find((d) => d.id === c?.dutyId);
    const border = bad ? "#ef4444" : c?.is_exception ? "#f59e0b" : locked ? "#475569" : "var(--color-border, #1e293b)";

    if (!canEdit || locked) {
      return (
        <div style={{ border: `1px solid ${border}`, borderRadius: 6, padding: "4px 6px", fontSize: 12, minHeight: 34, opacity: locked ? 0.85 : 1 }}>
          {c?.dutyId ? <><strong>{c.shift}</strong> · {duty?.category || `Duty #${c.dutyId}`}{locked ? " (locked)" : ""}</> : <span style={{ color: "#64748b" }}>—</span>}
        </div>
      );
    }
    return (
      <div style={{ border: `1px solid ${border}`, borderRadius: 6, padding: 4, display: "flex", flexDirection: "column", gap: 4 }}
        title={own.map((i) => i.message).join("\n") || (c?.is_exception ? `Exception: ${c.exception_reason}` : undefined)}>
        <select aria-label={`Shift for ${s.name} on ${dayLabel(date)}`} className="form-control" style={{ padding: "2px 4px", fontSize: 12 }}
          value={c?.shift || ""} onChange={(e) => changeShift(s.id, date, e.target.value)}>
          <option value="">Off / none</option>
          {SHIFTS.map((sh) => <option key={sh} value={sh} disabled={isLocked(date, sh)}>Shift {sh}{labels[sh] ? ` (${labels[sh]})` : ""}</option>)}
        </select>
        {c && (
          <select aria-label={`Duty point for ${s.name} on ${dayLabel(date)}`} className="form-control" style={{ padding: "2px 4px", fontSize: 12 }}
            value={c.dutyId ?? ""} onChange={(e) => setCell(s.id, date, { dutyId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">-- duty point --</option>
            {dutiesForShift(c.shift).map((d) => <option key={d.id} value={d.id}>{d.category}</option>)}
          </select>
        )}
        {(bad || own.length > 0 || c?.is_exception) && (
          <div style={{ fontSize: 11, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: bad ? "#ef4444" : "#d97706" }}>{bad ? "⛔ Rule violation" : c?.is_exception ? "⚠️ Exception" : `ⓘ ${own.length} note(s)`}</span>
            {bad && !c?.is_exception && (
              <button type="button" className="btn btn-secondary btn-sm" style={{ padding: "0 6px", fontSize: 10 }} onClick={() => authorize(s.id, date, own)}>Authorize</button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Weekly Duty Allocation</h2>
          <div className="text-muted" style={{ fontSize: 12 }}>
            {week ? `${dayLabel(week.week_start)} – ${dayLabel(week.week_end)}` : "…"} · {assignedCount} duty-day(s) assigned · set each officer&apos;s shift and duty point for the week
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn btn-secondary btn-sm" onClick={() => gotoWeek(addDays(weekStart, -7))} aria-label="Previous week">◀ Prev</button>
          <input type="date" className="form-control" aria-label="Pick a date in the week" value={weekStart} onChange={(e) => e.target.value && gotoWeek(e.target.value)} style={{ width: 150, padding: "4px 8px", fontSize: 13 }} />
          <button className="btn btn-secondary btn-sm" onClick={() => gotoWeek(addDays(weekStart, 7))} aria-label="Next week">Next ▶</button>
          <button className="btn btn-secondary btn-sm" onClick={() => gotoWeek(todayIso)}>This week</button>
          <button className="btn btn-secondary btn-sm" onClick={loadWeek} disabled={loading || saving}>↻ Refresh</button>
          {canEdit && (
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving || validating || !dirty || incomplete > 0 || loading}>
              Save week{dirty ? " *" : ""}
            </button>
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
          You have an unsaved weekly allocation for this week from an earlier session.
          <button className="btn btn-primary btn-sm" onClick={() => { setGrid(restorable); setRestorable(null); }}>Restore it</button>
          <button className="btn btn-secondary btn-sm" onClick={() => { setRestorable(null); saveDraft(token, draftKey, null); }}>Discard</button>
        </div>
      )}

      {!canEdit && (
        <div className="alert-banner alert-banner--info" style={{ marginBottom: 16 }}>
          Only the SHO or Admin SI can change the weekly allocation. You can review it here.
        </div>
      )}

      {skipped.length > 0 && (
        <div className="alert-banner alert-banner--info" style={{ marginBottom: 16 }}>
          {skipped.length} roster(s) are approved or published and will not be changed here:{" "}
          {skipped.map((d) => `${dayLabel(d.date)} Shift ${d.shift_code}`).join(", ")}. Use “Revise” on the Rosters tab to change them.
        </div>
      )}

      {canEdit && (blocking.length > 0 || validating || incomplete > 0 || advisory > 0) && (
        <div className={`alert-banner alert-banner--${blocking.length || incomplete ? "warning" : "info"}`} style={{ marginBottom: 16 }} aria-live="polite">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {validating ? "Checking rules…" : blocking.length ? `⛔ ${blocking.length} violation(s) block saving` : "✓ No blocking violations"}
            {!validating && ` · ${advisory} advisory note(s)`}
            {incomplete > 0 && ` · ${incomplete} cell(s) have a shift but no duty point`}
          </div>
          {blocking.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12 }}>
              {blocking.slice(0, 8).map((i, idx) => (
                <li key={idx} style={{ color: "#b91c1c" }}>
                  <strong>{dayLabel(i.date)} · Shift {i.shift_code} · {i.code.replace(/_/g, " ")}</strong>: {i.message}
                </li>
              ))}
              {blocking.length > 8 && <li>…and {blocking.length - 8} more</li>}
            </ul>
          )}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__body" style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", padding: "12px 16px" }}>
          <label style={{ fontSize: 12, color: "#94a3b8" }}>Staff pool{" "}
            <select className="form-control" value={sectorFilter} onChange={(e) => { setSectorFilter(e.target.value); setLimit(PAGE_SIZE); }} style={{ width: 160, display: "inline-block", padding: "4px 8px", fontSize: 13 }}>
              <option value="ALL">All sectors</option>
              <option value="STATION">Station (no sector)</option>
              {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12, color: "#94a3b8" }}>Find officer{" "}
            <input className="form-control" placeholder="Name or service no." value={search} onChange={(e) => { setSearch(e.target.value); setLimit(PAGE_SIZE); }} style={{ width: 190, display: "inline-block", padding: "4px 8px", fontSize: 13 }} />
          </label>
          {canEdit && (
            <label style={{ fontSize: 12, color: "#94a3b8", flex: 1, minWidth: 220 }}>Reason (recorded in the audit log)
              <input className="form-control" value={changeReason} onChange={(e) => setChangeReason(e.target.value)} style={{ padding: "4px 8px", fontSize: 13 }} />
            </label>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card__body" style={{ padding: 0 }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading the week…</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>No staff match these filters.</div>
          ) : (
            <div className="table-container" style={{ overflowX: "auto" }}>
              <table className="table" style={{ minWidth: 1180 }}>
                <thead>
                  <tr>
                    <th style={{ position: "sticky", left: 0, zIndex: 2, background: "var(--color-surface, #0f172a)", minWidth: 190 }}>Officer</th>
                    {days.map((d) => {
                      const dayRosters = (week?.rosters || []).filter((r) => r.date === d);
                      return (
                        <th key={d} style={{ minWidth: 150, verticalAlign: "top" }}>
                          <div>{dayLabel(d)}{d === todayIso ? " · today" : ""}</div>
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                            {dayRosters.length === 0
                              ? <span style={{ fontSize: 10, color: "#64748b", fontWeight: 400 }}>no rosters yet</span>
                              : dayRosters.map((r) => <span key={r.id} className={`badge ${statusColour(r.status)}`} style={{ fontSize: 10, textTransform: "capitalize" }}>{r.shift_code} · {r.status}</span>)}
                          </div>
                        </th>
                      );
                    })}
                    {canEdit && <th style={{ minWidth: 96 }}>Week</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, limit).map((s) => (
                    <tr key={s.id}>
                      <td style={{ position: "sticky", left: 0, zIndex: 1, background: "var(--color-surface, #0f172a)" }}>
                        <strong>{s.name}</strong>
                        <div style={{ fontSize: 11, color: "#64748b" }}>{s.designation} · {s.service_number}{s.sector_id ? ` · Sector ${s.sector_id}` : ""}</div>
                      </td>
                      {days.map((d) => <td key={d} style={{ verticalAlign: "top" }}>{renderCell(s, d)}</td>)}
                      {canEdit && (
                        <td style={{ verticalAlign: "top" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => fillRow(s.id)} title="Copy the first assigned day across the whole week">Fill week</button>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => clearRow(s.id)}>Clear</button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loading && rows.length > limit && (
            <div style={{ padding: 12, textAlign: "center" }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setLimit((l) => l + PAGE_SIZE)}>Show more ({rows.length - limit} more officers)</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
