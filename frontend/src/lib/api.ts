/**
 * API client for the Panjagutta Duty Management backend.
 * All requests go through the /api prefix and include the JWT auth header.
 */

export function getApiBase(): string {
  // Behind the HTTPS proxy the API is same-origin ("/api"); set NEXT_PUBLIC_API_URL at build time.
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== "undefined") {
    if (configured) {
      return configured.startsWith("/") ? `${window.location.origin}${configured}` : configured;
    }
    // Local development: API on port 8000 of the same host.
    return `${window.location.protocol}//${window.location.hostname}:8000/api`;
  }
  return configured && !configured.startsWith("/") ? configured : "http://localhost:8000/api";
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LoginResponse {
  access_token: string;
  token_type: string;
  role: string;
  must_change_password: boolean;
  username: string;
  sector_id?: number | null;
  is_demo?: boolean;
  session_timeout_minutes?: number;
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
  reporting_officer_id?: number | null;
  attached_to?: string | null;
  attachment_order?: string | null;
  attachment_until?: string | null;
  is_active: boolean;
  is_demo: boolean;
  date_of_joining: string | null;
  notes: string | null;
  user_id?: number | null;
  user_username?: string | null;
  user_role?: string | null;
}

export interface StaffStatusRow {
  staff_id: number;
  name: string;
  service_number: string;
  designation: string;
  category?: string;
  sector_id: number | null;
  section?: string | null;
  status: string;
  reason: string;
  is_conflicting: boolean;
  conflict_detail?: string | null;
  duty_category?: string | null;
  duty_section?: string | null;
  assigned_shift?: string | null;
  attendance_confirmed?: boolean;
  rest_until?: string | null;
}

export type CardKey =
  | "total_staff" | "scheduled_current_shift" | "present" | "on_duty" | "available" | "field_duty"
  | "court_duty" | "patrol_beat" | "on_leave" | "duty_off_rest" | "attached_other_wing"
  | "official_movement" | "absent" | "vacant_positions" | "emergency_deployment" | "shift_change_pending";

export interface DashboardSummary {
  date: string;
  shift: string;
  current_shift?: { code: string; date: string; time: string };
  focus_shift?: string | null;
  sector_scoped: boolean;
  cards: Record<CardKey, number>;
  card_members?: Partial<Record<CardKey, number[]>>;
  exclusive_cards?: string[];
  staff_status_list: StaffStatusRow[];
}

export interface DashboardFilters {
  designation?: string;
  sector_id?: number;
  section?: string;
  category?: string;
  duty_category?: string;
  status?: string;
}

export interface VacancyRow {
  date: string;
  shift_code: string;
  duty_master_id: number;
  category: string;
  section: string | null;
  required: number;
  allocated: number;
  vacant: number;
  roster_id: number | null;
  roster_published: boolean;
}

export interface DeploymentRow {
  staff_id: number;
  name: string;
  service_number: string;
  designation: string;
  sector_id: number | null;
  duty: string;
  section: string | null;
  notes: string | null;
}

export interface DashboardViews {
  current: { date: string; shift_code: string; time: string; roster_id: number | null; roster_version: number | null; deployment: DeploymentRow[] };
  upcoming: { date: string; shift_code: string; time: string; roster_id: number | null; roster_version: number | null; deployment: DeploymentRow[]; vacancies: VacancyRow[] };
  rest: Array<{ staff_id: number; name: string; service_number: string; reason: string; rest_until: string | null }>;
  vacancy: { rows: VacancyRow[]; total_required: number; total_allocated: number; total_vacant: number; shortages: VacancyRow[] };
}

export interface Alert {
  id: number;
  alert_type: string;
  entity_type: string;
  entity_id: number;
  message: string;
  severity: string;
  is_resolved?: boolean;
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
  days?: number;
  status: string;
  reference_number: string | null;
  remarks?: string | null;
  approver_username?: string | null;
  approver_remarks?: string | null;
  decision_at?: string | null;
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
  reference_remarks?: string | null;
  expected_return: string | null;
  actual_departure?: string | null;
  actual_return: string | null;
  authorized_at?: string | null;
  authorizing_officer?: string | null;
  closed_by?: string | null;
  close_notes?: string | null;
  is_overdue: boolean;
  created_at?: string;
}

export interface Task {
  id: number;
  description: string;
  category?: string;
  category_label?: string;
  custom_title?: string | null;
  group_title?: string;
  assignee_id: number;
  assignee_name?: string;
  assignee_service_number?: string;
  assignee_sector_id?: number | null;
  reporting_officer_id?: number | null;
  reporting_officer_name?: string | null;
  status: string;
  is_overdue: boolean;
  start_time?: string | null;
  expected_completion: string | null;
  actual_completion?: string | null;
  created_at?: string;
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
  is_latest?: boolean;
  assignment_count?: number;
  prepared_by?: string | null;
  approved_by?: string | null;
}

