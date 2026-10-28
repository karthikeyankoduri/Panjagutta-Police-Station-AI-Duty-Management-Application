"use client";
import { useEffect, useState, useCallback } from "react";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import { getStaff, getDashboardSummary, StaffMember } from "@/lib/api";

interface DutySlot {
  id: string;
  category: string;
  duty_point: string;
  required_strength: number;
  eligible_designations: string[];
  assigned_staff: StaffMember[];
  sector_id?: number;
}

const DEFAULT_DUTY_SLOTS: DutySlot[] = [
  {
    id: "slot-writer",
    category: "General Duty",
    duty_point: "Station Writer / General Diary",
    required_strength: 1,
    eligible_designations: ["ASI", "HC"],
    assigned_staff: [],
  },
  {
    id: "slot-sentry",
    category: "Security",
    duty_point: "Station Sentry & Lockup Guard",
    required_strength: 2,
    eligible_designations: ["PC", "HC", "ARPC"],
    assigned_staff: [],
  },
  {
    id: "slot-reception",
    category: "Public Interface",
    duty_point: "Reception & Public Grievance Desk",
    required_strength: 1,
    eligible_designations: ["WPC", "WHC", "PC"],
    assigned_staff: [],
  },
  {
    id: "slot-bc-1",
    category: "Sector 1 Patrol",
    duty_point: "Sector 1 — Blue Colts Motorcycle Beat",
    required_strength: 2,
    eligible_designations: ["PC", "HC", "HGS"],
    sector_id: 1,
    assigned_staff: [],
  },
  {
    id: "slot-patrol-1",
    category: "Sector 1 Patrol",
    duty_point: "Sector 1 — Patrol Mobile Car",
    required_strength: 2,
    eligible_designations: ["PC", "HC", "ASI"],
    sector_id: 1,
    assigned_staff: [],
  },
  {
    id: "slot-bc-2",
    category: "Sector 2 Patrol",
    duty_point: "Sector 2 — Blue Colts Motorcycle Beat",
    required_strength: 2,
    eligible_designations: ["PC", "HC"],
    sector_id: 2,
    assigned_staff: [],
  },
  {
    id: "slot-court",
    category: "Legal & Court",
    duty_point: "Court Duty & Summon Service (Nampally Courts)",
    required_strength: 2,
    eligible_designations: ["PC", "HC"],
    assigned_staff: [],
  },
  {
    id: "slot-reserve",
    category: "Station Reserve",
    duty_point: "Law & Order Emergency Reserve",
    required_strength: 4,
    eligible_designations: ["PC", "HC", "ARPC", "HGS"],
    assigned_staff: [],
  },
];

