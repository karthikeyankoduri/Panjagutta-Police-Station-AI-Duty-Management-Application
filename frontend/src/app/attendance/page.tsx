"use client";
import { useEffect, useState, useCallback, useMemo } from "react";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import { isoLocal, useToday } from "@/lib/use-today";
import {
  getStaff,
  getAttendance,
  getCurrentShift,
  getPolicyStatus,
  getMyDuties,
  getScheduledVsConfirmed,
  formatApiError,
  StaffMember,
} from "@/lib/api";

interface AttendanceRecord {
  id: number;
  staff_id: number;
  staff_name: string;
  service_number: string;
  designation: string;
  is_scheduled: boolean;
  is_confirmed: boolean;
  check_in_at?: string | null;
  check_out_at?: string | null;
  is_late?: boolean;
  status: "Present" | "Unscheduled" | "Not signed in" | "Off-shift";
  shift_code?: string;
  attendance_date?: string;
  notes?: string;
}

// Filled from the configured shift table (Policy & Shifts); never hard-coded.
const SHIFT_TIMINGS: Record<string, string> = {};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** HH:MM in the viewer's local time, or an em dash. */
function fmtTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Time spent signed in, e.g. "5h 40m", or an em dash while still signed in. */
function fmtDuration(from?: string | null, to?: string | null): string {
  if (!from || !to) return "—";
  const mins = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000));
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}

