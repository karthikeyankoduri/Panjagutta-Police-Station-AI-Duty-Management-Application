package com.panjagutta.dutymanagement;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Who can see and do what. Mirrors frontend/src/lib/access-matrix.json, which the web AppShell reads
 * and RoleAccessTest asserts against, so the web and the app cannot drift apart unnoticed. The server
 * (require_roles) enforces every permission; this class only decides what the app shows.
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
    static final String ROSTER = "roster";
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
    static final String LOCATIONS = "locations";
    static final String GUIDE = "guide";

    // Tab targets ("module:tab") for the two web pages that hold several tabs.
    static final String ROSTER_ROSTERS = "roster:rosters";
    static final String ALLOCATION = "roster:allocation";
    static final String ROSTER_REQUESTS = "roster:requests";
    static final String STAFF_REGISTER = "config:staff";

    static final String ALL = "ALL";

    private static final List<String> ALL_ROLES = Arrays.asList(SUPER_ADMIN, SHO, ADMIN_SI, SECTOR_SI, DI, DSI, STAFF);
    private static final List<String> OFFICERS = Arrays.asList(SUPER_ADMIN, SHO, ADMIN_SI, SECTOR_SI, DI, DSI);
    private static final List<String> SUPERVISORS = Arrays.asList(SUPER_ADMIN, SHO, ADMIN_SI, SECTOR_SI);
    private static final List<String> ADMINS = Arrays.asList(SUPER_ADMIN, SHO, ADMIN_SI);
    private static final List<String> ADMIN_ONLY = Arrays.asList(SUPER_ADMIN, ADMIN_SI);
    private static final List<String> SHO_ONLY = Arrays.asList(SUPER_ADMIN, SHO);

    /** Group name -> roles, as in access-matrix.json "groups". */
    static List<String> group(String name) {
        switch (name) {
            case "ALL": return ALL_ROLES;
            case "OFFICERS": return OFFICERS;
            case "SUPERVISORS": return SUPERVISORS;
            case "ADMINS": return ADMINS;
            case "ADMIN_ONLY": return ADMIN_ONLY;
            case "SHO_ONLY": return SHO_ONLY;
            default: throw new IllegalArgumentException("Unknown group " + name);
        }
    }

    /** Menu order, label and group, identical to the web sidebar (access-matrix.json "modules"). */
    static final String[][] MODULES = {
            {DASHBOARD, "Dashboard", "OFFICERS"},
            {ROSTER, "Roster & Duty", "ALL"},
            {ATTENDANCE, "Attendance", "ALL"},
            {TASKS, "Tasks", "ALL"},
            {MOVEMENTS, "Outside Movements", "ALL"},
            {ATTACHMENTS, "Attachments", "OFFICERS"},
            {APPROVALS, "Approvals & Alerts", "OFFICERS"},
            {REPORTS, "Reports", "OFFICERS"},
            {POLICY, "Policy & Shifts", "ADMINS"},
            {CONFIG, "Administration", "ADMIN_ONLY"},
            {AUDIT, "Audit Log", "ADMIN_ONLY"},
            {LOCATIONS, "Live Locations", "ADMIN_ONLY"},
            {GUIDE, "Workflow Guide", "ALL"},
    };

    /** Tabs inside a module: {module, tab id, label, group} (access-matrix.json "tabs"). */
    static final String[][] TABS = {
            {ROSTER, "rosters", "Rosters", "ALL"},
            {ROSTER, "allocation", "Allocation", "SUPERVISORS"},
            {ROSTER, "requests", "Requests", "ALL"},
            {CONFIG, "staff", "Staff & CSV Import", "ADMIN_ONLY"},
            {CONFIG, "duties", "Duty requirements", "ADMIN_ONLY"},
            {CONFIG, "sectors", "Sectors", "ADMIN_ONLY"},
            {CONFIG, "sections", "Sections", "ADMIN_ONLY"},
            {CONFIG, "lists", "Status & state lists", "ADMIN_ONLY"},
            {CONFIG, "cards", "Dashboard cards", "ADMIN_ONLY"},
    };

    /** Action name -> group (access-matrix.json "actions"). */
    static final String[][] ACTIONS = {
            {"roster.create", "ADMINS"},
            {"roster.submit", "ADMIN_ONLY"},
            {"roster.approve", "SHO_ONLY"},
            {"roster.publish", "ADMINS"},
            {"roster.revise", "ADMINS"},
            {"roster.explain", "OFFICERS"},
            {"roster.viewDrafts", "SUPERVISORS"},
            {"allocation.edit", "ADMINS"},
            {"dutyChange.decide", "ADMINS"},
            {"leave.approve", "ADMINS"},
            {"movement.authorize", "SUPERVISORS"},
            {"tasks.manage", "SUPERVISORS"},
            {"tasks.viewAll", "OFFICERS"},
            {"attendance.rollCall", "OFFICERS"},
            {"alerts.resolve", "SUPERVISORS"},
            {"attachments.manage", "ADMINS"},
            {"staff.manage", "ADMIN_ONLY"},
            {"config.write", "ADMIN_ONLY"},
            {"policy.signoff", "SHO_ONLY"},
            {"policy.edit", "ADMINS"},
            {"ai.ask", "OFFICERS"},
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

    /** Module part of a target such as "roster:allocation" (or the id itself). */
    static String moduleOf(String target) {
        if (target == null) return "";
        int i = target.indexOf(':');
        return i < 0 ? target : target.substring(0, i);
    }

    /** Tab part of a target such as "roster:allocation", or null when there is none. */
    static String tabOf(String target) {
        if (target == null) return null;
        int i = target.indexOf(':');
        return i < 0 ? null : target.substring(i + 1);
    }

    /** Can this role open the module (or "module:tab" target)? Same table as the web sidebar. */
    static boolean canSee(String target, String role) {
        String r = normalize(role);
        String module = moduleOf(target);
        String tab = tabOf(target);
        for (String[] m : MODULES) {
            if (!m[0].equals(module)) continue;
            if (!group(m[2]).contains(r)) return false;
            if (tab == null) return true;
            for (String[] t : TABS) {
                if (t[0].equals(module) && t[1].equals(tab)) return group(t[3]).contains(r);
            }
            return false;
        }
        return false;
    }

    /** Tabs of a module that this role may open, in web order. */
    static List<String[]> tabsFor(String module, String role) {
        List<String[]> out = new ArrayList<>();
        String r = normalize(role);
        for (String[] t : TABS) if (t[0].equals(module) && group(t[3]).contains(r)) out.add(t);
        return out;
    }

    static String label(String target) {
        String module = moduleOf(target);
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

    // ── Action rules (access-matrix.json "actions"; the server's require_roles is the real gate) ──

    /** Is `role` allowed the named action? */
    static boolean can(String action, String role) {
        for (String[] a : ACTIONS) {
            if (a[0].equals(action)) return group(a[1]).contains(normalize(role));
        }
        throw new IllegalArgumentException("Unknown action " + action);
    }

    static boolean canCreateRoster(String role) { return can("roster.create", role); }
    /** Submit for approval is Admin SI only (the SHO approves, never submits). */
    static boolean canSubmitRoster(String role) { return can("roster.submit", role); }
    static boolean canApproveRoster(String role) { return can("roster.approve", role); }
    static boolean canPublishRoster(String role) { return can("roster.publish", role); }
    static boolean canReviseRoster(String role) { return can("roster.revise", role); }
    static boolean canExplainRoster(String role) { return can("roster.explain", role); }
    static boolean canEditAllocation(String role) { return can("allocation.edit", role); }
    static boolean canDecideDutyChange(String role) { return can("dutyChange.decide", role); }
    static boolean canApproveLeave(String role) { return can("leave.approve", role); }
    static boolean canAuthorizeMovement(String role) { return can("movement.authorize", role); }
    static boolean canManageTasks(String role) { return can("tasks.manage", role); }
    static boolean canViewAllTasks(String role) { return can("tasks.viewAll", role); }
    static boolean canRollCall(String role) { return can("attendance.rollCall", role); }
    static boolean canResolveAlert(String role) { return can("alerts.resolve", role); }
    static boolean canManageAttachments(String role) { return can("attachments.manage", role); }
    static boolean canManageStaff(String role) { return can("staff.manage", role); }
    static boolean canWriteConfig(String role) { return can("config.write", role); }
    static boolean canSignOffPolicy(String role) { return can("policy.signoff", role); }
    static boolean canEditPolicySettings(String role) { return can("policy.edit", role); }
    static boolean canViewDraftRosters(String role) { return can("roster.viewDrafts", role); }
    static boolean canAskAI(String role) { return can("ai.ask", role); }

    /** Inbox sections a role is shown (web approvals page). */
    static boolean inboxShowsRosters(String role) { return can("roster.approve", role); }
    static boolean inboxShowsLeave(String role) { return can("leave.approve", role); }
    static boolean inboxShowsMovements(String role) { return can("movement.authorize", role); }
    static boolean inboxShowsDutyChanges(String role) { return can("dutyChange.decide", role); }

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

    /** Target a notification's entity_type opens (same mapping as the web bell). */
    static String targetForEntity(String entityType) {
        if (entityType == null) return null;
        switch (entityType) {
            case "LeaveRequest": return LEAVE;
            case "Movement": return MOVEMENTS;
            case "Roster": return ROSTER;
            case "Task": return TASKS;
            case "RosterAssignment": return ALLOCATION;
            case "AttachmentOrder": return ATTACHMENTS;
            case "DutyChangeRequest": return ROSTER_REQUESTS;
            default: return null;
        }
    }

    /** Module-only form of {@link #targetForEntity}, kept for callers that only need the page. */
    static String moduleForEntity(String entityType) {
        String target = targetForEntity(entityType);
        return target == null ? null : moduleOf(target);
    }
}
