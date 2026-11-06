package com.panjagutta.dutymanagement;

import android.app.AlertDialog;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Shift roster: week/month/list views, allocations, versions and the draft → approve → publish workflow (web: /roster). */
final class RosterScreen extends ModuleScreen {
    private static final String[] SHIFTS = {"A", "B", "C"};

    private int view; // 0 week, 1 month, 2 list
    private Calendar anchor = Calendar.getInstance();
    private String selectedDay;
    private String listDate = "";
    private String listShift = "";

    private JSONArray rosters = new JSONArray();
    private JSONArray cells = new JSONArray();
    private JSONArray myDuties = new JSONArray();
    private final Map<String, String> labels = new HashMap<>();

    private JSONObject detail;
    private JSONArray versions;

    RosterScreen(MainActivity a) {
        super(a);
        selectedDay = iso(anchor);
    }

    @Override
    boolean back() {
        if (versions != null) {
            versions = null;
            if (detail != null) renderDetail();
            else render();
            return true;
        }
        if (detail != null) {
            detail = null;
            show();
            return true;
        }
        return false;
    }

    @Override
    void show() {
        if (detail != null) {
            openDetail(detail.optInt("id"));
            return;
        }
        final Calendar start = weekStart();
        final String rangeStart = view == 1 ? iso(monthGridStart()) : iso(start);
        final String rangeEnd = view == 1 ? iso(addDays(monthGridStart(), 41)) : iso(addDays(start, 6));
        load(() -> {
            Object[] r = new Object[4];
            if (view == 2) {
                StringBuilder q = new StringBuilder("/rosters/?");
                if (!listDate.isEmpty()) q.append("roster_date=").append(listDate).append('&');
                if (!listShift.isEmpty()) q.append("shift_code=").append(listShift).append('&');
                r[0] = a.requestArray(q.toString());
            } else {
                r[1] = a.request("/rosters/calendar?start_date=" + rangeStart + "&end_date=" + rangeEnd, "GET", null, false).optJSONArray("cells");
            }
            try {
                JSONArray shifts = a.request("/policy/", "GET", null, false).optJSONArray("shifts");
                r[2] = shifts;
            } catch (Exception e) {
                r[2] = null;
            }
            try {
                r[3] = a.requestArray("/mobile/rosters");
            } catch (Exception e) {
                r[3] = new JSONArray();
            }
            return r;
        }, r -> {
            if (r[0] != null) rosters = (JSONArray) r[0];
            if (r[1] != null) cells = (JSONArray) r[1];
            if (r[2] != null) {
                JSONArray shifts = (JSONArray) r[2];
                for (int i = 0; i < shifts.length(); i++) {
                    JSONObject s = shifts.optJSONObject(i);
                    if (s != null) labels.put(str(s, "shift_code"), str(s, "start_time") + "–" + str(s, "end_time"));
                }
            }
            myDuties = (JSONArray) r[3];
            render();
        });
    }

    private Calendar weekStart() {
        Calendar c = (Calendar) anchor.clone();
        c.add(Calendar.DAY_OF_YEAR, -(c.get(Calendar.DAY_OF_WEEK) - Calendar.SUNDAY));
        return c;
    }

    private Calendar monthGridStart() {
        Calendar first = (Calendar) anchor.clone();
        first.set(Calendar.DAY_OF_MONTH, 1);
        first.add(Calendar.DAY_OF_YEAR, -(first.get(Calendar.DAY_OF_WEEK) - Calendar.SUNDAY));
        return first;
    }

    private String shiftLabel(String code) {
        String t = labels.get(code);
        return "Shift " + code + (t == null ? "" : " (" + t + ")");
    }

    private JSONObject cellFor(String date, String shift) {
        for (int i = 0; i < cells.length(); i++) {
            JSONObject c = cells.optJSONObject(i);
            if (c != null && date.equals(str(c, "date")) && shift.equals(str(c, "shift_code"))) return c;
        }
        return null;
    }

    // ── List / calendar ──────────────────────────────────────────────────────────

    private void render() {
        a.content.removeAllViews();
        heading("ROSTER", "Duty Roster", "Daily, weekly and monthly rosters for Shifts A, B and C. Every change is a new version with a reason.");
        if (RoleAccess.canCreateRoster(role)) {
            a.content.addView(fullWidth(primary("+ Create roster draft", () -> createDialog(iso(Calendar.getInstance()), "A"))));
        }
        addMyDuties();
        tabs(new String[]{"Week", "Month", "List / day"}, view, i -> {
            view = i;
            show();
        });
        if (view == 2) renderList();
        else renderCalendar();
    }