export default function DutyAllocationPage() {
  const { token, user } = useAuth();
  const [slots, setSlots] = useState<DutySlot[]>(DEFAULT_DUTY_SLOTS);
  const [availableStaff, setAvailableStaff] = useState<StaffMember[]>([]);
  const [staffStatusMap, setStaffStatusMap] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [selectedShift, setSelectedShift] = useState("A");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState<string>(DEFAULT_DUTY_SLOTS[0].id);
  const [selectedStaffId, setSelectedStaffId] = useState<string>("");
  const [message, setMessage] = useState<{ text: string; type: "info" | "warning" } | null>(null);

  useEffect(() => {
    if (!selectedDate) setSelectedDate(new Date().toISOString().split("T")[0]);
  }, [selectedDate]);

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [staffList, summary] = await Promise.all([
        getStaff(token, { is_active: true }),
        getDashboardSummary(token, selectedDate, selectedShift),
      ]);
      setAvailableStaff(staffList);

      const statusMap: Record<number, string> = {};
      summary.staff_status_list.forEach((s) => {
        statusMap[s.staff_id] = s.status;
      });
      setStaffStatusMap(statusMap);
    } catch (err: any) {
      setMessage({ text: err.message || "Failed to load duty data", type: "warning" });
    } finally {
      setLoading(false);
    }
  }, [token, selectedDate, selectedShift]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAssign = () => {
    if (!selectedStaffId) {
      setMessage({ text: "Please select a staff member to allocate.", type: "warning" });
      return;
    }
    const staffId = parseInt(selectedStaffId, 10);
    const staffObj = availableStaff.find((s) => s.id === staffId);
    if (!staffObj) return;

    // Check availability
    const status = staffStatusMap[staffId];
    if (status && status !== "Present - Available" && status !== "On Duty") {
      setMessage({
        text: `Warning: ${staffObj.name} is marked as '${status}'. Duty assignment may create a scheduling conflict.`,
        type: "warning",
      });
    }

    setSlots((prev) =>
      prev.map((slot) => {
        if (slot.id === selectedSlotId) {
          // Check if already assigned
          if (slot.assigned_staff.some((s) => s.id === staffId)) return slot;
          return {
            ...slot,
            assigned_staff: [...slot.assigned_staff, staffObj],
          };
        }
        return slot;
      })
    );

    setMessage({ text: `Successfully allocated ${staffObj.name} to duty point.`, type: "info" });
    setSelectedStaffId("");
  };

  const handleRemoveAssignment = (slotId: string, staffId: number) => {
    setSlots((prev) =>
      prev.map((slot) => {
        if (slot.id === slotId) {
          return {
            ...slot,
            assigned_staff: slot.assigned_staff.filter((s) => s.id !== staffId),
          };
        }
        return slot;
      })
    );
  };

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Duty Allocation Workspace</h1>
          <div className="page-subtitle">
            Assign available personnel to station beats, mobile patrols, and security points for Shift {selectedShift}.
          </div>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button className="btn btn-secondary btn-sm" onClick={loadData}>
            ↻ Refresh Availability
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setMessage({ text: "Allocation configuration saved to active draft.", type: "info" })}
          >
            💾 Save Allocation Draft
          </button>
        </div>
      </div>

      {message && (
        <div
          className={`alert-banner alert-banner--${message.type === "warning" ? "warning" : "info"}`}
          style={{ marginBottom: "16px" }}
        >
          {message.text}
        </div>
      )}

      {/* Date & Shift Selectors */}
      <div className="card" style={{ marginBottom: "20px" }}>
        <div className="card__body" style={{ display: "flex", gap: "20px", flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <label style={{ fontSize: "13px", fontWeight: 600 }}>Roster Date:</label>
            <input
              type="date"
              className="form-control"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              style={{ width: "160px" }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <label style={{ fontSize: "13px", fontWeight: 600 }}>Active Shift:</label>
            <select
              className="form-control"
              value={selectedShift}
              onChange={(e) => setSelectedShift(e.target.value)}
              style={{ width: "160px" }}
            >
              <option value="A">Shift A (07:00 - 15:00)</option>
              <option value="B">Shift B (15:00 - 23:00)</option>
              <option value="C">Shift C (23:00 - 07:00)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Two Column Layout: Duty Points vs Assignment Controls */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "20px" }}>
        {/* Left Column: Duty Points Grid */}
        <div className="card">
          <div className="card__header">
            <span className="card__title">Station Duty Points ({slots.length})</span>
          </div>
          <div className="card__body" style={{ padding: 0 }}>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Duty Point</th>
                    <th>Required</th>
                    <th>Assigned Officers</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {slots.map((slot) => {
                    const isFilled = slot.assigned_staff.length >= slot.required_strength;
                    return (
                      <tr
                        key={slot.id}
                        style={{
                          backgroundColor: selectedSlotId === slot.id ? "rgba(56, 189, 248, 0.08)" : undefined,
                          cursor: "pointer",
                        }}
                        onClick={() => setSelectedSlotId(slot.id)}
                      >
                        <td>
                          <div style={{ fontWeight: 600, color: "#e2e8f0" }}>{slot.duty_point}</div>
                          <div style={{ fontSize: "11px", color: "#94a3b8" }}>
                            Eligible: {slot.eligible_designations.join(", ")}
                          </div>
                        </td>
                        <td>
                          <span style={{ fontWeight: 600 }}>
                            {slot.assigned_staff.length} / {slot.required_strength}
                          </span>
                        </td>
                        <td>
                          {slot.assigned_staff.length === 0 ? (
                            <span style={{ fontSize: "12px", color: "#ef4444" }}>Unassigned</span>
                          ) : (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                              {slot.assigned_staff.map((s) => (
                                <span
                                  key={s.id}
                                  className="badge badge-default"
                                  style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                                >
                                  {s.name} ({s.designation})
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRemoveAssignment(slot.id, s.id);
                                    }}
                                    style={{
                                      background: "none",
                                      border: "none",
                                      color: "#ef4444",
                                      cursor: "pointer",
                                      fontSize: "12px",
                                    }}
                                  >
                                    ✕
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${isFilled ? "badge-success" : "badge-warning"}`}>
                            {isFilled ? "Fulfilled" : "Deficit"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Column: Allocation Action Panel */}
        <div>
          <div className="card" style={{ marginBottom: "20px" }}>
            <div className="card__header">
              <span className="card__title">Allocate Officer to Duty</span>
            </div>
            <div className="card__body">
              {/* Selected Slot Information */}
              {(() => {
                const currentSlot = slots.find((s) => s.id === selectedSlotId);
                return currentSlot ? (
                  <div
                    style={{
                      background: "#0f172a",
                      padding: "12px",
                      borderRadius: "6px",
                      marginBottom: "16px",
                      border: "1px solid #1e293b",
                    }}
                  >
                    <div style={{ fontSize: "12px", color: "#94a3b8" }}>Target Duty Point</div>
                    <div style={{ fontWeight: 600, color: "#38bdf8", fontSize: "14px" }}>
                      {currentSlot.duty_point}
                    </div>
                    <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                      Target: {currentSlot.required_strength} &middot; Eligible: {currentSlot.eligible_designations.join(", ")}
                    </div>
                  </div>
                ) : null;
              })()}

              <div className="form-group" style={{ marginBottom: "16px" }}>
                <label className="form-label">Select Staff Member</label>
                <select
                  className="form-control"
                  value={selectedStaffId}
                  onChange={(e) => setSelectedStaffId(e.target.value)}
                >
                  <option value="">-- Choose Officer --</option>
                  {availableStaff.map((s) => {
                    const status = staffStatusMap[s.id] || "Available";
                    return (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.designation}) &mdash; {status}
                      </option>
                    );
                  })}
                </select>
              </div>

              <button
                className="btn btn-primary"
                style={{ width: "100%" }}
                onClick={handleAssign}
              >
                + Assign to Duty Point
              </button>
            </div>
          </div>

          {/* Quick Staff Availability Overview */}
          <div className="card">
            <div className="card__header">
              <span className="card__title">Available Pool ({availableStaff.length})</span>
            </div>
            <div className="card__body" style={{ maxHeight: "320px", overflowY: "auto", padding: 0 }}>
              <div className="table-container">
                <table className="table" style={{ fontSize: "12px" }}>
                  <thead>
                    <tr>
                      <th>Name / Service #</th>
                      <th>Desig</th>
                      <th>Current Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {availableStaff.slice(0, 15).map((s) => {
                      const status = staffStatusMap[s.id] || "Present - Available";
                      const isFree = status === "Present - Available";
                      return (
                        <tr key={s.id}>
                          <td>
                            <strong>{s.name}</strong>
                            <div style={{ color: "#64748b", fontSize: "10px" }}>{s.service_number}</div>
                          </td>
                          <td>{s.designation}</td>
                          <td>
                            <span className={`badge ${isFree ? "badge-success" : "badge-default"}`}>
                              {status}
                            </span>
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
