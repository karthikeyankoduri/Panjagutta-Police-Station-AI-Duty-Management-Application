package com.panjagutta.dutymanagement;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Who can see and do what. Mirrors frontend/src/components/AppShell.tsx (NAV_ITEMS) and the
 * per-page role checks of the web app. The server enforces every permission; this class only
 * decides what the app shows so that each role gets the same workspace as on the web.
 */
final class RoleAccess {
    static final String SUPER_ADMIN = "SUPER_ADMIN";
    static final String SHO = "SHO";
    static final String ADMIN_SI = "ADMIN_SI";
    static final String SECTOR_SI = "SECTOR_SI";
    static final String DI = "DI";
    static final String DSI = "DSI";
    static final String STAFF = "STAFF";

    // Module ids (one per web page).
    static final String DASHBOARD = "dashboard";
    static final String STAFF_REGISTER = "staff";
    static final String ROSTER = "roster";
    static final String ALLOCATION = "allocation";
    static final String ATTENDANCE = "attendance";
    static final String TASKS = "tasks";
    static final String MOVEMENTS = "movements";
    static final String LEAVE = "leave";
    static final String ATTACHMENTS = "attachments";
    static final String APPROVALS = "approvals";
    static final String REPORTS = "reports";
    static final String POLICY = "policy";
    static final String CONFIG = "config";
    static final String AUDIT = "audit";
    static final String GUIDE = "guide";

    private static final List<String> OFFICERS = Arrays.asList(SHO, ADMIN_SI, SECTOR_SI, DI, DSI, SUPER_ADMIN);
    private static final List<String> ADMINS = Arrays.asList(SHO, ADMIN_SI, SUPER_ADMIN);
    private static final List<String> SUPERVISORS = Arrays.asList(SHO, ADMIN_SI, SECTOR_SI, SUPER_ADMIN);

    /** Menu order and labels, identical to the web sidebar. */
    static final String[][] MODULES = {
            {DASHBOARD, "Dashboard"},
            {STAFF_REGISTER, "Staff & CSV Import"},
            {ROSTER, "Shift Roster"},
            {ALLOCATION, "Duty Allocation"},
            {ATTENDANCE, "Attendance"},
            {TASKS, "Tasks"},
            {MOVEMENTS, "Outside Movements"},
            {LEAVE, "Leave & Rest"},
            {ATTACHMENTS, "Attachments"},
            {APPROVALS, "Approvals & Alerts"},
            {REPORTS, "Reports"},
            {POLICY, "Policy & Shifts"},
            {CONFIG, "Configuration"},
            {AUDIT, "Audit Log"},
            {GUIDE, "Workflow Guide"},
    };

    private RoleAccess() {
    }

    static String normalize(String role) {
        return role == null ? STAFF : role.trim().toUpperCase(java.util.Locale.ROOT);
    }

    static boolean isStaff(String role) {
        return STAFF.equals(normalize(role));
    }

    static boolean isOfficer(String role) {
        return OFFICERS.contains(normalize(role));
    }

    static boolean isAdmin(String role) {
        return ADMINS.contains(normalize(role));
    }

    static boolean isSupervisor(String role) {
        return SUPERVISORS.contains(normalize(role));
    }

    /** Same table as the web NAV_ITEMS `roles` field. */
    static boolean canSee(String module, String role) {
        String r = normalize(role);
        switch (module) {
            case DASHBOARD:
            case ATTACHMENTS:
            case APPROVALS:
            case REPORTS:
                return OFFICERS.contains(r);
            case STAFF_REGISTER:
            case POLICY:
            case CONFIG:
            case AUDIT:
                return ADMINS.contains(r);
            case ALLOCATION:
                return SUPERVISORS.contains(r);
            default:
                for (String[] m : MODULES) if (m[0].equals(module)) return true;
                return false;
        }
    }

    static String label(String module) {
        for (String[] m : MODULES) if (m[0].equals(module)) return m[1];
        return module;
    }

    /** Every module this role may open, in web sidebar order. */
    static List<String> modulesFor(String role) {
        List<String> out = new ArrayList<>();
        for (String[] m : MODULES) if (canSee(m[0], role)) out.add(m[0]);
        return out;
    }

