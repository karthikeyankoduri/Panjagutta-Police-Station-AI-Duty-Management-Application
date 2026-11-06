package com.panjagutta.dutymanagement;

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

/** Attendance recorded automatically from sign-in/sign-out: station view, personal record, scheduled vs signed in (web: /attendance). Read-only. */
final class AttendanceScreen extends ModuleScreen {
    private static final String[] SHIFTS = {"A", "B", "C"};
    private int tab; // 0 station, 1 my attendance, 2 scheduled vs signed in

    private String date = "";
    private String shift = "A";
    private boolean shiftResolved;
    private String search = "";
    private int shown = 50;

    private final List<JSONObject> station = new ArrayList<>();
    private JSONArray myDuties = new JSONArray();
    private JSONArray personal = new JSONArray();
    private JSONObject verify;
    private Calendar month = Calendar.getInstance();

    AttendanceScreen(MainActivity a) {
        super(a);
        date = a.today();
        if (!RoleAccess.canRollCall(role)) tab = 1;
    }

    @Override
    void show() {
        if (!shiftResolved) {
            // Open on the shift running now: sign-ins are recorded against it, not always Shift A.
            load(() -> {
                try {
                    return a.request("/attendance/current-shift", "GET", null, false);
                } catch (Exception e) {
                    return new JSONObject();
                }
            }, r -> {
                if (!str(r, "shift_code").isEmpty()) {
                    shift = str(r, "shift_code");
                    if (!str(r, "date").isEmpty()) date = str(r, "date");
                }
                shiftResolved = true;
                show();
            });
            return;
        }
        if (tab == 0) loadStation();
        else if (tab == 1) loadPersonal();
        else loadVerify();
    }

    private void tabsRow() {
        if (!RoleAccess.canRollCall(role)) return;
        tabs(new String[]{"Station", "My Attendance", "Scheduled vs Signed in"}, tab, i -> {
            tab = i;
            shown = 50;
            show();
        });
    }

    private void dateShiftCard(Runnable onApply) {
        LinearLayout card = card(0);
        EditText dateField = a.dateField(date, null);
        labeled(card, "Attendance date", dateField);
        Spinner shiftSpinner = spinner(new String[]{"Shift A", "Shift B", "Shift C"}, "ABC".indexOf(shift));
        labeled(card, "Shift", shiftSpinner);
        card.addView(buttonRow(primary("Load", () -> {
            String d = dateField.getText().toString().trim();
            if (!a.validDate(d)) {
                dateField.setError("Choose a date");
                return;
            }
            date = d;
            shift = SHIFTS[shiftSpinner.getSelectedItemPosition()];
            onApply.run();
        })));
        add(card);
    }

    // ── Roll-call ────────────────────────────────────────────────────────────────

    private void loadStation() {
        load(() -> {
            JSONArray staff = a.requestArray("/staff/?is_active=true");
            JSONArray records = a.requestArray("/attendance/?attendance_date=" + date + "&shift_code=" + shift);
            JSONArray scheduled;
            try {
                scheduled = arr(a.request("/attendance/scheduled?attendance_date=" + date + "&shift_code=" + shift, "GET", null, false), "rows");
            } catch (Exception ignored) {
                scheduled = new JSONArray();
            }
            return new JSONArray[]{staff, records, scheduled};
        }, r -> {
            Map<Integer, JSONObject> byStaff = new HashMap<>();
            for (int i = 0; i < r[1].length(); i++) {
                JSONObject x = r[1].optJSONObject(i);
                if (x != null) byStaff.put(x.optInt("staff_id"), x);
            }
            java.util.Set<Integer> scheduledIds = new java.util.HashSet<>();
            for (int i = 0; i < r[2].length(); i++) {
                JSONObject x = r[2].optJSONObject(i);
                if (x != null && x.optBoolean("scheduled")) scheduledIds.add(x.optInt("staff_id"));
            }
            station.clear();
            for (int i = 0; i < r[0].length(); i++) {
                JSONObject s = r[0].optJSONObject(i);
                if (s == null) continue;
                JSONObject att = byStaff.get(s.optInt("id"));
                boolean sched = scheduledIds.contains(s.optInt("id")) || (att != null && att.optBoolean("is_scheduled"));
                String status = att != null ? (att.optBoolean("is_confirmed") ? "Present" : "Unscheduled")
                        : sched ? "Not signed in" : "Off-shift";
                JSONObject row = body("staff_id", s.optInt("id"), "name", str(s, "name"),
                        "service_number", str(s, "service_number"), "designation", str(s, "designation"),
                        "scheduled", sched, "status", status,
                        "check_in_at", att == null ? "" : str(att, "check_in_at"),
                        "check_out_at", att == null ? "" : str(att, "check_out_at"),
                        "is_late", att != null && att.optBoolean("is_late"));
                station.add(row);
            }
            renderStation();
        });
    }

