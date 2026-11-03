"use client";
import { useEffect, useState, useCallback, useMemo } from "react";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import { useToday } from "@/lib/use-today";
import {
  getStaff,
  getAttendance,
  markAttendance,
  bulkAttendance,
  getPolicyStatus,
  getMyDuties,
  submitOwnAttendance,
  getScheduledVsConfirmed,
  verifyAttendance,
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
  verified_by?: string;
  verified_at?: string;
  status: "Present" | "Absent" | "Pending";
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
  const canVerify = ["SUPER_ADMIN", "ADMIN_SI", "SHO", "SECTOR_SI"].includes(user?.role || "");

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

  const handleSubmitOwn = async (shift: string) => {
    if (!token) return;
    try {
      await submitOwnAttendance(token, { attendance_date: todayLocal, shift_code: shift });
      setMessage({ text: `Attendance submitted for Shift ${shift}. An officer will verify it.`, type: "info" });
      setMyDuties(await getMyDuties(token));
    } catch (err: any) {
      setMessage({ text: formatApiError(err, "Could not submit attendance"), type: "warning" });
    }
  };

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
      setStationDate(new Date().toISOString().split("T")[0]);
    }
  }, [stationDate]);

  const loadStationAttendance = useCallback(async () => {
    if (!token || isStaff) return;
    const dateToLoad = stationDate || new Date().toISOString().split("T")[0];
    setStationLoading(true);
    try {
      const [staffList, attRecords] = await Promise.all([
        getStaff(token, { is_active: true }),
        getAttendance(token, { attendance_date: dateToLoad, shift_code: stationShift }),
      ]);

      const attMap = new Map<number, any>();
      if (Array.isArray(attRecords)) {
        attRecords.forEach((a: any) => attMap.set(a.staff_id, a));
      }

      const merged: AttendanceRecord[] = (staffList || []).map((s) => {
        const att = attMap.get(s.id);
        const isConfirmed = att ? Boolean(att.is_confirmed) : false;
        const isScheduled = att ? Boolean(att.is_scheduled) : true;
        let status: "Present" | "Absent" | "Pending" = "Pending";
        if (att) {
          status = isConfirmed ? "Present" : "Absent";
        }
        return {
          id: att?.id || s.id,
          staff_id: s.id,
          staff_name: s.name,
          service_number: s.service_number,
          designation: s.designation,
          is_scheduled: isScheduled,
          is_confirmed: isConfirmed,
          verified_by: att?.verified_by_id ? String(att.verified_by_id) : undefined,
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

  const handleMarkStation = async (staffId: number, status: "Present" | "Absent") => {
    if (!token) return;
    const dateToSave = stationDate || new Date().toISOString().split("T")[0];
    try {
      await markAttendance(token, {
        staff_id: staffId,
        attendance_date: dateToSave,
        shift_code: stationShift,
        is_confirmed: status === "Present",
        status,
      });
      setStationRecords((prev) =>
        prev.map((r) =>
          r.staff_id === staffId
            ? { ...r, is_confirmed: status === "Present", status }
            : r
        )
      );
      setMessage({ text: `Attendance updated for staff #${staffId} (${status}).`, type: "info" });
    } catch (err: any) {
      setMessage({ text: `Failed to update attendance: ${err.message}`, type: "warning" });
    }
  };

  const handleBulkConfirm = async () => {
    if (!token) return;
    const dateToSave = stationDate || new Date().toISOString().split("T")[0];
    try {
      await bulkAttendance(token, {
        attendance_date: dateToSave,
        shift_code: stationShift,
        action: "confirm_all",
      });
      setStationRecords((prev) =>
        prev.map((r) => ({ ...r, is_scheduled: true, is_confirmed: true, status: "Present" }))
      );
      setMessage({ text: "All personnel confirmed Present for this shift.", type: "info" });
    } catch (err: any) {
      setMessage({ text: `Failed to bulk confirm attendance: ${err.message}`, type: "warning" });
    }
  };

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
  const monthlyConfirmedPresent = personalRecords.filter((r) => r.is_confirmed).length;
  const monthlyAbsent = personalRecords.filter((r) => !r.is_confirmed && r.is_scheduled).length;
  const monthlyScheduled = personalRecords.filter((r) => r.is_scheduled).length;

  // Station counts for supervisor console
  const presentCount = stationRecords.filter((r) => r.status === "Present").length;
  const absentCount = stationRecords.filter((r) => r.status === "Absent").length;
  const pendingCount = stationRecords.filter((r) => r.status === "Pending").length;
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
            🧾 Scheduled vs Confirmed
          </button>
        </div>
      )}

      {todaysDuties.length > 0 && (activeTab === "personal" || isStaff) && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__header"><span className="card__title">Today&apos;s published duty</span></div>
          <div className="card__body" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {todaysDuties.map((d: any) => (
              <div key={`${d.roster_id}-${d.duty_category}`} style={{ border: "1px solid var(--color-border, #e2e8f0)", borderRadius: 8, padding: "10px 14px", minWidth: 220 }}>
                <div style={{ fontWeight: 700 }}>Shift {d.shift_name} · {d.start_time}–{d.end_time}</div>
                <div style={{ fontSize: 13 }}>{d.duty_category}</div>
                <div style={{ marginTop: 8 }}>
                  {d.attendance_confirmed ? (
                    <span className="badge badge-success">Verified</span>
                  ) : d.attendance_submitted_at ? (
                    <span className="badge badge-warning">Submitted · awaiting verification</span>
                  ) : (
                    <button className="btn btn-primary btn-sm" onClick={() => handleSubmitOwn(d.shift_name)}>Submit my attendance</button>
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
                Supervisory station strength headcount, shift roll-call confirmation, and per-officer attendance logging.
              </div>
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleBulkConfirm}
                id="btn-bulk-confirm"
              >
                ✓ Bulk Confirm Scheduled Present
              </button>
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
                <div style={{ fontSize: "12px", color: "#94a3b8" }}>Confirmed Present</div>
              </div>
            </div>
            <div className="card">
              <div className="card__body" style={{ textAlign: "center" }}>
                <div style={{ fontSize: "22px", fontWeight: 700, color: absentCount > 0 ? "#ef4444" : "#64748b" }}>
                  {absentCount}
                </div>
                <div style={{ fontSize: "12px", color: "#94a3b8" }}>Marked Absent</div>
              </div>
            </div>
            <div className="card">
              <div className="card__body" style={{ textAlign: "center" }}>
                <div style={{ fontSize: "22px", fontWeight: 700, color: pendingCount > 0 ? "#f59e0b" : "#64748b" }}>
                  {pendingCount}
                </div>
                <div style={{ fontSize: "12px", color: "#94a3b8" }}>Pending Roll-Call</div>
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
                        <th>Roll-Call Action</th>
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
                                  : r.status === "Absent"
                                  ? "badge-danger"
                                  : "badge-default"
                              }`}
                            >
                              {r.status}
                            </span>
                          </td>
                          <td>
                            <div style={{ display: "flex", gap: "6px" }}>
                              <button
                                className="btn btn-success btn-sm"
                                onClick={() => handleMarkStation(r.staff_id, "Present")}
                              >
                                ✓ Present
                              </button>
                              <button
                                className="btn btn-danger btn-sm"
                                onClick={() => handleMarkStation(r.staff_id, "Absent")}
                              >
                                ✗ Absent
                              </button>
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
        </>
      )}

      {isSupervisor && activeTab === "verify" && (
        <>
          <div className="page-header">
            <div>
              <h1 className="page-title">Scheduled vs Confirmed Attendance</h1>
              <div className="page-subtitle">Scheduled duty comes from the latest published roster; confirmed attendance is verified by an officer.</div>
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
                  ["Confirmed", verifyRows.confirmed],
                  ["Scheduled, not confirmed", verifyRows.scheduled_not_confirmed],
                  ["Confirmed, not scheduled", verifyRows.confirmed_not_scheduled],
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
                  <thead><tr><th>Service #</th><th>Name</th><th>Scheduled</th><th>Submitted</th><th>Confirmed</th><th></th></tr></thead>
                  <tbody>
                    {verifyRows.rows.map((r: any) => (
                      <tr key={r.staff_id}>
                        <td><strong>{r.service_number}</strong></td><td>{r.name}</td>
                        <td>{r.scheduled ? <span className="badge badge-info">Scheduled</span> : "—"}</td>
                        <td>{r.submitted ? "Yes" : "—"}</td>
                        <td>{r.confirmed ? <span className="badge badge-success">Verified</span> : <span className="badge badge-default">Not confirmed</span>}</td>
                        <td>
                          {canVerify && r.attendance_id && !r.confirmed && (
                            <button className="btn btn-success btn-sm" onClick={async () => {
                              try { await verifyAttendance(token!, r.attendance_id); loadVerify(stationDate || todayLocal, stationShift); }
                              catch (err: any) { setMessage({ text: formatApiError(err, "Could not verify"), type: "warning" }); }
                            }}>Verify</button>
                          )}
                        </td>
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
                Track your scheduled shifts, verified presence, and view monthly duty attendance history.
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
                  <div style={{ fontSize: "18px", fontWeight: 800, color: monthlyAbsent > 0 ? "#ef4444" : "#94a3b8" }}>{monthlyAbsent}</div>
                  <div style={{ fontSize: "10px", color: "#94a3b8", textTransform: "uppercase" }}>Days Absent</div>
                </div>
                <div style={{ textAlign: "center", padding: "6px 12px", background: "rgba(255,255,255,0.05)", borderRadius: "8px" }}>
                  <div style={{ fontSize: "18px", fontWeight: 800, color: "#38bdf8" }}>{monthlyScheduled}</div>
                  <div style={{ fontSize: "10px", color: "#94a3b8", textTransform: "uppercase" }}>Total Scheduled</div>
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
                                <span className="day-pill badge-green" title="Confirmed Present">
                                  ● Present
                                </span>
                              ) : (
                                <span className="day-pill badge-red" title="Marked Absent">
                                  ● Absent
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
                          ✓ Confirmed Present
                        </span>
                      ) : (
                        <span className="badge badge-red" style={{ fontSize: "12px", padding: "5px 12px" }}>
                          ✗ Marked Absent
                        </span>
                      )
                    ) : (
                      <span className="badge badge-gray" style={{ fontSize: "12px", padding: "5px 12px" }}>
                        ⚪ No Roll-Call Recorded
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
                    <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-muted)", textTransform: "uppercase" }}>Verified By Supervisor</div>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: "#1e293b", marginTop: "2px" }}>
                      {selectedDayRecord?.verified_by_id ? `Supervisor #${selectedDayRecord.verified_by_id}` : (selectedDayRecord?.is_confirmed ? "Station Officer" : "Pending Verification")}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-muted)", textTransform: "uppercase" }}>Verification Timestamp</div>
                    <div style={{ fontSize: "13px", color: "#475569", marginTop: "2px" }}>
                      {selectedDayRecord?.verified_at ? new Date(selectedDayRecord.verified_at).toLocaleTimeString() : "—"}
                    </div>
                  </div>
                </div>

                {selectedDayRecord?.notes && (
                  <div style={{ marginTop: "12px", fontSize: "12px", color: "#475569" }}>
                    <strong>Officer Remarks:</strong> {selectedDayRecord.notes}
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
                          <th>Roll-Call Status</th>
                          <th>Verified By</th>
                          <th>Timestamp</th>
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
                              <span className={`badge ${r.is_confirmed ? "badge-success" : "badge-danger"}`}>
                                {r.is_confirmed ? "Present" : "Absent"}
                              </span>
                            </td>
                            <td style={{ fontSize: "12px", color: "#64748b" }}>
                              {r.verified_by_id ? `Supervisor #${r.verified_by_id}` : (r.is_confirmed ? "Station Officer" : "Pending")}
                            </td>
                            <td style={{ fontSize: "12px", color: "#94a3b8" }}>
                              {r.verified_at ? new Date(r.verified_at).toLocaleTimeString() : "—"}
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
