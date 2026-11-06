package com.panjagutta.dutymanagement;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.List;

import org.junit.Test;

/** Mirrors the role x module table of the web sidebar (frontend/src/components/AppShell.tsx). */
public class RoleAccessTest {
    private static final String[] ALL_MODULES = {
            "dashboard", "staff", "roster", "allocation", "attendance", "tasks", "movements",
            "leave", "attachments", "approvals", "reports", "policy", "config", "audit", "guide"};

    /** Rows follow ALL_MODULES order; columns SUPER_ADMIN, SHO, ADMIN_SI, SECTOR_SI, DI, DSI, STAFF. */
    private static final String[] ROLES = {"SUPER_ADMIN", "SHO", "ADMIN_SI", "SECTOR_SI", "DI", "DSI", "STAFF"};
    private static final String[] MATRIX = {
            "YYYYYYN", // dashboard
            "YYYNNNN", // staff
            "YYYYYYY", // roster
            "YYYYNNN", // allocation
            "YYYYYYY", // attendance
            "YYYYYYY", // tasks
            "YYYYYYY", // movements
            "YYYYYYY", // leave
            "YYYYYYN", // attachments
            "YYYYYYN", // approvals
            "YYYYYYN", // reports
            "YYYNNNN", // policy
            "YYYNNNN", // config
            "YYYNNNN", // audit
            "YYYYYYY", // guide
    };

    @Test
    public void moduleVisibilityMatchesWebSidebar() {
        for (int m = 0; m < ALL_MODULES.length; m++) {
            for (int r = 0; r < ROLES.length; r++) {
                boolean expected = MATRIX[m].charAt(r) == 'Y';
                assertEquals(ALL_MODULES[m] + " for " + ROLES[r], expected,
                        RoleAccess.canSee(ALL_MODULES[m], ROLES[r]));
            }
        }
    }

    @Test
    public void bottomBarAndMoreMenuPartitionTheModules() {
        for (String role : ROLES) {
            List<String> bottom = RoleAccess.bottomModules(role);
            List<String> more = RoleAccess.moreModules(role);
            for (String module : bottom) assertFalse(module + " duplicated for " + role, more.contains(module));
            assertEquals(RoleAccess.modulesFor(role).size(), bottom.size() + more.size());
        }
        assertEquals(Arrays.asList("dashboard", "roster", "approvals", "attendance"), RoleAccess.bottomModules("SHO"));
        assertTrue(RoleAccess.bottomModules("STAFF").isEmpty());
    }

    @Test
    public void shoSeesEveryModuleAndDiSeesNoAdminModules() {
        assertEquals(ALL_MODULES.length, RoleAccess.modulesFor("SHO").size());
        List<String> di = RoleAccess.moreModules("DI");
        assertFalse(di.contains("staff"));
        assertFalse(di.contains("config"));
        assertFalse(di.contains("allocation"));
        assertTrue(di.contains("reports"));
    }

    @Test
    public void rosterWorkflowRulesMatchServer() {
        assertTrue(RoleAccess.canSubmitRoster("ADMIN_SI"));
        assertFalse("SHO approves, never submits", RoleAccess.canSubmitRoster("SHO"));
        assertTrue(RoleAccess.canApproveRoster("SHO"));
        assertFalse(RoleAccess.canApproveRoster("ADMIN_SI"));
        assertTrue(RoleAccess.canPublishRoster("SHO"));
        assertTrue(RoleAccess.canPublishRoster("ADMIN_SI"));
        assertFalse(RoleAccess.canPublishRoster("SECTOR_SI"));
        assertTrue(RoleAccess.canEditAllocation("ADMIN_SI"));
        assertFalse("Sector SI allocation is read-only", RoleAccess.canEditAllocation("SECTOR_SI"));
    }

    @Test
    public void decisionRules() {
        assertTrue(RoleAccess.canApproveLeave("SHO"));
        assertTrue(RoleAccess.canApproveLeave("ADMIN_SI"));
        assertFalse(RoleAccess.canApproveLeave("SECTOR_SI"));
        assertTrue(RoleAccess.canAuthorizeMovement("SECTOR_SI"));
        assertFalse(RoleAccess.canAuthorizeMovement("DI"));
        assertTrue(RoleAccess.canSignOffPolicy("SHO"));
        assertFalse(RoleAccess.canSignOffPolicy("ADMIN_SI"));
        assertTrue(RoleAccess.canSignOffPolicy("SUPER_ADMIN"));
    }

    @Test
    public void superAdminPassesEveryActionGate() {
        assertTrue(RoleAccess.canSubmitRoster("SUPER_ADMIN"));
        assertTrue(RoleAccess.canApproveRoster("SUPER_ADMIN"));
        assertTrue(RoleAccess.canApproveLeave("SUPER_ADMIN"));
        assertTrue(RoleAccess.canAuthorizeMovement("SUPER_ADMIN"));
        assertTrue(RoleAccess.canManageAttachments("SUPER_ADMIN"));
    }

    @Test
    public void staffGetsNoOfficerActions() {
        assertFalse(RoleAccess.canAskAI("STAFF"));
        assertFalse(RoleAccess.canViewAllTasks("STAFF"));
        assertFalse(RoleAccess.canResolveAlert("STAFF"));
        assertFalse(RoleAccess.canManageStaff("STAFF"));
    }

    @Test
    public void unknownOrMissingRoleIsTreatedAsStaff() {
        assertTrue(RoleAccess.isStaff(null));
        assertFalse(RoleAccess.isStaff("sho"));
        assertEquals("SHO", RoleAccess.normalize(" sho "));
    }

    @Test
    public void notificationEntitiesOpenTheSameModulesAsTheWeb() {
        assertEquals("leave", RoleAccess.moduleForEntity("LeaveRequest"));
        assertEquals("movements", RoleAccess.moduleForEntity("Movement"));
        assertEquals("roster", RoleAccess.moduleForEntity("Roster"));
        assertEquals("tasks", RoleAccess.moduleForEntity("Task"));
        assertEquals("allocation", RoleAccess.moduleForEntity("RosterAssignment"));
        assertEquals("attachments", RoleAccess.moduleForEntity("AttachmentOrder"));
        assertEquals(null, RoleAccess.moduleForEntity("Other"));
    }
}
