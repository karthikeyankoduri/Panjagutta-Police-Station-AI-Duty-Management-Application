"use client";
import { useEffect, useState, useCallback } from "react";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import {
  getTasks,
  getCurrentTasks,
  createTask,
  updateTask,
  updateTaskStatus,
  getStaff,
  formatApiError,
  Task,
  StaffMember,
} from "@/lib/api";

const STATUSES = ["Not Started", "In Progress", "Completed", "On Hold", "Cancelled"];
const STATUS_CLASS: Record<string, string> = {
  Completed: "badge-success", "In Progress": "badge-info", "On Hold": "badge-warning", Cancelled: "badge-default", "Not Started": "badge-default",
};
const OFFICER_RANKS = ["INSPECTOR", "SI", "WSI", "ASI", "AWSI"];

export default function TasksPage() {
  const { token, user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [current, setCurrent] = useState<Task[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [view, setView] = useState<"all" | "current">("all");

  const [statusFilter, setStatusFilter] = useState<string>("");
  const [overdueOnly, setOverdueOnly] = useState<boolean>(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [reportingId, setReportingId] = useState("");
  const [deadline, setDeadline] = useState("");

  const isStaff = user?.role === "STAFF";
  const isSupervisor = ["SHO", "ADMIN_SI", "SECTOR_SI", "SUPER_ADMIN"].includes(user?.role || "");

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [taskData, staffData, currentData] = await Promise.all([
        getTasks(token, { task_status: statusFilter || undefined, overdue_only: overdueOnly || undefined }),
        isSupervisor ? getStaff(token, { is_active: true }) : Promise.resolve([] as StaffMember[]),
        isStaff ? Promise.resolve([] as Task[]) : getCurrentTasks(token),
      ]);
      setTasks(taskData);
      setStaffList(staffData);
      setCurrent(currentData);
    } catch (err: any) {
      setError(err.message || "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, [token, statusFilter, overdueOnly, isSupervisor, isStaff]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    try {
      await createTask(token, {
        description,
        assignee_id: parseInt(assigneeId, 10),
        reporting_officer_id: reportingId ? parseInt(reportingId, 10) : null,
        expected_completion: deadline ? new Date(deadline).toISOString() : null,
      });
      setSuccess("Task created and the officer notified.");
      setShowCreateModal(false);
      setDescription("");
      setDeadline("");
      setReportingId("");
      fetchData();
    } catch (err: any) {
      setError(formatApiError(err, "Failed to create task"));
    }
  };

  const handleStatusChange = async (taskId: number, newStatus: string) => {
    if (!token) return;
    try {
      await updateTaskStatus(token, taskId, newStatus);
      setSuccess(`Task #${taskId} updated to '${newStatus}'.`);
      fetchData();
    } catch (err: any) {
      setError(formatApiError(err, "Failed to update task"));
    }
  };

  const handleReportingChange = async (taskId: number, officerId: string) => {
    if (!token) return;
    try {
      await updateTask(token, taskId, { reporting_officer_id: officerId ? Number(officerId) : null });
      fetchData();
    } catch (err: any) {
      setError(formatApiError(err, "Failed to update reporting officer"));
    }
  };

  const canUpdate = (t: Task) => isSupervisor || (user?.staff_id != null && t.assignee_id === user.staff_id);
  const officers = staffList.filter((s) => OFFICER_RANKS.includes(s.designation));
  const rows = view === "current" ? current : tasks;

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">{isStaff ? "My Tasks" : "Tasks & Special Bandobast"}</h1>
          <div className="page-subtitle">
            {isStaff ? "Tasks assigned to you. Update progress as you work; your reporting officer sees each change." :
              "Assign and track time-bound tasks. Tasks past their expected completion are flagged automatically."}
          </div>
        </div>
        {isSupervisor && (
          <button className="btn btn-primary" onClick={() => setShowCreateModal(true)} id="btn-create-task">+ Assign New Task</button>
        )}
      </div>

      {error && <div role="alert" className="alert-banner alert-banner--warning" style={{ marginBottom: 16 }}>{error}</div>}
      {success && <div className="alert-banner alert-banner--info" style={{ marginBottom: 16 }}>{success}</div>}

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card__body" style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          {!isStaff && (
            <div role="tablist" style={{ display: "flex", gap: 6 }}>
              <button role="tab" aria-selected={view === "all"} className={`btn btn-sm ${view === "all" ? "btn-primary" : "btn-secondary"}`} onClick={() => setView("all")}>All tasks</button>
              <button role="tab" aria-selected={view === "current"} className={`btn btn-sm ${view === "current" ? "btn-primary" : "btn-secondary"}`} onClick={() => setView("current")}>Current task per person ({current.length})</button>
            </div>
          )}
          {view === "all" && (
            <>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600 }}>
                Status
                <select className="form-control" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 160 }}>
                  <option value="">All statuses</option>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
                Overdue only
              </label>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card__header"><span className="card__title">{view === "current" ? "Current open task for each officer" : `Tasks (${rows.length})`}</span></div>
        <div className="card__body" style={{ padding: 0 }}>
          {loading ? (
            <div style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>Loading tasks...</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>No tasks found.</div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr><th>#</th><th>Description</th><th>Assigned officer</th><th>Reporting officer</th><th>Expected completion</th><th>Status</th><th>Update</th></tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id} style={{ backgroundColor: t.is_overdue ? "rgba(239, 68, 68, 0.08)" : undefined }}>
                      <td><strong>#{t.id}</strong></td>
                      <td style={{ maxWidth: 260 }}>
                        <div style={{ fontWeight: 600 }}>{t.description}</div>
                        {t.is_overdue && <span className="badge badge-danger" style={{ marginTop: 4 }}>OVERDUE</span>}
                      </td>
                      <td><strong>{t.assignee_name || `Staff #${t.assignee_id}`}</strong><div style={{ fontSize: 11, color: "#64748b" }}>{t.assignee_service_number}</div></td>
                      <td style={{ fontSize: 12 }}>
                        {isSupervisor ? (
                          <select className="form-control" style={{ fontSize: 12, padding: "4px 8px", width: 160 }} value={t.reporting_officer_id ?? ""}
                            onChange={(e) => handleReportingChange(t.id, e.target.value)} aria-label="Reporting officer">
                            <option value="">— none —</option>
                            {officers.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.designation})</option>)}
                            {t.reporting_officer_id && !officers.some((o) => o.id === t.reporting_officer_id) && (
                              <option value={t.reporting_officer_id}>{t.reporting_officer_name}</option>
                            )}
                          </select>
                        ) : (t.reporting_officer_name || "—")}
                      </td>
                      <td style={{ fontSize: 12, color: "#94a3b8" }}>{t.expected_completion ? new Date(t.expected_completion).toLocaleString() : "No deadline"}</td>
                      <td><span className={`badge ${STATUS_CLASS[t.status] || "badge-default"}`}>{t.status}</span></td>
                      <td>
                        {canUpdate(t) ? (
                          <select className="form-control" style={{ fontSize: 12, padding: "4px 8px", width: 130 }} value={t.status}
                            onChange={(e) => handleStatusChange(t.id, e.target.value)} aria-label={`Status of task ${t.id}`}>
                            {STATUSES.filter((s) => isSupervisor || s !== "Cancelled" || t.status === "Cancelled").map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        ) : <span className="text-muted" style={{ fontSize: 12 }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showCreateModal && (
        <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.7)", padding: 12, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div className="card" style={{ width: "100%", maxWidth: "min(95vw, 650px)" }}>
            <div className="card__header">
              <span className="card__title">Assign New Task</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowCreateModal(false)} aria-label="Close">✕</button>
            </div>
            <form onSubmit={handleCreateTask} className="card__body">
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="form-label" htmlFor="task-desc">Task description</label>
                <textarea id="task-desc" className="form-control" required rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="form-label" htmlFor="task-assignee">Assigned officer</label>
                <select id="task-assignee" className="form-control" required value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                  <option value="">-- Choose officer --</option>
                  {staffList.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.service_number} · {s.designation})</option>)}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="form-label" htmlFor="task-reporting">Reporting officer</label>
                <select id="task-reporting" className="form-control" value={reportingId} onChange={(e) => setReportingId(e.target.value)}>
                  <option value="">-- Choose reporting officer --</option>
                  {officers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.designation})</option>)}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 20 }}>
                <label className="form-label" htmlFor="task-deadline">Expected completion</label>
                <input id="task-deadline" type="datetime-local" className="form-control" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Assign Task</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
