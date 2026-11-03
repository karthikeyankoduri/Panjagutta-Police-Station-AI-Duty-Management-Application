"use client";
import { useEffect, useState, useCallback } from "react";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import { useToday, addDaysIso } from "@/lib/use-today";
import {
  getShiftEndReport,
  getDailyReport,
  getDailyVacancyReport,
  getWorkloadReport,
  getPolicyStatus,
  downloadReport,
  formatApiError,
  shiftLabels,
  ShiftInfo,
} from "@/lib/api";

type Tab = "shift-end" | "daily" | "vacancy" | "workload";
const TABS: { key: Tab; label: string }[] = [
  { key: "shift-end", label: "📋 Shift-end handover" },
  { key: "daily", label: "🗓 Daily report" },
  { key: "vacancy", label: "📊 Vacancy report" },
  { key: "workload", label: "⚖️ Workload report" },
];

interface Section { title: string; columns: string[]; rows: (string | number | null)[][] }

export default function ReportsPage() {
  const { token } = useAuth();
  const [tab, setTab] = useState<Tab>("shift-end");
  const today = useToday();
  const [reportDate, setReportDate] = useState("");
  const [shiftCode, setShiftCode] = useState("A");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  useEffect(() => {
    if (!today) return;
    setReportDate((d) => d || today);
    setStart((d) => d || addDaysIso(today, -6));
    setEnd((d) => d || today);
  }, [today]);
  const [shifts, setShifts] = useState<ShiftInfo[]>([]);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const labels = shiftLabels(shifts);

  useEffect(() => {
    if (token) getPolicyStatus(token).then((p) => setShifts(p.shifts)).catch(() => null);
  }, [token]);

  const fetchReport = useCallback(async () => {
    if (!token || !reportDate) return;
    setLoading(true);
    setError(null);
    try {
      if (tab === "shift-end") setData(await getShiftEndReport(token, reportDate, shiftCode));
      else if (tab === "daily") setData(await getDailyReport(token, reportDate));
      else if (tab === "vacancy") setData(await getDailyVacancyReport(token, reportDate));
      else setData(await getWorkloadReport(token, start, end));
    } catch (err: any) {
      setError(formatApiError(err, "Failed to load report"));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [token, tab, reportDate, shiftCode, start, end]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  const handleDownload = async (format: "csv" | "xlsx" | "pdf") => {
    if (!token) return;
    setDownloading(format);
    try {
      await downloadReport(token, tab, format, { date: reportDate, shift: shiftCode, start, end });
    } catch (err: any) {
      setError(formatApiError(err, "Export failed"));
    } finally {
      setDownloading(null);
    }
  };

  const sections: Section[] = data?.sections || [];

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Station Reports &amp; Exports</h1>
          <div className="page-subtitle">Generated from records using the same rules as the dashboard. Export as PDF, Excel or CSV.</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-secondary btn-sm" onClick={() => window.print()}>🖨 Print</button>
          {(["pdf", "xlsx", "csv"] as const).map((f) => (
            <button key={f} className="btn btn-primary btn-sm" onClick={() => handleDownload(f)} disabled={!!downloading || loading}>
              {downloading === f ? "Preparing…" : `⬇ ${f === "xlsx" ? "Excel" : f.toUpperCase()}`}
            </button>
          ))}
        </div>
      </div>

      {error && <div role="alert" className="alert-banner alert-banner--warning" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card__body" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
          <div role="tablist" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {TABS.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} className={`btn btn-sm ${tab === t.key ? "btn-primary" : "btn-secondary"}`} onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {tab === "workload" ? (
              <>
                <label style={{ fontSize: 13 }}>From <input type="date" className="form-control" value={start} onChange={(e) => setStart(e.target.value)} style={{ display: "inline-block", width: 150 }} /></label>
                <label style={{ fontSize: 13 }}>To <input type="date" className="form-control" value={end} onChange={(e) => setEnd(e.target.value)} style={{ display: "inline-block", width: 150 }} /></label>
              </>
            ) : (
              <label style={{ fontSize: 13 }}>Date <input type="date" className="form-control" value={reportDate} onChange={(e) => setReportDate(e.target.value)} style={{ display: "inline-block", width: 150 }} /></label>
            )}
            {tab === "shift-end" && (
              <label style={{ fontSize: 13 }}>Shift{" "}
                <select className="form-control" value={shiftCode} onChange={(e) => setShiftCode(e.target.value)} style={{ display: "inline-block", width: 170 }}>
                  {["A", "B", "C"].map((s) => <option key={s} value={s}>Shift {s}{labels[s] ? ` (${labels[s]})` : ""}</option>)}
                </select>
              </label>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loading-overlay"><div className="spinner" /> Generating report…</div>
      ) : data && (
        <div className="card printable-report">
          <div className="card__header" style={{ display: "block" }}>
            <div style={{ fontSize: 11, letterSpacing: ".08em", color: "#64748b", fontWeight: 700 }}>HYDERABAD CITY POLICE — PANJAGUTTA POLICE STATION</div>
            <h2 className="card__title" style={{ marginTop: 4 }}>{data.report_type}</h2>
            <div className="text-muted" style={{ fontSize: 12 }}>
              {data.report_date && `Date ${data.report_date}`}
              {data.shift_code && ` · Shift ${data.shift_code}`}
              {data.shift_window && ` (${data.shift_window})`}
              {data.start_date && `${data.start_date} to ${data.end_date}`}
              {data.roster_version != null && ` · Roster v${data.roster_version}`}
              {data.sector_scoped && ` · Sector ${data.sector_id} only`}
              {` · Generated ${new Date(data.generated_at).toLocaleString()} by ${data.generated_by}`}
            </div>
            {data.note && <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>{data.note}</div>}
          </div>
          <div className="card__body">
            {sections.map((sec) => (
              <div key={sec.title} style={{ marginBottom: 20 }}>
                <h3 style={{ fontSize: 15, margin: "0 0 8px" }}>{sec.title}</h3>
                {sec.rows.length === 0 ? (
                  <div className="text-muted" style={{ fontSize: 13 }}>No records.</div>
                ) : (
                  <div className="table-wrapper">
                    <table className="table">
                      <thead><tr>{sec.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                      <tbody>
                        {sec.rows.map((row, i) => (
                          <tr key={i}>{row.map((v, j) => <td key={j}>{v === null || v === "" ? "—" : String(v)}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
            {data.disclaimer && <div className="text-muted" style={{ fontSize: 11 }}>{data.disclaimer}</div>}
          </div>
        </div>
      )}
    </AppShell>
  );
}