export default function AttendancePage() {
  const { token, user } = useAuth();

  const isStaff = user?.role === "STAFF";
  const isSupervisor = [
    "SUPER_ADMIN", "ADMIN_SI", "SHO", "DI", "DSI", "SECTOR_SI"
  ].includes(user?.role || "");

  // Notifications
  const [message, setMessage] = useState<{ text: string; type: "info" | "warning" } | null>(null);

  // Tab mode for supervisors: "station" (Station Roll-Call) vs "personal" (My Attendance) vs "verify"
  const [activeTab, setActiveTab] = useState<"station" | "personal" | "verify">(
    isStaff ? "personal" : "station"
  );
  const [, setTimingsLoaded] = useState(0);
  const [myDuties, setMyDuties] = useState<any[]>([]);
  const [verifyRows, setVerifyRows] = useState<any | null>(null);

  useEffect(() => {
    if (!token) return;
    getPolicyStatus(token).then((p) => {
      p.shifts.forEach((s) => { SHIFT_TIMINGS[s.shift_code] = `${s.start_time} - ${s.end_time}`; });
      setTimingsLoaded((n) => n + 1);
    }).catch(() => null);
    getMyDuties(token).then(setMyDuties);
  }, [token]);

  const todayLocal = useToday();
  const todaysDuties = myDuties.filter((d) => d.duty_date === todayLocal);

  const loadVerify = useCallback(async (date: string, shift: string) => {
    if (!token) return;
    try {
      setVerifyRows(await getScheduledVsConfirmed(token, date, shift));
    } catch (err: any) {
      setMessage({ text: formatApiError(err, "Could not load scheduled attendance"), type: "warning" });
    }
  }, [token]);

  // Personal View mode: "calendar" vs "history"
  const [personalViewMode, setPersonalViewMode] = useState<"calendar" | "history">("calendar");


  // ───────────────────────────────────────────────────────────────────────────
  // Station Roll-Call State (Supervisors)
  // ───────────────────────────────────────────────────────────────────────────
  const [stationDate, setStationDate] = useState("");
  const [stationShift, setStationShift] = useState("A");
  const [stationRecords, setStationRecords] = useState<AttendanceRecord[]>([]);
  const [stationLoading, setStationLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!stationDate) {
      setStationDate(isoLocal(new Date()));
    }
  }, [stationDate]);

  // Open on the shift that is running now (sign-ins are recorded against it), not always Shift A.
  useEffect(() => {
    if (!token) return;
    getCurrentShift(token)
      .then((c) => { setStationShift(c.shift_code); setStationDate(c.date); })
      .catch(() => null);
  }, [token]);

  const loadStationAttendance = useCallback(async () => {
    if (!token || isStaff) return;
    const dateToLoad = stationDate || isoLocal(new Date());
    setStationLoading(true);
    try {
      const [staffList, attRecords, sched] = await Promise.all([
        getStaff(token, { is_active: true }),
        getAttendance(token, { attendance_date: dateToLoad, shift_code: stationShift }),
        getScheduledVsConfirmed(token, dateToLoad, stationShift).catch(() => null),
      ]);

      const attMap = new Map<number, any>();
      if (Array.isArray(attRecords)) {
        attRecords.forEach((a: any) => attMap.set(a.staff_id, a));
      }
      const scheduledIds = new Set<number>(
        ((sched?.rows as any[]) || []).filter((r) => r.scheduled).map((r) => r.staff_id)
      );

      const merged: AttendanceRecord[] = (staffList || []).map((s) => {
        const att = attMap.get(s.id);
        const isScheduled = scheduledIds.has(s.id) || Boolean(att?.is_scheduled);
        const isConfirmed = att ? Boolean(att.is_confirmed) : false;
        let status: AttendanceRecord["status"];
        if (att) status = isConfirmed ? "Present" : "Unscheduled";
        else status = isScheduled ? "Not signed in" : "Off-shift";
        return {
          id: att?.id || s.id,
          staff_id: s.id,
          staff_name: s.name,
          service_number: s.service_number,
          designation: s.designation,
          is_scheduled: isScheduled,
          is_confirmed: isConfirmed,
          check_in_at: att?.check_in_at,
          check_out_at: att?.check_out_at,
          is_late: Boolean(att?.is_late),
          status,
          shift_code: att?.shift_code || stationShift,
          attendance_date: att?.attendance_date || dateToLoad,
          notes: att?.notes,
        };
      });

      setStationRecords(merged);
    } catch (err: any) {
      setMessage({ text: err.message || "Failed to load station attendance", type: "warning" });
    } finally {
      setStationLoading(false);
    }
  }, [token, stationDate, stationShift, isStaff]);

  useEffect(() => {
    if (activeTab === "station" && !isStaff) {
      loadStationAttendance();
    }
  }, [activeTab, loadStationAttendance, isStaff]);

  // ───────────────────────────────────────────────────────────────────────────
  // Personal Attendance & Monthly Calendar State
  // ───────────────────────────────────────────────────────────────────────────
  const [calYear, setCalYear] = useState(2026);
  const [calMonth, setCalMonth] = useState(10);
  const [todayStr, setTodayStr] = useState("");
  const [selectedCalDate, setSelectedCalDate] = useState("");
  const [personalRecords, setPersonalRecords] = useState<any[]>([]);
  const [personalLoading, setPersonalLoading] = useState(false);
  const [myStaffProfile, setMyStaffProfile] = useState<StaffMember | null>(null);

  useEffect(() => {
    const now = new Date();
    setCalYear(now.getFullYear());
    setCalMonth(now.getMonth());
    const ds = now.toISOString().split("T")[0];
    setTodayStr(ds);
    setSelectedCalDate(ds);
  }, []);

  // Month navigation
  const handlePrevMonth = () => {
    if (calMonth === 0) {
      setCalMonth(11);
      setCalYear((y) => y - 1);
    } else {
      setCalMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (calMonth === 11) {
      setCalMonth(0);
      setCalYear((y) => y + 1);
    } else {
      setCalMonth((m) => m + 1);
    }
  };

  const handleTodayMonth = () => {
    const now = new Date();
    setCalYear(now.getFullYear());
    setCalMonth(now.getMonth());
    const ds = now.toISOString().split("T")[0];
    setSelectedCalDate(ds);
  };

  // Load personal attendance for selected month
  const loadPersonalMonthAttendance = useCallback(async () => {
    if (!token) return;
    setPersonalLoading(true);

    const firstDay = new Date(calYear, calMonth, 1);
    const lastDay = new Date(calYear, calMonth + 1, 0);
    const startDate = firstDay.toISOString().split("T")[0];
    const endDate = lastDay.toISOString().split("T")[0];

    try {
      const [attData, staffList] = await Promise.all([
        getAttendance(token, {
          start_date: startDate,
          end_date: endDate,
          own_only: isSupervisor ? true : undefined,
        }),
        getStaff(token, { is_active: true }).catch(() => []),
      ]);

      setPersonalRecords(attData || []);

      // Resolve current user profile
      const found = (staffList || []).find(
        (s: StaffMember) =>
          s.user_username === user?.username ||
          s.service_number === user?.username ||
          s.id === (user as any)?.staff_id
      );
      if (found) {
        setMyStaffProfile(found);
      }
    } catch (err: any) {
      setMessage({ text: err.message || "Failed to load personal attendance records", type: "warning" });
    } finally {
      setPersonalLoading(false);
    }
  }, [token, calYear, calMonth, isSupervisor, user]);

  useEffect(() => {
    if (activeTab === "personal" || isStaff) {
      loadPersonalMonthAttendance();
    }
  }, [activeTab, isStaff, loadPersonalMonthAttendance]);

  // Calendar calculations
  const calendarDays = useMemo(() => {
    const firstDayIndex = new Date(calYear, calMonth, 1).getDay(); // 0 = Sun
    const totalDays = new Date(calYear, calMonth + 1, 0).getDate();

    // Previous month filler days
    const prevMonthDays = new Date(calYear, calMonth, 0).getDate();
    const days: Array<{
      dateStr: string;
      dayNum: number;
      isCurrentMonth: boolean;
      record?: any;
    }> = [];

    // Map attendance records by date string
    const dateMap = new Map<string, any>();
    personalRecords.forEach((r) => {
      if (r.attendance_date) dateMap.set(r.attendance_date, r);
    });

    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const dNum = prevMonthDays - i;
      const prevM = calMonth === 0 ? 11 : calMonth - 1;
      const prevY = calMonth === 0 ? calYear - 1 : calYear;
      const dateStr = `${prevY}-${String(prevM + 1).padStart(2, "0")}-${String(dNum).padStart(2, "0")}`;
      days.push({
        dateStr,
        dayNum: dNum,
        isCurrentMonth: false,
        record: dateMap.get(dateStr),
      });
    }

    for (let d = 1; d <= totalDays; d++) {
      const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push({
        dateStr,
        dayNum: d,
        isCurrentMonth: true,
        record: dateMap.get(dateStr),
      });
    }

    // Remaining filler days to complete 35 or 42 grid cells
    const remaining = (7 - (days.length % 7)) % 7;
    for (let r = 1; r <= remaining; r++) {
      const nextM = calMonth === 11 ? 0 : calMonth + 1;
      const nextY = calMonth === 11 ? calYear + 1 : calYear;
      const dateStr = `${nextY}-${String(nextM + 1).padStart(2, "0")}-${String(r).padStart(2, "0")}`;
      days.push({
        dateStr,
        dayNum: r,
        isCurrentMonth: false,
        record: dateMap.get(dateStr),
      });
    }

    return days;
  }, [calYear, calMonth, personalRecords]);

  // Selected Day Record details
  const selectedDayRecord = useMemo(() => {
    return personalRecords.find((r) => r.attendance_date === selectedCalDate);
  }, [personalRecords, selectedCalDate]);

  // Monthly stats
  const todaySignIns = useMemo(
    () => personalRecords.filter((r) => r.attendance_date === todayLocal && r.check_in_at),
    [personalRecords, todayLocal]
  );
  const monthlyConfirmedPresent = personalRecords.filter((r) => r.is_confirmed).length;
  const monthlyLate = personalRecords.filter((r) => r.is_late).length;
  const monthlySignIns = personalRecords.filter((r) => r.check_in_at).length;

  // Station counts for supervisor console
  const presentCount = stationRecords.filter((r) => r.status === "Present").length;
  const lateCount = stationRecords.filter((r) => r.is_late).length;
  const notSignedInCount = stationRecords.filter((r) => r.status === "Not signed in").length;
  const scheduledCount = stationRecords.filter((r) => r.is_scheduled).length;

  const filteredStationRecords = stationRecords.filter((r) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      r.staff_name.toLowerCase().includes(q) ||
      r.service_number.toLowerCase().includes(q) ||
      r.designation.toLowerCase().includes(q)
    );
  });

  return (
    <AppShell>
      {/* Dual Tab Switcher for Supervisory Roles */}
      {isSupervisor && (
        <div className="attendance-view-switcher">
          <button
            type="button"
            className={`btn ${activeTab === "station" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setActiveTab("station")}
            id="tab-station-console"
          >
            🏢 Station Roll-Call Console
          </button>
          <button
            type="button"
            className={`btn ${activeTab === "personal" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setActiveTab("personal")}
            id="tab-my-attendance"
          >
            👤 My Personal Attendance &amp; Calendar
          </button>
          <button
            type="button"
            className={`btn ${activeTab === "verify" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => { setActiveTab("verify"); loadVerify(stationDate || todayLocal, stationShift); }}
            id="tab-verify"
          >
            🧾 Scheduled vs Signed in
          </button>
        </div>
      )}

      {todaySignIns.length > 0 && (activeTab === "personal" || isStaff) && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__header"><span className="card__title">Today&apos;s sign-ins</span></div>
          <div className="card__body" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {todaySignIns.map((r: any) => (
              <div key={r.id} style={{ border: "1px solid var(--color-border, #e2e8f0)", borderRadius: 8, padding: "10px 14px", minWidth: 220 }}>
                <div style={{ fontWeight: 700 }}>Shift {r.shift_code}{SHIFT_TIMINGS[r.shift_code] ? ` · ${SHIFT_TIMINGS[r.shift_code]}` : ""}</div>
                <div style={{ marginTop: 8 }}>
                  <span className={`badge ${r.is_late ? "badge-warning" : "badge-success"}`}>
                    Signed in {fmtTime(r.check_in_at)}{r.is_late ? " · late" : ""}
                  </span>
                  {r.check_out_at && <span className="badge badge-default" style={{ marginLeft: 6 }}>Signed out {fmtTime(r.check_out_at)}</span>}
                  {!r.is_scheduled && <span className="badge badge-default" style={{ marginLeft: 6 }}>Not on roster</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {todaysDuties.length > 0 && (activeTab === "personal" || isStaff) && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__header"><span className="card__title">Today&apos;s published duty · attendance is recorded when you sign in</span></div>
          <div className="card__body" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {todaysDuties.map((d: any) => (
              <div key={`${d.roster_id}-${d.duty_category}`} style={{ border: "1px solid var(--color-border, #e2e8f0)", borderRadius: 8, padding: "10px 14px", minWidth: 220 }}>
                <div style={{ fontWeight: 700 }}>Shift {d.shift_name} · {d.start_time}–{d.end_time}</div>
                <div style={{ fontSize: 13 }}>{d.duty_category}</div>
                <div style={{ marginTop: 8 }}>
                  {d.check_in_at ? (
                    <>
                      <span className={`badge ${d.is_late ? "badge-warning" : "badge-success"}`}>
                        Signed in {fmtTime(d.check_in_at)}{d.is_late ? " · late" : ""}
                      </span>
                      {d.check_out_at && <span className="badge badge-default" style={{ marginLeft: 6 }}>Signed out {fmtTime(d.check_out_at)}</span>}
                    </>
                  ) : (
                    <span className="badge badge-default">Not signed in yet</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notifications */}
      {message && (
        <div
          className={`alert-banner alert-banner--${message.type === "warning" ? "warning" : "info"}`}
          style={{ marginBottom: "16px" }}
        >
          {message.text}
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════════
          TAB 1: STATION ROLL-CALL CONSOLE (SUPERVISORS ONLY)
          ═════════════════════════════════════════════════════════════════════ */}
      {isSupervisor && activeTab === "station" && (
        <>
          <div className="page-header">
            <div>
              <h1 className="page-title">Station Daily Attendance &amp; Roll-Call</h1>
              <div className="page-subtitle">
                Attendance is recorded automatically when each person signs in and out. This view is read-only.
              </div>
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={loadStationAttendance}
                disabled={stationLoading}
              >
                ↻ Refresh
              </button>
            </div>
          </div>

          {/* Date & Shift Selectors */}
          <div className="card" style={{ marginBottom: "20px" }}>
            <div className="card__body" style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: "1 1 200px" }}>
                <label style={{ fontSize: "13px", fontWeight: 600, whiteSpace: "nowrap" }}>Attendance Date:</label>
                <input
                  type="date"
                  className="form-control"
                  value={stationDate}
                  onChange={(e) => setStationDate(e.target.value)}
                  style={{ width: "100%", maxWidth: "220px" }}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: "1 1 200px" }}>
                <label style={{ fontSize: "13px", fontWeight: 600, whiteSpace: "nowrap" }}>Active Shift:</label>
                <select
                  className="form-control"
                  value={stationShift}
                  onChange={(e) => setStationShift(e.target.value)}
                  style={{ width: "100%", maxWidth: "240px" }}
                >
                  {["A", "B", "C"].map((s) => (
                    <option key={s} value={s}>Shift {s}{SHIFT_TIMINGS[s] ? ` (${SHIFT_TIMINGS[s]})` : ""}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: "1 1 220px" }}>
                <input
                  type="search"
                  className="form-control"
                  placeholder="Filter personnel name or service #..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Attendance Stats Cards */}
          <div className="stats-grid-5">
            <div className="card">
              <div className="card__body" style={{ textAlign: "center" }}>
                <div style={{ fontSize: "22px", fontWeight: 700, color: "#e2e8f0" }}>{stationRecords.length}</div>
                <div style={{ fontSize: "12px", color: "#94a3b8" }}>Total Station Strength</div>
              </div>
            </div>
            <div className="card">
              <div className="card__body" style={{ textAlign: "center" }}>
                <div style={{ fontSize: "22px", fontWeight: 700, color: "#38bdf8" }}>{scheduledCount}</div>
                <div style={{ fontSize: "12px", color: "#94a3b8" }}>Scheduled for Shift</div>
              </div>
            </div>
            <div className="card">
              <div className="card__body" style={{ textAlign: "center" }}>
                <div style={{ fontSize: "22px", fontWeight: 700, color: "#22c55e" }}>{presentCount}</div>
                <div style={{ fontSize: "12px", color: "#94a3b8" }}>Signed in (Present)</div>
              </div>
            </div>
            <div className="card">
              <div className="card__body" style={{ textAlign: "center" }}>
                <div style={{ fontSize: "22px", fontWeight: 700, color: lateCount > 0 ? "#f59e0b" : "#64748b" }}>
                  {lateCount}
                </div>
                <div style={{ fontSize: "12px", color: "#94a3b8" }}>Signed in late</div>
              </div>
            </div>
            <div className="card">
              <div className="card__body" style={{ textAlign: "center" }}>
                <div style={{ fontSize: "22px", fontWeight: 700, color: notSignedInCount > 0 ? "#ef4444" : "#64748b" }}>
                  {notSignedInCount}
                </div>
                <div style={{ fontSize: "12px", color: "#94a3b8" }}>Scheduled, not signed in</div>
              </div>
            </div>
          </div>

          {/* Attendance Roll Call Table */}
          <div className="card">
            <div className="card__header" style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="card__title">
                Shift {stationShift} Station Roll-Call ({filteredStationRecords.length} Personnel)
              </span>
            </div>
            <div className="card__body" style={{ padding: 0 }}>
              {stationLoading ? (
                <div style={{ padding: "30px", textAlign: "center", color: "#94a3b8" }}>Loading roll-call...</div>
              ) : filteredStationRecords.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state__icon">👥</div>
                  <div className="empty-state__title">No Personnel Records</div>
                  <div className="empty-state__text">
                    {searchQuery ? "No staff match your search query." : "No active staff found in system."}
                  </div>
                </div>
              ) : (
                <div className="table-container">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Service #</th>
                        <th>Officer Name</th>
                        <th>Designation</th>
                        <th>Roster Scheduled</th>
                        <th>Attendance Status</th>
                        <th>Signed in</th>
                        <th>Signed out</th>
                        <th>Time on duty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredStationRecords.map((r) => (
                        <tr key={r.staff_id}>
                          <td><strong>{r.service_number}</strong></td>
                          <td>{r.staff_name}</td>
                          <td>{r.designation}</td>
                          <td>
                            {r.is_scheduled ? (
                              <span className="badge badge-info">Scheduled</span>
                            ) : (
                              <span style={{ fontSize: "12px", color: "#64748b" }}>Off-Shift</span>
                            )}
                          </td>
                          <td>
                            <span
                              className={`badge ${
                                r.status === "Present"
                                  ? "badge-success"
                                  : r.status === "Not signed in"
                                  ? "badge-danger"
                                  : "badge-default"
                              }`}
                            >
                              {r.status}
                            </span>
                            {r.is_late && <span className="badge badge-warning" style={{ marginLeft: 6 }}>Late</span>}
                          </td>
                          <td>{fmtTime(r.check_in_at)}</td>
                          <td>{r.check_in_at && !r.check_out_at ? <span className="text-muted">Still signed in</span> : fmtTime(r.check_out_at)}</td>
                          <td>{fmtDuration(r.check_in_at, r.check_out_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {isSupervisor && activeTab === "verify" && (
        <>
          <div className="page-header">
            <div>
              <h1 className="page-title">Scheduled vs Signed-in Attendance</h1>
              <div className="page-subtitle">Scheduled duty comes from the latest published roster; attendance is recorded automatically at sign-in.</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input type="date" className="form-control" value={stationDate} onChange={(e) => setStationDate(e.target.value)} aria-label="Date" />
              <select className="form-control" value={stationShift} onChange={(e) => setStationShift(e.target.value)} aria-label="Shift">
                {["A", "B", "C"].map((s) => <option key={s} value={s}>Shift {s}{SHIFT_TIMINGS[s] ? ` (${SHIFT_TIMINGS[s]})` : ""}</option>)}
              </select>
              <button className="btn btn-secondary btn-sm" onClick={() => loadVerify(stationDate || todayLocal, stationShift)}>Load</button>
            </div>
          </div>
          {verifyRows && (
            <>
              <div className="stats-grid-5" style={{ marginBottom: 16 }}>
                {[
                  ["Scheduled", verifyRows.scheduled],
                  ["Signed in", verifyRows.confirmed],
                  ["Scheduled, not signed in", verifyRows.scheduled_not_confirmed],
                  ["Signed in, not scheduled", verifyRows.confirmed_not_scheduled],
                ].map(([label, n]) => (
                  <div className="card" key={label as string}><div className="card__body" style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 700 }}>{n as number}</div>
                    <div style={{ fontSize: 12, color: "#94a3b8" }}>{label as string}</div>
                  </div></div>
                ))}
              </div>
              {!verifyRows.roster_id && <div className="alert-banner alert-banner--info" style={{ marginBottom: 12 }}>No published roster for this shift yet.</div>}
              <div className="card"><div className="card__body" style={{ padding: 0 }}>
                <table className="table">
                  <thead><tr><th>Service #</th><th>Name</th><th>Scheduled</th><th>Status</th><th>Signed in</th><th>Signed out</th></tr></thead>
                  <tbody>
                    {verifyRows.rows.map((r: any) => (
                      <tr key={r.staff_id}>
                        <td><strong>{r.service_number}</strong></td><td>{r.name}</td>
                        <td>{r.scheduled ? <span className="badge badge-info">Scheduled</span> : "—"}</td>
                        <td>
                          {r.confirmed ? <span className="badge badge-success">Present</span> : r.attendance_id ? <span className="badge badge-default">Unscheduled sign-in</span> : <span className="badge badge-danger">Not signed in</span>}
                          {r.is_late && <span className="badge badge-warning" style={{ marginLeft: 6 }}>Late</span>}
                        </td>
                        <td>{fmtTime(r.check_in_at)}</td>
                        <td>{fmtTime(r.check_out_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div></div>
            </>
          )}
        </>
      )}

      {/* ═════════════════════════════════════════════════════════════════════
          TAB 2 / STAFF VIEW: PERSONAL ATTENDANCE & MONTHLY CALENDAR
          ═════════════════════════════════════════════════════════════════════ */}
      {(isStaff || activeTab === "personal") && (
        <>
          <div className="page-header">
            <div>
              <h1 className="page-title">
                {isStaff ? "My Daily Attendance & Duty Calendar" : "My Personal Attendance Record"}
              </h1>
              <div className="page-subtitle">
                Your attendance is recorded automatically each time you sign in and out. Review your shifts and monthly history here.
              </div>
            </div>

            {/* View Mode Switcher: Calendar vs History */}
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                className={`btn btn-sm ${personalViewMode === "calendar" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setPersonalViewMode("calendar")}
              >
                📅 Calendar View
              </button>
              <button
                type="button"
                className={`btn btn-sm ${personalViewMode === "history" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setPersonalViewMode("history")}
              >
                📋 History Ledger
              </button>
            </div>
          </div>

          {/* Officer Profile Card */}
          <div className="card" style={{ marginBottom: "20px", background: "linear-gradient(135deg, #1b2a3d 0%, #0d1b2a 100%)", color: "#fff", borderColor: "#2e4058" }}>
            <div className="card__body" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                <div style={{ fontSize: "32px", background: "#243447", width: "54px", height: "54px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  👮
                </div>
                <div>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: "#fff" }}>
                    {myStaffProfile ? myStaffProfile.name : user?.username}
                  </div>
                  <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "2px" }}>
                    Service No: <strong style={{ color: "#38bdf8" }}>{myStaffProfile?.service_number || user?.username}</strong> &middot; Rank: {myStaffProfile?.designation || user?.role} {myStaffProfile?.sector_id ? `· Sector ${myStaffProfile.sector_id}` : ""}
                  </div>
                </div>
              </div>

              {/* Monthly Stats Summary */}
              <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                <div style={{ textAlign: "center", padding: "6px 12px", background: "rgba(255,255,255,0.05)", borderRadius: "8px" }}>
                  <div style={{ fontSize: "18px", fontWeight: 800, color: "#22c55e" }}>{monthlyConfirmedPresent}</div>
                  <div style={{ fontSize: "10px", color: "#94a3b8", textTransform: "uppercase" }}>Days Present</div>
                </div>
                <div style={{ textAlign: "center", padding: "6px 12px", background: "rgba(255,255,255,0.05)", borderRadius: "8px" }}>
                  <div style={{ fontSize: "18px", fontWeight: 800, color: monthlyLate > 0 ? "#f59e0b" : "#94a3b8" }}>{monthlyLate}</div>
                  <div style={{ fontSize: "10px", color: "#94a3b8", textTransform: "uppercase" }}>Late Sign-ins</div>
                </div>
                <div style={{ textAlign: "center", padding: "6px 12px", background: "rgba(255,255,255,0.05)", borderRadius: "8px" }}>
                  <div style={{ fontSize: "18px", fontWeight: 800, color: "#38bdf8" }}>{monthlySignIns}</div>
                  <div style={{ fontSize: "10px", color: "#94a3b8", textTransform: "uppercase" }}>Total Sign-ins</div>
                </div>
              </div>
            </div>
          </div>

          {/* ──────────────────────────────────────────────────────────────────
              MODE A: MONTHLY CALENDAR VIEW
              ────────────────────────────────────────────────────────────────── */}
          {personalViewMode === "calendar" ? (
            <>
              <div className="calendar-card">
                {/* Calendar Header with Month Navigation */}
                <div className="calendar-header">
                  <div className="calendar-nav-group">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={handlePrevMonth}
                      title="Previous month"
                    >
                      &larr; Prev
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={handleNextMonth}
                      title="Next month"
                    >
                      Next &rarr;
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={handleTodayMonth}
                    >
                      Today
                    </button>
                  </div>

                  <div className="calendar-month-title">
                    {MONTH_NAMES[calMonth]} {calYear}
                  </div>

                  <div style={{ fontSize: "12px", color: "#64748b" }}>
                    Select any date to view duty breakdown
                  </div>
                </div>

                {/* Weekday Names Header */}
                <div className="calendar-weekdays">
                  {WEEKDAY_NAMES.map((d) => (
                    <div key={d}>{d}</div>
                  ))}
                </div>

                {/* 7-Column Day Grid */}
                {personalLoading ? (
                  <div style={{ padding: "40px", textAlign: "center", color: "#94a3b8" }}>
                    <div className="spinner" style={{ marginBottom: "8px" }} />
                    <div>Loading duty calendar...</div>
                  </div>
                ) : (
                  <div className="calendar-grid">
                    {calendarDays.map((day, idx) => {
                      const isSelected = day.dateStr === selectedCalDate;
                      const isToday = day.dateStr === todayStr;
                      const hasRecord = Boolean(day.record);
                      const isConfirmed = day.record?.is_confirmed;
                      const shift = day.record?.shift_code;

                      return (
                        <div
                          key={idx}
                          className={`calendar-day-cell ${!day.isCurrentMonth ? "other-month" : ""} ${isSelected ? "selected" : ""} ${isToday ? "today" : ""}`}
                          onClick={() => setSelectedCalDate(day.dateStr)}
                        >
                          <div className="day-header">
                            <span className="day-num">{day.dayNum}</span>
                            {shift && (
                              <span className="day-shift-badge">
                                Shift {shift}
                              </span>
                            )}
                          </div>

                          {/* Status Indicator Pill */}
                          <div style={{ marginTop: "4px" }}>
                            {hasRecord ? (
                              isConfirmed ? (
                                <span className={`day-pill ${day.record?.is_late ? "badge-yellow" : "badge-green"}`} title={day.record?.is_late ? "Signed in late" : "Signed in on time"}>
                                  ● {day.record?.is_late ? "Late" : "Present"}
                                </span>
                              ) : (
                                <span className="day-pill badge-gray" title="Signed in, not on the roster for this shift">
                                  ● Unscheduled
                                </span>
                              )
                            ) : (
                              day.isCurrentMonth && (
                                <span style={{ fontSize: "10px", color: "#94a3b8" }}>
                                  &mdash;
                                </span>
                              )
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Selected Day Detail Card */}
              <div className="day-detail-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px", marginBottom: "14px" }}>
                  <div>
                    <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-navy-900)" }}>
                      Duty Detail for: {selectedCalDate ? new Date(selectedCalDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }) : "Select a date"}
                      {selectedCalDate && selectedCalDate === todayStr && (
                        <span className="badge badge-blue" style={{ marginLeft: "8px" }}>Today</span>
                      )}
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--color-muted)", marginTop: "2px" }}>
                      Official Panjagutta Police Station Roll-Call Ledger
                    </div>
                  </div>

                  {/* Status Badge */}
                  <div>
                    {selectedDayRecord ? (
                      selectedDayRecord.is_confirmed ? (
                        <span className="badge badge-green" style={{ fontSize: "12px", padding: "5px 12px" }}>
                          ✓ Present{selectedDayRecord.is_late ? " (late)" : ""}
                        </span>
                      ) : (
                        <span className="badge badge-gray" style={{ fontSize: "12px", padding: "5px 12px" }}>
                          Signed in · not on roster
                        </span>
                      )
                    ) : (
                      <span className="badge badge-gray" style={{ fontSize: "12px", padding: "5px 12px" }}>
                        ⚪ No sign-in recorded
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "14px", background: "var(--color-surface-bg)", padding: "14px", borderRadius: "var(--radius-md)" }}>
                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-muted)", textTransform: "uppercase" }}>Assigned Shift</div>
                    <div style={{ fontSize: "14px", fontWeight: 700, color: "#1e293b", marginTop: "2px" }}>
                      {selectedDayRecord?.shift_code ? `Shift ${selectedDayRecord.shift_code} (${SHIFT_TIMINGS[selectedDayRecord.shift_code] || "Standard Hours"})` : "Not assigned / Rest day"}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-muted)", textTransform: "uppercase" }}>Scheduled on Roster</div>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: selectedDayRecord?.is_scheduled ? "#16a34a" : "#64748b", marginTop: "2px" }}>
                      {selectedDayRecord?.is_scheduled ? "Yes — Scheduled on Duty Roster" : "No / Unscheduled"}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-muted)", textTransform: "uppercase" }}>Signed in</div>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: "#1e293b", marginTop: "2px" }}>
                      {selectedDayRecord?.check_in_at
                        ? `${fmtTime(selectedDayRecord.check_in_at)}${selectedDayRecord.is_late ? " (late)" : ""}`
                        : selectedDayRecord ? "Marked by a supervisor (earlier record)" : "—"}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-muted)", textTransform: "uppercase" }}>Signed out</div>
                    <div style={{ fontSize: "13px", color: "#475569", marginTop: "2px" }}>
                      {selectedDayRecord?.check_in_at && !selectedDayRecord?.check_out_at
                        ? "Still signed in"
                        : `${fmtTime(selectedDayRecord?.check_out_at)}${selectedDayRecord?.check_out_at ? ` · ${fmtDuration(selectedDayRecord.check_in_at, selectedDayRecord.check_out_at)} on duty` : ""}`}
                    </div>
                  </div>
                </div>

                {selectedDayRecord?.notes && (
                  <div style={{ marginTop: "12px", fontSize: "12px", color: "#475569" }}>
                    <strong>Remarks:</strong> {selectedDayRecord.notes}
                  </div>
                )}
              </div>
            </>
          ) : (
            /* ──────────────────────────────────────────────────────────────────
                MODE B: PERSONAL HISTORY TABLE
                ────────────────────────────────────────────────────────────────── */
            <div className="card">
              <div className="card__header">
                <span className="card__title">
                  My Attendance History ({MONTH_NAMES[calMonth]} {calYear})
                </span>
                <span style={{ fontSize: "12px", color: "#94a3b8" }}>
                  {personalRecords.length} records in this period
                </span>
              </div>
              <div className="card__body" style={{ padding: 0 }}>
                {personalLoading ? (
                  <div style={{ padding: "30px", textAlign: "center", color: "#94a3b8" }}>Loading records...</div>
                ) : personalRecords.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-state__icon">📅</div>
                    <div className="empty-state__title">No Attendance Records</div>
                    <div className="empty-state__text">
                      No duty records recorded for {MONTH_NAMES[calMonth]} {calYear}.
                    </div>
                  </div>
                ) : (
                  <div className="table-container">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Shift</th>
                          <th>Shift Timings</th>
                          <th>Scheduled</th>
                          <th>Status</th>
                          <th>Signed in</th>
                          <th>Signed out</th>
                        </tr>
                      </thead>
                      <tbody>
                        {personalRecords.map((r) => (
                          <tr key={r.id}>
                            <td><strong>{r.attendance_date}</strong></td>
                            <td>
                              <span className="day-shift-badge">Shift {r.shift_code}</span>
                            </td>
                            <td style={{ fontSize: "12px", color: "#64748b" }}>
                              {SHIFT_TIMINGS[r.shift_code] || "—"}
                            </td>
                            <td>
                              {r.is_scheduled ? (
                                <span className="badge badge-info">Scheduled</span>
                              ) : (
                                <span style={{ fontSize: "12px", color: "#64748b" }}>Off-Duty</span>
                              )}
                            </td>
                            <td>
                              <span className={`badge ${r.is_confirmed ? "badge-success" : "badge-default"}`}>
                                {r.is_confirmed ? "Present" : "Unscheduled"}
                              </span>
                              {r.is_late && <span className="badge badge-warning" style={{ marginLeft: 6 }}>Late</span>}
                            </td>
                            <td style={{ fontSize: "12px", color: "#64748b" }}>
                              {r.check_in_at ? fmtTime(r.check_in_at) : "Supervisor-marked"}
                            </td>
                            <td style={{ fontSize: "12px", color: "#94a3b8" }}>
                              {r.check_in_at && !r.check_out_at ? "Still signed in" : fmtTime(r.check_out_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
