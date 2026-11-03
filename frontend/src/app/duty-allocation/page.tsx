"use client";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import {
  getStaff,
  getDashboardSummary,
  getDuties,
  getActiveDraft,
  getPolicyStatus,
  getSectors,
  getAuthorizers,
  createRoster,
  updateRosterAssignments,
  validateRoster,
  submitRoster,
  approveRoster,
  publishRoster,
  saveDraft,
  loadDraft,
  formatApiError,
  shiftLabels,
  ApiError,
  StaffMember,
  DutyItem,
  RosterDetail,
  ShiftInfo,
  Sector,
  ValidationIssue,
} from "@/lib/api";

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

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function DutyAllocationPage() {
  const { token, user } = useAuth();
  const [duties, setDuties] = useState<DutySlotWithAllocations[]>([]);
  const [activeRoster, setActiveRoster] = useState<RosterDetail | null>(null);
  const [availableStaff, setAvailableStaff] = useState<StaffMember[]>([]);
  const [staffStatusMap, setStaffStatusMap] = useState<Record<number, string>>({});
  const [shifts, setShifts] = useState<ShiftInfo[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [authorizers, setAuthorizers] = useState<Array<{ user_id: number; username: string; role: string; name: string; is_self: boolean }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedShift, setSelectedShift] = useState("A");
  const [selectedDate, setSelectedDate] = useState("");
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

  const labels = shiftLabels(shifts);
  const isSho = user?.role === "SHO" || user?.role === "SUPER_ADMIN";
  const isAdminSi = user?.role === "ADMIN_SI" || user?.role === "SUPER_ADMIN";
  const canEdit = isSho || isAdminSi;
  const draftKey = `alloc:${selectedDate}:${selectedShift}`;

  // Deep link from the roster page: /duty-allocation?date=YYYY-MM-DD&shift=A
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    setSelectedDate(qs.get("date") || todayIso());
    const s = qs.get("shift");
    if (s && ["A", "B", "C"].includes(s)) setSelectedShift(s);
  }, []);

  useEffect(() => {
    if (!token) return;
    getPolicyStatus(token).then((p) => setShifts(p.shifts)).catch(() => null);
    getSectors(token).then(setSectors);
    getAuthorizers(token).then(setAuthorizers);
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

      // Offer to restore an unsaved draft kept on the server (drafts survive logout).
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

  // Validate while editing (warn BEFORE saving) and keep an autosaved draft.
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
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Duty Allocation Workspace</h1>
          <div className="page-subtitle">
            Shift {selectedShift}{labels[selectedShift] ? ` (${labels[selectedShift]})` : ""} on {selectedDate} · required, allocated and vacant strength per duty
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
                    <button className="btn btn-secondary btn-sm" onClick={() => act(() => submitRoster(token!, activeRoster.id), `Roster #${activeRoster.id} submitted for SHO approval.`)} disabled={saving}>
                      📤 Submit for Approval
                    </button>
                  )}
                </>
              )}
              {activeRoster.status === "submitted" && isSho && (
                <button className="btn btn-primary btn-sm" onClick={() => act(() => approveRoster(token!, activeRoster.id), `Roster #${activeRoster.id} approved.`)} disabled={saving}>✓ Approve Roster (SHO)</button>
              )}
              {activeRoster.status === "approved" && canEdit && (
                <button className="btn btn-success btn-sm" onClick={() => act(() => publishRoster(token!, activeRoster.id), `Roster #${activeRoster.id} published.`)} disabled={saving}>📢 Publish Roster</button>
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
                    ? `This roster is ${activeRoster.status}. Use "Revise" on the roster page to start a new version.`
                    : canEdit ? "Create a draft roster to start allocating." : "Only the SHO or Admin SI can allocate duties. You can review the allocation here."}
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
    </AppShell>
  );
}
