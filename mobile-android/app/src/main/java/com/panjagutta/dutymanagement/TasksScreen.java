package com.panjagutta.dutymanagement;

import android.app.AlertDialog;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Spinner;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/** Tasks & special bandobast: assign, track and update tasks (web: /tasks). */
final class TasksScreen extends ModuleScreen {
    private static final String[] STATUSES = {"Not Started", "In Progress", "Completed", "On Hold", "Cancelled"};
    private static final List<String> OFFICER_RANKS = Arrays.asList("INSPECTOR", "SI", "WSI", "ASI", "AWSI");
    /** {code, label}; the order is the display order. "Others" takes a custom header. */
    private static final String[][] CATEGORIES = {
            {"REGULAR_DUTY", "Regular Duty"}, {"BANDOBAST", "Bandobast"}, {"VIP_MOVEMENT", "VIP Movement"},
            {"TRAFFIC_DUTY", "Traffic Duties"}, {"VEHICLE_CHECKING", "Vehicle Checking"}, {"OTHERS", "Others"}};
    private static final int CUSTOM_TITLE_MAX = 120;

    private int view; // 0 all, 1 current per person
    private String statusFilter = "";
    private String categoryFilter = "";
    private boolean overdueOnly;
    private JSONArray tasks = new JSONArray();
    private JSONArray current = new JSONArray();
    private JSONArray staff = new JSONArray();

    TasksScreen(MainActivity a) {
        super(a);
    }

    @Override
    void show() {
        load(() -> {
            StringBuilder q = new StringBuilder("/tasks/?");
            if (!statusFilter.isEmpty()) q.append("task_status=").append(java.net.URLEncoder.encode(statusFilter, "UTF-8")).append('&');
            if (overdueOnly) q.append("overdue_only=true&");
            if (!categoryFilter.isEmpty()) q.append("category=").append(categoryFilter).append('&');
            JSONArray t = a.requestArray(q.toString());
            JSONArray s = RoleAccess.canManageTasks(role) ? a.requestArray("/staff/?is_active=true") : new JSONArray();
            JSONArray c = RoleAccess.isStaff(role) ? new JSONArray() : a.requestArray("/tasks/current");
            return new JSONArray[]{t, s, c};
        }, r -> {
            tasks = r[0];
            staff = r[1];
            current = r[2];
            render();
        });
    }

    private boolean canUpdate(JSONObject t) {
        int own = a.profile == null ? 0 : a.profile.optInt("staff_id", 0);
        return RoleAccess.canManageTasks(role) || (own > 0 && t.optInt("assignee_id") == own);
    }

    private List<JSONObject> officers() {
        List<JSONObject> out = new ArrayList<>();
        for (int i = 0; i < staff.length(); i++) {
            JSONObject s = staff.optJSONObject(i);
            if (s != null && OFFICER_RANKS.contains(str(s, "designation"))) out.add(s);
        }
        return out;
    }

    private void render() {
        a.content.removeAllViews();
        a.stopRefreshing();
        boolean isStaff = RoleAccess.isStaff(role);
        heading("TASKS", isStaff ? "My Tasks" : "Tasks & Special Bandobast",
                isStaff ? "Tasks assigned to you. Update progress as you work; your reporting officer sees each change."
                        : "Assign and track time-bound tasks. Tasks past their expected completion are flagged automatically.");
        if (RoleAccess.canManageTasks(role)) a.content.addView(fullWidth(primary("+ Assign new task", this::createDialog)));
        if (RoleAccess.canViewAllTasks(role)) {
            tabs(new String[]{"All tasks", "Current per person (" + current.length() + ")"}, view, i -> {
                view = i;
                render();
            });
        }
        if (view == 0) {
            LinearLayout filter = card(0);
            Spinner status = spinner(prepend("All statuses", STATUSES), statusFilter.isEmpty() ? 0 : Arrays.asList(STATUSES).indexOf(statusFilter) + 1);
            labeled(filter, "Status", status);
            List<String> categoryNames = new ArrayList<>();
            categoryNames.add("All categories");
            int categorySelected = 0;
            for (int i = 0; i < CATEGORIES.length; i++) {
                categoryNames.add(CATEGORIES[i][1]);
                if (CATEGORIES[i][0].equals(categoryFilter)) categorySelected = i + 1;
            }
            Spinner category = spinner(categoryNames, categorySelected);
            labeled(filter, "Category", category);
            CheckBox overdue = new CheckBox(a);
            overdue.setText("Overdue only");
            overdue.setChecked(overdueOnly);
            filter.addView(overdue);
            filter.addView(buttonRow(primary("Apply filter", () -> {
                int p = status.getSelectedItemPosition();
                statusFilter = p == 0 ? "" : STATUSES[p - 1];
                overdueOnly = overdue.isChecked();
                int cp = category.getSelectedItemPosition();
                categoryFilter = cp == 0 ? "" : CATEGORIES[cp - 1][0];
                show();
            })));
            add(filter);
        }
        JSONArray rows = view == 0 ? tasks : current;
        section((view == 1 ? "CURRENT OPEN TASK FOR EACH OFFICER" : "TASKS") + " (" + rows.length() + ")");
        if (rows.length() == 0) empty("No tasks found.");
        if (view == 1) {
            for (int i = 0; i < rows.length(); i++) {
                JSONObject t = rows.optJSONObject(i);
                if (t != null) addTask(t, true);
            }
            return;
        }
        // One section per category; "Others" gets one section per custom header.
        for (String[] c : CATEGORIES) {
            if ("OTHERS".equals(c[0])) continue;
            addGroup(c[1], null, tasksWhere(rows, c[0], null, false));
        }
        java.util.LinkedHashMap<String, String> headers = new java.util.LinkedHashMap<>();
        for (int i = 0; i < rows.length(); i++) {
            JSONObject t = rows.optJSONObject(i);
            if (t == null || !isOthers(t)) continue;
            String h = str(t, "custom_title").trim();
            String key = h.toLowerCase(Locale.ROOT);
            if (!headers.containsKey(key)) headers.put(key, h);
        }
        List<String> keys = new ArrayList<>(headers.keySet());
        java.util.Collections.sort(keys, (x, y) -> x.isEmpty() ? (y.isEmpty() ? 0 : 1) : y.isEmpty() ? -1 : x.compareTo(y));
        for (String key : keys) {
            String h = headers.get(key);
            addGroup(h.isEmpty() ? "Others" : h, h.isEmpty() ? null : "Others", tasksWhere(rows, "OTHERS", key, true));
        }
    }

