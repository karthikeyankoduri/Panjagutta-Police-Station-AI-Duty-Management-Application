package com.panjagutta.dutymanagement;

import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Weekly duty allocation (web: Roster &gt; Allocation &gt; Week). Every officer gets a card with seven day rows;
 * a day holds one shift and duty point. Saving fans out to the per-day rosters on the server in a single
 * transaction, so the usual rules (leave, rest, shift overlap, authorized exceptions) apply to every day.
 * Editing is for the SHO and Admin SI; the Sector SI sees the week read-only. Shown inside
 * {@link AllocationScreen}, which owns the Day | Week toggle.
 */
final class WeekAllocationScreen extends ModuleScreen {
    private static final String[] SHIFTS = {"A", "B", "C"};
    private static final int PAGE = 15;

    private final Runnable showDay;

    private String weekStart;
    private final List<String> days = new ArrayList<>();
    private JSONArray weekRosters = new JSONArray();
    private JSONArray staff = new JSONArray();
    private JSONArray duties = new JSONArray();
    private JSONArray sectors = new JSONArray();
    private JSONArray authorizers = new JSONArray();
    /** "staffId|date" -> {shift, dutyId, is_exception, exception_reason, exception_authorized_by_id} (same shape as the web draft). */
    private final Map<String, JSONObject> grid = new HashMap<>();
    /** "date|shift" of rosters that are approved or published and cannot be edited here. */
    private final Set<String> locked = new HashSet<>();
    private final Map<String, List<JSONObject>> issueByKey = new HashMap<>();
    private JSONArray issues = new JSONArray();
    private String baseline = "";
    private boolean dirty;
    private JSONObject restorable;
    private String skippedNote = "";
    private String poolSector = "";
    private String search = "";
    private String changeReason = "Weekly duty allocation";
    private int limit = PAGE;
    private int validationId;

    WeekAllocationScreen(MainActivity a, Runnable showDay) {
        super(a);
        this.showDay = showDay;
    }

    boolean isDirty() {
        return dirty;
    }

    private boolean canEdit() {
        return RoleAccess.canEditAllocation(role);
    }

    private static String key(int staffId, String date) {
        return staffId + "|" + date;
    }

    private static String mondayOf(String ymd) {
        java.util.Calendar c = cal(ymd);
        int dow = c.get(java.util.Calendar.DAY_OF_WEEK); // Sunday = 1
        return iso(addDays(c, -((dow + 5) % 7)));
    }

    private static JSONObject newCell(String shift, int dutyId) {
        JSONObject c = new JSONObject();
        try {
            c.put("shift", shift);
            c.put("dutyId", dutyId > 0 ? (Object) dutyId : JSONObject.NULL);
            c.put("is_exception", false);
            c.put("exception_reason", JSONObject.NULL);
            c.put("exception_authorized_by_id", JSONObject.NULL);
        } catch (JSONException ignored) {
            // Literal keys.
        }
        return c;
    }

    private static int dutyIdOf(JSONObject cell) {
        return cell == null || cell.isNull("dutyId") ? 0 : cell.optInt("dutyId");
    }

    private static int authorizerOf(JSONObject cell) {
        return cell == null || cell.isNull("exception_authorized_by_id") ? 0 : cell.optInt("exception_authorized_by_id");
    }

    private static String signature(Map<String, JSONObject> g) {
        List<String> keys = new ArrayList<>();
        for (Map.Entry<String, JSONObject> e : g.entrySet()) if (dutyIdOf(e.getValue()) > 0) keys.add(e.getKey());
        Collections.sort(keys);
        StringBuilder sb = new StringBuilder();
        for (String k : keys) {
            JSONObject c = g.get(k);
            sb.append(k).append(',').append(str(c, "shift")).append(',').append(dutyIdOf(c)).append(',')
                    .append(authorizerOf(c)).append(';');
        }
        return sb.toString();
    }

    private String draftKey() {
        return "alloc-week:" + weekStart;
    }

    // ── Loading ──────────────────────────────────────────────────────────────────

