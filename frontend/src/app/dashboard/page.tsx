"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import AppShell from "@/components/AppShell";
import { getDashboardSummary, getAlerts, getPolicyStatus, DashboardSummary, Alert, PolicyStatusData } from "@/lib/api";

const CARD_CONFIG = [
  { key: "total_staff", label: "Total Staff", cls: "card--total", icon: "👥" },
  { key: "scheduled_current_shift", label: "Scheduled", cls: "card--on-duty", icon: "📅" },
  { key: "present", label: "Present", cls: "card--present", icon: "✅" },
  { key: "on_duty", label: "On Duty", cls: "card--on-duty", icon: "🔵" },
  { key: "available", label: "Available", cls: "card--available", icon: "🟢" },
  { key: "field_duty", label: "Field Duty", cls: "card--field", icon: "🏃" },
  { key: "court_duty", label: "Court Duty", cls: "card--court", icon: "⚖️" },
  { key: "patrol_beat", label: "Patrol / Beat", cls: "card--patrol", icon: "🚔" },
  { key: "on_leave", label: "On Leave", cls: "card--leave", icon: "🏖️" },
  { key: "duty_off_rest", label: "Duty Off / Rest", cls: "card--rest", icon: "😴" },
  { key: "attached_other_wing", label: "Attached", cls: "card--attached", icon: "🔗" },
  { key: "official_movement", label: "Official Movement", cls: "card--movement", icon: "🚗" },
  { key: "absent", label: "Absent", cls: "card--absent", icon: "❌" },
  { key: "vacant_positions", label: "Vacant Positions", cls: "card--vacant", icon: "⚠️" },
] as const;

const STATUS_BADGE_MAP: Record<string, string> = {
  "Present - Available": "badge-green",
  "On Duty": "badge-blue",
  "Field Duty": "badge-purple",
  "Court Duty": "badge-purple",
  "Patrol / Beat Duty": "badge-blue",
  "Official Movement": "badge-orange",
  "Attached to Other Wing": "badge-blue",
  "On Leave": "badge-yellow",
  "Duty Off / Rest": "badge-gray",
  "Absent": "badge-red",
  "Emergency Deployment": "badge-red",
  "Shift Change Pending": "badge-yellow",
};