    private static boolean isOthers(JSONObject t) {
        String c = t.optString("category", "");
        return c.isEmpty() || "OTHERS".equals(c);
    }

    private List<JSONObject> tasksWhere(JSONArray rows, String category, String headerKey, boolean byHeader) {
        List<JSONObject> out = new ArrayList<>();
        for (int i = 0; i < rows.length(); i++) {
            JSONObject t = rows.optJSONObject(i);
            if (t == null) continue;
            if (byHeader) {
                if (isOthers(t) && str(t, "custom_title").trim().toLowerCase(Locale.ROOT).equals(headerKey)) out.add(t);
            } else if (category.equals(t.optString("category", ""))) {
                out.add(t);
            }
        }
        return out;
    }

    private void addGroup(String title, String subtitle, List<JSONObject> group) {
        if (group.isEmpty()) return;
        section((title + (subtitle == null ? "" : " · " + subtitle)).toUpperCase(Locale.ROOT) + " (" + group.size() + ")");
        for (JSONObject t : group) addTask(t, false);
    }

    private static List<String> prepend(String first, String[] rest) {
        List<String> out = new ArrayList<>();
        out.add(first);
        out.addAll(Arrays.asList(rest));
        return out;
    }

    private void addTask(JSONObject t, boolean showCategory) {
        final int id = t.optInt("id");
        final String status = str(t, "status");
        boolean overdue = t.optBoolean("is_overdue");
        int accent = overdue ? RED : "Completed".equals(status) ? GREEN : "In Progress".equals(status) ? BLUE
                : "On Hold".equals(status) ? AMBER : MUTED;
        LinearLayout card = card(accent);
        card.addView(titleRow(text("#" + id + " · " + str(t, "description"), 14, INK, true),
                overdue ? badge("OVERDUE", RED, RED_BG) : statusBadge(status)));
        if (showCategory) {
            String label = "OTHERS".equals(str(t, "category")) && !str(t, "custom_title").isEmpty()
                    ? str(t, "custom_title") : str(t, "category_label", "Others");
            card.addView(muted("Category: " + label));
        }
        card.addView(muted("Assigned: " + person(str(t, "assignee_name", "Staff #" + str(t, "assignee_id")), str(t, "assignee_service_number"))));
        card.addView(muted("Reporting officer: " + str(t, "reporting_officer_name", "—")));
        card.addView(muted("Expected completion: " + (str(t, "expected_completion").isEmpty() ? "No deadline" : dateTime(str(t, "expected_completion")))));
        if (overdue) card.addView(statusBadge(status));
        List<android.widget.Button> buttons = new ArrayList<>();
        if (canUpdate(t)) buttons.add(secondary("Status: " + status, () -> statusDialog(t)));
        if (RoleAccess.canManageTasks(role)) buttons.add(secondary("Reporting officer", () -> reportingDialog(t)));
        if (!buttons.isEmpty()) addButtons(card, buttons);
        addTight(card);
    }

    private void statusDialog(JSONObject t) {
        final int id = t.optInt("id");
        final String status = str(t, "status");
        List<String> allowed = new ArrayList<>();
        for (String s : STATUSES) {
            if (RoleAccess.canManageTasks(role) || !"Cancelled".equals(s) || "Cancelled".equals(status)) allowed.add(s);
        }
        new AlertDialog.Builder(a).setTitle("Task #" + id + " status")
                .setSingleChoiceItems(allowed.toArray(new String[0]), allowed.indexOf(status), (d, which) -> {
                    d.dismiss();
                    String chosen = allowed.get(which);
                    if (!chosen.equals(status)) {
                        act("/tasks/" + id + "/status", "PATCH", body("new_status", chosen), "Task #" + id + " updated to '" + chosen + "'.");
                    }
                })
                .setNegativeButton("Cancel", null).show();
    }