    @Override
    void show() {
        if (weekStart == null) weekStart = mondayOf(a.today());
        final String start = weekStart;
        load(() -> {
            Object[] r = new Object[6];
            r[0] = a.requestArray("/staff/?is_active=true");
            r[1] = a.requestArray("/duties/?active_only=true");
            r[2] = a.request("/rosters/week?start=" + start, "GET", null, false);
            try {
                r[3] = a.requestArray("/config/sectors");
            } catch (Exception e) {
                r[3] = new JSONArray();
            }
            try {
                r[4] = a.requestArray("/config/authorizers");
            } catch (Exception e) {
                r[4] = new JSONArray();
            }
            try {
                r[5] = a.request("/auth/drafts/" + java.net.URLEncoder.encode("alloc-week:" + start, "UTF-8"), "GET", null, false)
                        .optJSONObject("payload");
            } catch (Exception e) {
                r[5] = null;
            }
            return r;
        }, r -> {
            staff = (JSONArray) r[0];
            duties = (JSONArray) r[1];
            JSONObject w = (JSONObject) r[2];
            sectors = (JSONArray) r[3];
            authorizers = (JSONArray) r[4];

            weekStart = str(w, "week_start", weekStart);
            days.clear();
            JSONArray dayList = arr(w, "days");
            for (int i = 0; i < dayList.length(); i++) days.add(dayList.optString(i));
            weekRosters = arr(w, "rosters");
            locked.clear();
            for (int i = 0; i < weekRosters.length(); i++) {
                JSONObject ro = weekRosters.optJSONObject(i);
                if (ro != null && !ro.optBoolean("editable")) locked.add(str(ro, "date") + "|" + str(ro, "shift_code"));
            }
            grid.clear();
            JSONArray cells = arr(w, "cells");
            for (int i = 0; i < cells.length(); i++) {
                JSONObject c = cells.optJSONObject(i);
                if (c == null) continue;
                JSONObject cell = newCell(str(c, "shift_code"), c.optInt("duty_master_id"));
                try {
                    cell.put("is_exception", c.optBoolean("is_exception"));
                    cell.put("exception_reason", c.isNull("exception_reason") ? JSONObject.NULL : c.optString("exception_reason"));
                    cell.put("exception_authorized_by_id", c.isNull("exception_authorized_by_id")
                            ? JSONObject.NULL : c.optInt("exception_authorized_by_id"));
                } catch (JSONException ignored) {
                    // Literal keys.
                }
                grid.put(key(c.optInt("staff_id"), str(c, "date")), cell);
            }
            baseline = signature(grid);
            dirty = false;
            issues = new JSONArray();
            issueByKey.clear();
            restorable = null;
            JSONObject saved = (JSONObject) r[5];
            if (saved != null && canEdit()) {
                Map<String, JSONObject> savedGrid = gridFrom(saved);
                if (!signature(savedGrid).equals(baseline)) restorable = saved;
            }
            render();
        });
    }

    private static Map<String, JSONObject> gridFrom(JSONObject saved) {
        Map<String, JSONObject> g = new HashMap<>();
        java.util.Iterator<String> it = saved.keys();
        while (it.hasNext()) {
            String k = it.next();
            JSONObject c = saved.optJSONObject(k);
            if (c != null) g.put(k, c);
        }
        return g;
    }

    // ── Rendering ────────────────────────────────────────────────────────────────

    private void render() {
        a.content.removeAllViews();
        a.stopRefreshing();
        int assigned = 0;
        for (JSONObject c : grid.values()) if (dutyIdOf(c) > 0) assigned++;
        String range = days.isEmpty() ? weekStart : weekdayTitle(cal(days.get(0))) + " – " + weekdayTitle(cal(days.get(days.size() - 1)));
        heading("DUTY ALLOCATION", "Weekly Duty Allocation",
                range + " · " + assigned + " duty-day(s) assigned · set each officer's shift and duty point for the week");
        tabs(new String[]{"Day (by duty point)", "Week (by officer)"}, 1, i -> {
            if (i == 0) leave();
        });
        addControls();
        if (restorable != null) addRestoreBanner();
        if (!canEdit()) {
            LinearLayout note = card(BLUE);
            note.addView(muted("Only the SHO or Admin SI can change the weekly allocation. You can review it here."));
            add(note);
        }
        if (!skippedNote.isEmpty()) {
            LinearLayout note = card(AMBER);
            note.addView(text(skippedNote, 12, INK, false));
            add(note);
        }
        addRosterStatus();
        addIssues();
        addOfficers();
    }