    private void renderStation() {
        a.content.removeAllViews();
        a.stopRefreshing();
        heading("ATTENDANCE", "Station attendance",
                "Recorded automatically when each person signs in and out. This view is read-only.");
        tabsRow();
        dateShiftCard(this::loadStation);
        int present = 0, late = 0, notIn = 0, scheduled = 0;
        for (JSONObject r : station) {
            String s = str(r, "status");
            if ("Present".equals(s)) present++;
            else if ("Not signed in".equals(s)) notIn++;
            if (r.optBoolean("is_late")) late++;
            if (r.optBoolean("scheduled")) scheduled++;
        }
        LinearLayout stats = card(0);
        stats.addView(muted("Strength " + station.size() + " · Scheduled " + scheduled));
        LinearLayout line = hrow();
        line.addView(badge("SIGNED IN " + present, GREEN, GREEN_BG));
        line.addView(new android.view.View(a), new LinearLayout.LayoutParams(a.dp(8), 1));
        line.addView(badge("LATE " + late, AMBER, AMBER_BG));
        line.addView(new android.view.View(a), new LinearLayout.LayoutParams(a.dp(8), 1));
        line.addView(badge("NOT IN " + notIn, RED, RED_BG));
        stats.addView(line);
        add(stats);

        EditText box = searchField("Filter personnel name or service #", v -> {
            search = v;
            shown = 50;
            renderStation();
        });
        box.setText(search);
        addTight(box);

        String q = search.toLowerCase(Locale.ROOT);
        List<JSONObject> rows = new ArrayList<>();
        for (JSONObject r : station) {
            if (!q.isEmpty() && !str(r, "name").toLowerCase(Locale.ROOT).contains(q)
                    && !str(r, "service_number").toLowerCase(Locale.ROOT).contains(q)
                    && !str(r, "designation").toLowerCase(Locale.ROOT).contains(q)) continue;
            rows.add(r);
        }
        section("SHIFT " + shift + " ATTENDANCE (" + rows.size() + ")");
        if (rows.isEmpty()) empty(search.isEmpty() ? "No active staff found." : "No staff match your search.");
        for (int i = 0; i < rows.size() && i < shown; i++) {
            final JSONObject r = rows.get(i);
            String status = str(r, "status");
            LinearLayout card = card("Present".equals(status) ? GREEN : "Not signed in".equals(status) ? RED : 0);
            card.addView(titleRow(text(str(r, "name"), 14, INK, true),
                    "Present".equals(status) ? badge(r.optBoolean("is_late") ? "LATE" : "PRESENT", r.optBoolean("is_late") ? AMBER : GREEN, r.optBoolean("is_late") ? AMBER_BG : GREEN_BG)
                            : "Not signed in".equals(status) ? badge("NOT SIGNED IN", RED, RED_BG)
                            : "Unscheduled".equals(status) ? badge("UNSCHEDULED", AMBER, AMBER_BG) : badge("OFF-SHIFT", MUTED, BACKGROUND)));
            card.addView(muted(str(r, "service_number") + " · " + str(r, "designation") + " · "
                    + (r.optBoolean("scheduled") ? "Scheduled" : "Off-shift")));
            if (!str(r, "check_in_at").isEmpty()) {
                card.addView(muted("In " + a.formatTime(str(r, "check_in_at"))
                        + (str(r, "check_out_at").isEmpty() ? " · still signed in" : " · Out " + a.formatTime(str(r, "check_out_at")))));
            }
            addTight(card);
        }
        if (rows.size() > shown) {
            a.content.addView(secondary("Show more (" + (rows.size() - shown) + " left)", () -> {
                shown += 50;
                renderStation();
            }));
        }
    }

