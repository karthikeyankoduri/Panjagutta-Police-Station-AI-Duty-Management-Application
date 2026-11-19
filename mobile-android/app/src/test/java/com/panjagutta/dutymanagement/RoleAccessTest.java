package com.panjagutta.dutymanagement;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Iterator;
import java.util.List;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * The app's role rules must equal frontend/src/lib/access-matrix.json: the file the web sidebar is
 * built from and the backend tests check against the real API. If one of these fails after a web
 * change, update RoleAccess (and the screens) so the app keeps matching the web.
 */
public class RoleAccessTest {
    private static final String[] ROLES = {"SUPER_ADMIN", "SHO", "ADMIN_SI", "SECTOR_SI", "DI", "DSI", "STAFF"};

    private static JSONObject matrix() throws Exception {
        // Gradle runs unit tests with the module directory (mobile-android/app) as the working directory.
        Path file = Paths.get(System.getProperty("user.dir"), "..", "..", "frontend", "src", "lib", "access-matrix.json")
                .normalize();
        return new JSONObject(new String(Files.readAllBytes(file), StandardCharsets.UTF_8));
    }

    private static List<String> list(JSONArray array) {
        List<String> out = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) out.add(array.optString(i));
        return out;
    }

    @Test
    public void rolesAndGroupsMatchSharedMatrix() throws Exception {
        JSONObject m = matrix();
        assertEquals(Arrays.asList(ROLES), list(m.getJSONArray("roles")));
        JSONObject groups = m.getJSONObject("groups");
        for (Iterator<String> it = groups.keys(); it.hasNext(); ) {
            String name = it.next();
            assertEquals("group " + name, list(groups.getJSONArray(name)), RoleAccess.group(name));
        }
    }

    @Test
    public void modulesMatchSharedMatrixInOrderLabelAndGroup() throws Exception {
        JSONArray modules = matrix().getJSONArray("modules");
        assertEquals("module count", modules.length(), RoleAccess.MODULES.length);
        for (int i = 0; i < modules.length(); i++) {
            JSONObject web = modules.getJSONObject(i);
            assertEquals(web.getString("id"), RoleAccess.MODULES[i][0]);
            assertEquals(web.getString("label"), RoleAccess.MODULES[i][1]);
            assertEquals(web.getString("group"), RoleAccess.MODULES[i][2]);
            for (String role : ROLES) {
                boolean expected = RoleAccess.group(web.getString("group")).contains(role);
                assertEquals(web.getString("id") + " for " + role, expected, RoleAccess.canSee(web.getString("id"), role));
            }
        }
    }

    @Test
    public void tabsMatchSharedMatrix() throws Exception {
        JSONObject tabs = matrix().getJSONObject("tabs");
        int total = 0;
        for (Iterator<String> it = tabs.keys(); it.hasNext(); ) {
            String module = it.next();
            JSONArray web = tabs.getJSONArray(module);
            List<String[]> mine = new ArrayList<>();
            for (String[] t : RoleAccess.TABS) if (t[0].equals(module)) mine.add(t);
            assertEquals("tabs of " + module, web.length(), mine.size());
            for (int i = 0; i < web.length(); i++) {
                assertEquals(web.getJSONObject(i).getString("id"), mine.get(i)[1]);
                assertEquals(web.getJSONObject(i).getString("label"), mine.get(i)[2]);
                assertEquals(web.getJSONObject(i).getString("group"), mine.get(i)[3]);
            }
            total += web.length();
        }
        assertEquals("every tab is covered", total, RoleAccess.TABS.length);
    }

    @Test
    public void actionsMatchSharedMatrix() throws Exception {
        JSONObject actions = matrix().getJSONObject("actions");
        assertEquals("action count", actions.length(), RoleAccess.ACTIONS.length);
        for (String[] action : RoleAccess.ACTIONS) {
            assertEquals(action[0], actions.getString(action[0]), action[1]);
            for (String role : ROLES) {
                assertEquals(action[0] + " for " + role, RoleAccess.group(action[1]).contains(role),
                        RoleAccess.can(action[0], role));
            }
        }
    }

    @Test
    public void shoCannotOpenAdministrationOrAuditLog() {
        assertFalse(RoleAccess.canSee("config", "SHO"));
        assertFalse(RoleAccess.canSee("config:staff", "SHO"));
        assertFalse(RoleAccess.canSee("audit", "SHO"));
        assertTrue("SHO keeps Policy & Shifts", RoleAccess.canSee("policy", "SHO"));
        assertFalse(RoleAccess.canManageStaff("SHO"));
        assertFalse(RoleAccess.canWriteConfig("SHO"));
        assertTrue(RoleAccess.canSee("config", "ADMIN_SI"));
        assertTrue(RoleAccess.canSee("audit", "SUPER_ADMIN"));
    }

    @Test
    public void allocationIsATabOfRosterForSupervisorsOnly() {
        assertTrue(RoleAccess.canSee(RoleAccess.ALLOCATION, "SECTOR_SI"));
        assertFalse(RoleAccess.canSee(RoleAccess.ALLOCATION, "DI"));
        assertFalse(RoleAccess.canSee(RoleAccess.ALLOCATION, "STAFF"));
        assertEquals(3, RoleAccess.tabsFor("roster", "SHO").size());
        assertEquals(2, RoleAccess.tabsFor("roster", "DI").size());
        assertEquals(6, RoleAccess.tabsFor("config", "ADMIN_SI").size());
        assertEquals(0, RoleAccess.tabsFor("config", "SHO").size());
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
    public void shoSeesEveryModuleExceptAdministrationAuditAndLiveLocations() {
        List<String> sho = RoleAccess.modulesFor("SHO");
        assertEquals(RoleAccess.MODULES.length - 3, sho.size());
        assertFalse(sho.contains("locations"));
        assertTrue(sho.contains("policy"));
        List<String> di = RoleAccess.moreModules("DI");
        assertFalse(di.contains("config"));
        assertFalse(di.contains("policy"));
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
        assertTrue(RoleAccess.canDecideDutyChange("SHO"));
        assertTrue(RoleAccess.canDecideDutyChange("ADMIN_SI"));
        assertFalse(RoleAccess.canDecideDutyChange("SECTOR_SI"));
        assertFalse(RoleAccess.canDecideDutyChange("STAFF"));
    }

    @Test
    public void superAdminPassesEveryActionGate() {
        for (String[] action : RoleAccess.ACTIONS) {
            assertTrue(action[0], RoleAccess.can(action[0], "SUPER_ADMIN"));
        }
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
        assertEquals("roster", RoleAccess.moduleForEntity("RosterAssignment"));
        assertEquals("roster:allocation", RoleAccess.targetForEntity("RosterAssignment"));
        assertEquals("roster:requests", RoleAccess.targetForEntity("DutyChangeRequest"));
        assertEquals("attachments", RoleAccess.moduleForEntity("AttachmentOrder"));
        assertEquals(null, RoleAccess.moduleForEntity("Other"));
    }
}
