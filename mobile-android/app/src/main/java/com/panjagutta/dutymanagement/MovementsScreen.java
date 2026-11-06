package com.panjagutta.dutymanagement;

import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Spinner;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/** Outside movement register: request/log, authorize, reject, cancel, return (web: /movements). */
final class MovementsScreen extends ModuleScreen {
    private JSONArray movements = new JSONArray();
    private JSONArray staff = new JSONArray();
    private int tab; // 0 pending, 1 active, 2 history

    MovementsScreen(MainActivity a) {
        super(a);
    }

    @Override
    void show() {
        load(() -> new JSONArray[]{
                a.requestArray("/movements/"),
                RoleAccess.isStaff(role) ? new JSONArray() : a.requestArray("/staff/?is_active=true")
        }, r -> {
            movements = r[0];
            staff = r[1];
            render();
        });
    }

    private int ownStaffId() {
        return a.profile == null ? 0 : a.profile.optInt("staff_id", 0);
    }

    private void render() {
        a.content.removeAllViews();
        a.stopRefreshing();
        heading("MOVEMENTS", "Outside Movement Register",
                "Log departure, track expected return schedules and monitor overdue alerts for court, crime and field duties.");
        a.content.addView(fullWidth(primary(RoleAccess.isStaff(role) ? "+ Request outside movement" : "+ Log out movement", this::logDialog)));

        List<JSONObject> pending = new ArrayList<>();
        List<JSONObject> active = new ArrayList<>();
        List<JSONObject> history = new ArrayList<>();
        int overdue = 0;
        for (int i = 0; i < movements.length(); i++) {
            JSONObject m = movements.optJSONObject(i);
            if (m == null) continue;
            String s = str(m, "status");
            if ("pending_authorization".equals(s)) pending.add(m);
            else if ("open".equals(s) || "authorized".equals(s) || "dispatched".equals(s)) {
                active.add(m);
                if (m.optBoolean("is_overdue")) overdue++;
            } else history.add(m);
        }
        LinearLayout kpi = card(overdue > 0 ? RED : 0);
        kpi.addView(muted("Pending authorization " + pending.size() + " · Outside station " + active.size()
                + " · Overdue " + overdue + " · Closed " + history.size()));
        add(kpi);
        tabs(new String[]{"Pending (" + pending.size() + ")", "Active (" + active.size() + ")", "History (" + history.size() + ")"}, tab, i -> {
            tab = i;
            render();
        });
        List<JSONObject> list = tab == 0 ? pending : tab == 1 ? active : history;
        if (list.isEmpty()) {
            empty(tab == 0 ? "No pending movement requests." : tab == 1
                    ? "No staff members are currently outside the station on authorized movement." : "No closed movements yet.");
        }
        for (JSONObject m : list) addMovement(m);
    }

