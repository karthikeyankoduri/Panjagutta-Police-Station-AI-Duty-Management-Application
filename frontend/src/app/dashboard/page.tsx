"use client";
import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import AppShell from "@/components/AppShell";
import {
  getDashboardSummary, getDashboardViews, getAlerts, getPolicyStatus, getSectors, getSections, getConfigLists,
  resolveAlert, shiftLabels, hiddenDashboardCards,
  DashboardSummary, DashboardViews, Alert, PolicyStatusData, DashboardFilters, CardKey, Sector, SectionItem, ListItem,
} from "@/lib/api";

const CARD_CONFIG: { key: CardKey; label: string; cls: string; icon: string; hint?: string }[] = [
  { key: "total_staff", label: "Total Staff", cls: "card--total", icon: "👥" },
  { key: "scheduled_current_shift", label: "Scheduled", cls: "card--on-duty", icon: "📅", hint: "On the published roster" },
  { key: "present", label: "Present", cls: "card--present", icon: "✅", hint: "Confirmed attendance" },
  { key: "on_duty", label: "On Duty", cls: "card--on-duty", icon: "🔵" },
  { key: "available", label: "Available", cls: "card--available", icon: "🟢", hint: "Present, no duty" },
  { key: "field_duty", label: "Field Duty", cls: "card--field", icon: "🏃" },
  { key: "court_duty", label: "Court Duty", cls: "card--court", icon: "⚖️" },
  { key: "patrol_beat", label: "Patrol / Beat", cls: "card--patrol", icon: "🚔" },
  { key: "on_leave", label: "On Leave", cls: "card--leave", icon: "🏖️" },
  { key: "duty_off_rest", label: "Duty Off / Rest", cls: "card--rest", icon: "😴" },
  { key: "attached_other_wing", label: "Attached", cls: "card--attached", icon: "🔗" },
  { key: "official_movement", label: "Official Movement", cls: "card--movement", icon: "🚗" },
  { key: "absent", label: "Absent", cls: "card--absent", icon: "❌" },
  { key: "vacant_positions", label: "Vacant Positions", cls: "card--vacant", icon: "⚠️", hint: "Opens the vacancy view" },
];

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

type ViewTab = "current" | "upcoming" | "rest" | "vacancy";