    private void reportingDialog(JSONObject t) {
        final int id = t.optInt("id");
        List<JSONObject> officers = officers();
        List<String> names = new ArrayList<>();
        names.add("— none —");
        int selected = 0;
        for (int i = 0; i < officers.size(); i++) {
            JSONObject o = officers.get(i);
            names.add(str(o, "name") + " (" + str(o, "designation") + ")");
            if (!t.isNull("reporting_officer_id") && o.optInt("id") == t.optInt("reporting_officer_id")) selected = i + 1;
        }
        new AlertDialog.Builder(a).setTitle("Reporting officer")
                .setSingleChoiceItems(names.toArray(new String[0]), selected, (d, which) -> {
                    d.dismiss();
                    JSONObject payload = new JSONObject();
                    try {
                        payload.put("reporting_officer_id", which == 0 ? JSONObject.NULL : officers.get(which - 1).optInt("id"));
                    } catch (org.json.JSONException ignored) {
                        // Literal key.
                    }
                    act("/tasks/" + id, "PATCH", payload, "Reporting officer updated.");
                })
                .setNegativeButton("Cancel", null).show();
    }

    private void createDialog() {
        LinearLayout form = formBody();
        List<String> categoryNames = new ArrayList<>();
        categoryNames.add("-- Choose category --");
        for (String[] c : CATEGORIES) categoryNames.add(c[1]);
        Spinner category = spinner(categoryNames, 0);
        labeled(form, "Category", category);
        EditText customTitle = field("Header for this task (e.g. Election duty)", android.text.InputType.TYPE_CLASS_TEXT);
        customTitle.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(CUSTOM_TITLE_MAX)});
        LinearLayout customRow = new LinearLayout(a);
        customRow.setOrientation(LinearLayout.VERTICAL);
        labeled(customRow, "Header for this task", customTitle);
        form.addView(customRow);
        customRow.setVisibility(android.view.View.GONE);
        category.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(android.widget.AdapterView<?> parent, android.view.View v, int pos, long id) {
                customRow.setVisibility(pos == CATEGORIES.length ? android.view.View.VISIBLE : android.view.View.GONE);
            }
            @Override public void onNothingSelected(android.widget.AdapterView<?> parent) { }
        });
        EditText description = multiline("Task description");
        labeled(form, "Task description", description);
        List<String> names = new ArrayList<>();
        List<Integer> ids = new ArrayList<>();
        names.add("-- Choose officer --");
        ids.add(0);
        for (int i = 0; i < staff.length(); i++) {
            JSONObject s = staff.optJSONObject(i);
            if (s == null) continue;
            names.add(str(s, "name") + " (" + str(s, "service_number") + " · " + str(s, "designation") + ")");
            ids.add(s.optInt("id"));
        }
        Spinner assignee = spinner(names, 0);
        labeled(form, "Assigned officer", assignee);
        List<JSONObject> officers = officers();
        List<String> officerNames = new ArrayList<>();
        officerNames.add("-- Choose reporting officer --");
        for (JSONObject o : officers) officerNames.add(str(o, "name") + " (" + str(o, "designation") + ")");
        Spinner reporting = spinner(officerNames, 0);
        labeled(form, "Reporting officer", reporting);
        EditText deadline = field("Expected completion (optional)", android.text.InputType.TYPE_NULL);
        deadline.setFocusable(false);
        deadline.setOnClickListener(v -> a.pickDateTime(deadline));
        labeled(form, "Expected completion (tap to choose)", deadline);
        form("Assign new task", form, "Assign task", () -> {
            int cp = category.getSelectedItemPosition();
            if (cp == 0) {
                a.toast("Choose the task category.");
                return false;
            }
            boolean others = cp == CATEGORIES.length;
            if (others && customTitle.getText().toString().trim().isEmpty()) {
                customTitle.setError("Enter a header for Others");
                return false;
            }
            if (description.getText().toString().trim().isEmpty()) {
                description.setError("Required");
                return false;
            }
            int assigneeId = ids.get(assignee.getSelectedItemPosition());
            if (assigneeId == 0) {
                a.toast("Choose the assigned officer.");
                return false;
            }
            int rp = reporting.getSelectedItemPosition();
            Object tag = deadline.getTag();
            String when = null;
            if (tag instanceof Long) {
                SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
                f.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
                when = f.format(new Date((Long) tag));
            }
            act("/tasks/", "POST", body("description", description.getText().toString().trim(),
                    "category", CATEGORIES[cp - 1][0], "custom_title", others ? customTitle.getText().toString().trim() : null,
                    "assignee_id", assigneeId,
                    "reporting_officer_id", rp > 0 ? officers.get(rp - 1).optInt("id") : null, "expected_completion", when),
                    "Task created and the officer notified.");
            return true;
        });
    }
}