    private void leave() {
        if (dirty) {
            confirm("You have unsaved changes for this week. Discard them?", showDay);
        } else {
            showDay.run();
        }
    }

    private void goTo(String ymd) {
        Runnable go = () -> {
            weekStart = mondayOf(ymd);
            skippedNote = "";
            limit = PAGE;
            show();
        };
        if (dirty) confirm("You have unsaved changes for this week. Discard them?", go);
        else go.run();
    }

    private void addControls() {
        LinearLayout card = card(0);
        card.addView(buttonRow(
                secondary("◀ Prev", () -> goTo(iso(addDays(cal(weekStart), -7)))),
                secondary("This week", () -> goTo(a.today())),
                secondary("Next ▶", () -> goTo(iso(addDays(cal(weekStart), 7))))));
        EditText dateField = a.dateField(weekStart, null);
        labeled(card, "Any date in the week", dateField);

        List<String> poolNames = new ArrayList<>();
        List<String> poolIds = new ArrayList<>();
        poolNames.add("All sectors");
        poolIds.add("");
        poolNames.add("Station (no sector)");
        poolIds.add("STATION");
        for (int i = 0; i < sectors.length(); i++) {
            JSONObject s = sectors.optJSONObject(i);
            if (s == null) continue;
            poolNames.add(str(s, "name"));
            poolIds.add(str(s, "id"));
        }
        Spinner poolSpinner = spinner(poolNames, Math.max(0, poolIds.indexOf(poolSector)));
        labeled(card, "Staff pool", poolSpinner);
        EditText searchField = searchField("Name or service no.", v -> { });
        searchField.setText(search);
        labeled(card, "Find officer", searchField);

        EditText reason = null;
        if (canEdit()) {
            reason = textField("Reason (audit log)");
            reason.setText(changeReason);
            labeled(card, "Reason (recorded in the audit log)", reason);
        }
        final EditText reasonField = reason;
        card.addView(buttonRow(primary("Apply filters / date", () -> {
            String d = dateField.getText().toString().trim();
            if (!a.validDate(d)) {
                dateField.setError("Choose a date");
                return;
            }
            poolSector = poolIds.get(poolSpinner.getSelectedItemPosition());
            search = searchField.getText().toString().trim();
            if (reasonField != null) changeReason = reasonField.getText().toString().trim();
            limit = PAGE;
            if (!mondayOf(d).equals(weekStart)) goTo(d);
            else render();
        })));
        if (canEdit()) {
            card.addView(buttonRow(success("💾 Save week" + (dirty ? " *" : ""), () -> {
                if (reasonField != null) changeReason = reasonField.getText().toString().trim();
                save();
            })));
        }
        add(card);
    }

    private void addRestoreBanner() {
        LinearLayout card = card(BLUE);
        card.addView(text("You have an unsaved weekly allocation for this week from an earlier session.", 12, INK, true));
        card.addView(buttonRow(
                primary("Restore it", () -> {
                    Map<String, JSONObject> saved = gridFrom(restorable);
                    grid.clear();
                    grid.putAll(saved);
                    restorable = null;
                    changed();
                    a.toast("Restored your unsaved weekly allocation. Review and save it.");
                }),
                secondary("Discard", () -> {
                    restorable = null;
                    saveDraftOnServer(null);
                    render();
                })));
        add(card);
    }