export default function DashboardPage() {
  const { token, user } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [views, setViews] = useState<DashboardViews | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [policy, setPolicy] = useState<PolicyStatusData | null>(null);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [sections, setSections] = useState<SectionItem[]>([]);
  const [lists, setLists] = useState<Record<string, ListItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedCard, setSelectedCard] = useState<CardKey | null>(null);
  const [shiftFilter, setShiftFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [filters, setFilters] = useState<DashboardFilters>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [viewTab, setViewTab] = useState<ViewTab>("current");

  const labels = shiftLabels(policy?.shifts);
  // Cards an administrator has switched off in Administration → Dashboard cards.
  const hiddenCards = useMemo(() => hiddenDashboardCards(lists), [lists]);
  const sectorScoped = user?.role === "SECTOR_SI";

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const [summaryData, viewData, alertsData] = await Promise.all([
        getDashboardSummary(token, dateFilter || undefined, shiftFilter || undefined, filters),
        getDashboardViews(token, dateFilter || undefined, shiftFilter || undefined).catch(() => null),
        getAlerts(token),
      ]);
      setSummary(summaryData);
      setViews(viewData);
      setAlerts(alertsData);
      // Re-read the lists so an administrator's card changes apply on refresh.
      getConfigLists(token).then(setLists).catch(() => null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  }, [token, shiftFilter, dateFilter, filters]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!token) return;
    getPolicyStatus(token).then(setPolicy).catch(() => null);
    getSectors(token).then(setSectors);
    getSections(token).then(setSections);
    getConfigLists(token).then(setLists);
  }, [token]);

  const filteredStaff = useMemo(() => {
    const rows = summary?.staff_status_list ?? [];
    const members = selectedCard && selectedCard !== "vacant_positions" ? summary?.card_members?.[selectedCard] : undefined;
    const allowed = members ? new Set(members) : null;
    const q = searchQuery.toLowerCase();
    return rows.filter((s) => {
      if (allowed && !allowed.has(s.staff_id)) return false;
      if (q && !s.name.toLowerCase().includes(q) && !s.service_number.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [summary, selectedCard, searchQuery]);

  const dutyCategories = useMemo(
    () => Array.from(new Set((summary?.staff_status_list ?? []).map((s) => s.duty_category).filter(Boolean))) as string[],
    [summary]
  );

  const onCard = (key: CardKey) => {
    if (key === "vacant_positions") {
      setViewTab("vacancy");
      document.getElementById("shift-views")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    setSelectedCard(selectedCard === key ? null : key);
  };

  const setFilter = (k: keyof DashboardFilters, v: string) =>
    setFilters((f) => ({ ...f, [k]: v ? (k === "sector_id" ? Number(v) : v) : undefined }));

  const onResolve = async (id: number) => {
    if (!token) return;
    try {
      await resolveAlert(token, id);
      setAlerts((a) => a.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resolve alert");
    }
  };

  const canResolve = user && ["SHO", "ADMIN_SI", "SECTOR_SI", "SUPER_ADMIN"].includes(user.role);

  return (
    <AppShell>
      {(!policy || policy.policy_status === "unconfirmed") && (
        <div className="policy-banner" style={{ background: "#fef2f2", borderColor: "#f87171", color: "#991b1b" }}>
          <span className="policy-banner__icon">🔒</span>
          <div>
            <div className="policy-banner__title" style={{ color: "#991b1b" }}>Rotation &amp; Rest Policy: UNCONFIRMED</div>
            <div className="policy-banner__text">
              Roster drafting is blocked until the SHO confirms the rotation/rest policy (or enables demo simulation).
              Rest and duty-off status is not calculated until a rule is active. See <strong>Policy &amp; Shifts</strong>.
            </div>
          </div>
        </div>
      )}
      {policy?.policy_status === "demo_simulated" && (
        <div className="policy-banner" style={{ background: "#fffbeb", borderColor: "#fde68a", color: "#92400e" }}>
          <span className="policy-banner__icon">⚠</span>
          <div>
            <div className="policy-banner__title" style={{ color: "#92400e" }}>Rotation &amp; Rest Policy: DEMO SIMULATION MODE</div>
            <div className="policy-banner__text">Simulated rotation/rest rules are active for evaluation. Not signed off by the SHO.</div>
          </div>
        </div>
      )}
      {policy?.policy_status === "confirmed" && (
        <div className="policy-banner" style={{ background: "#f0fdf4", borderColor: "#86efac", color: "#166534" }}>
          <span className="policy-banner__icon">✓</span>
          <div>
            <div className="policy-banner__title" style={{ color: "#166534" }}>Rotation &amp; Rest Policy: CONFIRMED BY SHO</div>
            <div className="policy-banner__text">
              {policy.rotation_sequence} · {policy.min_rest_hours_after_shift}h rest after each shift · {policy.duty_off_after_shift_b_hours}h duty-off after Shift B
            </div>
          </div>
        </div>
      )}

      {summary && summary.cards.total_staff === 0 && !Object.values(filters).some(Boolean) && (
        <div style={{ background: "linear-gradient(135deg, #1e3a8a, #1e40af)", color: "#ffffff", padding: "16px 20px", borderRadius: "var(--radius-md)", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", boxShadow: "var(--shadow-md)" }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>📂 Station Staff Register is Empty</div>
            <div style={{ fontSize: 13, color: "#bfdbfe", marginTop: 4 }}>Import the station staff register and provision logins via CSV import.</div>
          </div>
          {user && ["SHO", "ADMIN_SI", "SUPER_ADMIN"].includes(user.role) && (
            <Link href="/config?tab=staff" className="btn btn-secondary btn-lg" style={{ background: "#ffffff", color: "#1e3a8a", fontWeight: 700, border: "none" }} id="btn-go-to-csv-import">
              👥 Go to Staff &amp; CSV Import →
            </Link>
          )}
        </div>
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">Operational Dashboard</h1>
          <div className="page-subtitle">
            {summary
              ? `${summary.date} · ${summary.shift === "all" ? "All shifts" : `Shift ${summary.shift}`}${summary.current_shift ? ` · Running now: Shift ${summary.current_shift.code} (${summary.current_shift.time})` : ""}`
              : "Loading..."}{" "}
            {summary?.sector_scoped && <span className="badge badge-blue">Sector {user?.sector_id} view</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input type="date" className="form-input" style={{ width: "auto" }} value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} aria-label="Date" />
          <select className="form-select" style={{ width: "auto" }} value={shiftFilter} onChange={(e) => setShiftFilter(e.target.value)} aria-label="Filter by shift" id="shift-filter">
            <option value="">All Shifts</option>
            {["A", "B", "C"].map((s) => (
              <option key={s} value={s}>Shift {s}{labels[s] ? ` (${labels[s]})` : ""}</option>
            ))}
          </select>
          <button className="btn btn-secondary btn-sm" onClick={fetchData} id="btn-refresh">↻ Refresh</button>
        </div>
      </div>

      {/* Filters (guide §10: designation, sector, section, shift, duty category, current status) */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__body" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", padding: "10px 14px" }}>
          <strong style={{ fontSize: 13 }}>Filters</strong>
          <select className="form-select" style={{ width: "auto" }} value={filters.designation || ""} onChange={(e) => setFilter("designation", e.target.value)} aria-label="Designation">
            <option value="">All designations</option>
            {(lists.designation || []).map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
          </select>
          {!sectorScoped && (
            <select className="form-select" style={{ width: "auto" }} value={filters.sector_id || ""} onChange={(e) => setFilter("sector_id", e.target.value)} aria-label="Sector">
              <option value="">All sectors</option>
              {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <select className="form-select" style={{ width: "auto" }} value={filters.section || ""} onChange={(e) => setFilter("section", e.target.value)} aria-label="Section">
            <option value="">All sections</option>
            {sections.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
          <select className="form-select" style={{ width: "auto" }} value={filters.duty_category || ""} onChange={(e) => setFilter("duty_category", e.target.value)} aria-label="Duty category">
            <option value="">All duty categories</option>
            {Array.from(new Set([...(filters.duty_category ? [filters.duty_category] : []), ...dutyCategories])).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select className="form-select" style={{ width: "auto" }} value={filters.status || ""} onChange={(e) => setFilter("status", e.target.value)} aria-label="Current status">
            <option value="">All statuses</option>
            {(lists.staff_status || []).filter((s) => s.is_active).map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
          </select>
          {Object.values(filters).some(Boolean) && (
            <button className="btn btn-secondary btn-sm" onClick={() => setFilters({})}>Clear filters</button>
          )}
        </div>
      </div>

      {error && (
        <div className="alert-item warning" role="alert">
          <span>⚠</span>
          <div><strong>Error loading dashboard:</strong> {error}</div>
        </div>
      )}

      {loading && !summary ? (
        <div className="loading-overlay"><div className="spinner" /> Loading dashboard...</div>
      ) : (
        <>
          <div className="summary-grid">
            {CARD_CONFIG.filter(({ key }) => !hiddenCards.has(key)).map(({ key, label, cls, icon, hint }) => (
              <button
                key={key}
                className={`summary-card ${cls}${selectedCard === key ? " selected" : ""}`}
                onClick={() => onCard(key)}
                style={{ textAlign: "left", border: selectedCard === key ? "2px solid var(--card-accent)" : undefined }}
                aria-pressed={selectedCard === key}
                title={hint}
                id={`card-${key}`}
              >
                <div style={{ fontSize: 20, marginBottom: 6 }}>{icon}</div>
                <div className="summary-card__value">{summary?.cards[key] ?? "—"}</div>
                <div className="summary-card__label">{label}</div>
              </button>
            ))}
            {((summary?.cards.emergency_deployment ?? 0) > 0 || (summary?.cards.shift_change_pending ?? 0) > 0) && (
              <>
                <button className={`summary-card card--absent${selectedCard === "emergency_deployment" ? " selected" : ""}`} onClick={() => onCard("emergency_deployment")} style={{ textAlign: "left" }}>
                  <div style={{ fontSize: 20, marginBottom: 6 }}>🚨</div>
                  <div className="summary-card__value">{summary?.cards.emergency_deployment ?? 0}</div>
                  <div className="summary-card__label">Emergency Deployment</div>
                </button>
                <button className={`summary-card card--leave${selectedCard === "shift_change_pending" ? " selected" : ""}`} onClick={() => onCard("shift_change_pending")} style={{ textAlign: "left" }}>
                  <div style={{ fontSize: 20, marginBottom: 6 }}>🔄</div>
                  <div className="summary-card__value">{summary?.cards.shift_change_pending ?? 0}</div>
                  <div className="summary-card__label">Shift Change Pending</div>
                </button>
              </>
            )}
          </div>

          {/* Shift views */}
          {views && (
            <div className="card" style={{ marginBottom: 20 }} id="shift-views">
              <div className="card__header" style={{ flexWrap: "wrap", gap: 8 }}>
                <h2 className="card__title">Shift Views</h2>
                <div role="tablist" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {([
                    ["current", `Current shift ${views.current.shift_code}`],
                    ["upcoming", `Upcoming shift ${views.upcoming.shift_code}`],
                    ["rest", `Rest (${views.rest.length})`],
                    ["vacancy", `Vacancy & shortage (${views.vacancy.total_vacant})`],
                  ] as [ViewTab, string][]).map(([k, label]) => (
                    <button key={k} role="tab" aria-selected={viewTab === k} className={`btn btn-sm ${viewTab === k ? "btn-primary" : "btn-secondary"}`} onClick={() => setViewTab(k)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="card__body">
                {(viewTab === "current" || viewTab === "upcoming") && (() => {
                  const v = viewTab === "current" ? views.current : views.upcoming;
                  return (
                    <>
                      <div className="text-muted" style={{ fontSize: 13, marginBottom: 8 }}>
                        {v.date} · Shift {v.shift_code} ({v.time}) ·{" "}
                        {v.roster_id ? `Published roster v${v.roster_version} · ${v.deployment.length} deployed` : "No published roster yet"}
                      </div>
                      {viewTab === "upcoming" && views.upcoming.vacancies.length > 0 && (
                        <div className="alert-banner alert-banner--warning" style={{ marginBottom: 8 }}>
                          {views.upcoming.vacancies.length} duty position(s) still vacant for the next shift:{" "}
                          {views.upcoming.vacancies.map((x) => `${x.category} (${x.vacant})`).join(", ")}
                        </div>
                      )}
                      {v.deployment.length > 0 && (
                        <div className="table-wrapper">
                          <table className="table">
                            <thead><tr><th>Duty</th><th>Name</th><th>Service No.</th><th>Rank</th><th>Sector</th><th>Notes</th></tr></thead>
                            <tbody>
                              {v.deployment.map((d) => (
                                <tr key={`${d.staff_id}-${d.duty}`}>
                                  <td><strong>{d.duty}</strong>{d.section ? <span className="text-muted"> · {d.section}</span> : null}</td>
                                  <td>{d.name}</td>
                                  <td><code>{d.service_number}</code></td>
                                  <td>{d.designation}</td>
                                  <td>{d.sector_id ? `Sector ${d.sector_id}` : "—"}</td>
                                  <td className="text-muted">{d.notes || ""}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  );
                })()}
                {viewTab === "rest" && (
                  views.rest.length === 0 ? (
                    <div className="text-muted" style={{ fontSize: 13 }}>
                      No one is in a rest window{!policy || policy.policy_status === "unconfirmed" ? " (rest is only calculated once a rotation rule is active)" : ""}.
                    </div>
                  ) : (
                    <div className="table-wrapper">
                      <table className="table">
                        <thead><tr><th>Name</th><th>Service No.</th><th>Reason</th><th>Rest until</th></tr></thead>
                        <tbody>
                          {views.rest.map((r) => (
                            <tr key={r.staff_id}>
                              <td>{r.name}</td><td><code>{r.service_number}</code></td>
                              <td className="text-muted">{r.reason}</td>
                              <td>{r.rest_until ? new Date(r.rest_until).toLocaleString() : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                )}
                {viewTab === "vacancy" && (
                  <>
                    <div className="text-muted" style={{ fontSize: 13, marginBottom: 8 }}>
                      Required {views.vacancy.total_required} · Allocated {views.vacancy.total_allocated} · <strong>Vacant {views.vacancy.total_vacant}</strong> (latest published roster)
                    </div>
                    <div className="table-wrapper">
                      <table className="table">
                        <thead><tr><th>Shift</th><th>Duty</th><th>Section</th><th>Required</th><th>Allocated</th><th>Vacant</th></tr></thead>
                        <tbody>
                          {views.vacancy.rows.map((r) => (
                            <tr key={`${r.shift_code}-${r.duty_master_id}`} style={r.vacant ? { background: "rgba(220,38,38,.06)" } : undefined}>
                              <td>{r.shift_code}</td><td><strong>{r.category}</strong></td><td>{r.section || "—"}</td>
                              <td>{r.required}</td><td>{r.allocated}</td>
                              <td>{r.vacant ? <span className="badge badge-red">{r.vacant} vacant</span> : <span className="badge badge-green">Filled</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {alerts.length > 0 && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card__header">
                <h2 className="card__title">🔔 Active Alerts ({alerts.length})</h2>
                <Link href="/approvals" className="btn btn-secondary btn-sm">Open approvals &amp; alerts</Link>
              </div>
              <div className="card__body" style={{ padding: "12px 16px" }}>
                {alerts.slice(0, 5).map((alert) => (
                  <div key={alert.id} className={`alert-item ${alert.severity}`} style={{ alignItems: "flex-start" }}>
                    <span>{alert.severity === "critical" ? "🚨" : "⚠"}</span>
                    <div style={{ flex: 1 }}>
                      <strong>{alert.alert_type.replace(/_/g, " ")}</strong>
                      <br />{alert.message}
                    </div>
                    {canResolve && (
                      <button className="btn btn-secondary btn-sm" onClick={() => onResolve(alert.id)}>Resolve</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <div className="card__header">
              <h2 className="card__title">
                Staff Status ({filteredStaff.length})
                {selectedCard && (
                  <span className="badge badge-blue" style={{ marginLeft: 8 }}>
                    {CARD_CONFIG.find((c) => c.key === selectedCard)?.label ?? selectedCard.replace(/_/g, " ")}
                    <button onClick={() => setSelectedCard(null)} style={{ background: "none", border: "none", cursor: "pointer", marginLeft: 4, color: "inherit" }} aria-label="Clear card filter">×</button>
                  </span>
                )}
              </h2>
              <input type="search" className="form-input" placeholder="Search staff name or ID..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ width: 220 }} aria-label="Search staff" id="staff-search" />
            </div>

            {filteredStaff.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state__icon">👤</div>
                <div className="empty-state__title">No staff in this view</div>
                <div className="empty-state__text">{searchQuery ? "Try a different search term." : "Change the card or filters above."}</div>
              </div>
            ) : (
              <div className="table-wrapper" style={{ borderRadius: 0, border: "none" }}>
                <table className="table" aria-label="Staff status table">
                  <thead>
                    <tr><th>Service No.</th><th>Name</th><th>Designation</th><th>Sector</th><th>Current Status</th><th>Duty</th><th>Reason</th></tr>
                  </thead>
                  <tbody>
                    {filteredStaff.map((staff) => (
                      <tr key={staff.staff_id}>
                        <td><code style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{staff.service_number}</code></td>
                        <td>
                          <strong>{staff.name}</strong>
                          {staff.is_conflicting && (
                            <span className="badge badge-red" style={{ marginLeft: 6 }} title={staff.conflict_detail || ""}>⚠ Conflict</span>
                          )}
                        </td>
                        <td>{staff.designation}</td>
                        <td>{staff.sector_id ? `Sector ${staff.sector_id}` : "—"}</td>
                        <td>
                          <span className={`badge ${STATUS_BADGE_MAP[staff.status] || "badge-gray"}`}>{staff.status}</span>
                          {staff.attendance_confirmed && staff.status !== "Present - Available" && (
                            <span className="badge badge-green" style={{ marginLeft: 4 }} title="Attendance confirmed">✓</span>
                          )}
                        </td>
                        <td>{staff.duty_category ? `${staff.duty_category}${staff.assigned_shift ? ` (${staff.assigned_shift})` : ""}` : "—"}</td>
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