    // ── Personal ─────────────────────────────────────────────────────────────────

    private void loadPersonal() {
        Calendar first = (Calendar) month.clone();
        first.set(Calendar.DAY_OF_MONTH, 1);
        Calendar last = (Calendar) first.clone();
        last.add(Calendar.MONTH, 1);
        last.add(Calendar.DAY_OF_YEAR, -1);
        final String start = iso(first);
        final String end = iso(last);
        load(() -> {
            JSONArray duties;
            try {
                duties = a.requestArray("/mobile/rosters");
            } catch (Exception e) {
                duties = new JSONArray();
            }
            JSONArray records = a.requestArray("/attendance/?start_date=" + start + "&end_date=" + end
                    + (RoleAccess.isStaff(role) ? "" : "&own_only=true"));
            return new JSONArray[]{duties, records};
        }, r -> {
            myDuties = r[0];
            personal = r[1];
            renderPersonal();
        });
    }

    private void renderPersonal() {
        a.content.removeAllViews();
        a.stopRefreshing();
        heading("ATTENDANCE", "My Attendance Record", "Your scheduled shifts, verified presence and monthly history.");
        tabsRow();
        String today = iso(Calendar.getInstance());
        boolean any = false;
        for (int i = 0; i < myDuties.length(); i++) {
            JSONObject d = myDuties.optJSONObject(i);
            if (d == null || !today.equals(str(d, "duty_date"))) continue;
            if (!any) section("TODAY'S PUBLISHED DUTY");
            any = true;
            final String shiftName = str(d, "shift_name");
            LinearLayout card = card(BLUE);
            card.addView(text("Shift " + shiftName + " · " + str(d, "start_time") + "–" + str(d, "end_time"), 14, INK, true));
            card.addView(muted(str(d, "duty_category")));
            if (d.optBoolean("attendance_confirmed")) {
                card.addView(badge("VERIFIED", GREEN, GREEN_BG));
            } else if (!str(d, "attendance_submitted_at").isEmpty()) {
                card.addView(badge("SUBMITTED · AWAITING VERIFICATION", AMBER, AMBER_BG));
            } else {
                card.addView(buttonRow(primary("Submit my attendance", () -> act("/attendance/", "POST",
                        body("attendance_date", today, "shift_code", shiftName),
                        "Attendance submitted for Shift " + shiftName + ". An officer will verify it."))));
            }
            addTight(card);
        }
        LinearLayout nav = hrow();
        nav.addView(secondary("‹", () -> {
            month.add(Calendar.MONTH, -1);
            loadPersonal();
        }));
        TextView label = text(monthTitle(month), 14, INK, true);
        label.setGravity(android.view.Gravity.CENTER);
        nav.addView(label, new LinearLayout.LayoutParams(0, android.view.ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        nav.addView(secondary("›", () -> {
            month.add(Calendar.MONTH, 1);
            loadPersonal();
        }));
        addTight(nav);
        int present = 0, late = 0, signIns = 0;
        for (int i = 0; i < personal.length(); i++) {
            JSONObject r = personal.optJSONObject(i);
            if (r == null) continue;
            if (r.optBoolean("is_confirmed")) present++;
            if (r.optBoolean("is_late")) late++;
            if (!str(r, "check_in_at").isEmpty()) signIns++;
        }
        LinearLayout stats = card(0);
        stats.addView(text("Present " + present + "  ·  Late " + late + "  ·  Sign-ins " + signIns, 12, INK, true));
        add(stats);
        section("HISTORY LEDGER (" + personal.length() + ")");
        if (personal.length() == 0) empty("No attendance records this month.");
        for (int i = 0; i < personal.length(); i++) {
            JSONObject r = personal.optJSONObject(i);
            if (r == null) continue;
            boolean ok = r.optBoolean("is_confirmed");
            boolean lateIn = r.optBoolean("is_late");
            LinearLayout card = card(ok ? (lateIn ? AMBER : GREEN) : 0);
            card.addView(titleRow(text(day(str(r, "attendance_date")) + " · Shift " + str(r, "shift_code"), 13, INK, true),
                    ok ? badge(lateIn ? "LATE" : "PRESENT", lateIn ? AMBER : GREEN, lateIn ? AMBER_BG : GREEN_BG)
                            : badge("UNSCHEDULED", MUTED, BACKGROUND)));
            if (!str(r, "check_in_at").isEmpty()) {
                card.addView(muted("In " + a.formatTime(str(r, "check_in_at"))
                        + (str(r, "check_out_at").isEmpty() ? " · still signed in" : " · Out " + a.formatTime(str(r, "check_out_at")))));
            } else {
                card.addView(muted("Marked by a supervisor (earlier record)"));
            }
            if (!str(r, "notes").isEmpty()) card.addView(muted(str(r, "notes")));
            addTight(card);
        }
    }

    // ── Scheduled vs confirmed ───────────────────────────────────────────────────

    private void loadVerify() {
        load(() -> a.request("/attendance/scheduled?attendance_date=" + date + "&shift_code=" + shift, "GET", null, false), r -> {
            verify = r;
            renderVerify();
        });
    }

    private void renderVerify() {
        a.content.removeAllViews();
        a.stopRefreshing();
        heading("ATTENDANCE", "Scheduled vs Signed in",
                "Scheduled duty comes from the latest published roster; attendance is recorded automatically at sign-in.");
        tabsRow();
        dateShiftCard(this::loadVerify);
        LinearLayout stats = card(0);
        stats.addView(muted("Scheduled " + verify.optInt("scheduled") + " · Signed in " + verify.optInt("confirmed")
                + " · Scheduled, not signed in " + verify.optInt("scheduled_not_confirmed")
                + " · Signed in, not scheduled " + verify.optInt("confirmed_not_scheduled")));
        add(stats);
        if (verify.isNull("roster_id")) {
            LinearLayout info = card(BLUE);
            info.addView(text("No published roster for this shift yet.", 12, BLUE, true));
            add(info);
        }
        JSONArray rows = arr(verify, "rows");
        section("PERSONNEL (" + rows.length() + ")");
        if (rows.length() == 0) empty("No scheduled or signed-in personnel for this shift.");
        for (int i = 0; i < rows.length() && i < 150; i++) {
            JSONObject r = rows.optJSONObject(i);
            if (r == null) continue;
            boolean confirmed = r.optBoolean("confirmed");
            boolean any = !r.isNull("attendance_id");
            LinearLayout card = card(confirmed ? GREEN : r.optBoolean("scheduled") ? RED : 0);
            card.addView(titleRow(text(str(r, "name"), 14, INK, true),
                    confirmed ? badge(r.optBoolean("is_late") ? "LATE" : "PRESENT", r.optBoolean("is_late") ? AMBER : GREEN, r.optBoolean("is_late") ? AMBER_BG : GREEN_BG)
                            : any ? badge("UNSCHEDULED", AMBER, AMBER_BG) : badge("NOT SIGNED IN", MUTED, BACKGROUND)));
            card.addView(muted(str(r, "service_number") + " · " + (r.optBoolean("scheduled") ? "Scheduled" : "Not scheduled")));
            if (!str(r, "check_in_at").isEmpty()) {
                card.addView(muted("In " + a.formatTime(str(r, "check_in_at"))
                        + (str(r, "check_out_at").isEmpty() ? " · still signed in" : " · Out " + a.formatTime(str(r, "check_out_at")))));
            }
            addTight(card);
        }
    }
}
