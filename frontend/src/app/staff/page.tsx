"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import AppShell from "@/components/AppShell";
import {
  getStaff,
  createStaff,
  updateStaff,
  importStaffCsv,
  clearDemoData,
  StaffMember,
} from "@/lib/api";

const DESIGNATIONS = [
  "INSPECTOR",
  "SI",
  "WSI",
  "ASI",
  "AWSI",
  "HC",
  "WHC",
  "PC",
  "WPC",
  "ARPC",
  "ARWPC",
  "HGS",
  "WHGS",
  "SPO",
];

const CATEGORIES = ["SECTOR_STAFF", "SECTION_DUTY", "DRIVER", "ATTACHED"];
const SECTORS = [1, 2, 3, 4, 5];
const USER_ROLES = [
  "SUPER_ADMIN",
  "SHO",
  "DI",
  "ADMIN_SI",
  "DSI",
  "SECTOR_SI",
  "STATION_WRITER",
  "SECTION_INCHARGE",
  "GENERAL_STAFF",
];

export default function StaffPage() {
  const { token, user } = useAuth();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [search, setSearch] = useState("");
  const [desigFilter, setDesigFilter] = useState("");
  const [sectorFilter, setSectorFilter] = useState("");

  // Add Staff Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [addFormData, setAddFormData] = useState({
    service_number: "",
    name: "",
    designation: "PC",
    category: "SECTOR_STAFF",
    sector_id: "",
    section: "",
    contact_phone: "",
  });
  const [addFormError, setAddFormError] = useState("");
  const [addFormLoading, setAddFormLoading] = useState(false);

  // Edit Staff Modal State
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [editFormData, setEditFormData] = useState({
    name: "",
    designation: "",
    category: "",
    sector_id: "",
    section: "",
    contact_phone: "",
    is_active: true,
    user_username: "",
    user_role: "",
    reset_password: "",
  });
  const [editFormError, setEditFormError] = useState("");
  const [editFormLoading, setEditFormLoading] = useState(false);

  // CSV Import Modal State
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<{
    success?: boolean;
    message: string;
    imported_count: number;
    imported_new?: number;
    updated_staff?: number;
    total_staff_count: number;
    details?: string[];
    errors?: string[];
    detected_headers?: string[];
  } | null>(null);
  const [importError, setImportError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Clear Demo Data Modal State
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearLoading, setClearLoading] = useState(false);
  const [clearError, setClearError] = useState("");

  const isAdminOrSho =
    user?.role === "ADMIN_SI" || user?.role === "SHO" || user?.role === "SUPER_ADMIN";

  const fetchStaff = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await getStaff(token, {
        search: search || undefined,
        designation: desigFilter || undefined,
        sector_id: sectorFilter ? parseInt(sectorFilter) : undefined,
      });
      setStaff(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load staff");
    } finally {
      setLoading(false);
    }
  }, [token, search, desigFilter, sectorFilter]);

  useEffect(() => {
    fetchStaff();
  }, [fetchStaff]);

  // Handle Add Staff
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddFormError("");
    setAddFormLoading(true);
    try {
      await createStaff(token!, {
        service_number: addFormData.service_number,
        name: addFormData.name,
        designation: addFormData.designation,
        category: addFormData.category,
        sector_id: addFormData.sector_id ? parseInt(addFormData.sector_id) : undefined,
        section: addFormData.section || undefined,
        contact_phone: addFormData.contact_phone || undefined,
      });
      setShowAddModal(false);
      setAddFormData({
        service_number: "",
        name: "",
        designation: "PC",
        category: "SECTOR_STAFF",
        sector_id: "",
        section: "",
        contact_phone: "",
      });
      setSuccessMsg("Staff member added successfully.");
      setTimeout(() => setSuccessMsg(""), 4000);
      fetchStaff();
    } catch (e) {
      setAddFormError(e instanceof Error ? e.message : "Failed to create staff");
    } finally {
      setAddFormLoading(false);
    }
  };

  // Open Edit Modal
  const handleOpenEdit = (s: StaffMember) => {
    setEditingStaff(s);
    setEditFormData({
      name: s.name,
      designation: s.designation,
      category: s.category,
      sector_id: s.sector_id ? String(s.sector_id) : "",
      section: s.section || "",
      contact_phone: s.contact_phone || "",
      is_active: s.is_active,
      user_username: s.user_username || "",
      user_role: s.user_role || "GENERAL_STAFF",
      reset_password: "",
    });
    setEditFormError("");
  };

  // Handle Update Staff & User
  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStaff) return;
    setEditFormError("");
    setEditFormLoading(true);
    try {
      await updateStaff(token!, editingStaff.id, {
        name: editFormData.name,
        designation: editFormData.designation,
        category: editFormData.category,
        sector_id: editFormData.sector_id ? parseInt(editFormData.sector_id) : null,
        section: editFormData.section || null,
        contact_phone: editFormData.contact_phone || null,
        is_active: editFormData.is_active,
        user_username: editFormData.user_username || undefined,
        user_role: editFormData.user_role || undefined,
        reset_password: editFormData.reset_password ? editFormData.reset_password : undefined,
      });
      setEditingStaff(null);
      setSuccessMsg(`Updated staff profile for ${editFormData.name} successfully.`);
      setTimeout(() => setSuccessMsg(""), 4000);
      fetchStaff();
    } catch (e) {
      setEditFormError(e instanceof Error ? e.message : "Failed to update staff member");
    } finally {
      setEditFormLoading(false);
    }
  };

  // Handle CSV/Excel Import
  const handleCsvImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setImportError("Please select a CSV or Excel (.xlsx) file to upload.");
      return;
    }
    setImportError("");
    setImportLoading(true);
    setImportResult(null);
    try {
      const res = await importStaffCsv(token!, selectedFile);
      setImportResult(res);
      if (res.imported_count > 0) {
        setSuccessMsg(`Successfully processed ${res.imported_count} staff personnel and user accounts!`);
        setTimeout(() => setSuccessMsg(""), 6000);
      } else {
        setImportError(res.message || "No personnel records could be imported from the file.");
      }
      fetchStaff();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Staff import failed.");
    } finally {
      setImportLoading(false);
    }
  };

  // Handle Clear Demo Data
  const handleClearDemo = async () => {
    setClearError("");
    setClearLoading(true);
    try {
      const res = await clearDemoData(token!);
      setShowClearModal(false);
      setSuccessMsg(res.detail || "Demo operational data and demo staff removed.");
      setTimeout(() => setSuccessMsg(""), 5000);
      fetchStaff();
    } catch (e) {
      setClearError(e instanceof Error ? e.message : "Failed to clear demo data.");
    } finally {
      setClearLoading(false);
    }
  };

  return (
    <AppShell>
      {/* Page Header */}
      <div className="page-header" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
        <div>
          <h1 className="page-title">Station Staff Register & Personnel Management</h1>
          <div className="page-subtitle">
            Manage station personnel (140 Authorized Strength across Panjagutta PS), provision login credentials, and import roster staff via CSV.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {isAdminOrSho && (
            <>
              <button
                className="btn btn-danger"
                onClick={() => { setShowClearModal(true); setClearError(""); }}
                id="btn-clear-demo"
                title="Wipe demo records and prepare station for official roster"
              >
                🗑 Wipe Demo Data
              </button>
              <a
                href="/panjagutta_140_police_staff.csv"
                download="panjagutta_140_police_staff.csv"
                className="btn btn-secondary"
                id="btn-download-csv-template"
                title="Download Official Police Proforma CSV template with unique PG IDs"
              >
                📥 Download Proforma CSV
              </a>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setShowImportModal(true);
                  setSelectedFile(null);
                  setImportResult(null);
                  setImportError("");
                }}
                id="btn-import-staff-csv"
              >
                📂 Import Staff (CSV / Excel)
              </button>
            </>
          )}
          <button
            className="btn btn-secondary"
            onClick={() => setShowAddModal(true)}
            id="btn-add-staff"
          >
            + Add Individual Staff
          </button>
        </div>
      </div>

      {/* Notifications */}
      {successMsg && (
        <div
          className="alert-item success"
          role="status"
          style={{
            marginBottom: 16,
            background: "var(--color-success-light)",
            color: "#166534",
            padding: "12px 16px",
            borderRadius: "var(--radius-md)",
            border: "1px solid #86efac",
            fontWeight: 600,
          }}
        >
          ✓ {successMsg}
        </div>
      )}
      {error && (
        <div
          className="alert-item warning"
          role="alert"
          style={{
            marginBottom: 16,
            background: "var(--color-danger-light)",
            color: "#991b1b",
            padding: "12px 16px",
            borderRadius: "var(--radius-md)",
            border: "1px solid #fca5a5",
          }}
        >
          ⚠ {error}
        </div>
      )}

      {/* Stats Summary Bar */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 16 }}>
        <div className="card" style={{ padding: "12px 16px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-muted)", textTransform: "uppercase" }}>
            Total Staff Strength
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "var(--color-navy-900)", marginTop: 4 }}>
            {staff.length} <span style={{ fontSize: 13, fontWeight: 500, color: "var(--color-muted)" }}>/ 140 Authorized</span>
          </div>
        </div>
        <div className="card" style={{ padding: "12px 16px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-muted)", textTransform: "uppercase" }}>
            Active Personnel
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "var(--color-success)", marginTop: 4 }}>
            {staff.filter((s) => s.is_active).length}
          </div>
        </div>
        <div className="card" style={{ padding: "12px 16px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-muted)", textTransform: "uppercase" }}>
            Officers (SHO, DI, SIs, ASIs)
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "var(--color-blue-600)", marginTop: 4 }}>
            {staff.filter((s) => ["INSPECTOR", "SI", "WSI", "ASI", "AWSI"].includes(s.designation)).length}
          </div>
        </div>
        <div className="card" style={{ padding: "12px 16px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-muted)", textTransform: "uppercase" }}>
            Constabulary (HC, PC, ARPC)
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#d97706", marginTop: 4 }}>
            {staff.filter((s) => ["HC", "WHC", "PC", "WPC", "ARPC", "ARWPC"].includes(s.designation)).length}
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div
          className="card__body"
          style={{ display: "flex", gap: 12, flexWrap: "wrap", padding: "12px 16px", alignItems: "center" }}
        >
          <input
            className="form-input"
            placeholder="Search by name, service number, username, or section..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 240 }}
            id="staff-search-input"
          />
          <select
            className="form-select"
            value={desigFilter}
            onChange={(e) => setDesigFilter(e.target.value)}
            style={{ width: 170 }}
            id="designation-filter"
          >
            <option value="">All Designations</option>
            {DESIGNATIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select
            className="form-select"
            value={sectorFilter}
            onChange={(e) => setSectorFilter(e.target.value)}
            style={{ width: 140 }}
            id="sector-filter"
          >
            <option value="">All Sectors</option>
            {SECTORS.map((s) => (
              <option key={s} value={s}>
                Sector {s}
              </option>
            ))}
          </select>
          <button className="btn btn-secondary" onClick={fetchStaff} id="btn-apply-filters">
            Apply Filters
          </button>
          {(search || desigFilter || sectorFilter) && (
            <button
              className="btn btn-secondary"
              onClick={() => {
                setSearch("");
                setDesigFilter("");
                setSectorFilter("");
              }}
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Staff Table */}
      {loading ? (
        <div className="loading-overlay" style={{ padding: "40px", textAlign: "center" }}>
          <div className="spinner" /> Loading station staff...
        </div>
      ) : staff.length === 0 ? (
        <div className="empty-state" style={{ padding: "48px 24px", textAlign: "center" }}>
          <div className="empty-state__icon" style={{ fontSize: 48, marginBottom: 12 }}>👥</div>
          <h3 className="empty-state__title" style={{ fontSize: 18, marginBottom: 8 }}>No Staff Found in Station Register</h3>
          <p className="empty-state__text" style={{ maxWidth: 500, margin: "0 auto 20px", color: "var(--color-muted)" }}>
            The station staff register is currently empty or matches no filters. You can import the 140 authorized personnel CSV file or add personnel individually.
          </p>
          {isAdminOrSho && (
            <button
              className="btn btn-primary"
              onClick={() => {
                setShowImportModal(true);
                setSelectedFile(null);
                setImportResult(null);
                setImportError("");
              }}
            >
              📂 Import 140 Personnel CSV
            </button>
          )}
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="table" aria-label="Staff register">
            <thead>
              <tr>
                <th>Service No.</th>
                <th>Officer Name</th>
                <th>Designation</th>
                <th>Category</th>
                <th>Sector</th>
                <th>Section</th>
                <th>Contact</th>
                <th>Login Account & Role</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id}>
                  <td>
                    <code style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: "var(--color-navy-800)" }}>
                      {s.service_number}
                    </code>
                  </td>
                  <td>
                    <strong>{s.name}</strong>
                    {s.is_demo && (
                      <span className="badge badge-yellow" style={{ marginLeft: 6, fontSize: 10 }}>
                        DEMO
                      </span>
                    )}
                  </td>
                  <td>
                    <span
                      className="badge"
                      style={{
                        background: ["INSPECTOR", "SI", "WSI"].includes(s.designation)
                          ? "var(--color-blue-100)"
                          : "var(--color-muted-light)",
                        color: ["INSPECTOR", "SI", "WSI"].includes(s.designation)
                          ? "var(--color-blue-600)"
                          : "#334155",
                        fontWeight: 700,
                      }}
                    >
                      {s.designation}
                    </span>
                  </td>
                  <td>{s.category.replace("_", " ")}</td>
                  <td>
                    {s.sector_id ? (
                      <span className="badge badge-blue">Sector {s.sector_id}</span>
                    ) : (
                      <span style={{ color: "var(--color-muted)" }}>—</span>
                    )}
                  </td>
                  <td>{s.section || <span style={{ color: "var(--color-muted)" }}>General</span>}</td>
                  <td style={{ fontSize: 12 }}>
                    {s.contact_phone ? (
                      <span>📞 {s.contact_phone}</span>
                    ) : (
                      <span style={{ color: "var(--color-muted)" }}>—</span>
                    )}
                  </td>
                  <td>
                    {s.user_username ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 11, color: "var(--color-muted)" }}>ID:</span>
                          <code style={{ fontSize: 11, fontWeight: 700, color: "var(--color-navy-800)" }}>{s.service_number}</code>
                        </div>
                        <span className="badge badge-purple" style={{ fontSize: 10, alignSelf: "flex-start" }}>
                          {s.user_role || "STAFF"}
                        </span>
                        <div style={{ fontSize: 10, color: "#64748b" }} title="Default initial password">
                          🔑 <code>Password@PJ2024!</code>
                        </div>
                      </div>
                    ) : (
                      <span style={{ color: "var(--color-muted)", fontSize: 11 }}>No user account</span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${s.is_active ? "badge-green" : "badge-red"}`}>
                      {s.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleOpenEdit(s)}
                      id={`edit-staff-${s.id}`}
                      title="Edit officer profile and user credentials"
                    >
                      ✏ Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── CSV Import Modal ─── */}
      {showImportModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div className="card" style={{ width: "100%", maxWidth: 600, maxHeight: "90vh", overflowY: "auto" }}>
            <div className="card__header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h2 className="card__title">Import Station Personnel (CSV)</h2>
                <div style={{ fontSize: 12, color: "var(--color-muted)", marginTop: 2 }}>
                  Bulk import 140 Panjagutta Police Station personnel across all designations with automatic user account provisioning.
                </div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowImportModal(false)}>✕</button>
            </div>
            <div className="card__body" style={{ padding: 20 }}>
              {/* Instructions and Download Link */}
              <div
                style={{
                  background: "var(--color-blue-50)",
                  border: "1px solid var(--color-blue-100)",
                  borderRadius: "var(--radius-md)",
                  padding: 14,
                  marginBottom: 20,
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                <div style={{ fontWeight: 700, color: "var(--color-blue-600)", marginBottom: 4 }}>
                  Official Police Department Proforma (140 Personnel)
                </div>
                <div>
                  Upload staff personnel via official Police Department Excel/CSV proforma with unique Panjagutta IDs (e.g. <code>pg-011</code>). Includes SHO, DI, Admin SI, Duty SI, Sector SIs, Specialized SIs, ASIs, HCs, PCs, WPCs, Drivers, Home Guards, and SPOs.
                </div>
                <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center" }}>
                  <a
                    href="/panjagutta_140_police_staff.csv"
                    download="panjagutta_140_police_staff.csv"
                    className="btn btn-primary btn-sm"
                  >
                    ⬇ Download Proforma CSV (`panjagutta_140_police_staff.csv`)
                  </a>
                </div>
              </div>

              {/* Upload Form */}
              <form onSubmit={handleCsvImport}>
                <div className="form-group">
                  <label className="form-label" htmlFor="csv-file-input">
                    Select CSV or Excel (.xlsx / .xls) File *
                  </label>
                  <input
                    id="csv-file-input"
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    className="form-input"
                    required
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        setSelectedFile(e.target.files[0]);
                        setImportError("");
                      }
                    }}
                  />
                  {selectedFile && (
                    <div style={{ marginTop: 8, fontSize: 12, color: "var(--color-muted)" }}>
                      Selected: <strong>{selectedFile.name}</strong> ({(selectedFile.size / 1024).toFixed(1)} KB)
                    </div>
                  )}
                </div>

                <div
                  style={{
                    background: "var(--color-muted-light)",
                    padding: 12,
                    borderRadius: "var(--radius-sm)",
                    fontSize: 12,
                    color: "#475569",
                    marginBottom: 16,
                  }}
                >
                  <strong>Supported Proforma Columns:</strong>
                  <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", marginTop: 4, color: "var(--color-navy-800)" }}>
                    S.No | Range | Zone | Division | Police Station | PG ID (e.g. pg-011) | Employee ID | Rank | General No | Employee name | Mobile no (personal) | Department No | Mother Tongue | E-mail ID
                  </div>
                  <div style={{ marginTop: 6, fontSize: 11, color: "var(--color-muted)", lineHeight: 1.5 }}>
                    💡 <em>Note: Unique Station IDs (<code>pg-001</code>, <code>pg-011</code>, etc.) are automatically assigned. Every personnel is provisioned a login account with default password <code>Password@PJ2024!</code> (or from a 'Password' column). Personnel can sign in using their Station ID (e.g. <code>pg-001</code>), HRMS Employee ID, or Email.</em>
                  </div>
                </div>

                {importError && (
                  <div className="alert-item warning" style={{ marginBottom: 16, color: "var(--color-danger)" }}>
                    ⚠ {importError}
                  </div>
                )}

                {importResult && (
                  <div
                    style={{
                      background: importResult.imported_count > 0 ? "var(--color-success-light, #f0fdf4)" : "#fef2f2",
                      color: importResult.imported_count > 0 ? "#166534" : "#991b1b",
                      border: `1px solid ${importResult.imported_count > 0 ? "#bbf7d0" : "#fecaca"}`,
                      padding: 14,
                      borderRadius: "var(--radius-md)",
                      marginBottom: 16,
                      fontSize: 13,
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                      {importResult.imported_count > 0 ? "✓ " : "⚠ "} {importResult.message}
                    </div>
                    <div>
                      Imported/Updated: <strong>{importResult.imported_count}</strong> personnel ({importResult.imported_new || 0} new, {importResult.updated_staff || 0} updated).
                    </div>
                    <div>
                      Total Station Register Strength: <strong>{importResult.total_staff_count}</strong> staff.
                    </div>
                    {importResult.errors && importResult.errors.length > 0 && (
                      <div style={{ marginTop: 10, padding: 8, background: "rgba(0,0,0,0.05)", borderRadius: 4, maxHeight: 130, overflowY: "auto", fontSize: 11 }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>Issues / Warnings ({importResult.errors.length}):</div>
                        {importResult.errors.slice(0, 10).map((err: string, i: number) => (
                          <div key={i}>• {err}</div>
                        ))}
                        {importResult.errors.length > 10 && <div>...and {importResult.errors.length - 10} more.</div>}
                      </div>
                    )}
                  </div>
                )}

                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowImportModal(false)}
                    disabled={importLoading}
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={importLoading || !selectedFile}
                    id="btn-submit-csv-import"
                  >
                    {importLoading ? "Importing Personnel..." : "🚀 Upload & Import File"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ─── Edit Staff & User Modal ─── */}
      {editingStaff && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div className="card" style={{ width: "100%", maxWidth: 540, maxHeight: "90vh", overflowY: "auto" }}>
            <div className="card__header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h2 className="card__title">Edit Staff & User Profile</h2>
                <div style={{ fontSize: 12, color: "var(--color-muted)", marginTop: 2 }}>
                  Service Number: <code style={{ fontWeight: 700 }}>{editingStaff.service_number}</code>
                </div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setEditingStaff(null)}>✕</button>
            </div>
            <div className="card__body" style={{ padding: 20 }}>
              <form onSubmit={handleUpdate}>
                <div className="form-group">
                  <label className="form-label" htmlFor="edit-name">Full Officer Name *</label>
                  <input
                    id="edit-name"
                    className="form-input"
                    required
                    value={editFormData.name}
                    onChange={(e) => setEditFormData((p) => ({ ...p, name: e.target.value }))}
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="edit-designation">Designation *</label>
                    <select
                      id="edit-designation"
                      className="form-select"
                      value={editFormData.designation}
                      onChange={(e) => setEditFormData((p) => ({ ...p, designation: e.target.value }))}
                    >
                      {DESIGNATIONS.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="edit-category">Category *</label>
                    <select
                      id="edit-category"
                      className="form-select"
                      value={editFormData.category}
                      onChange={(e) => setEditFormData((p) => ({ ...p, category: e.target.value }))}
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>{c.replace("_", " ")}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="edit-sector">Sector Assignment</label>
                    <select
                      id="edit-sector"
                      className="form-select"
                      value={editFormData.sector_id}
                      onChange={(e) => setEditFormData((p) => ({ ...p, sector_id: e.target.value }))}
                    >
                      <option value="">None / Station General</option>
                      {SECTORS.map((s) => (
                        <option key={s} value={s}>Sector {s}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="edit-section">Station Section</label>
                    <input
                      id="edit-section"
                      className="form-input"
                      value={editFormData.section}
                      placeholder="e.g. Court, CCTNS, Reception"
                      onChange={(e) => setEditFormData((p) => ({ ...p, section: e.target.value }))}
                    />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="edit-phone">Contact Phone</label>
                    <input
                      id="edit-phone"
                      className="form-input"
                      value={editFormData.contact_phone}
                      placeholder="e.g. 9849901001"
                      onChange={(e) => setEditFormData((p) => ({ ...p, contact_phone: e.target.value }))}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="edit-status">Personnel Status</label>
                    <select
                      id="edit-status"
                      className="form-select"
                      value={editFormData.is_active ? "active" : "inactive"}
                      onChange={(e) => setEditFormData((p) => ({ ...p, is_active: e.target.value === "active" }))}
                    >
                      <option value="active">Active Duty</option>
                      <option value="inactive">Inactive / On Leave / Suspended</option>
                    </select>
                  </div>
                </div>

                {/* Linked User Account Card */}
                <div
                  style={{
                    background: "var(--color-muted-light)",
                    border: "1px solid var(--color-surface-border)",
                    borderRadius: "var(--radius-md)",
                    padding: 14,
                    marginTop: 8,
                    marginBottom: 16,
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: "var(--color-navy-800)" }}>
                    🔐 Linked System Login Account
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div className="form-group" style={{ marginBottom: 8 }}>
                      <label className="form-label" htmlFor="edit-user-role">System Role</label>
                      <select
                        id="edit-user-role"
                        className="form-select"
                        value={editFormData.user_role}
                        onChange={(e) => setEditFormData((p) => ({ ...p, user_role: e.target.value }))}
                      >
                        {USER_ROLES.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group" style={{ marginBottom: 8 }}>
                      <label className="form-label" htmlFor="edit-user-pwd">Reset Password</label>
                      <input
                        id="edit-user-pwd"
                        type="password"
                        className="form-input"
                        placeholder="Leave blank to retain password"
                        value={editFormData.reset_password}
                        onChange={(e) => setEditFormData((p) => ({ ...p, reset_password: e.target.value }))}
                      />
                    </div>
                  </div>
                  {editFormData.user_username && (
                    <div style={{ fontSize: 11, color: "var(--color-muted)", marginTop: 6, display: "flex", flexDirection: "column", gap: 2 }}>
                      <div>Login Username: <code>{editFormData.user_username}</code> (or Station ID: <code>{editingStaff.service_number}</code>)</div>
                      <div style={{ color: "var(--color-navy-700)" }}>ℹ <em>Enter a new password above to reset credentials for this officer immediately.</em></div>
                    </div>
                  )}
                </div>

                {editFormError && (
                  <div className="alert-item warning" style={{ marginBottom: 12, color: "var(--color-danger)" }}>
                    ⚠ {editFormError}
                  </div>
                )}

                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setEditingStaff(null)}
                    disabled={editFormLoading}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={editFormLoading}
                    id="btn-save-staff-edit"
                  >
                    {editFormLoading ? "Saving Changes..." : "Save Profile & Credentials"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ─── Add Staff Modal ─── */}
      {showAddModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div className="card" style={{ width: "100%", maxWidth: 500, maxHeight: "90vh", overflowY: "auto" }}>
            <div className="card__header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 className="card__title">Add Individual Staff Member</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowAddModal(false)}>✕</button>
            </div>
            <div className="card__body" style={{ padding: 20 }}>
              <form onSubmit={handleCreate}>
                <div className="form-group">
                  <label className="form-label" htmlFor="svc-num">Service Number *</label>
                  <input
                    id="svc-num"
                    className="form-input"
                    required
                    value={addFormData.service_number}
                    onChange={(e) => setAddFormData((p) => ({ ...p, service_number: e.target.value }))}
                    placeholder="e.g. PJ-PC-099"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="staff-name">Full Name *</label>
                  <input
                    id="staff-name"
                    className="form-input"
                    required
                    value={addFormData.name}
                    onChange={(e) => setAddFormData((p) => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. Ramesh Kumar"
                  />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="designation-sel">Designation *</label>
                    <select
                      id="designation-sel"
                      className="form-select"
                      value={addFormData.designation}
                      onChange={(e) => setAddFormData((p) => ({ ...p, designation: e.target.value }))}
                    >
                      {DESIGNATIONS.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="category-sel">Category *</label>
                    <select
                      id="category-sel"
                      className="form-select"
                      value={addFormData.category}
                      onChange={(e) => setAddFormData((p) => ({ ...p, category: e.target.value }))}
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>{c.replace("_", " ")}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="sector-sel">Sector</label>
                    <select
                      id="sector-sel"
                      className="form-select"
                      value={addFormData.sector_id}
                      onChange={(e) => setAddFormData((p) => ({ ...p, sector_id: e.target.value }))}
                    >
                      <option value="">None / General</option>
                      {SECTORS.map((s) => (
                        <option key={s} value={s}>Sector {s}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="section-input">Section</label>
                    <input
                      id="section-input"
                      className="form-input"
                      value={addFormData.section}
                      onChange={(e) => setAddFormData((p) => ({ ...p, section: e.target.value }))}
                      placeholder="e.g. Court"
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="contact-input">Contact Phone</label>
                  <input
                    id="contact-input"
                    className="form-input"
                    value={addFormData.contact_phone}
                    onChange={(e) => setAddFormData((p) => ({ ...p, contact_phone: e.target.value }))}
                    placeholder="e.g. 9849901001"
                  />
                </div>
                {addFormError && <div className="form-error" role="alert">{addFormError}</div>}
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={addFormLoading} id="submit-staff">
                    {addFormLoading ? "Saving..." : "Save Staff"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ─── Clear Demo Data Confirmation Modal ─── */}
      {showClearModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div className="card" style={{ width: "100%", maxWidth: 480 }}>
            <div className="card__header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 className="card__title" style={{ color: "var(--color-danger)" }}>
                ⚠ Confirm Wipe Demo Data
              </h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowClearModal(false)}>✕</button>
            </div>
            <div className="card__body" style={{ padding: 20 }}>
              <p style={{ fontSize: 13, lineHeight: 1.6, color: "#334155", marginBottom: 16 }}>
                This will permanently delete all demo rosters, demo duty assignments, demo leave applications, movements, attendance, and demo staff records to prepare Panjagutta Police Station for official duty operations.
              </p>
              <div
                style={{
                  background: "var(--color-danger-light)",
                  padding: 12,
                  borderRadius: "var(--radius-md)",
                  fontSize: 12,
                  color: "#991b1b",
                  marginBottom: 16,
                }}
              >
                <strong>Security Protection:</strong> Your current admin login session will be preserved so you can immediately import the official 140 staff CSV without being logged out.
              </div>
              {clearError && (
                <div className="alert-item warning" style={{ marginBottom: 12, color: "var(--color-danger)" }}>
                  ⚠ {clearError}
                </div>
              )}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowClearModal(false)}
                  disabled={clearLoading}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleClearDemo}
                  disabled={clearLoading}
                  id="btn-confirm-clear-demo"
                >
                  {clearLoading ? "Wiping Records..." : "Yes, Wipe Demo Data"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