export default function DashboardPage() {
  const { token, isLoading } = useAuth();
  const router = useRouter();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [policy, setPolicy] = useState<PolicyStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [shiftFilter, setShiftFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const [summaryData, alertsData, policyData] = await Promise.all([
        getDashboardSummary(token, undefined, shiftFilter || undefined),
        getAlerts(token),
        getPolicyStatus(token).catch(() => null),
      ]);
      setSummary(summaryData);
      setAlerts(alertsData);
      if (policyData) setPolicy(policyData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  }, [token, shiftFilter]);

  useEffect(() => {
    if (!isLoading && !token) router.push("/login");
  }, [token, isLoading, router]);

  useEffect(() => {
    if (token) fetchData();
  }, [token, fetchData]);

  const filteredStaff = summary?.staff_status_list.filter((s) => {
    if (searchQuery && !s.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !s.service_number.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (selectedCard && selectedCard !== "total_staff" && selectedCard !== "scheduled_current_shift") {
      const cardToStatus: Record<string, string[]> = {
        present: ["Present - Available"],
        on_duty: ["On Duty"],
        available: ["Present - Available"],
        field_duty: ["Field Duty"],
        court_duty: ["Court Duty"],
        patrol_beat: ["Patrol / Beat Duty"],
        on_leave: ["On Leave"],
        duty_off_rest: ["Duty Off / Rest"],
        attached_other_wing: ["Attached to Other Wing"],
        official_movement: ["Official Movement"],
        absent: ["Absent"],
      };
      const allowedStatuses = cardToStatus[selectedCard];
      if (allowedStatuses && !allowedStatuses.includes(s.status)) return false;
    }
    return true;
  }) ?? [];

  if (isLoading || !token) return null;

  return (
    <AppShell>
      {(!policy || policy.policy_status === "unconfirmed") && (
        <div className="policy-banner" style={{ background: "#fef2f2", borderColor: "#f87171", color: "#991b1b" }}>
          <span className="policy-banner__icon">🔒</span>
          <div>
            <div className="policy-banner__title" style={{ color: "#991b1b" }}>Rotation &amp; Rest Policy: UNCONFIRMED</div>
            <div className="policy-banner__text">
              Roster publish is blocked until the SHO confirms or demo-simulates the rotation/rest policy.
              Go to <strong>Policy Config</strong> to review and acknowledge for demo purposes.
            </div>
          </div>
        </div>
      )}

      {policy?.policy_status === "demo_simulated" && (
        <div className="policy-banner" style={{ background: "#fffbeb", borderColor: "#fde68a", color: "#92400e" }}>
          <span className="policy-banner__icon">⚠</span>
          <div>
            <div className="policy-banner__title" style={{ color: "#92400e" }}>Rotation &amp; Rest Policy: DEMO SIMULATION MODE</div>
            <div className="policy-banner__text">
              Synthetic rotation/rest rules are active for prototype evaluation. Roster publication is unlocked for demo testing.
            </div>
          </div>
        </div>
      )}

      {policy?.policy_status === "confirmed" && (
        <div className="policy-banner" style={{ background: "#f0fdf4", borderColor: "#86efac", color: "#166534" }}>
          <span className="policy-banner__icon">✓</span>
          <div>
            <div className="policy-banner__title" style={{ color: "#166534" }}>Rotation &amp; Rest Policy: OFFICIALLY CONFIRMED (SHO)</div>
            <div className="policy-banner__text">
              Station rotation sequence and mandatory rest intervals are formally approved by the SHO. Policy gate cleared.
            </div>
          </div>
        </div>
      )}

      {summary && summary.cards.total_staff === 0 && (
        <div
          style={{
            background: "linear-gradient(135deg, #1e3a8a, #1e40af)",
            color: "#ffffff",
            padding: "16px 20px",
            borderRadius: "var(--radius-md)",
            marginBottom: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
            boxShadow: "var(--shadow-md)",
          }}
        >
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>
              <span>📂</span> Station Staff Register is Empty
            </div>
            <div style={{ fontSize: 13, color: "#bfdbfe", marginTop: 4 }}>
              As Admin SI, you can import the official 140 station staff and provision their logins via CSV import.
            </div>
          </div>
          <Link
            href="/staff"
            className="btn btn-secondary btn-lg"
            style={{
              background: "#ffffff",
              color: "#1e3a8a",
              fontWeight: 700,
              border: "none",
            }}
            id="btn-go-to-csv-import"
          >
            👥 Go to Staff &amp; CSV Import →
          </Link>
        </div>
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">Operational Dashboard</h1>
          <div className="page-subtitle">
            {summary ? `${summary.date} · Shift: ${summary.shift.toUpperCase()}` : "Loading..."}{" "}
            {summary?.sector_scoped && <span className="badge badge-blue">Sector View</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            className="form-select"
            style={{ width: "auto" }}
            value={shiftFilter}
            onChange={(e) => setShiftFilter(e.target.value)}
            aria-label="Filter by shift"
            id="shift-filter"
          >
            <option value="">All Shifts</option>
            <option value="A">Shift A (08:00–14:00)</option>
            <option value="B">Shift B (14:00–20:00)</option>
            <option value="C">Shift C (20:00–08:00+)</option>
          </select>
          <button className="btn btn-secondary btn-sm" onClick={fetchData} id="btn-refresh">
            ↻ Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="alert-item warning" role="alert">
          <span>⚠</span>
          <div>
            <strong>Error loading dashboard:</strong> {error}
            <br /><em>Ensure the backend is running (uvicorn app.main:app)</em>
          </div>
        </div>
      )}

      {/* 14 Summary Cards */}
      {loading ? (
        <div className="loading-overlay"><div className="spinner" /> Loading dashboard...</div>
      ) : (
        <>
          <div className="summary-grid">
            {CARD_CONFIG.map(({ key, label, cls, icon }) => (
              <button
                key={key}
                className={`summary-card ${cls}${selectedCard === key ? " selected" : ""}`}
                onClick={() => setSelectedCard(selectedCard === key ? null : key)}
                style={{ textAlign: "left", border: selectedCard === key ? "2px solid var(--card-accent)" : undefined }}
                aria-pressed={selectedCard === key}
                id={`card-${key}`}
              >
                <div style={{ fontSize: 20, marginBottom: 6 }}>{icon}</div>
                <div className="summary-card__value">
                  {summary?.cards[key as keyof typeof summary.cards] ?? "—"}
                </div>
                <div className="summary-card__label">{label}</div>
              </button>
            ))}
          </div>

          {/* Alerts */}
          {alerts.length > 0 && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card__header">
                <h2 className="card__title">🔔 Active Alerts ({alerts.length})</h2>
              </div>
              <div className="card__body" style={{ padding: "12px 16px" }}>
                {alerts.slice(0, 5).map((alert) => (
                  <div key={alert.id} className={`alert-item ${alert.severity}`}>
                    <span>{alert.severity === "critical" ? "🚨" : "⚠"}</span>
                    <div>
                      <strong>{alert.alert_type.replace(/_/g, " ")}</strong>
                      <br />{alert.message}
                    </div>
                  </div>
                ))}
                {alerts.length > 5 && (
                  <div style={{ textAlign: "center", padding: "8px", fontSize: 12, color: "#64748b" }}>
                    +{alerts.length - 5} more alerts — <a href="/approvals" style={{ color: "#2563eb" }}>View all</a>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Staff Status Table */}
          <div className="card">
            <div className="card__header">
              <h2 className="card__title">
                Staff Status
                {selectedCard && (
                  <span className="badge badge-blue" style={{ marginLeft: 8 }}>
                    Filtered: {CARD_CONFIG.find(c => c.key === selectedCard)?.label}
                    <button
                      onClick={() => setSelectedCard(null)}
                      style={{ background: "none", border: "none", cursor: "pointer", marginLeft: 4, color: "inherit" }}
                      aria-label="Clear filter"
                    >×</button>
                  </span>
                )}
              </h2>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="search"
                  className="form-input"
                  placeholder="Search staff name or ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ width: 220 }}
                  aria-label="Search staff"
                  id="staff-search"
                />
              </div>
            </div>

            {filteredStaff.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state__icon">👤</div>
                <div className="empty-state__title">No staff records found</div>
                <div className="empty-state__text">
                  {searchQuery ? "Try a different search term." : "Ensure the backend is seeded with demo data."}
                </div>
              </div>
            ) : (
              <div className="table-wrapper" style={{ borderRadius: 0, border: "none" }}>
                <table className="table" aria-label="Staff status table">
                  <thead>
                    <tr>
                      <th>Service No.</th>
                      <th>Name</th>
                      <th>Designation</th>
                      <th>Sector</th>
                      <th>Current Status</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStaff.map((staff) => (
                      <tr key={staff.staff_id}>
                        <td>
                          <code style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                            {staff.service_number}
                          </code>
                        </td>
                        <td>
                          <strong>{staff.name}</strong>
                          {staff.is_conflicting && (
                            <span className="badge badge-red" style={{ marginLeft: 6 }}>⚠ Conflict</span>
                          )}
                        </td>
                        <td>{staff.designation}</td>
                        <td>{staff.sector_id ? `Sector ${staff.sector_id}` : "—"}</td>
                        <td>
                          <span className={`badge ${STATUS_BADGE_MAP[staff.status] || "badge-gray"}`}>
                            {staff.status}
                          </span>
                        </td>
                        <td style={{ color: "#64748b", fontSize: 12 }}>{staff.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}
