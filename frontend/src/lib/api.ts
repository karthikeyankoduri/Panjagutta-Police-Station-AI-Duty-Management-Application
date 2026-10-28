/**
 * API client for the Panjagutta Duty Management backend.
 * All requests go through /api/ prefix and include JWT auth header.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

export interface LoginResponse {
  access_token: string;
  token_type: string;
  role: string;
  must_change_password: boolean;
  username: string;
}

export interface StaffMember {
  id: number;
  service_number: string;
  name: string;
  designation: string;
  category: string;
  sector_id: number | null;
  section: string | null;
  contact_phone?: string | null;
  is_active: boolean;
  is_demo: boolean;
  date_of_joining: string | null;
  notes: string | null;
  user_id?: number | null;
  user_username?: string | null;
  user_role?: string | null;
}

export interface DashboardSummary {
  date: string;
  shift: string;
  sector_scoped: boolean;
  cards: {
    total_staff: number;
    scheduled_current_shift: number;
    present: number;
    on_duty: number;
    available: number;
    field_duty: number;
    court_duty: number;
    patrol_beat: number;
    on_leave: number;
    duty_off_rest: number;
    attached_other_wing: number;
    official_movement: number;
    absent: number;
    vacant_positions: number;
  };
  staff_status_list: Array<{
    staff_id: number;
    name: string;
    service_number: string;
    designation: string;
    sector_id: number | null;
    status: string;
    reason: string;
    is_conflicting: boolean;
  }>;
}

export interface Alert {
  id: number;
  alert_type: string;
  entity_type: string;
  entity_id: number;
  message: string;
  severity: string;
  created_at: string;
}

export interface LeaveRequest {
  id: number;
  staff_id: number;
  staff_name?: string;
  service_number?: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  status: string;
  reference_number: string | null;
  remarks?: string | null;
  submitted_at: string;
}

export interface Movement {
  id: number;
  staff_id: number;
  staff_name?: string;
  service_number?: string;
  purpose: string;
  destination: string;
  status: string;
  expected_return: string | null;
  actual_departure?: string | null;
  actual_return: string | null;
  is_overdue: boolean;
  created_at?: string;
}

export interface Task {
  id: number;
  description: string;
  assignee_id: number;
  assignee_name?: string;
  status: string;
  is_overdue: boolean;
  expected_completion: string | null;
}

export interface RosterItem {
  id: number;
  roster_date: string;
  shift_code: string;
  version: number;
  status: string;
  change_reason: string | null;
  is_demo_policy: boolean;
  created_at: string;
}

export interface AttachmentItem {
  id: number;
  staff_id: number;
  staff_name?: string;
  service_number?: string;
  parent_unit: string;
  attached_wing: string;
  order_reference: string | null;
  start_date: string;
  expected_end_date: string | null;
  actual_end_date: string | null;
  is_active: boolean;
}

export interface AuditItem {
  id: number;
  timestamp: string;
  actor_username: string;
  action: string;
  entity_type: string;
  entity_id: number | null;
  old_values: any;
  new_values: any;
  request_id: string | null;
  ip_address: string | null;
}

export interface PolicyStatusData {
  policy_status: string;
  is_demo_mode: boolean;
  demo_acknowledgement_text: string | null;
  confirmed_by_id: number | null;
  confirmed_at: string | null;
  min_rest_hours_after_shift: number;
  duty_off_after_shift_b_hours: number;
  rotation_sequence: string;
  notes: string | null;
  shifts: Array<{
    shift_code: string;
    start_time: string;
    end_time: string;
    duration_hours: number;
    crosses_midnight: boolean;
  }>;
}

// ─── Auth ──────────────────────────────────────────────────────────────────

export async function login(username: string, password: string): Promise<LoginResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  } catch (err: unknown) {
    if (err instanceof TypeError && err.message === "Failed to fetch") {
      throw new Error(
        `Cannot reach backend API at ${API_BASE}. Ensure panjagutta_backend is running on port 8000.`
      );
    }
    throw err;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Login failed" }));
    throw new Error(err.detail || "Login failed");
  }
  return res.json();
}

export async function logout(token: string): Promise<void> {
  await fetch(`${API_BASE}/auth/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getMe(token: string) {
  const res = await authFetch(token, "/auth/me");
  return res.json();
}

// ─── Generic authenticated fetch ──────────────────────────────────────────

export async function authFetch(
  token: string,
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  if (res.status === 401) {
    if (typeof window !== "undefined") {
      localStorage.removeItem("token");
      window.location.href = "/login";
    }
  }
  return res;
}

// ─── Dashboard ─────────────────────────────────────────────────────────────

export async function getDashboardSummary(
  token: string,
  date?: string,
  shift?: string
): Promise<DashboardSummary> {
  const params = new URLSearchParams();
  if (date) params.set("for_date", date);
  if (shift) params.set("shift_code", shift);
  const res = await authFetch(token, `/dashboard/summary?${params}`);
  if (!res.ok) throw new Error("Failed to fetch dashboard summary");
  return res.json();
}

export async function getAlerts(token: string): Promise<Alert[]> {
  const res = await authFetch(token, "/dashboard/alerts");
  if (!res.ok) return [];
  return res.json();
}

// ─── Staff ─────────────────────────────────────────────────────────────────

export async function getStaff(
  token: string,
  params?: { sector_id?: number; designation?: string; search?: string; is_active?: boolean }
): Promise<StaffMember[]> {
  const qs = new URLSearchParams();
  if (params?.sector_id) qs.set("sector_id", String(params.sector_id));
  if (params?.designation) qs.set("designation", params.designation);
  if (params?.search) qs.set("search", params.search);
  if (params?.is_active !== undefined) qs.set("is_active", String(params.is_active));
  const res = await authFetch(token, `/staff?${qs}`);
  if (!res.ok) throw new Error("Failed to fetch staff");
  return res.json();
}

export async function createStaff(token: string, data: Partial<StaffMember>): Promise<StaffMember> {
  const res = await authFetch(token, "/staff", { method: "POST", body: JSON.stringify(data) });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to create staff");
  }
  return res.json();
}

export async function updateStaff(
  token: string,
  staffId: number,
  data: Partial<StaffMember> & {
    user_role?: string;
    user_username?: string;
    reset_password?: string;
  }
): Promise<StaffMember> {
  const res = await authFetch(token, `/staff/${staffId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to update staff" }));
    throw new Error(err.detail || "Failed to update staff");
  }
  return res.json();
}

export async function importStaffCsv(
  token: string,
  csvData: string | File
): Promise<{
  success?: boolean;
  message: string;
  imported_count: number;
  imported_new?: number;
  updated_staff?: number;
  total_staff_count: number;
  details?: string[];
  errors?: string[];
  detected_headers?: string[];
}> {
  let res: Response;
  if (typeof csvData === "string") {
    res = await authFetch(token, "/staff/import-csv", {
      method: "POST",
      body: JSON.stringify({ csv_content: csvData }),
    });
  } else {
    const formData = new FormData();
    formData.append("file", csvData);
    res = await fetch(`${API_BASE}/staff/import-csv`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "CSV Import failed" }));
    throw new Error(err.detail || "CSV Import failed");
  }
  return res.json();
}

export async function clearDemoData(
  token: string
): Promise<{ success: boolean; detail: string; admin_retained?: string }> {
  const res = await authFetch(token, "/staff/clear-demo-data", {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to clear demo data" }));
    throw new Error(err.detail || "Failed to clear demo data");
  }
  return res.json();
}

export async function getSectors(token: string) {
  const res = await authFetch(token, "/staff/sectors");
  if (!res.ok) return [];
  return res.json();
}

export async function getDesignations(token: string) {
  const res = await authFetch(token, "/staff/designations");
  if (!res.ok) return [];
  return res.json();
}

// ─── Rosters ───────────────────────────────────────────────────────────────

export async function getRosters(
  token: string,
  params?: { roster_date?: string; shift_code?: string; roster_status?: string }
): Promise<RosterItem[]> {
  const qs = new URLSearchParams();
  if (params?.roster_date) qs.set("roster_date", params.roster_date);
  if (params?.shift_code) qs.set("shift_code", params.shift_code);
  if (params?.roster_status) qs.set("roster_status", params.roster_status);
  const res = await authFetch(token, `/rosters?${qs}`);
  if (!res.ok) return [];
  return res.json();
}

export async function createRoster(token: string, data: any) {
  const res = await authFetch(token, "/rosters/", { method: "POST", body: JSON.stringify(data) });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to create roster");
  }
  return res.json();
}

export async function submitRoster(token: string, rosterId: number) {
  const res = await authFetch(token, `/rosters/${rosterId}/submit`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to submit roster");
  }
  return res.json();
}

export async function approveRoster(token: string, rosterId: number, comments?: string) {
  const qs = comments ? `?comments=${encodeURIComponent(comments)}` : "";
  const res = await authFetch(token, `/rosters/${rosterId}/approve${qs}`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to approve roster");
  }
  return res.json();
}

export async function publishRoster(token: string, rosterId: number) {
  const res = await authFetch(token, `/rosters/${rosterId}/publish`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to publish roster");
  }
  return res.json();
}

// ─── Leave ─────────────────────────────────────────────────────────────────

export async function getLeaveRequests(
  token: string,
  params?: { staff_id?: number; leave_status?: string }
): Promise<LeaveRequest[]> {
  const qs = new URLSearchParams();
  if (params?.staff_id) qs.set("staff_id", String(params.staff_id));
  if (params?.leave_status) qs.set("leave_status", params.leave_status);
  const res = await authFetch(token, `/leave?${qs}`);
  if (!res.ok) return [];
  return res.json();
}

export async function createLeaveRequest(token: string, data: any) {
  const res = await authFetch(token, "/leave/", { method: "POST", body: JSON.stringify(data) });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to submit leave request");
  }
  return res.json();
}

export async function approveLeave(token: string, leaveId: number, remarks?: string) {
  const qs = remarks ? `?remarks=${encodeURIComponent(remarks)}` : "";
  const res = await authFetch(token, `/leave/${leaveId}/approve${qs}`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to approve leave");
  }
  return res.json();
}

export async function rejectLeave(token: string, leaveId: number, remarks?: string) {
  const qs = remarks ? `?remarks=${encodeURIComponent(remarks)}` : "";
  const res = await authFetch(token, `/leave/${leaveId}/reject${qs}`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to reject leave");
  }
  return res.json();
}

// ─── Movements ─────────────────────────────────────────────────────────────

export async function getMovements(
  token: string,
  params?: { staff_id?: number; mov_status?: string }
): Promise<Movement[]> {
  const qs = new URLSearchParams();
  if (params?.staff_id) qs.set("staff_id", String(params.staff_id));
  if (params?.mov_status) qs.set("mov_status", params.mov_status);
  const res = await authFetch(token, `/movements?${qs}`);
  if (!res.ok) return [];
  return res.json();
}

export async function createMovement(token: string, data: any) {
  const res = await authFetch(token, "/movements/", { method: "POST", body: JSON.stringify(data) });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to log movement");
  }
  return res.json();
}

export async function returnMovement(token: string, movementId: number, notes?: string) {
  const res = await authFetch(token, `/movements/${movementId}/return`, {
    method: "POST",
    body: JSON.stringify({ close_notes: notes }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to close movement");
  }
  return res.json();
}

// ─── Tasks ─────────────────────────────────────────────────────────────────

export async function getTasks(
  token: string,
  params?: { assignee_id?: number; task_status?: string; overdue_only?: boolean }
): Promise<Task[]> {
  const qs = new URLSearchParams();
  if (params?.assignee_id) qs.set("assignee_id", String(params.assignee_id));
  if (params?.task_status) qs.set("task_status", params.task_status);
  if (params?.overdue_only) qs.set("overdue_only", "true");
  const res = await authFetch(token, `/tasks?${qs}`);
  if (!res.ok) return [];
  return res.json();
}

export async function createTask(token: string, data: any) {
  const res = await authFetch(token, "/tasks/", { method: "POST", body: JSON.stringify(data) });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to create task");
  }
  return res.json();
}

export async function updateTaskStatus(token: string, taskId: number, newStatus: string) {
  const res = await authFetch(token, `/tasks/${taskId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ new_status: newStatus }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to update task status");
  }
  return res.json();
}

// ─── Attendance ────────────────────────────────────────────────────────────

export async function getAttendance(
  token: string,
  params?: { attendance_date?: string; shift_code?: string }
) {
  const qs = new URLSearchParams();
  if (params?.attendance_date) qs.set("attendance_date", params.attendance_date);
  if (params?.shift_code) qs.set("shift_code", params.shift_code);
  const res = await authFetch(token, `/attendance?${qs}`);
  if (!res.ok) return [];
  return res.json();
}

export async function markAttendance(token: string, data: any) {
  const res = await authFetch(token, "/attendance/mark", { method: "POST", body: JSON.stringify(data) });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to record attendance");
  }
  return res.json();
}

// ─── Attachments ───────────────────────────────────────────────────────────

export async function getAttachments(
  token: string,
  activeOnly: boolean = true
): Promise<AttachmentItem[]> {
  const res = await authFetch(token, `/attachments?active_only=${activeOnly}`);
  if (!res.ok) return [];
  return res.json();
}

export async function createAttachment(token: string, data: any) {
  const res = await authFetch(token, "/attachments/", { method: "POST", body: JSON.stringify(data) });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to create attachment");
  }
  return res.json();
}

export async function endAttachment(token: string, attachmentId: number, data: any) {
  const res = await authFetch(token, `/attachments/${attachmentId}/end`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to end attachment");
  }
  return res.json();
}

// ─── Policy ────────────────────────────────────────────────────────────────

export async function getPolicyStatus(token: string): Promise<PolicyStatusData> {
  const res = await authFetch(token, "/policy/");
  if (!res.ok) throw new Error("Failed to fetch policy status");
  return res.json();
}

export async function confirmPolicy(token: string, data: any) {
  const res = await authFetch(token, "/policy/confirm", { method: "POST", body: JSON.stringify(data) });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to confirm policy");
  }
  return res.json();
}

export async function enableDemoMode(token: string) {
  const res = await authFetch(token, "/policy/demo-mode", { method: "POST", body: JSON.stringify({}) });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to activate demo mode");
  }
  return res.json();
}

// ─── Reports ───────────────────────────────────────────────────────────────

export async function getShiftEndReport(token: string, reportDate?: string, shiftCode?: string) {
  const qs = new URLSearchParams();
  if (reportDate) qs.set("report_date", reportDate);
  if (shiftCode) qs.set("shift_code", shiftCode);
  const res = await authFetch(token, `/reports/shift-end?${qs}`);
  if (!res.ok) throw new Error("Failed to generate shift-end report");
  return res.json();
}

export async function getDailyVacancyReport(token: string, reportDate?: string) {
  const qs = new URLSearchParams();
  if (reportDate) qs.set("report_date", reportDate);
  const res = await authFetch(token, `/reports/daily-vacancy?${qs}`);
  if (!res.ok) throw new Error("Failed to generate vacancy report");
  return res.json();
}

export function getExportUrl(reportType: string, date?: string, shift?: string) {
  const qs = new URLSearchParams();
  qs.set("report_type", reportType);
  if (date) qs.set("report_date", date);
  if (shift) qs.set("shift_code", shift);
  return `${API_BASE}/reports/export?${qs}`;
}

// ─── Audit ─────────────────────────────────────────────────────────────────

export async function getAuditLogs(
  token: string,
  params?: { actor?: string; action?: string; entity?: string }
): Promise<AuditItem[]> {
  const qs = new URLSearchParams();
  if (params?.actor) qs.set("actor_username", params.actor);
  if (params?.action) qs.set("action", params.action);
  if (params?.entity) qs.set("entity_type", params.entity);
  const res = await authFetch(token, `/audit?${qs}`);
  if (!res.ok) return [];
  return res.json();
}

// ─── AI Advisory ───────────────────────────────────────────────────────────

export async function explainRoster(token: string, rosterId?: number) {
  const res = await authFetch(token, "/ai/explain-roster", {
    method: "POST",
    body: JSON.stringify({ roster_id: rosterId }),
  });
  if (!res.ok) throw new Error("Failed to generate roster explanation");
  return res.json();
}

export async function askAI(token: string, query: string) {
  const res = await authFetch(token, "/ai/query", {
    method: "POST",
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error("Failed to process query");
  return res.json();
}