export interface DutyItem {
  id: number;
  category: string;
  section?: string;
  shift_code?: string;
  required_strength?: number;
  eligible_designations?: string[];
  description?: string;
  is_active: boolean;
  is_configured: boolean;
}

export interface RosterAssignmentItem {
  id: number;
  duty_master_id: number;
  duty_category: string;
  duty_section?: string;
  staff_id: number;
  staff_name: string;
  service_number: string;
  designation: string;
  sector_id?: number;
  notes?: string;
  is_exception: boolean;
  exception_reason?: string;
  exception_authorized_by_id?: number;
  exception_authorized_by?: string | null;
}

export interface RosterDetail extends RosterItem {
  prepared_by_id?: number;
  modified_by_id?: number;
  modified_by?: string | null;
  approved_by_id?: number;
  approved_at?: string | null;
  approval_comments?: string | null;
  published_at?: string;
  assignments: RosterAssignmentItem[];
  total_assigned: number;
  total_vacancies: number;
  vacancies_by_duty?: Array<{ duty_master_id: number; category: string; section: string | null; required: number; allocated: number; vacant: number }>;
  warnings: string[];
}

export interface ValidationIssue {
  code: string;
  message: string;
  staff_id: number | null;
  duty_master_id: number | null;
  index: number | null;
  blocking: boolean;
  overridden: boolean;
  severity: "violation" | "warning";
}

export interface ValidationResult {
  issues: ValidationIssue[];
  warnings: string[];
  blocking_count: number;
  can_save: boolean;
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
  reporting_officer_id?: number | null;
  reporting_officer_name?: string | null;
  end_authority?: string | null;
  is_past_expected_end?: boolean;
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
  authorizer_username?: string | null;
  exception_reason?: string | null;
  request_id: string | null;
  ip_address: string | null;
}

export interface ShiftInfo {
  shift_code: string;
  start_time: string;
  end_time: string;
  duration_hours: number;
  crosses_midnight: boolean;
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
  permitted_exceptions?: string | null;
  exception_authorizer_role?: string | null;
  effective_from?: string | null;
  version?: number | null;
  notes: string | null;
  shifts: ShiftInfo[];
}

export interface NotificationItem {
  id: number;
  title: string;
  message: string;
  category: string;
  entity_type: string | null;
  entity_id: number | null;
  is_read: boolean;
  created_at: string;
}

export interface InboxData {
  counts: { rosters: number; leave: number; movements: number; alerts: number; total: number };
  rosters: Array<{ id: number; date: string; shift_code: string; version: number; change_reason: string | null; waiting_since: string | null }>;
  leave: Array<{ id: number; staff_id: number; staff_name?: string; service_number?: string; leave_type: string; start_date: string; end_date: string; reference_number: string | null; submitted_at: string | null }>;
  movements: Array<{ id: number; staff_id: number; staff_name?: string; service_number?: string; destination: string; purpose: string; expected_return: string | null }>;
  alerts: Alert[];
}

export interface Sector { id: number; name: string; code: string; description: string | null; is_active: boolean; staff_count?: number }
export interface SectionItem { id: number; name: string; description: string | null; is_active: boolean }
export interface ListItem { id: number; code: string; label: string; description: string | null; sort_order: number; is_active: boolean }

// ─── Errors ─────────────────────────────────────────────────────────────────

/** Error carrying the server's structured detail (e.g. roster validation issues). */
export class ApiError extends Error {
  status: number;
  detail: any;
  constructor(message: string, status: number, detail: any) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export function formatApiError(err: any, defaultMessage: string = "Request failed"): string {
  if (!err) return defaultMessage;
  if (typeof err === "string") return err;
  if (typeof err.detail === "string") return err.detail;
  if (Array.isArray(err.detail)) {
    const messages = err.detail.map((item: any) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const field = Array.isArray(item.loc)
          ? item.loc.filter((part: any) => part !== "body").join(".")
          : "";
        const msg = item.msg || JSON.stringify(item);
        return field ? `${field}: ${msg}` : msg;
      }
      return String(item);
    });
    return messages.join("; ") || defaultMessage;
  }
  if (err.detail && typeof err.detail === "object") {
    return err.detail.message || err.detail.msg || JSON.stringify(err.detail);
  }
  if (typeof err.message === "string") return err.message;
  return defaultMessage;
}

