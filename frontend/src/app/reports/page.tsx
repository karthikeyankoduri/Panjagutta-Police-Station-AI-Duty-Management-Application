"use client";
import { useEffect, useState, useCallback } from "react";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import {
  getShiftEndReport,
  getDailyVacancyReport,
  getExportUrl,
} from "@/lib/api";

export default function ReportsPage() {
  const { token, user } = useAuth();
  const [reportDate, setReportDate] = useState("");
  const [shiftCode, setShiftCode] = useState("A");

  useEffect(() => {
    if (!reportDate) setReportDate(new Date().toISOString().split("T")[0]);
  }, [reportDate]);
  const [activeTab, setActiveTab] = useState<"shift" | "vacancy">("shift");
  const [shiftData, setShiftData] = useState<any>(null);
  const [vacancyData, setVacancyData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReports = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      if (activeTab === "shift") {
        const data = await getShiftEndReport(token, reportDate, shiftCode);
        setShiftData(data);
      } else {
        const data = await getDailyVacancyReport(token, reportDate);
        setVacancyData(data);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load report data");
    } finally {
      setLoading(false);
    }
  }, [token, reportDate, shiftCode, activeTab]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const handleDownloadCsv = () => {
    const url = getExportUrl(activeTab === "shift" ? "shift-end" : "daily-vacancy", reportDate, shiftCode);
    window.open(url, "_blank");
  };

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Station Reports &amp; Exports</h1>
          <div className="page-subtitle">
            Shift-end handover reports, daily sector vacancy tracking, and server-side CSV/audit exports.
          </div>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button className="btn btn-secondary btn-sm" onClick={() => window.print()}>
            🖨 Print Report
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleDownloadCsv}>
            ⬇ Export to CSV
          </button>
        </div>
      </div>

      {error && <div className="alert-banner alert-banner--warning" style={{ marginBottom: "16px" }}>{error}</div>}

      {/* Tabs and Controls */}
      <div className="card" style={{ marginBottom: "20px" }}>
        <div className="card__body" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
          <div style={{ display: "flex", gap: "10px" }}>
            <button
              className={`btn btn-sm ${activeTab === "shift" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setActiveTab("shift")}
            >
              📋 Shift-End Handover Report
            </button>
            <button
              className={`btn btn-sm ${activeTab === "vacancy" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setActiveTab("vacancy")}
            >
              📊 Daily Sector Vacancy Report
            </button>
          </div>

          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <label style={{ fontSize: "12px", fontWeight: 600 }}>Date:</label>
              <input
                type="date"
                className="form-control"
                value={reportDate}
                onChange={(e) => setReportDate(e.target.value)}
                style={{ width: "150px" }}
              />
            </div>

            {activeTab === "shift" && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <label style={{ fontSize: "12px", fontWeight: 600 }}>Shift:</label>
                <select
                  className="form-control"
                  value={shiftCode}
                  onChange={(e) => setShiftCode(e.target.value)}
                  style={{ width: "120px" }}
                >
                  <option value="A">Shift A</option>
                  <option value="B">Shift B</option>
                  <option value="C">Shift C</option>
                </select>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Report Content */}
      {loading ? (
        <div className="card">
          <div className="card__body" style={{ textAlign: "center", padding: "40px", color: "#94a3b8" }}>
            Generating report data...
          </div>
        </div>
      ) : activeTab === "shift" && shiftData ? (
        <div>
          {/* Shift Report Header Card */}
          <div className="card" style={{ marginBottom: "20px" }}>
            <div className="card__header" style={{ display: "flex", justifyContent: "space-between" }}>
              <div>
                <span className="card__title">Shift-End Handover Report &middot; Panjagutta PS</span>
                <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "4px" }}>
                  Date: {shiftData.report_date} &middot; Shift: {shiftData.shift_code} &middot; Officer: {shiftData.generated_by}
                </div>
              </div>
              <span className="badge badge-info" style={{ height: "fit-content" }}>
                OFFICIAL RECORD
              </span>
            </div>
            <div className="card__body">
              {/* Headcount Metrics */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "20px" }}>
                <div style={{ background: "#0f172a", padding: "14px", borderRadius: "6px", textAlign: "center" }}>
                  <div style={{ fontSize: "22px", fontWeight: 700, color: "#e2e8f0" }}>
                    {shiftData.headcount.total_sanctioned_strength}
                  </div>
                  <div style={{ fontSize: "12px", color: "#94a3b8" }}>Station Strength</div>
                </div>
                <div style={{ background: "#0f172a", padding: "14px", borderRadius: "6px", textAlign: "center" }}>
                  <div style={{ fontSize: "22px", fontWeight: 700, color: "#38bdf8" }}>
                    {shiftData.headcount.scheduled_for_shift}
                  </div>
                  <div style={{ fontSize: "12px", color: "#94a3b8" }}>Scheduled Strength</div>
                </div>
                <div style={{ background: "#0f172a", padding: "14px", borderRadius: "6px", textAlign: "center" }}>
                  <div style={{ fontSize: "22px", fontWeight: 700, color: "#22c55e" }}>
                    {shiftData.headcount.confirmed_present}
                  </div>
                  <div style={{ fontSize: "12px", color: "#94a3b8" }}>Confirmed Present</div>
                </div>
                <div style={{ background: "#0f172a", padding: "14px", borderRadius: "6px", textAlign: "center" }}>
                  <div style={{ fontSize: "22px", fontWeight: 700, color: shiftData.headcount.deficit > 0 ? "#ef4444" : "#22c55e" }}>
                    {shiftData.headcount.deficit}
                  </div>
                  <div style={{ fontSize: "12px", color: "#94a3b8" }}>Shift Deficit</div>
                </div>
              </div>

              {/* Sub-summaries */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
                <div style={{ background: "#0f172a", padding: "16px", borderRadius: "6px" }}>
                  <h3 style={{ fontSize: "14px", color: "#38bdf8", marginBottom: "10px" }}>Outside Movements</h3>
                  <div style={{ fontSize: "13px", lineHeight: "1.8" }}>
                    <div>Total Movements Logged: <strong>{shiftData.movements.total}</strong></div>
                    <div>Active Outside: <strong>{shiftData.movements.open}</strong></div>
                    <div>Overdue Alerts: <strong style={{ color: shiftData.movements.overdue > 0 ? "#ef4444" : "inherit" }}>{shiftData.movements.overdue}</strong></div>
                    <div>Safely Returned: <strong>{shiftData.movements.returned}</strong></div>
                  </div>
                </div>

                <div style={{ background: "#0f172a", padding: "16px", borderRadius: "6px" }}>
                  <h3 style={{ fontSize: "14px", color: "#38bdf8", marginBottom: "10px" }}>Special Tasks &amp; Warrants</h3>
                  <div style={{ fontSize: "13px", lineHeight: "1.8" }}>
                    <div>Total Assigned Tasks: <strong>{shiftData.tasks.total}</strong></div>
                    <div>Completed During Shift: <strong>{shiftData.tasks.completed}</strong></div>
                    <div>In Progress / Ongoing: <strong>{shiftData.tasks.in_progress}</strong></div>
                    <div>Overdue Tasks: <strong style={{ color: shiftData.tasks.overdue > 0 ? "#ef4444" : "inherit" }}>{shiftData.tasks.overdue}</strong></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Sample Deployments Table */}
          <div className="card">
            <div className="card__header">
              <span className="card__title">Duty Deployments Log ({shiftData.total_deployments} recorded)</span>
            </div>
            <div className="card__body" style={{ padding: 0 }}>
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Officer</th>
                      <th>Service #</th>
                      <th>Assigned Duty</th>
                      <th>Section / Sector</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shiftData.deployments_sample.map((d: any, idx: number) => (
                      <tr key={idx}>
                        <td><strong>{d.staff_name}</strong></td>
                        <td>{d.service_number}</td>
                        <td><span className="badge badge-info">{d.duty_name}</span></td>
                        <td>{d.section || "Station Wide"}</td>
                        <td style={{ fontSize: "12px", color: "#94a3b8" }}>{d.notes || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : activeTab === "vacancy" && vacancyData ? (
        <div className="card">
          <div className="card__header">
            <span className="card__title">Daily Sector Strength &amp; Vacancy Analysis</span>
          </div>
          <div className="card__body" style={{ padding: 0 }}>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Sector Name</th>
                    <th>Code</th>
                    <th>Currently Assigned</th>
                    <th>Minimum Target</th>
                    <th>Deficit</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {vacancyData.sectors.map((s: any) => (
                    <tr key={s.sector_id}>
                      <td><strong>{s.sector_name}</strong></td>
                      <td>{s.code}</td>
                      <td><strong>{s.assigned_staff}</strong></td>
                      <td>{s.minimum_target}</td>
                      <td>
                        <span style={{ color: s.deficit > 0 ? "#ef4444" : "#22c55e", fontWeight: 600 }}>
                          {s.deficit}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${s.status === "Adequate" ? "badge-success" : "badge-warning"}`}>
                          {s.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
