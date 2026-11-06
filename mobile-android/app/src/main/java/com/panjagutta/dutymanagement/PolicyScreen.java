package com.panjagutta.dutymanagement;

import android.text.InputType;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Spinner;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Locale;

/** Station policy: SHO rotation/rest sign-off, demo mode and shift timings (web: /policy). */
final class PolicyScreen extends ModuleScreen {
    private JSONObject policy;

    PolicyScreen(MainActivity a) {
        super(a);
    }

    @Override
    void show() {
        load(() -> a.request("/policy/", "GET", null, false), p -> {
            policy = p;
            render();
        });
    }

    private void render() {
        a.content.removeAllViews();
        a.stopRefreshing();
        heading("POLICY", "Station Policy & Parameters",
                "Shift timings, rotation intervals and the mandatory policy gate sign-off.");
        String state = str(policy, "policy_status");
        LinearLayout banner = card("confirmed".equals(state) ? GREEN : AMBER);
        banner.addView(text("confirmed".equals(state) ? "✓ Policy confirmed by SHO — roster publication unlocked"
                : "demo_simulated".equals(state) ? "⚠ Demo simulation mode active — prototype evaluation only"
                : "🔒 Policy unconfirmed — roster publication gate is blocked", 13, "confirmed".equals(state) ? GREEN : AMBER, true));
        banner.addView(muted("confirmed".equals(state)
                ? "Formal sign-off recorded " + dateTime(str(policy, "confirmed_at")) + "."
                : "Operational duty rosters require formal SHO authorization or explicit demo-mode acknowledgement."));
        add(banner);

        addSignOff();
        addShifts();
    }