    private void addRosterStatus() {
        if (days.isEmpty()) return;
        LinearLayout card = card(0);
        card.addView(text("Rosters this week", 13, INK, true));
        for (String d : days) {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < weekRosters.length(); i++) {
                JSONObject ro = weekRosters.optJSONObject(i);
                if (ro != null && d.equals(str(ro, "date"))) {
                    sb.append(sb.length() == 0 ? "" : "  ·  ").append(str(ro, "shift_code")).append(' ').append(str(ro, "status"));
                }
            }
            card.addView(muted(weekdayTitle(cal(d)) + ":  " + (sb.length() == 0 ? "no rosters yet" : sb)));
        }
        add(card);
    }

    private void addIssues() {
        if (!canEdit()) return;
        List<JSONObject> blocking = new ArrayList<>();
        int advisory = 0;
        for (int i = 0; i < issues.length(); i++) {
            JSONObject issue = issues.optJSONObject(i);
            if (issue == null || issue.isNull("cell_index")) continue;
            if (issue.optBoolean("blocking")) blocking.add(issue);
            else advisory++;
        }
        if (blocking.isEmpty() && advisory == 0) return;
        LinearLayout card = card(blocking.isEmpty() ? BLUE : RED);
        card.addView(text(blocking.isEmpty() ? "✓ No blocking violations" : "⛔ " + blocking.size() + " violation(s) block saving",
                13, blocking.isEmpty() ? GREEN : RED, true));
        card.addView(muted(advisory + " advisory note(s)"));
        for (int i = 0; i < Math.min(8, blocking.size()); i++) {
            JSONObject issue = blocking.get(i);
            card.addView(text("• " + weekdayTitle(cal(str(issue, "date"))) + " · Shift " + str(issue, "shift_code") + " · "
                    + str(issue, "code").replace('_', ' ') + ": " + str(issue, "message"), 11, RED, false));
        }
        if (blocking.size() > 8) card.addView(muted("…and " + (blocking.size() - 8) + " more"));
        add(card);
    }

    private void addOfficers() {
        List<JSONObject> rows = new ArrayList<>();
        String q = search.toLowerCase();
        for (int i = 0; i < staff.length(); i++) {
            JSONObject s = staff.optJSONObject(i);
            if (s == null) continue;
            if (!poolSector.isEmpty()) {
                boolean station = "STATION".equals(poolSector);
                if (station ? !s.isNull("sector_id") : s.isNull("sector_id") || !poolSector.equals(str(s, "sector_id"))) continue;
            }
            if (!q.isEmpty() && !str(s, "name").toLowerCase().contains(q) && !str(s, "service_number").toLowerCase().contains(q)) continue;
            rows.add(s);
        }
        section("OFFICERS (" + rows.size() + ")");
        if (rows.isEmpty()) empty("No staff match these filters.");
        for (int n = 0; n < Math.min(limit, rows.size()); n++) {
            JSONObject s = rows.get(n);
            LinearLayout card = card(0);
            card.addView(text(str(s, "name") + " (" + str(s, "designation") + ")", 14, INK, true));
            card.addView(muted(str(s, "service_number") + (s.isNull("sector_id") ? "" : " · Sector " + str(s, "sector_id"))));
            for (String d : days) card.addView(dayRow(s, d));
            if (canEdit()) {
                card.addView(buttonRow(
                        secondary("Fill week", () -> fillRow(s)),
                        danger("Clear", () -> clearRow(s))));
            }
            addTight(card);
        }
        if (rows.size() > limit) {
            LinearLayout more = card(0);
            more.addView(buttonRow(secondary("Show more (" + (rows.size() - limit) + " more officers)", () -> {
                limit += PAGE;
                render();
            })));
            add(more);
        }
    }

    private String dutyName(int id) {
        for (int i = 0; i < duties.length(); i++) {
            JSONObject d = duties.optJSONObject(i);
            if (d != null && d.optInt("id") == id) return str(d, "category");
        }
        return "Duty #" + id;
    }

    private boolean isLocked(String date, String shift) {
        return !shift.isEmpty() && locked.contains(date + "|" + shift);
    }

    private View dayRow(JSONObject s, String date) {
        final String k = key(s.optInt("id"), date);
        JSONObject c = grid.get(k);
        List<JSONObject> own = issueByKey.get(k);
        boolean bad = false;
        if (own != null) for (JSONObject i : own) if (i.optBoolean("blocking")) bad = true;
        boolean exception = c != null && c.optBoolean("is_exception");
        boolean lock = c != null && isLocked(date, str(c, "shift"));
        boolean editable = canEdit() && !lock;

        LinearLayout box = new LinearLayout(a);
        box.setOrientation(LinearLayout.VERTICAL);
        LinearLayout row = hrow();
        row.setPadding(0, a.dp(7), 0, a.dp(3));
        row.addView(text(weekdayTitle(cal(date)), 12, MUTED, true),
                new LinearLayout.LayoutParams(a.dp(88), ViewGroup.LayoutParams.WRAP_CONTENT));
        String value;
        if (c == null) value = "— Off / none";
        else if (dutyIdOf(c) == 0) value = "Shift " + str(c, "shift") + " · choose duty";
        else value = "Shift " + str(c, "shift") + " · " + dutyName(dutyIdOf(c)) + (lock ? " 🔒" : "");
        TextView v = text((bad ? "⛔ " : exception ? "⚠ " : "") + value + (editable ? "  ✎" : ""), 13,
                bad ? RED : exception ? AMBER : c == null ? MUTED : INK, c != null);
        row.addView(v, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        if (editable) row.setOnClickListener(x -> cellDialog(s, date));
        box.addView(row);
        if (own != null) {
            for (JSONObject i : own) {
                box.addView(text("• " + str(i, "message"), 11, i.optBoolean("blocking") ? RED : MUTED, false));
            }
            if (bad && !exception && canEdit()) {
                List<String> violations = new ArrayList<>();
                for (JSONObject i : own) if (i.optBoolean("blocking")) violations.add(str(i, "message"));
                box.addView(buttonRow(secondary("Authorize exception", () -> authorizeDialog(s, date, violations))));
            }
        }
        return box;
    }

    // ── Editing ──────────────────────────────────────────────────────────────────

    private void cellDialog(JSONObject s, String date) {
        final String k = key(s.optInt("id"), date);
        JSONObject current = grid.get(k);
        int curShift = current == null ? 0 : Math.max(0, java.util.Arrays.asList(SHIFTS).indexOf(str(current, "shift")) + 1);

        LinearLayout form = formBody();
        form.addView(text(str(s, "name") + " · " + weekdayTitle(cal(date)), 14, INK, true));
        List<String> shiftNames = new ArrayList<>();
        shiftNames.add("Off / none");
        for (String sh : SHIFTS) shiftNames.add("Shift " + sh + (isLocked(date, sh) ? " (locked)" : ""));
        Spinner shiftSpinner = spinner(shiftNames, curShift);
        labeled(form, "Shift", shiftSpinner);

        final List<String> dutyNames = new ArrayList<>();
        final List<Integer> dutyIds = new ArrayList<>();
        Spinner dutySpinner = spinner(dutyNames, 0);
        labeled(form, "Duty point", dutySpinner);
        Runnable fillDuties = () -> {
            int pos = shiftSpinner.getSelectedItemPosition();
            String sh = pos == 0 ? "" : SHIFTS[pos - 1];
            int keep = dutyIdOf(current);
            dutyNames.clear();
            dutyIds.clear();
            dutyNames.add("-- duty point --");
            dutyIds.add(0);
            int select = 0;
            if (!sh.isEmpty()) {
                for (int i = 0; i < duties.length(); i++) {
                    JSONObject d = duties.optJSONObject(i);
                    if (d == null) continue;
                    String dShift = str(d, "shift_code");
                    if (!dShift.isEmpty() && !dShift.equals(sh)) continue;
                    dutyNames.add(str(d, "category"));
                    dutyIds.add(d.optInt("id"));
                    if (d.optInt("id") == keep) select = dutyNames.size() - 1;
                }
            }
            ((ArrayAdapter<?>) dutySpinner.getAdapter()).notifyDataSetChanged();
            dutySpinner.setSelection(select);
        };
        fillDuties.run();
        onSelect(shiftSpinner, i -> fillDuties.run());

        form("Set duty", form, "Set", () -> {
            int pos = shiftSpinner.getSelectedItemPosition();
            if (pos == 0) {
                grid.remove(k);
                changed();
                return true;
            }
            String sh = SHIFTS[pos - 1];
            if (isLocked(date, sh)) {
                a.toast("Shift " + sh + " on this day is approved or published. Revise it on the Roster screen to change it.");
                return false;
            }
            int dutyId = dutyIds.get(dutySpinner.getSelectedItemPosition());
            if (dutyId == 0) {
                a.toast("Choose a duty point.");
                return false;
            }
            grid.put(k, newCell(sh, dutyId)); // a changed cell drops any earlier exception: it was granted for the old values
            changed();
            return true;
        });
    }

    private List<JSONObject> allowedAuthorizers() {
        List<JSONObject> out = new ArrayList<>();
        for (int i = 0; i < authorizers.length(); i++) {
            JSONObject au = authorizers.optJSONObject(i);
            if (au != null && (!au.optBoolean("is_self") || RoleAccess.SHO.equals(role))) out.add(au);
        }
        return out;
    }

    private void authorizeDialog(JSONObject s, String date, List<String> violations) {
        LinearLayout form = formBody();
        for (String v : violations) form.addView(text("• " + v, 12, RED, false));
        EditText reason = multiline("Exception reason");
        labeled(form, "Exception reason *", reason);
        List<JSONObject> allowed = allowedAuthorizers();
        List<String> names = new ArrayList<>();
        names.add("-- Select officer --");
        for (JSONObject au : allowed) names.add(str(au, "name") + " (" + str(au, "role") + ")");
        Spinner authorizer = spinner(names, 0);
        labeled(form, "Authorizing officer *", authorizer);
        form("Authorize exception for " + str(s, "name"), form, "Authorize", () -> {
            int ap = authorizer.getSelectedItemPosition();
            JSONObject cell = grid.get(key(s.optInt("id"), date));
            if (reason.getText().toString().trim().isEmpty() || ap == 0) {
                a.toast("An exception needs a reason and the authorizing officer.");
                return false;
            }
            if (cell == null) return true;
            try {
                cell.put("is_exception", true);
                cell.put("exception_reason", reason.getText().toString().trim());
                cell.put("exception_authorized_by_id", allowed.get(ap - 1).optInt("user_id"));
            } catch (JSONException e) {
                return false;
            }
            changed();
            return true;
        });
    }

    private void fillRow(JSONObject s) {
        JSONObject source = null;
        for (String d : days) {
            JSONObject c = grid.get(key(s.optInt("id"), d));
            if (dutyIdOf(c) > 0) {
                source = c;
                break;
            }
        }
        if (source == null) {
            a.toast("Set a shift and duty on one day first, then use Fill week to copy it across.");
            return;
        }
        String shift = str(source, "shift");
        int dutyId = dutyIdOf(source);
        for (String d : days) {
            JSONObject existing = grid.get(key(s.optInt("id"), d));
            if (isLocked(d, shift) || (existing != null && isLocked(d, str(existing, "shift")))) continue;
            grid.put(key(s.optInt("id"), d), newCell(shift, dutyId));
        }
        changed();
    }

    private void clearRow(JSONObject s) {
        for (String d : days) {
            JSONObject c = grid.get(key(s.optInt("id"), d));
            if (c != null && !isLocked(d, str(c, "shift"))) grid.remove(key(s.optInt("id"), d));
        }
        changed();
    }

    /** After any edit: redraw, re-run the rule checks and keep the server-side draft. */
    private void changed() {
        dirty = !signature(grid).equals(baseline);
        render();
        validate(null);
        JSONObject payload = new JSONObject();
        try {
            for (Map.Entry<String, JSONObject> e : grid.entrySet()) payload.put(e.getKey(), e.getValue());
        } catch (JSONException ignored) {
            // Keys are plain strings.
        }
        saveDraftOnServer(dirty ? payload : null);
    }

    private void saveDraftOnServer(JSONObject payload) {
        final String key = draftKey();
        a.executor.execute(() -> {
            try {
                JSONObject b = new JSONObject();
                b.put("key", key);
                b.put("payload", payload == null ? JSONObject.NULL : payload);
                a.request("/auth/drafts", "PUT", b, false);
            } catch (Exception ignored) {
                // Autosave is best-effort.
            }
        });
    }

    // ── Validation and saving ────────────────────────────────────────────────────

    /** Cells to send, in a stable order; `sentKeys` receives the "staffId|date" of each so issue indexes map back. */
    private JSONObject payload(List<String> sentKeys, String reason) {
        List<String> keys = new ArrayList<>();
        for (Map.Entry<String, JSONObject> e : grid.entrySet()) if (dutyIdOf(e.getValue()) > 0) keys.add(e.getKey());
        Collections.sort(keys);
        JSONArray cells = new JSONArray();
        JSONArray staffIds = new JSONArray();
        for (int i = 0; i < staff.length(); i++) if (staff.optJSONObject(i) != null) staffIds.put(staff.optJSONObject(i).optInt("id"));
        for (String k : keys) {
            JSONObject c = grid.get(k);
            String[] p = k.split("\\|");
            JSONObject cell = new JSONObject();
            try {
                cell.put("staff_id", Integer.parseInt(p[0]));
                cell.put("date", p[1]);
                cell.put("shift_code", str(c, "shift"));
                cell.put("duty_master_id", dutyIdOf(c));
                cell.put("is_exception", c.optBoolean("is_exception"));
                String why = str(c, "exception_reason");
                cell.put("exception_reason", why.isEmpty() ? JSONObject.NULL : why);
                cell.put("exception_authorized_by_id", authorizerOf(c) > 0 ? (Object) authorizerOf(c) : JSONObject.NULL);
            } catch (JSONException ignored) {
                // Literal keys.
            }
            cells.put(cell);
            sentKeys.add(k);
        }
        return body("week_start", weekStart, "staff_ids", staffIds, "cells", cells, "change_reason", reason);
    }

    private void applyIssues(JSONObject result, List<String> sentKeys) {
        issues = arr(result, "issues");
        issueByKey.clear();
        for (int i = 0; i < issues.length(); i++) {
            JSONObject issue = issues.optJSONObject(i);
            if (issue == null || issue.isNull("cell_index")) continue;
            int idx = issue.optInt("cell_index");
            if (idx < 0 || idx >= sentKeys.size()) continue;
            List<JSONObject> list = issueByKey.get(sentKeys.get(idx));
            if (list == null) {
                list = new ArrayList<>();
                issueByKey.put(sentKeys.get(idx), list);
            }
            list.add(issue);
        }
    }

    /** Dry-runs the whole week; `then` receives the result (null on failure). With no callback the screen redraws. */
    private void validate(Done<JSONObject> then) {
        if (!canEdit()) {
            if (then != null) then.run(null);
            return;
        }
        final int id = ++validationId;
        final List<String> sentKeys = new ArrayList<>();
        final JSONObject body = payload(sentKeys, null);
        a.executor.execute(() -> {
            JSONObject result = null;
            try {
                result = a.request("/rosters/week/validate", "POST", body, false);
            } catch (Exception ignored) {
                // Checks are advisory until saving.
            }
            final JSONObject res = result;
            a.mainHandler.post(() -> {
                if (!active()) return;
                if (res != null && (id == validationId)) {
                    applyIssues(res, sentKeys);
                    if (then == null) render();
                }
                if (then != null) then.run(res);
            });
        });
    }

    private void save() {
        if (!dirty) {
            a.toast("No changes to save.");
            return;
        }
        validate(check -> {
            if (check != null && !check.optBoolean("can_save", true)) {
                a.toast(check.optInt("blocking_count") + " rule violation(s) must be fixed or authorized as exceptions before saving. Nothing was saved.");
                render();
                return;
            }
            final List<String> sentKeys = new ArrayList<>();
            call("/rosters/week", "PUT", payload(sentKeys, changeReason), null, res -> {
                a.toast(str(res, "detail", "Weekly allocation saved."));
                StringBuilder sb = new StringBuilder();
                JSONArray result = arr(res, "days");
                for (int i = 0; i < result.length(); i++) {
                    JSONObject d = result.optJSONObject(i);
                    if (d != null && "skipped".equals(str(d, "action"))) {
                        sb.append(sb.length() == 0 ? "" : ", ").append(weekdayTitle(cal(str(d, "date")))).append(" Shift ").append(str(d, "shift_code"));
                    }
                }
                skippedNote = sb.length() == 0 ? "" : "Approved or published rosters were not changed: " + sb
                        + ". Use Revise on the Roster screen to change them.";
                saveDraftOnServer(null);
                show();
            });
        });
    }
}
