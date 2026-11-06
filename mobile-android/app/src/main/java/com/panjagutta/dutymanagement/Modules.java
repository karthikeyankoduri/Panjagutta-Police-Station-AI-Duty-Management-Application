package com.panjagutta.dutymanagement;

/** Creates the native screen for a role module id (see {@link RoleAccess}). */
final class Modules {
    private Modules() {
    }

    static ModuleScreen create(String id, MainActivity a) {
        switch (id) {
            case MainActivity.MORE: return new MoreScreen(a);
            case RoleAccess.GUIDE: return new GuideScreen(a);
            case RoleAccess.DASHBOARD: return new DashboardScreen(a);
            case RoleAccess.APPROVALS: return new ApprovalsScreen(a);
            case RoleAccess.ROSTER: return new RosterScreen(a);
            case RoleAccess.ATTENDANCE: return new AttendanceScreen(a);
            case RoleAccess.LEAVE: return new LeaveScreen(a);
            case RoleAccess.MOVEMENTS: return new MovementsScreen(a);
            case RoleAccess.TASKS: return new TasksScreen(a);
            case RoleAccess.ALLOCATION: return new AllocationScreen(a);
            case RoleAccess.STAFF_REGISTER: return new StaffScreen(a);
            case RoleAccess.ATTACHMENTS: return new AttachmentsScreen(a);
            case RoleAccess.REPORTS: return new ReportsScreen(a);
            case RoleAccess.POLICY: return new PolicyScreen(a);
            case RoleAccess.CONFIG: return new ConfigScreen(a);
            case RoleAccess.AUDIT: return new AuditScreen(a);
            default: return null;
        }
    }
}