    private void addSignOff() {
        final boolean sho = RoleAccess.canSignOffPolicy(role);
        LinearLayout card = card(0);
        card.addView(text("SHO ROTATION POLICY SIGN-OFF", 10, BLUE, true));
        EditText rotation = textField("A->B->C");
        rotation.setText(str(policy, "rotation_sequence", "A->B->C"));
        labeled(card, "Duty rotation sequence", rotation);
        EditText minRest = field("Hours", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        minRest.setText(str(policy, "min_rest_hours_after_shift", "16"));
        labeled(card, "Minimum rest hours (between shifts)", minRest);
        EditText dutyOff = field("Hours", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        dutyOff.setText(str(policy, "duty_off_after_shift_b_hours", "24"));
        labeled(card, "Duty-off after Shift B (hours)", dutyOff);
        Spinner authorizer = spinner(new String[]{"SHO only", "Admin SI"}, "ADMIN_SI".equals(str(policy, "exception_authorizer_role")) ? 1 : 0);
        labeled(card, "Who may authorize exceptions", authorizer);
        EditText effective = a.dateField(str(policy, "effective_from"), null);
        labeled(card, "Effective from (long-press to clear)", effective);
        EditText exceptions = multiline("e.g. Emergency deployment, VIP bandobast");
        exceptions.setText(str(policy, "permitted_exceptions"));
        labeled(card, "Permitted exceptions to rest rules", exceptions);
        EditText notes = multiline("Authorization remarks");
        notes.setText(str(policy, "notes", "Station House Officer formal approval of shift rotation rules and mandatory rest intervals."));
        labeled(card, "SHO authorization remarks", notes);
        if (!sho) {
            for (android.view.View v : new android.view.View[]{rotation, minRest, dutyOff, authorizer, effective, exceptions, notes}) {
                v.setEnabled(false);
            }
            card.addView(muted("Only the Station House Officer (SHO) can execute formal policy confirmation."));
        } else {
            card.addView(fullWidth(primary("✓ Officially confirm policy (SHO)", () -> {
                double rest;
                double off;
                try {
                    rest = Double.parseDouble(minRest.getText().toString().trim());
                    off = Double.parseDouble(dutyOff.getText().toString().trim());
                } catch (NumberFormatException e) {
                    a.toast("Enter the rest and duty-off hours as numbers.");
                    return;
                }
                String eff = effective.getText().toString().trim();
                act("/policy/confirm", "POST", body("rotation_sequence", rotation.getText().toString().trim(),
                        "min_rest_hours_after_shift", rest, "duty_off_after_shift_b_hours", off,
                        "permitted_exceptions", exceptions.getText().toString().trim().isEmpty() ? null : exceptions.getText().toString().trim(),
                        "exception_authorizer_role", authorizer.getSelectedItemPosition() == 1 ? "ADMIN_SI" : "SHO",
                        "effective_from", a.validDate(eff) ? eff : null,
                        "notes", notes.getText().toString().trim()),
                        "Station duty rotation policy formally confirmed by SHO. Policy gate cleared.");
            })));
        }
        if (RoleAccess.canEditPolicySettings(role)) {
            card.addView(fullWidth(secondary("Toggle demo simulation mode", () -> confirm(
                    "Activate demo simulation mode? A prototype notice banner will be shown.",
                    () -> act("/policy/demo-mode", "POST", null, "Demo simulation mode activated.")))));
        }
        add(card);
    }

    private void addShifts() {
        section("STATION SHIFT TIMINGS");
        JSONArray shifts = arr(policy, "shifts");
        for (int i = 0; i < shifts.length(); i++) {
            JSONObject s = shifts.optJSONObject(i);
            if (s == null) continue;
            final String code = str(s, "shift_code");
            LinearLayout card = card(BLUE);
            card.addView(titleRow(text("Shift " + code, 14, INK, true),
                    s.optBoolean("crosses_midnight") ? badge("CROSSES MIDNIGHT", AMBER, AMBER_BG) : null));
            card.addView(muted(trimTime(str(s, "start_time")) + " – " + trimTime(str(s, "end_time")) + " · "
                    + str(s, "duration_hours") + " hrs"));
            if (RoleAccess.canEditPolicySettings(role)) {
                card.addView(buttonRow(secondary("Edit timings", () -> editShift(s))));
            }
            addTight(card);
        }
        add(muted("Shift timings are stored centrally and used everywhere (dashboard, roster, attendance, rest and overlap checks, reports and the Android app). Every change is versioned and written to the audit log."));
    }

    private static String trimTime(String t) {
        return t.length() >= 5 ? t.substring(0, 5) : t;
    }

    private void editShift(JSONObject s) {
        final String code = str(s, "shift_code");
        LinearLayout form = formBody();
        EditText start = timeField(trimTime(str(s, "start_time")));
        EditText end = timeField(trimTime(str(s, "end_time")));
        labeled(form, "Start time", start);
        labeled(form, "End time", end);
        form("Edit Shift " + code + " timings", form, "Save", () -> {
            String st = start.getText().toString().trim();
            String en = end.getText().toString().trim();
            if (!st.matches("\\d{2}:\\d{2}") || !en.matches("\\d{2}:\\d{2}")) {
                a.toast("Choose both times.");
                return false;
            }
            int minutes = ((Integer.parseInt(en.substring(0, 2)) * 60 + Integer.parseInt(en.substring(3)))
                    - (Integer.parseInt(st.substring(0, 2)) * 60 + Integer.parseInt(st.substring(3))) + 24 * 60) % (24 * 60);
            if (minutes == 0) minutes = 24 * 60;
            act("/policy/shifts/" + code, "PUT", body("shift_code", code, "start_time", st, "end_time", en,
                    "duration_hours", minutes / 60.0), String.format(Locale.US, "Shift %s timings updated to %s - %s.", code, st, en));
            return true;
        });
    }

    private EditText timeField(String initial) {
        EditText field = field("HH:mm", InputType.TYPE_NULL);
        field.setText(initial);
        field.setFocusable(false);
        field.setOnClickListener(v -> {
            int h = 8;
            int m = 0;
            String cur = field.getText().toString();
            if (cur.matches("\\d{2}:\\d{2}")) {
                h = Integer.parseInt(cur.substring(0, 2));
                m = Integer.parseInt(cur.substring(3));
            }
            new android.app.TimePickerDialog(a, (tv, hour, min) ->
                    field.setText(String.format(Locale.US, "%02d:%02d", hour, min)), h, m, true).show();
        });
        return field;
    }
}
