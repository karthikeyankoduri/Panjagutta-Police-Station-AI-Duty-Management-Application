"use client";
import { useEffect, useState, useCallback } from "react";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import {
  getAttachments,
  createAttachment,
  endAttachment,
  getStaff,
  AttachmentItem,
  StaffMember,
} from "@/lib/api";

export default function AttachmentsPage() {
  const { token, user } = useAuth();
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [staffId, setStaffId] = useState("");
  const [attachedWing, setAttachedWing] = useState("Cyber Crime Police Station, Hyderabad");
  const [orderRef, setOrderRef] = useState("CP/HYD/ATTACH/2024/88");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    if (!startDate) setStartDate(new Date().toISOString().split("T")[0]);
  }, [startDate]);

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [attData, staffData] = await Promise.all([
        getAttachments(token, false),
        getStaff(token, { is_active: true }),
      ]);
      setAttachments(attData);
      setStaffList(staffData);
    } catch (err: any) {
      setError(err.message || "Failed to load attachment records");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    try {
      await createAttachment(token, {
        staff_id: parseInt(staffId, 10),
        parent_unit: "Panjagutta Police Station",
        attached_wing: attachedWing,
        order_reference: orderRef || null,
        start_date: startDate,
        expected_end_date: endDate || null,
      });
      setSuccess("Attachment order recorded. Personnel excluded from station duty rosters.");
      setShowCreateModal(false);
      fetchData();
    } catch (err: any) {
      setError(err.message || "Failed to create attachment order");
    }
  };

  const handleEnd = async (attachmentId: number) => {
    if (!token) return;
    try {
      await endAttachment(token, attachmentId, {
        actual_end_date: new Date().toISOString().split("T")[0],
        end_authority: "Repatriation order issued by Commissioner of Police.",
      });
      setSuccess("Attachment ended. Officer returned to station active pool.");
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const activeAttachments = attachments.filter((a) => a.is_active);
  const pastAttachments = attachments.filter((a) => !a.is_active);

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">External Attachment Orders</h1>
          <div className="page-subtitle">
            Personnel attached to Task Force, Cyber Crime, High Court, or Commissionerate. Excluded from daily rosters.
          </div>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setShowCreateModal(true)}
          id="btn-create-attachment"
        >
          + Record Attachment Order
        </button>
      </div>

      {error && <div className="alert-banner alert-banner--warning" style={{ marginBottom: "16px" }}>{error}</div>}
      {success && <div className="alert-banner alert-banner--info" style={{ marginBottom: "16px" }}>{success}</div>}

      {/* Active Attachments Table */}
      <div className="card" style={{ marginBottom: "24px" }}>
        <div className="card__header" style={{ display: "flex", justifyContent: "space-between" }}>
          <span className="card__title">Currently Attached Personnel ({activeAttachments.length})</span>
          <span style={{ fontSize: "12px", color: "#38bdf8" }}>Counted in Station Strength &middot; Excluded from Routine Duty</span>
        </div>
        <div className="card__body" style={{ padding: 0 }}>
          {activeAttachments.length === 0 ? (
            <div style={{ padding: "24px", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>
              No personnel currently attached to external wings.
            </div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Order #</th>
                    <th>Officer</th>
                    <th>Attached Wing / Agency</th>
                    <th>Order Reference</th>
                    <th>Attached Since</th>
                    <th>Expected End</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {activeAttachments.map((a) => {
                    const st = staffList.find((s) => s.id === a.staff_id);
                    return (
                      <tr key={a.id}>
                        <td><strong>#{a.id}</strong></td>
                        <td>
                          <strong>{st?.name || a.staff_name || `Staff #${a.staff_id}`}</strong>
                          <div style={{ fontSize: "11px", color: "#64748b" }}>
                            {st?.service_number} &middot; {st?.designation}
                          </div>
                        </td>
                        <td style={{ fontWeight: 600, color: "#38bdf8" }}>{a.attached_wing}</td>
                        <td style={{ fontSize: "12px", color: "#94a3b8" }}>{a.order_reference || "N/A"}</td>
                        <td>{a.start_date}</td>
                        <td style={{ fontSize: "12px", color: "#94a3b8" }}>{a.expected_end_date || "Indefinite"}</td>
                        <td>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleEnd(a.id)}
                          >
                            Repatriate to Station
                          </button>
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

      {/* Historical Attachments */}
      <div className="card">
        <div className="card__header">
          <span className="card__title">Repatriated / Historical Attachments ({pastAttachments.length})</span>
        </div>
        <div className="card__body" style={{ padding: 0 }}>
          {pastAttachments.length === 0 ? (
            <div style={{ padding: "20px", textAlign: "center", color: "#94a3b8" }}>No past attachments recorded.</div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Order #</th>
                    <th>Officer</th>
                    <th>Attached Wing</th>
                    <th>Period</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pastAttachments.map((a) => (
                    <tr key={a.id}>
                      <td>#{a.id}</td>
                      <td>{a.staff_name || `Staff #${a.staff_id}`}</td>
                      <td>{a.attached_wing}</td>
                      <td>{a.start_date} to {a.actual_end_date || "—"}</td>
                      <td><span className="badge badge-success">Repatriated</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {showCreateModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div className="card" style={{ width: "480px", maxWidth: "90vw" }}>
            <div className="card__header">
              <span className="card__title">Create Attachment Order</span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowCreateModal(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreate} className="card__body">
              <div className="form-group" style={{ marginBottom: "16px" }}>
                <label className="form-label">Staff Officer</label>
                <select
                  className="form-control"
                  required
                  value={staffId}
                  onChange={(e) => setStaffId(e.target.value)}
                >
                  <option value="">-- Choose Officer --</option>
                  {staffList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.service_number} &middot; {s.designation})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: "16px" }}>
                <label className="form-label">Attached Wing / Destination Unit</label>
                <input
                  type="text"
                  className="form-control"
                  required
                  value={attachedWing}
                  onChange={(e) => setAttachedWing(e.target.value)}
                  placeholder="e.g. Hyderabad City Task Force, Cyber Crime PS..."
                />
              </div>

              <div className="form-group" style={{ marginBottom: "16px" }}>
                <label className="form-label">Order Reference Number</label>
                <input
                  type="text"
                  className="form-control"
                  value={orderRef}
                  onChange={(e) => setOrderRef(e.target.value)}
                  placeholder="e.g. CP/ORDER/ATTACH/2024/91"
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "20px" }}>
                <div className="form-group">
                  <label className="form-label">Start Date</label>
                  <input
                    type="date"
                    className="form-control"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Expected End (Optional)</label>
                  <input
                    type="date"
                    className="form-control"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Record Order
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