    /** Bottom bar for non-staff roles (staff keep the personal self-service tabs). */
    static List<String> bottomModules(String role) {
        if (isStaff(role)) return new ArrayList<>();
        return new ArrayList<>(Arrays.asList(DASHBOARD, ROSTER, APPROVALS, ATTENDANCE));
    }

    /** Modules shown on the More screen: everything the role can open that is not on the bottom bar. */
    static List<String> moreModules(String role) {
        List<String> out = modulesFor(role);
        out.removeAll(bottomModules(role));
        return out;
    }

    // ── Action rules (web page checks + server `require_roles`) ──────────────────

    static boolean canCreateRoster(String role) { return ADMINS.contains(normalize(role)); }
    /** Submit for approval is Admin SI only (the SHO approves, never submits). */
    static boolean canSubmitRoster(String role) { return in(role, ADMIN_SI, SUPER_ADMIN); }
    static boolean canApproveRoster(String role) { return in(role, SHO, SUPER_ADMIN); }
    static boolean canPublishRoster(String role) { return ADMINS.contains(normalize(role)); }
    static boolean canReviseRoster(String role) { return ADMINS.contains(normalize(role)); }
    static boolean canExplainRoster(String role) { return !isStaff(role); }

    static boolean canEditAllocation(String role) { return ADMINS.contains(normalize(role)); }

    static boolean canApproveLeave(String role) { return ADMINS.contains(normalize(role)); }
    static boolean canAuthorizeMovement(String role) { return SUPERVISORS.contains(normalize(role)); }
    static boolean canManageTasks(String role) { return SUPERVISORS.contains(normalize(role)); }
    static boolean canViewAllTasks(String role) { return !isStaff(role); }
    static boolean canRollCall(String role) { return in(role, DI, DSI, SECTOR_SI, SHO, ADMIN_SI, SUPER_ADMIN); }
    static boolean canResolveAlert(String role) { return SUPERVISORS.contains(normalize(role)); }

    static boolean canManageAttachments(String role) { return ADMINS.contains(normalize(role)); }
    static boolean canManageStaff(String role) { return ADMINS.contains(normalize(role)); }
    static boolean canWriteConfig(String role) { return ADMINS.contains(normalize(role)); }
    static boolean canSignOffPolicy(String role) { return in(role, SHO, SUPER_ADMIN); }
    static boolean canEditPolicySettings(String role) { return ADMINS.contains(normalize(role)); }
    static boolean canViewDraftRosters(String role) { return SUPERVISORS.contains(normalize(role)); }
    static boolean canAskAI(String role) { return !isStaff(role); }

    /** Inbox sections a role is shown (web approvals page). */
    static boolean inboxShowsRosters(String role) { return in(role, SHO, SUPER_ADMIN); }
    static boolean inboxShowsLeave(String role) { return ADMINS.contains(normalize(role)); }
    static boolean inboxShowsMovements(String role) { return SUPERVISORS.contains(normalize(role)); }

    static String roleLabel(String role) {
        switch (normalize(role)) {
            case SHO: return "SHO";
            case ADMIN_SI: return "Admin SI";
            case SECTOR_SI: return "Sector SI";
            case DI: return "DI";
            case DSI: return "DSI";
            case SUPER_ADMIN: return "Super Admin";
            default: return "Staff";
        }
    }

    /** Module a notification's entity_type opens (same mapping as the web bell). */
    static String moduleForEntity(String entityType) {
        if (entityType == null) return null;
        switch (entityType) {
            case "LeaveRequest": return LEAVE;
            case "Movement": return MOVEMENTS;
            case "Roster": return ROSTER;
            case "Task": return TASKS;
            case "RosterAssignment": return ALLOCATION;
            case "AttachmentOrder": return ATTACHMENTS;
            default: return null;
        }
    }

    private static boolean in(String role, String... allowed) {
        String r = normalize(role);
        for (String a : allowed) if (a.equals(r)) return true;
        return false;
    }
}
