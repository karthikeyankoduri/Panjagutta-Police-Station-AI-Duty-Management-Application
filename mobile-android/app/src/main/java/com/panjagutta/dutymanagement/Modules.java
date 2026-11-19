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
            case RoleAccess.ROSTER: return roster(a);
            case RoleAccess.ATTENDANCE: return new AttendanceScreen(a);
            case RoleAccess.MOVEMENTS: return new MovementsScreen(a);
            case RoleAccess.TASKS: return new TasksScreen(a);
            case RoleAccess.ATTACHMENTS: return new AttachmentsScreen(a);
            case RoleAccess.REPORTS: return new ReportsScreen(a);
            case RoleAccess.POLICY: return new PolicyScreen(a);
            case RoleAccess.CONFIG: return administration(a);
            case RoleAccess.AUDIT: return new AuditScreen(a);
            case RoleAccess.LOCATIONS: return new LocationsScreen(a);
            default: return null;
        }
    }

    /** Roster & Duty: Rosters, Allocation (supervisors) and duty change Requests, as on the web. */
    private static ModuleScreen roster(MainActivity a) {
        CompositeScreen host = new CompositeScreen(a);
        String role = a.role();
        for (String[] t : RoleAccess.tabsFor(RoleAccess.ROSTER, role)) {
            switch (t[1]) {
                case "rosters":
                    // Staff use the personal Roster tab; here they only get the Requests tab.
                    if (!RoleAccess.isStaff(role)) host.tab(t[1], t[2], new RosterScreen(a), 0);
                    break;
                case "allocation": host.tab(t[1], t[2], new AllocationScreen(a), 0); break;
                case "requests": host.tab(t[1], t[2], new DutyRequestsScreen(a), 0); break;
                default: break;
            }
        }
        return host;
    }

    /** Administration: the staff register plus the five configuration lists, as one page with tabs. */
    private static ModuleScreen administration(MainActivity a) {
        CompositeScreen host = new CompositeScreen(a);
        ConfigScreen config = new ConfigScreen(a);
        StaffScreen staff = new StaffScreen(a);
        for (String[] t : RoleAccess.tabsFor(RoleAccess.CONFIG, a.role())) {
            switch (t[1]) {
                case "staff": host.tab(t[1], t[2], staff, 0); break;
                case "duties": host.tab(t[1], t[2], config, 0); break;
                case "sectors": host.tab(t[1], t[2], config, 1); break;
                case "sections": host.tab(t[1], t[2], config, 2); break;
                case "lists": host.tab(t[1], t[2], config, 3); break;
                case "cards": host.tab(t[1], t[2], config, 4); break;
                default: break;
            }
        }
        return host;
    }
}