    private void addMyDuties() {
        if (myDuties.length() == 0) return;
        section("MY PUBLISHED DUTY");
        String today = iso(Calendar.getInstance());
        for (int i = 0; i < myDuties.length() && i < 4; i++) {
            JSONObject d = myDuties.optJSONObject(i);
            if (d == null) continue;
            boolean isToday = today.equals(str(d, "duty_date"));
            LinearLayout card = card(isToday ? GREEN : BLUE);
            card.addView(text((isToday ? "Today" : day(str(d, "duty_date"))) + " · Shift " + str(d, "shift_name"), 13, INK, true));
            card.addView(muted(str(d, "duty_category") + " · " + str(d, "start_time") + "–" + str(d, "end_time")
                    + (str(d, "current_task").isEmpty() ? "" : " · " + str(d, "current_task"))));
            addTight(card);
        }
    }

    private void renderCalendar() {
        LinearLayout nav = hrow();
        String title = view == 1 ? monthTitle(anchor)
                : weekdayTitle(weekStart()) + " – " + weekdayTitle(addDays(weekStart(), 6));
        nav.addView(secondary("‹", () -> {
            anchor = view == 1 ? shiftMonth(-1) : addDays(anchor, -7);
            show();
        }));
        TextView label = text(title, 13, INK, true);
        label.setGravity(Gravity.CENTER);
        nav.addView(label, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        nav.addView(secondary("›", () -> {
            anchor = view == 1 ? shiftMonth(1) : addDays(anchor, 7);
            show();
        }));
        addTight(nav);
        LinearLayout today = hrow();
        today.addView(secondary("Today", () -> {
            anchor = Calendar.getInstance();
            selectedDay = iso(anchor);
            show();
        }));
        today.addView(muted("   A/B/C = shifts · tap a shift to open it"));
        addTight(today);
        if (view == 0) {
            for (int i = 0; i < 7; i++) addDayCard(iso(addDays(weekStart(), i)), addDays(weekStart(), i));
        } else {
            addMonthGrid();
            Calendar sel = cal(selectedDay);
            addDayCard(selectedDay, sel);
        }
    }

    private Calendar shiftMonth(int delta) {
        Calendar c = (Calendar) anchor.clone();
        c.set(Calendar.DAY_OF_MONTH, 1);
        c.add(Calendar.MONTH, delta);
        return c;
    }

    private void addMonthGrid() {
        LinearLayout grid = new LinearLayout(a);
        grid.setOrientation(LinearLayout.VERTICAL);
        grid.setPadding(a.dp(6), a.dp(8), a.dp(6), a.dp(8));
        grid.setBackground(a.roundRect(SURFACE, LINE, 14));
        LinearLayout head = new LinearLayout(a);
        for (String d : new String[]{"S", "M", "T", "W", "T", "F", "S"}) {
            TextView t = text(d, 9, MUTED, true);
            t.setGravity(Gravity.CENTER);
            head.addView(t, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        }
        grid.addView(head);
        Calendar day = monthGridStart();
        String todayIso = iso(Calendar.getInstance());
        for (int w = 0; w < 6; w++) {
            LinearLayout row = new LinearLayout(a);
            for (int d = 0; d < 7; d++) {
                final String ds = iso(day);
                boolean inMonth = day.get(Calendar.MONTH) == anchor.get(Calendar.MONTH);
                LinearLayout cell = new LinearLayout(a);
                cell.setOrientation(LinearLayout.VERTICAL);
                cell.setGravity(Gravity.CENTER_HORIZONTAL);
                cell.setPadding(0, a.dp(4), 0, a.dp(4));
                if (ds.equals(selectedDay)) cell.setBackground(a.roundRect(TINT, BLUE, 8));
                TextView n = text(String.valueOf(day.get(Calendar.DAY_OF_MONTH)), 11,
                        ds.equals(todayIso) ? BLUE : inMonth ? INK : MUTED, ds.equals(todayIso));
                n.setGravity(Gravity.CENTER);
                cell.addView(n);
                StringBuilder dots = new StringBuilder();
                for (String s : SHIFTS) dots.append(cellFor(ds, s) != null ? "●" : "·");
                TextView dot = text(dots.toString(), 7, inMonth ? BLUE : MUTED, false);
                dot.setGravity(Gravity.CENTER);
                dot.setPadding(0, 0, 0, 0);
                cell.addView(dot);
                cell.setOnClickListener(v -> {
                    selectedDay = ds;
                    render();
                });
                row.addView(cell, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
                day.add(Calendar.DAY_OF_YEAR, 1);
            }
            grid.addView(row);
        }
        add(grid);
    }

    private void addDayCard(String ds, Calendar day) {
        boolean isToday = ds.equals(iso(Calendar.getInstance()));
        LinearLayout card = card(isToday ? BLUE : 0);
        card.addView(text(weekdayTitle(day) + (isToday ? "  ·  Today" : ""), 13, INK, true));
        for (String s : SHIFTS) {
            JSONObject c = cellFor(ds, s);
            LinearLayout row = hrow();
            row.setPadding(0, a.dp(6), 0, 0);
            row.addView(text(shiftLabel(s), 12, MUTED, false), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            if (c != null) {
                final int id = c.optInt("id");
                row.addView(rosterBadge(str(c, "status"), "v" + str(c, "version") + " · " + str(c, "status")
                        + (c.optInt("assignment_count") > 0 ? " · " + c.optInt("assignment_count") : "")));
                row.setOnClickListener(v -> openDetail(id));
            } else if (RoleAccess.canCreateRoster(role)) {
                row.addView(secondary("+ Draft", () -> createDialog(ds, s)));
            } else {
                row.addView(muted("—"));
            }
            card.addView(row);
        }
        add(card);
    }

    private TextView rosterBadge(String status, String label) {
        int fg = statusColor(status);
        int bg = "published".equals(status) ? GREEN_BG : "submitted".equals(status) ? AMBER_BG
                : "approved".equals(status) ? TINT : BACKGROUND;
        return badge(label.toUpperCase(Locale.ROOT), fg, bg);
    }

    private static int statusColor(String status) {
        return "published".equals(status) ? GREEN : "submitted".equals(status) ? AMBER
                : "approved".equals(status) ? BLUE : MUTED;
    }

    private void renderList() {
        LinearLayout filter = card(0);
        EditText date = a.dateField(listDate.isEmpty() ? a.today() : listDate, null);
        if (listDate.isEmpty()) date.setText("");
        labeled(filter, "Date (optional)", date);
        Spinner shift = spinner(new String[]{"All shifts", "Shift A", "Shift B", "Shift C"},
                listShift.isEmpty() ? 0 : "ABC".indexOf(listShift) + 1);
        labeled(filter, "Shift", shift);
        filter.addView(buttonRow(
                secondary("Reset", () -> {
                    listDate = "";
                    listShift = "";
                    show();
                }),
                primary("Apply", () -> {
                    listDate = date.getText().toString().trim();
                    int p = shift.getSelectedItemPosition();
                    listShift = p == 0 ? "" : SHIFTS[p - 1];
                    show();
                })));
        add(filter);
        section("ROSTERS (" + rosters.length() + ")");
        if (rosters.length() == 0) empty("No rosters match your filters.");
        for (int i = 0; i < rosters.length(); i++) {
            JSONObject r = rosters.optJSONObject(i);
            if (r == null) continue;
            final int id = r.optInt("id");
            String status = str(r, "status");
            LinearLayout card = card(statusColor(status));
            card.addView(titleRow(text("#" + id + " · " + day(str(r, "roster_date")) + " · Shift " + str(r, "shift_code"), 14, INK, true),
                    rosterBadge(status, status)));
            card.addView(muted("v" + str(r, "version") + (r.optBoolean("is_latest", true) ? "" : " (superseded)")
                    + " · " + str(r, "prepared_by", "—") + (str(r, "approved_by").isEmpty() ? "" : " → " + str(r, "approved_by"))));
            card.addView(muted(str(r, "change_reason", "Initial preparation")));
            card.setClickable(true);
            card.setOnClickListener(v -> openDetail(id));
            addTight(card);
        }
    }

    // ── Detail ───────────────────────────────────────────────────────────────────

    private void openDetail(int id) {
        load(() -> a.request("/rosters/" + id, "GET", null, false), d -> {
            detail = d;
            renderDetail();
        });
    }

    private void renderDetail() {
        a.content.removeAllViews();
        a.stopRefreshing();
        final JSONObject d = detail;
        final int id = d.optInt("id");
        final String status = str(d, "status");
        backLink("Back to rosters", this::back);
        heading("ROSTER #" + id, day(str(d, "roster_date")) + " · Shift " + str(d, "shift_code"),
                shiftLabel(str(d, "shift_code")) + " · v" + str(d, "version")
                        + (d.optBoolean("is_latest", true) ? "" : " (superseded)"));
        LinearLayout summary = card(statusColor(status));
        summary.addView(titleRow(text("Status", 12, MUTED, false), rosterBadge(status, status)));
        summary.addView(muted("Assigned " + d.optInt("total_assigned") + " · Vacant " + d.optInt("total_vacancies")));
        summary.addView(muted("Reason: " + str(d, "change_reason", "None recorded")));
        if (!str(d, "approval_comments").isEmpty()) summary.addView(muted("SHO comments: " + str(d, "approval_comments")));
        summary.addView(muted((str(d, "prepared_by").isEmpty() ? "" : "Prepared by " + str(d, "prepared_by"))
                + (str(d, "modified_by").isEmpty() ? "" : " · modified by " + str(d, "modified_by"))
                + (str(d, "approved_by").isEmpty() ? "" : " · approved by " + str(d, "approved_by"))));
        add(summary);

        // Actions, each shown only to the roles allowed to use it.
        List<android.widget.Button> buttons = new ArrayList<>();
        if ("draft".equals(status) && RoleAccess.canSubmitRoster(role)) {
            buttons.add(primary("Submit for approval", () -> confirm("Submit roster #" + id + " for SHO approval?",
                    () -> act("/rosters/" + id + "/submit", "POST", null, "Roster #" + id + " submitted for SHO approval.", () -> openDetail(id)))));
        }
        if ("submitted".equals(status) && RoleAccess.canApproveRoster(role)) {
            buttons.add(primary("Approve", () -> prompt("Approve roster #" + id, "Comments (optional)", false,
                    c -> act("/rosters/" + id + "/approve", "POST", body("comments", c.isEmpty() ? null : c), "Roster #" + id + " approved.", () -> openDetail(id)))));
            buttons.add(danger("Return", () -> prompt("Return roster #" + id, "What must change? (required)", true,
                    c -> act("/rosters/" + id + "/reject", "POST", body("comments", c), "Roster #" + id + " returned to the Admin SI.", () -> openDetail(id)))));
        }
        if ("approved".equals(status) && RoleAccess.canPublishRoster(role)) {
            buttons.add(success("Publish", () -> confirm("Publish roster #" + id + "? Assigned staff will be notified.",
                    () -> act("/rosters/" + id + "/publish", "POST", null, "Roster #" + id + " published; assigned staff notified.", () -> openDetail(id)))));
        }
        if (("approved".equals(status) || "published".equals(status)) && RoleAccess.canReviseRoster(role)
                && d.optBoolean("is_latest", true)) {
            buttons.add(secondary("Revise (new version)", () -> prompt("New version from roster #" + id,
                    "Reason for the change (required)", true,
                    c -> call("/rosters/" + id + "/revise", "POST", body("change_reason", c), "New version created.", res -> {
                        if (res.optInt("id") > 0) openDetail(res.optInt("id"));
                        else show();
                    }))));
        }
        if ("draft".equals(status) && RoleAccess.canSee(RoleAccess.ALLOCATION, role)) {
            buttons.add(primary("Open in Duty Allocation", () -> {
                a.allocationDate = str(d, "roster_date");
                a.allocationShift = str(d, "shift_code");
                a.openModule(RoleAccess.ALLOCATION);
            }));
        }
        buttons.add(secondary("Versions", () -> loadVersions(id)));
        if (RoleAccess.canExplainRoster(role)) buttons.add(secondary("AI Explain", () -> explain(id)));
        LinearLayout actions = card(0);
        actions.addView(text("ACTIONS", 10, BLUE, true));
        addButtons(actions, buttons);
        add(actions);

        JSONArray vacancies = arr(d, "vacancies_by_duty");
        StringBuilder vac = new StringBuilder();
        for (int i = 0; i < vacancies.length(); i++) {
            JSONObject v = vacancies.optJSONObject(i);
            if (v != null && v.optInt("vacant") > 0) {
                if (vac.length() > 0) vac.append(" · ");
                vac.append(str(v, "category")).append(' ').append(v.optInt("allocated")).append('/').append(v.optInt("required"));
            }
        }
        if (vac.length() > 0) {
            LinearLayout warn = card(AMBER);
            warn.addView(text("Vacancies: " + vac, 12, AMBER, true));
            add(warn);
        }
        JSONArray warnings = arr(d, "warnings");
        for (int i = 0; i < warnings.length(); i++) {
            LinearLayout w = card(AMBER);
            w.addView(text(warnings.optString(i), 12, AMBER, false));
            add(w);
        }

        JSONArray assignments = arr(d, "assignments");
        section("ALLOCATIONS (" + assignments.length() + ")");
        if (assignments.length() == 0) empty("No duty points allocated yet.");
        for (int i = 0; i < assignments.length(); i++) {
            JSONObject as = assignments.optJSONObject(i);
            if (as == null) continue;
            LinearLayout card = card(as.optBoolean("is_exception") ? AMBER : 0);
            card.addView(text(str(as, "duty_category") + (str(as, "duty_section").isEmpty() ? "" : " · " + str(as, "duty_section")), 13, INK, true));
            card.addView(muted(person(str(as, "staff_name"), str(as, "service_number")) + " · " + str(as, "designation")
                    + (as.isNull("sector_id") ? " · Station" : " · Sector " + str(as, "sector_id"))));
            if (as.optBoolean("is_exception")) {
                card.addView(text("⚠ Exception: " + str(as, "exception_reason")
                        + (str(as, "exception_authorized_by").isEmpty() ? "" : " — authorized by " + str(as, "exception_authorized_by")), 11, AMBER, true));
            }
            addTight(card);
        }
    }

    private void loadVersions(int id) {
        load(() -> a.requestArray("/rosters/" + id + "/versions"), list -> {
            versions = list;
            renderVersions();
        });
    }

    private void renderVersions() {
        a.content.removeAllViews();
        backLink("Back to roster #" + detail.optInt("id"), this::back);
        heading("HISTORY", "Version history", "Rosters are never overwritten. Each change is kept as a version with its reason.");
        for (int i = 0; i < versions.length(); i++) {
            JSONObject v = versions.optJSONObject(i);
            if (v == null) continue;
            final int vid = v.optInt("id");
            LinearLayout card = card(statusColor(str(v, "status")));
            card.addView(titleRow(text("v" + str(v, "version") + (v.optBoolean("is_latest") ? " (latest)" : ""), 14, INK, true),
                    rosterBadge(str(v, "status"), str(v, "status"))));
            card.addView(muted(str(v, "change_reason", "—")));
            card.addView(muted("Prepared " + str(v, "prepared_by", "—") + " · " + dateTime(str(v, "created_at"))
                    + (str(v, "approved_by").isEmpty() ? "" : " · approved by " + str(v, "approved_by"))
                    + " · " + v.optInt("assignment_count") + " assigned"));
            card.setClickable(true);
            card.setOnClickListener(x -> {
                versions = null;
                openDetail(vid);
            });
            addTight(card);
        }
    }

    private void explain(int id) {
        a.toast("Analysing rotation rules, rest hours and leave records…");
        a.executor.execute(() -> {
            try {
                JSONObject res = a.request("/ai/explain-roster", "POST", body("roster_id", id), false);
                a.mainHandler.post(() -> {
                    StringBuilder msg = new StringBuilder();
                    msg.append(str(res, "disclaimer")).append("\n\n");
                    JSONArray reasons = arr(res, "key_reasons");
                    for (int i = 0; i < reasons.length(); i++) msg.append("• ").append(reasons.optString(i)).append("\n");
                    msg.append("\nExcluded on leave: ").append(res.optInt("excluded_on_leave"))
                            .append("  ·  Active assigned: ").append(res.optInt("total_assignments"));
                    new AlertDialog.Builder(a).setTitle("AI roster explainability").setMessage(msg.toString())
                            .setPositiveButton("Close", null).show();
                });
            } catch (Exception e) {
                final String m = e.getMessage() == null ? "Could not explain the roster." : e.getMessage();
                a.mainHandler.post(() -> a.toast(m));
            }
        });
    }

    private void createDialog(String date, String shift) {
        LinearLayout body = formBody();
        EditText dateField = a.dateField(date, null);
        labeled(body, "Roster date", dateField);
        Spinner shiftSpinner = spinner(new String[]{shiftLabel("A"), shiftLabel("B"), shiftLabel("C")}, "ABC".indexOf(shift));
        labeled(body, "Shift", shiftSpinner);
        EditText reason = multiline("Reason / change note");
        reason.setText("Routine daily roster preparation");
        labeled(body, "Reason / change note", reason);
        form("Create roster draft", body, "Create draft", () -> {
            String d = dateField.getText().toString().trim();
            if (!a.validDate(d)) {
                dateField.setError("Choose a date");
                return false;
            }
            JSONObject payload = body("roster_date", d, "shift_code", SHIFTS[shiftSpinner.getSelectedItemPosition()],
                    "change_reason", reason.getText().toString().trim(), "assignments", new JSONArray());
            call("/rosters/", "POST", payload, "Draft created.", res -> {
                if (res.optInt("id") > 0) openDetail(res.optInt("id"));
                else show();
            });
            return true;
        });
    }
}