async function ensureOk(res: Response, fallback: string): Promise<Response> {
  if (res.ok) return res;
  const body = await res.json().catch(() => ({ detail: fallback }));
  throw new ApiError(formatApiError(body, fallback), res.status, body?.detail);
}

async function json<T = any>(res: Response, fallback: string): Promise<T> {
  await ensureOk(res, fallback);
  return res.json();
}

// ─── Auth ───────────────────────────────────────────────────────────────────

export async function login(username: string, password: string): Promise<LoginResponse> {
  let res: Response;
  try {
    res = await fetch(`${getApiBase()}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  } catch (err: unknown) {
    if (err instanceof TypeError) {
      throw new Error(`Cannot reach the duty management server (${getApiBase()}). Check the network or contact IT.`);
    }
    throw err;
  }
  return json(res, "Login failed");
}

export async function logout(token: string): Promise<void> {
  await fetch(`${getApiBase()}/auth/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getMe(token: string) {
  const res = await authFetch(token, "/auth/me");
  return json(res, "Failed to load profile");
}

export async function changePassword(token: string, currentPassword: string, newPassword: string) {
  const res = await authFetch(token, "/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
  return json(res, "Failed to change password");
}

export async function saveDraft(token: string, key: string, payload: any) {
  const res = await authFetch(token, "/auth/drafts", { method: "PUT", body: JSON.stringify({ key, payload }) });
  return res.ok;
}

export async function loadDraft<T = any>(token: string, key: string): Promise<T | null> {
  const res = await authFetch(token, `/auth/drafts/${encodeURIComponent(key)}`);
  if (!res.ok) return null;
  return (await res.json()).payload ?? null;
}

// ─── Generic authenticated fetch ────────────────────────────────────────────

export async function authFetch(token: string, path: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${getApiBase()}${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  if (typeof window !== "undefined") {
    if (res.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      const reason = res.headers.get("WWW-Authenticate") ? "" : "?expired=1";
      window.location.href = `/login${reason}`;
    } else if (res.status === 403 && res.headers.get("X-Password-Change-Required") && !window.location.pathname.startsWith("/change-password")) {
      window.location.href = "/change-password";
    }
  }
  return res;
}

/** Download a file from an authenticated endpoint (no token in the URL). */
export async function downloadFile(token: string, path: string, fallbackName: string) {
  const res = await ensureOk(await authFetch(token, path), "Download failed");
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^";]+)"?/);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = match ? match[1] : fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ─── Dashboard / inbox / notifications ──────────────────────────────────────

export async function getDashboardSummary(
  token: string,
  date?: string,
  shift?: string,
  filters?: DashboardFilters
): Promise<DashboardSummary> {
  const params = new URLSearchParams();
  if (date) params.set("for_date", date);
  if (shift) params.set("shift_code", shift);
  Object.entries(filters || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  });
  const res = await authFetch(token, `/dashboard/summary?${params}`);
  return json(res, "Failed to fetch dashboard summary");
}

export async function getDashboardViews(token: string, date?: string, shift?: string): Promise<DashboardViews> {
  const params = new URLSearchParams();
  if (date) params.set("for_date", date);
  if (shift) params.set("shift_code", shift);
  return json(await authFetch(token, `/dashboard/views?${params}`), "Failed to load shift views");
}

export async function getAlerts(token: string): Promise<Alert[]> {
  const res = await authFetch(token, "/dashboard/alerts");
  if (!res.ok) return [];
  return res.json();
}

export async function resolveAlert(token: string, alertId: number) {
  return json(await authFetch(token, `/dashboard/alerts/${alertId}/resolve`, { method: "POST" }), "Failed to resolve alert");
}

export async function getInbox(token: string): Promise<InboxData> {
  return json(await authFetch(token, "/dashboard/inbox"), "Failed to load approvals inbox");
}

export async function getNotifications(token: string): Promise<{ unread: number; items: NotificationItem[] }> {
  const res = await authFetch(token, "/notifications/");
  if (!res.ok) return { unread: 0, items: [] };
  return res.json();
}

export async function markNotificationRead(token: string, id: number) {
  await authFetch(token, `/notifications/${id}/read`, { method: "POST" });
}

export async function markAllNotificationsRead(token: string) {
  await authFetch(token, "/notifications/read-all", { method: "POST" });
}

// ─── Staff ──────────────────────────────────────────────────────────────────

export async function getStaff(
  token: string,
  params?: { sector_id?: number; designation?: string; search?: string; is_active?: boolean; section?: string; category?: string; attached?: boolean }
): Promise<StaffMember[]> {
  const qs = new URLSearchParams();
  if (params?.sector_id) qs.set("sector_id", String(params.sector_id));
  if (params?.designation) qs.set("designation", params.designation);
  if (params?.search) qs.set("search", params.search);
  if (params?.section) qs.set("section", params.section);
  if (params?.category) qs.set("category", params.category);
  if (params?.attached !== undefined) qs.set("attached", String(params.attached));
  if (params?.is_active !== undefined) qs.set("is_active", String(params.is_active));
  return json(await authFetch(token, `/staff/?${qs}`), "Failed to fetch staff");
}

export async function createStaff(token: string, data: Partial<StaffMember>): Promise<StaffMember> {
  return json(await authFetch(token, "/staff/", { method: "POST", body: JSON.stringify(data) }), "Failed to create staff");
}

export async function updateStaff(
  token: string,
  staffId: number,
  data: Partial<StaffMember> & { user_role?: string; user_username?: string; reset_password?: string }
): Promise<StaffMember> {
  return json(await authFetch(token, `/staff/${staffId}`, { method: "PATCH", body: JSON.stringify(data) }), "Failed to update staff");
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
    res = await authFetch(token, "/staff/import-csv", { method: "POST", body: JSON.stringify({ csv_content: csvData }) });
  } else {
    const formData = new FormData();
    formData.append("file", csvData);
    res = await authFetch(token, "/staff/import-csv", { method: "POST", body: formData });
  }
  return json(res, "CSV Import failed");
}

export async function downloadStaffTemplate(token: string) {
  return downloadFile(token, "/staff/download-template", "panjagutta_staff_template.csv");
}

export async function clearDemoData(token: string): Promise<{ success: boolean; detail: string; admin_retained?: string }> {
  return json(await authFetch(token, "/staff/clear-demo-data", { method: "POST" }), "Failed to clear demo data");
}

// ─── Configuration ──────────────────────────────────────────────────────────

export async function getSectors(token: string): Promise<Sector[]> {
  const res = await authFetch(token, "/config/sectors");
  if (!res.ok) return [];
  return res.json();
}

export async function saveSector(token: string, data: Partial<Sector>, id?: number) {
  return json(await authFetch(token, id ? `/config/sectors/${id}` : "/config/sectors", {
    method: id ? "PATCH" : "POST", body: JSON.stringify(data),
  }), "Failed to save sector");
}

export async function getSections(token: string): Promise<SectionItem[]> {
  const res = await authFetch(token, "/config/sections");
  if (!res.ok) return [];
  return res.json();
}

export async function saveSection(token: string, data: Partial<SectionItem>, id?: number) {
  return json(await authFetch(token, id ? `/config/sections/${id}` : "/config/sections", {
    method: id ? "PATCH" : "POST", body: JSON.stringify(data),
  }), "Failed to save section");
}

export async function getConfigLists(token: string): Promise<Record<string, ListItem[]>> {
  const res = await authFetch(token, "/config/lists");
  if (!res.ok) return {};
  return res.json();
}

export async function updateListItem(token: string, id: number, data: Partial<ListItem>) {
  return json(await authFetch(token, `/config/lists/items/${id}`, { method: "PATCH", body: JSON.stringify(data) }), "Failed to update list item");
}

export async function addListItem(token: string, listName: string, data: { code: string; label: string; description?: string; sort_order?: number }) {
  return json(await authFetch(token, `/config/lists/${listName}`, { method: "POST", body: JSON.stringify(data) }), "Failed to add list item");
}

/** Show or hide dashboard KPI cards in one save (SHO, Admin SI, Super Admin). */
export async function setDashboardCards(token: string, cards: Record<string, boolean>) {
  return json(await authFetch(token, "/config/dashboard-cards", { method: "PUT", body: JSON.stringify({ cards }) }), "Failed to save dashboard cards");
}

export interface MyProfile {
  id: number;
  username: string;
  role: string;
  email?: string | null;
  is_active: boolean;
  is_demo: boolean;
  sector_id: number | null;
  sector_name: string | null;
  staff_id: number | null;
  staff_name: string | null;
  service_number: string | null;
  designation?: string;
  category?: string;
  section?: string | null;
  contact_phone?: string | null;
  reporting_officer?: string | null;
  date_of_joining?: string | null;
  last_login: string | null;
  member_since: string | null;
  session_timeout_minutes?: number;
}

export async function getMyProfile(token: string): Promise<MyProfile> {
  return json(await authFetch(token, "/auth/me"), "Failed to load profile");
}

/** Card keys the admin has switched off; an empty or missing list means every card is shown. */
export function hiddenDashboardCards(lists: Record<string, ListItem[]>): Set<string> {
  return new Set((lists.dashboard_card || []).filter((c) => !c.is_active).map((c) => c.code));
}

export async function getAuthorizers(token: string): Promise<Array<{ user_id: number; username: string; role: string; name: string; is_self: boolean }>> {
  const res = await authFetch(token, "/config/authorizers");
  if (!res.ok) return [];
  return res.json();
}

export async function getDesignations(token: string): Promise<ListItem[]> {
  return (await getConfigLists(token)).designation || [];
}

// ─── Rosters ────────────────────────────────────────────────────────────────

export async function getRosters(
  token: string,
  params?: { roster_date?: string; shift_code?: string; roster_status?: string; start_date?: string; end_date?: string }
): Promise<RosterItem[]> {
  const qs = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => v && qs.set(k, String(v)));
  const res = await authFetch(token, `/rosters/?${qs}`);
  if (!res.ok) return [];
  return res.json();
}

export async function getRosterCalendar(token: string, start: string, end: string): Promise<{ cells: Array<RosterItem & { date: string }> }> {
  return json(await authFetch(token, `/rosters/calendar?start_date=${start}&end_date=${end}`), "Failed to load roster calendar");
}

export async function getRosterVersions(token: string, rosterId: number): Promise<RosterItem[]> {
  return json(await authFetch(token, `/rosters/${rosterId}/versions`), "Failed to load versions");
}

export async function createRoster(token: string, data: any) {
  return json(await authFetch(token, "/rosters/", { method: "POST", body: JSON.stringify(data) }), "Failed to create roster");
}

export async function validateRoster(token: string, data: { roster_date: string; shift_code: string; assignments: any[] }): Promise<ValidationResult> {
  return json(await authFetch(token, "/rosters/validate", { method: "POST", body: JSON.stringify(data) }), "Validation failed");
}

export async function submitRoster(token: string, rosterId: number) {
  return json(await authFetch(token, `/rosters/${rosterId}/submit`, { method: "POST" }), "Failed to submit roster");
}

export async function approveRoster(token: string, rosterId: number, comments?: string) {
  return json(await authFetch(token, `/rosters/${rosterId}/approve`, { method: "POST", body: JSON.stringify({ comments }) }), "Failed to approve roster");
}

export async function rejectRoster(token: string, rosterId: number, comments: string) {
  return json(await authFetch(token, `/rosters/${rosterId}/reject`, { method: "POST", body: JSON.stringify({ comments }) }), "Failed to return roster");
}

export async function reviseRoster(token: string, rosterId: number, changeReason: string) {
  return json(await authFetch(token, `/rosters/${rosterId}/revise`, { method: "POST", body: JSON.stringify({ change_reason: changeReason }) }), "Failed to create new version");
}

export async function publishRoster(token: string, rosterId: number) {
  return json(await authFetch(token, `/rosters/${rosterId}/publish`, { method: "POST" }), "Failed to publish roster");
}

export async function getRosterDetail(token: string, rosterId: number): Promise<RosterDetail> {
  return json(await authFetch(token, `/rosters/${rosterId}`), "Failed to load roster details");
}

export async function getActiveDraft(token: string, rosterDate: string, shiftCode: string): Promise<{ roster: RosterDetail | null }> {
  const qs = new URLSearchParams({ roster_date: rosterDate, shift_code: shiftCode });
  const res = await authFetch(token, `/rosters/active-draft?${qs}`);
  if (!res.ok) return { roster: null };
  return res.json();
}

export async function updateRosterAssignments(token: string, rosterId: number, data: { change_reason?: string; assignments: any[] }) {
  return json(await authFetch(token, `/rosters/${rosterId}/assignments`, { method: "PUT", body: JSON.stringify(data) }), "Failed to save duty assignments");
}

// ─── Duty Change Requests ──────────────────────────────────────────────────

export interface DutyChangeRequest {
  id: number;
  roster_id: number;
  roster_assignment_id?: number | null;
  staff_id: number;
  officer_name: string;
  service_number: string;
  current_shift_code: string;
  current_duty_category?: string | null;
  current_roster_date: string;
  requested_shift_code?: string | null;
  requested_duty_category?: string | null;
  reason: string;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  reviewer_remarks?: string | null;
  submitted_at: string;
}

export async function getDutyChangeRequests(token: string, params?: { status?: string }): Promise<DutyChangeRequest[]> {
  const qs = params?.status ? `?status=${params.status}` : "";
  const res = await authFetch(token, `/rosters/change-requests/${qs}`);
  if (!res.ok) return [];
  return res.json();
}

export async function submitDutyChangeRequest(
  token: string,
  data: {
    roster_id: number;
    roster_assignment_id?: number | null;
    current_shift_code: string;
    current_duty_category?: string | null;
    current_roster_date: string;
    requested_shift_code?: string | null;
    requested_duty_category?: string | null;
    reason: string;
  }
): Promise<DutyChangeRequest> {
  return json(await authFetch(token, "/rosters/change-requests/", { method: "POST", body: JSON.stringify(data) }), "Failed to submit duty change request");
}

export async function approveDutyChangeRequest(token: string, id: number, remarks?: string): Promise<DutyChangeRequest> {
  return json(await authFetch(token, `/rosters/change-requests/${id}/approve`, { method: "POST", body: JSON.stringify({ remarks }) }), "Failed to approve request");
}

export async function rejectDutyChangeRequest(token: string, id: number, remarks: string): Promise<DutyChangeRequest> {
  return json(await authFetch(token, `/rosters/change-requests/${id}/reject`, { method: "POST", body: JSON.stringify({ remarks }) }), "Failed to reject request");
}

export async function withdrawDutyChangeRequest(token: string, id: number): Promise<void> {
  await authFetch(token, `/rosters/change-requests/${id}`, { method: "DELETE" });
}

// ─── Duty Master ────────────────────────────────────────────────────────────

export async function getDuties(token: string, params?: { shift_code?: string; section?: string; active_only?: boolean }): Promise<DutyItem[]> {
  const qs = new URLSearchParams();
  if (params?.shift_code) qs.set("shift_code", params.shift_code);
  if (params?.section) qs.set("section", params.section);
  if (params?.active_only !== undefined) qs.set("active_only", String(params.active_only));
  const res = await authFetch(token, `/duties/?${qs}`);
  if (!res.ok) return [];
  return res.json();
}

export async function updateDuty(token: string, dutyId: number, data: any) {
  return json(await authFetch(token, `/duties/${dutyId}`, { method: "PATCH", body: JSON.stringify(data) }), "Failed to update duty");
}

export async function createDuty(token: string, data: any) {
  return json(await authFetch(token, "/duties/", { method: "POST", body: JSON.stringify(data) }), "Failed to create duty");
}

// ─── Leave ──────────────────────────────────────────────────────────────────

export async function getLeaveRequests(token: string, params?: { staff_id?: number; leave_status?: string }): Promise<LeaveRequest[]> {
  const qs = new URLSearchParams();
  if (params?.staff_id) qs.set("staff_id", String(params.staff_id));
  if (params?.leave_status) qs.set("leave_status", params.leave_status);
  const res = await authFetch(token, `/leave/?${qs}`);
  if (!res.ok) return [];
  return res.json();
}

export async function createLeaveRequest(token: string, data: any) {
  return json(await authFetch(token, "/leave/", { method: "POST", body: JSON.stringify(data) }), "Failed to submit leave request");
}

export async function approveLeave(token: string, leaveId: number, remarks?: string) {
  return json(await authFetch(token, `/leave/${leaveId}/approve`, { method: "POST", body: JSON.stringify({ remarks }) }), "Failed to approve leave");
}

export async function rejectLeave(token: string, leaveId: number, remarks?: string) {
  return json(await authFetch(token, `/leave/${leaveId}/reject`, { method: "POST", body: JSON.stringify({ remarks }) }), "Failed to reject leave");
}

export async function cancelLeave(token: string, leaveId: number, remarks?: string) {
  return json(await authFetch(token, `/leave/${leaveId}/cancel`, { method: "POST", body: JSON.stringify({ remarks }) }), "Failed to cancel leave");
}

export async function getLeaveImpact(token: string, leaveId: number): Promise<{ affected_assignments: Array<{ roster_id: number; date: string; shift: string; version: number; status: string; duty: string | null }>; vacancies_if_approved: number }> {
  return json(await authFetch(token, `/leave/${leaveId}/impact`), "Failed to load leave impact");
}

// ─── Movements ──────────────────────────────────────────────────────────────

export async function getMovements(token: string, params?: { staff_id?: number; mov_status?: string }): Promise<Movement[]> {
  const qs = new URLSearchParams();
  if (params?.staff_id) qs.set("staff_id", String(params.staff_id));
  if (params?.mov_status) qs.set("mov_status", params.mov_status);
  const res = await authFetch(token, `/movements/?${qs}`);
  if (!res.ok) return [];
  return res.json();
}

export async function createMovement(token: string, data: any) {
  return json(await authFetch(token, "/movements/", { method: "POST", body: JSON.stringify(data) }), "Failed to log movement");
}

export async function authorizeMovement(token: string, movementId: number) {
  return json(await authFetch(token, `/movements/${movementId}/authorize`, { method: "POST" }), "Failed to authorize movement");
}

export async function rejectMovement(token: string, movementId: number, notes?: string) {
  return json(await authFetch(token, `/movements/${movementId}/reject`, { method: "POST", body: JSON.stringify({ notes }) }), "Failed to reject movement");
}

export async function cancelMovement(token: string, movementId: number, notes?: string) {
  return json(await authFetch(token, `/movements/${movementId}/cancel`, { method: "POST", body: JSON.stringify({ notes }) }), "Failed to cancel movement");
}

export async function returnMovement(token: string, movementId: number, notes?: string) {
  return json(await authFetch(token, `/movements/${movementId}/return`, { method: "POST", body: JSON.stringify({ close_notes: notes }) }), "Failed to close movement");
}

// ─── Tasks ──────────────────────────────────────────────────────────────────

export async function getTasks(token: string, params?: { assignee_id?: number; task_status?: string; overdue_only?: boolean; category?: string }): Promise<Task[]> {
  const qs = new URLSearchParams();
  if (params?.assignee_id) qs.set("assignee_id", String(params.assignee_id));
  if (params?.task_status) qs.set("task_status", params.task_status);
  if (params?.overdue_only) qs.set("overdue_only", "true");
  if (params?.category) qs.set("category", params.category);
  const res = await authFetch(token, `/tasks/?${qs}`);
  if (!res.ok) return [];
  return res.json();
}

export async function getCurrentTasks(token: string): Promise<Task[]> {
  const res = await authFetch(token, "/tasks/current");
  if (!res.ok) return [];
  return res.json();
}

export async function createTask(token: string, data: any) {
  return json(await authFetch(token, "/tasks/", { method: "POST", body: JSON.stringify(data) }), "Failed to create task");
}

export async function updateTask(token: string, taskId: number, data: any) {
  return json(await authFetch(token, `/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(data) }), "Failed to update task");
}

export async function updateTaskStatus(token: string, taskId: number, newStatus: string) {
  return json(await authFetch(token, `/tasks/${taskId}/status`, { method: "PATCH", body: JSON.stringify({ new_status: newStatus }) }), "Failed to update task status");
}

// ─── Attendance ─────────────────────────────────────────────────────────────

export async function getAttendance(
  token: string,
  params?: { attendance_date?: string; shift_code?: string; start_date?: string; end_date?: string; staff_id?: number; own_only?: boolean }
) {
  const qs = new URLSearchParams();
  if (params?.attendance_date) qs.set("attendance_date", params.attendance_date);
  if (params?.shift_code) qs.set("shift_code", params.shift_code);
  if (params?.start_date) qs.set("start_date", params.start_date);
  if (params?.end_date) qs.set("end_date", params.end_date);
  if (params?.staff_id) qs.set("staff_id", String(params.staff_id));
  if (params?.own_only) qs.set("own_only", "true");
  const res = await authFetch(token, `/attendance/?${qs}`);
  if (!res.ok) return [];
  return res.json();
}

export async function getCurrentShift(token: string): Promise<{ shift_code: string; date: string }> {
  return json(await authFetch(token, "/attendance/current-shift"), "Failed to load the current shift");
}

export async function getScheduledVsConfirmed(token: string, date: string, shift: string) {
  return json(await authFetch(token, `/attendance/scheduled?attendance_date=${date}&shift_code=${shift}`), "Failed to load scheduled attendance");
}

/** The signed-in officer's own published duties (works for any role linked to a staff profile). */
export async function getMyDuties(token: string) {
  const res = await authFetch(token, "/mobile/rosters");
  if (!res.ok) return [];
  return res.json();
}

// ─── Attachments ────────────────────────────────────────────────────────────

export async function getAttachments(token: string, activeOnly: boolean = true): Promise<AttachmentItem[]> {
  const res = await authFetch(token, `/attachments/?active_only=${activeOnly}`);
  if (!res.ok) return [];
  return res.json();
}

export async function createAttachment(token: string, data: any) {
  return json(await authFetch(token, "/attachments/", { method: "POST", body: JSON.stringify(data) }), "Failed to create attachment");
}

export async function endAttachment(token: string, attachmentId: number, data: any) {
  return json(await authFetch(token, `/attachments/${attachmentId}/end`, { method: "POST", body: JSON.stringify(data) }), "Failed to end attachment");
}

// ─── Policy ─────────────────────────────────────────────────────────────────

export async function getPolicyStatus(token: string): Promise<PolicyStatusData> {
  return json(await authFetch(token, "/policy/"), "Failed to fetch policy status");
}

export async function confirmPolicy(token: string, data: any) {
  return json(await authFetch(token, "/policy/confirm", { method: "POST", body: JSON.stringify(data) }), "Failed to confirm policy");
}

export async function enableDemoMode(token: string) {
  return json(await authFetch(token, "/policy/demo-mode", { method: "POST", body: JSON.stringify({}) }), "Failed to activate demo mode");
}

export async function updateShiftConfig(token: string, shiftCode: string, data: { start_time: string; end_time: string; duration_hours?: number }) {
  return json(await authFetch(token, `/policy/shifts/${shiftCode}`, {
    method: "PUT", body: JSON.stringify({ shift_code: shiftCode, ...data }),
  }), "Failed to update shift timings");
}

/** "A · 08:00–14:00" labels from the configured shift table (never hard-coded). */
export function shiftLabels(shifts: ShiftInfo[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  (shifts || []).forEach((s) => { out[s.shift_code] = `${s.start_time}–${s.end_time}`; });
  return out;
}

// ─── Reports ────────────────────────────────────────────────────────────────

export async function getShiftEndReport(token: string, reportDate?: string, shiftCode?: string) {
  const qs = new URLSearchParams();
  if (reportDate) qs.set("report_date", reportDate);
  if (shiftCode) qs.set("shift_code", shiftCode);
  return json(await authFetch(token, `/reports/shift-end?${qs}`), "Failed to generate shift-end report");
}

export async function getDailyReport(token: string, reportDate?: string) {
  const qs = new URLSearchParams();
  if (reportDate) qs.set("report_date", reportDate);
  return json(await authFetch(token, `/reports/daily?${qs}`), "Failed to generate daily report");
}

export async function getDailyVacancyReport(token: string, reportDate?: string) {
  const qs = new URLSearchParams();
  if (reportDate) qs.set("report_date", reportDate);
  return json(await authFetch(token, `/reports/daily-vacancy?${qs}`), "Failed to generate vacancy report");
}

export async function getWorkloadReport(token: string, start: string, end: string) {
  return json(await authFetch(token, `/reports/workload?start_date=${start}&end_date=${end}`), "Failed to generate workload report");
}

export async function downloadReport(
  token: string,
  reportType: string,
  format: "csv" | "xlsx" | "pdf",
  opts: { date?: string; shift?: string; start?: string; end?: string } = {}
) {
  const qs = new URLSearchParams({ report_type: reportType, format });
  if (opts.date) qs.set("report_date", opts.date);
  if (opts.shift) qs.set("shift_code", opts.shift);
  if (opts.start) qs.set("start_date", opts.start);
  if (opts.end) qs.set("end_date", opts.end);
  return downloadFile(token, `/reports/export?${qs}`, `panjagutta_${reportType}.${format}`);
}

/** @deprecated The export endpoint requires the Authorization header; use downloadReport(). */
export function getExportUrl(reportType: string, date?: string, shift?: string) {
  const qs = new URLSearchParams();
  qs.set("report_type", reportType);
  if (date) qs.set("report_date", date);
  if (shift) qs.set("shift_code", shift);
  return `${getApiBase()}/reports/export?${qs}`;
}

// ─── Audit ──────────────────────────────────────────────────────────────────

export async function getAuditLogs(
  token: string,
  params?: { actor?: string; action?: string; entity?: string; exceptions_only?: boolean; limit?: number; offset?: number }
): Promise<AuditItem[]> {
  const qs = new URLSearchParams();
  if (params?.actor) qs.set("actor_username", params.actor);
  if (params?.action) qs.set("action", params.action);
  if (params?.entity) qs.set("entity_type", params.entity);
  if (params?.exceptions_only) qs.set("exceptions_only", "true");
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.offset) qs.set("offset", String(params.offset));
  const res = await authFetch(token, `/audit/?${qs}`);
  if (!res.ok) return [];
  return res.json();
}

// ─── AI Advisory ────────────────────────────────────────────────────────────

export async function explainRoster(token: string, rosterId?: number) {
  return json(await authFetch(token, "/ai/explain-roster", { method: "POST", body: JSON.stringify({ roster_id: rosterId }) }), "Failed to generate roster explanation");
}

export async function askAI(token: string, query: string) {
  return json(await authFetch(token, "/ai/query", { method: "POST", body: JSON.stringify({ query }) }), "Failed to process query");
}
