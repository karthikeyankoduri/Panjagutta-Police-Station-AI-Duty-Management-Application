"use client";
import { useEffect, useState, useCallback } from "react";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import {
  getTasks,
  createTask,
  updateTaskStatus,
  getStaff,
  Task,
  StaffMember,
} from "@/lib/api";

export default function TasksPage() {
  const { token, user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [overdueOnly, setOverdueOnly] = useState<boolean>(false);

  // Create Task Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [deadline, setDeadline] = useState("");

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [taskData, staffData] = await Promise.all([
        getTasks(token, {
          task_status: statusFilter || undefined,
          overdue_only: overdueOnly || undefined,
        }),
        getStaff(token, { is_active: true }),
      ]);
      setTasks(taskData);
      setStaffList(staffData);
    } catch (err: any) {
      setError(err.message || "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, [token, statusFilter, overdueOnly]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    try {
      await createTask(token, {
        description,
        assignee_id: parseInt(assigneeId, 10),
        expected_completion: deadline ? new Date(deadline).toISOString() : null,
      });
      setSuccess("Special task created and assigned.");
      setShowCreateModal(false);
      setDescription("");
      setDeadline("");
      fetchData();
    } catch (err: any) {
      setError(err.message || "Failed to create task");
    }
  };

  const handleStatusChange = async (taskId: number, newStatus: string) => {
    if (!token) return;
    try {
      await updateTaskStatus(token, taskId, newStatus);
      setSuccess(`Task #${taskId} updated to '${newStatus}'.`);
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Tasks &amp; Special Bandobast</h1>
          <div className="page-subtitle">
            Assign, track, and monitor time-sensitive station investigations, VIP bandobast, and summons.
          </div>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setShowCreateModal(true)}
          id="btn-create-task"
        >
          + Assign New Task
        </button>
      </div>

      {error && <div className="alert-banner alert-banner--warning" style={{ marginBottom: "16px" }}>{error}</div>}
      {success && <div className="alert-banner alert-banner--info" style={{ marginBottom: "16px" }}>{success}</div>}

      {/* Filter Bar */}
      <div className="card" style={{ marginBottom: "20px" }}>
        <div className="card__body" style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <label style={{ fontSize: "13px", fontWeight: 600 }}>Filter Status:</label>
            <select
              className="form-control"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ width: "160px" }}
            >
              <option value="">All Statuses</option>
              <option value="Not Started">Not Started</option>
              <option value="In Progress">In Progress</option>
              <option value="Completed">Completed</option>
              <option value="On Hold">On Hold</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={overdueOnly}
              onChange={(e) => setOverdueOnly(e.target.checked)}
            />
            Show Overdue Tasks Only
          </label>
        </div>
      </div>

      {/* Tasks Table */}
      <div className="card">
        <div className="card__header" style={{ display: "flex", justifyContent: "space-between" }}>
          <span className="card__title">Station Assigned Tasks ({tasks.length})</span>
        </div>
        <div className="card__body" style={{ padding: 0 }}>
          {loading ? (
            <div style={{ padding: "30px", textAlign: "center", color: "#94a3b8" }}>Loading tasks...</div>
          ) : tasks.length === 0 ? (
            <div style={{ padding: "30px", textAlign: "center", color: "#94a3b8" }}>
              No tasks found matching your filter criteria.
            </div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Task ID</th>
                    <th>Description</th>
                    <th>Assigned Officer</th>
                    <th>Deadline</th>
                    <th>Status</th>
                    <th>Update Status</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t) => {
                    const st = staffList.find((s) => s.id === t.assignee_id);
                    const statusClass =
                      t.status === "Completed"
                        ? "badge-success"
                        : t.status === "In Progress"
                        ? "badge-info"
                        : t.status === "On Hold"
                        ? "badge-warning"
                        : "badge-default";

                    return (
                      <tr
                        key={t.id}
                        style={{
                          backgroundColor: t.is_overdue ? "rgba(239, 68, 68, 0.08)" : undefined,
                        }}
                      >
                        <td><strong>#{t.id}</strong></td>
                        <td style={{ maxWidth: "260px" }}>
                          <div style={{ fontWeight: 600, color: "#e2e8f0" }}>{t.description}</div>
                          {t.is_overdue && (
                            <span className="badge badge-danger" style={{ marginTop: "4px" }}>
                              OVERDUE DEADLINE
                            </span>
                          )}
                        </td>
                        <td>
                          <strong>{st?.name || `Staff #${t.assignee_id}`}</strong>
                          <div style={{ fontSize: "11px", color: "#64748b" }}>
                            {st?.service_number} &middot; {st?.designation}
                          </div>
                        </td>
                        <td style={{ fontSize: "12px", color: "#94a3b8" }}>
                          {t.expected_completion
                            ? new Date(t.expected_completion).toLocaleString()
                            : "No deadline"}
                        </td>
                        <td>
                          <span className={`badge ${statusClass}`}>{t.status}</span>
                        </td>
                        <td>
                          <select
                            className="form-control"
                            style={{ fontSize: "12px", padding: "4px 8px", width: "130px" }}
                            value={t.status}
                            onChange={(e) => handleStatusChange(t.id, e.target.value)}
                          >
                            <option value="Not Started">Not Started</option>
                            <option value="In Progress">In Progress</option>
                            <option value="Completed">Completed</option>
                            <option value="On Hold">On Hold</option>
                            <option value="Cancelled">Cancelled</option>
                          </select>
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

      {/* Create Task Modal */}
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
              <span className="card__title">Assign New Special Task</span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowCreateModal(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreateTask} className="card__body">
              <div className="form-group" style={{ marginBottom: "16px" }}>
                <label className="form-label">Task Description</label>
                <textarea
                  className="form-control"
                  required
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Serve NBW in Cr No. 204/2024; VIP Route bundobast at Nagarjuna Circle..."
                />
              </div>

              <div className="form-group" style={{ marginBottom: "16px" }}>
                <label className="form-label">Assignee Officer</label>
                <select
                  className="form-control"
                  required
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                >
                  <option value="">-- Choose Officer --</option>
                  {staffList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.service_number} &middot; {s.designation})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: "20px" }}>
                <label className="form-label">Expected Completion Deadline</label>
                <input
                  type="datetime-local"
                  className="form-control"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                />
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
                  Assign Task
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