    private void addMovement(JSONObject m) {
        final int id = m.optInt("id");
        final String status = str(m, "status");
        boolean overdue = m.optBoolean("is_overdue") && !"returned".equals(status);
        int accent = overdue ? RED : "pending_authorization".equals(status) ? AMBER : "returned".equals(status) ? GREEN
                : "rejected".equals(status) || "cancelled".equals(status) ? MUTED : BLUE;
        LinearLayout card = card(accent);
        card.addView(titleRow(text("#" + id + " · " + str(m, "staff_name", "Staff #" + str(m, "staff_id")), 14, INK, true),
                overdue ? badge("OVERDUE", RED, RED_BG) : statusBadge("pending_authorization".equals(status) ? "pending approval" : status)));
        if (!str(m, "service_number").isEmpty()) card.addView(muted(str(m, "service_number")));
        card.addView(text(str(m, "destination"), 13, INK, true));
        card.addView(muted(str(m, "purpose")));
        card.addView(muted("Expected return: " + dateTime(str(m, "expected_return"))
                + (str(m, "actual_return").isEmpty() ? "" : " · returned " + dateTime(str(m, "actual_return")))));
        if (!str(m, "authorizing_officer").isEmpty()) card.addView(muted("Authorized by " + str(m, "authorizing_officer")));
        if (!str(m, "close_notes").isEmpty()) card.addView(muted("Notes: " + str(m, "close_notes")));

        boolean own = ownStaffId() > 0 && m.optInt("staff_id") == ownStaffId();
        List<android.widget.Button> buttons = new ArrayList<>();
        if ("pending_authorization".equals(status)) {
            if (RoleAccess.canAuthorizeMovement(role)) {
                buttons.add(primary("✓ Authorize", () -> act("/movements/" + id + "/authorize", "POST", null,
                        "Movement #" + id + " authorized and departure recorded.")));
                buttons.add(danger("✗ Reject", () -> prompt("Reject movement #" + id, "Reason for not authorizing (shown to the officer)", false,
                        c -> act("/movements/" + id + "/reject", "POST", body("notes", c.isEmpty() ? null : c),
                                "Movement #" + id + " was not authorized. The officer has been notified."))));
            } else {
                card.addView(muted("Awaiting authorizing officer"));
            }
            if (own || RoleAccess.canAuthorizeMovement(role)) {
                buttons.add(secondary("Cancel request", () -> confirm("Cancel movement #" + id + "?",
                        () -> act("/movements/" + id + "/cancel", "POST", null, "Movement #" + id + " cancelled."))));
            }
        } else if ("open".equals(status) || "authorized".equals(status) || "dispatched".equals(status)) {
            if (!RoleAccess.isStaff(role) || own) {
                buttons.add(success("Mark returned", () -> prompt("Close movement #" + id, "Return remarks (optional)", false,
                        c -> act("/movements/" + id + "/return", "POST",
                                body("close_notes", c.isEmpty() ? "Returned to station duty." : c),
                                "Movement #" + id + " closed. Officer marked returned to station."))));
            }
        }
        if (!buttons.isEmpty()) addButtons(card, buttons);
        addTight(card);
    }

    private void logDialog() {
        LinearLayout form = formBody();
        Spinner staffSpinner = null;
        List<Integer> ids = new ArrayList<>();
        if (!RoleAccess.isStaff(role)) {
            List<String> names = new ArrayList<>();
            for (int i = 0; i < staff.length(); i++) {
                JSONObject s = staff.optJSONObject(i);
                if (s == null) continue;
                names.add(str(s, "name") + " (" + str(s, "service_number") + " · " + str(s, "designation") + ")");
                ids.add(s.optInt("id"));
            }
            staffSpinner = spinner(names, 0);
            labeled(form, "Staff officer", staffSpinner);
        }
        EditText purpose = textField("Official purpose");
        labeled(form, "Official purpose", purpose);
        EditText destination = textField("Destination");
        labeled(form, "Destination", destination);
        EditText expected = field("Expected return", android.text.InputType.TYPE_NULL);
        expected.setFocusable(false);
        long defaultMillis = System.currentTimeMillis() + 4 * 3600_000L;
        expected.setTag(defaultMillis);
        expected.setText(a.formatDate(isoUtc(defaultMillis)) + " " + a.formatTime(isoUtc(defaultMillis)));
        expected.setOnClickListener(v -> a.pickDateTime(expected));
        labeled(form, "Expected return (tap to change)", expected);
        final Spinner fStaff = staffSpinner;
        form(RoleAccess.isStaff(role) ? "Request outside movement" : "Log out movement", form, "Submit", () -> {
            if (purpose.getText().toString().trim().isEmpty()) {
                purpose.setError("Required");
                return false;
            }
            if (destination.getText().toString().trim().isEmpty()) {
                destination.setError("Required");
                return false;
            }
            Object tag = expected.getTag();
            int staffId = fStaff == null ? ownStaffId() : ids.isEmpty() ? 0 : ids.get(fStaff.getSelectedItemPosition());
            JSONObject payload = body("purpose", purpose.getText().toString().trim(),
                    "destination", destination.getText().toString().trim(),
                    "expected_return", tag instanceof Long ? isoUtc((Long) tag) : null,
                    "staff_id", staffId > 0 ? staffId : null);
            call("/movements/", "POST", payload, null, res -> {
                a.toast("pending_authorization".equals(str(res, "status")) || RoleAccess.isStaff(role)
                        ? "Outside movement request submitted. Awaiting supervisor departure authorization."
                        : "Staff member authorized and logged out for official movement.");
                tab = "pending_authorization".equals(str(res, "status")) ? 0 : 1;
                show();
            });
            return true;
        });
    }

    private static String isoUtc(long millis) {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
        f.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
        return f.format(new Date(millis));
    }
}
