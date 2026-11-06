package com.panjagutta.dutymanagement;

import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Spinner;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** External attachment orders: record and repatriate (web: /attachments). */
final class AttachmentsScreen extends ModuleScreen {
    private static final List<String> OFFICER_RANKS = Arrays.asList("INSPECTOR", "SI", "WSI", "ASI", "AWSI");
    private JSONArray attachments = new JSONArray();
    private JSONArray staff = new JSONArray();
    private int tab;

    AttachmentsScreen(MainActivity a) {
        super(a);
    }

    @Override
    void show() {
        load(() -> new JSONArray[]{a.requestArray("/attachments/?active_only=false"), a.requestArray("/staff/?is_active=true")}, r -> {
            attachments = r[0];
            staff = r[1];
            render();
        });
    }

    private void render() {
        a.content.removeAllViews();
        a.stopRefreshing();
        heading("ATTACHMENTS", "External Attachment Orders",
                "Personnel attached to Task Force, Cyber Crime, High Court or Commissionerate. Excluded from daily rosters.");
        if (RoleAccess.canManageAttachments(role)) {
            a.content.addView(fullWidth(primary("+ Record attachment order", this::createDialog)));
        }
        List<JSONObject> active = new ArrayList<>();
        List<JSONObject> past = new ArrayList<>();
        for (int i = 0; i < attachments.length(); i++) {
            JSONObject x = attachments.optJSONObject(i);
            if (x == null) continue;
            if (x.optBoolean("is_active")) active.add(x);
            else past.add(x);
        }
        tabs(new String[]{"Currently attached (" + active.size() + ")", "Repatriated (" + past.size() + ")"}, tab, i -> {
            tab = i;
            render();
        });
        List<JSONObject> list = tab == 0 ? active : past;
        if (list.isEmpty()) empty(tab == 0 ? "No personnel currently attached to external wings." : "No past attachments recorded.");
        for (JSONObject x : list) {
            final int id = x.optInt("id");
            boolean pastEnd = x.optBoolean("is_past_expected_end");
            LinearLayout card = card(tab == 1 ? GREEN : pastEnd ? RED : BLUE);
            card.addView(titleRow(text("#" + id + " · " + person(str(x, "staff_name", "Staff #" + str(x, "staff_id")), str(x, "service_number")), 14, INK, true),
                    tab == 1 ? badge("REPATRIATED", GREEN, GREEN_BG) : pastEnd ? badge("PAST END DATE", RED, RED_BG) : null));
            card.addView(text(str(x, "attached_wing"), 13, BLUE, true));
            card.addView(muted("Order: " + str(x, "order_reference", "N/A")));
            if (tab == 0) {
                card.addView(muted("Since " + day(str(x, "start_date")) + " · Expected end " + (str(x, "expected_end_date").isEmpty() ? "Indefinite" : day(str(x, "expected_end_date")))));
                card.addView(muted("Reporting officer: " + str(x, "reporting_officer_name", "—")));
                if (RoleAccess.canManageAttachments(role)) {
                    card.addView(buttonRow(secondary("Repatriate to station", () -> endDialog(x))));
                }
            } else {
                card.addView(muted(day(str(x, "start_date")) + " to " + day(str(x, "actual_end_date"))));
                if (!str(x, "end_authority").isEmpty()) card.addView(muted("Authority: " + str(x, "end_authority")));
            }
            addTight(card);
        }
    }

    private void endDialog(JSONObject x) {
        final int id = x.optInt("id");
        LinearLayout form = formBody();
        EditText authority = textField("Repatriation order / authority");
        labeled(form, "Repatriation order / authority (required)", authority);
        EditText endDate = a.dateField(a.today(), null);
        labeled(form, "Actual end date", endDate);
        form("Repatriate " + str(x, "staff_name"), form, "Confirm", () -> {
            if (authority.getText().toString().trim().isEmpty()) {
                authority.setError("Enter the repatriation order / authority.");
                return false;
            }
            String d = endDate.getText().toString().trim();
            act("/attachments/" + id + "/end", "POST", body("actual_end_date", a.validDate(d) ? d : a.today(),
                    "end_authority", authority.getText().toString().trim()),
                    "Attachment ended. Officer returned to station active pool.");
            return true;
        });
    }

    private void createDialog() {
        LinearLayout form = formBody();
        List<String> names = new ArrayList<>();
        List<Integer> ids = new ArrayList<>();
        names.add("-- Choose officer --");
        ids.add(0);
        List<String> officerNames = new ArrayList<>();
        List<Integer> officerIds = new ArrayList<>();
        officerNames.add("-- Not applicable / external officer --");
        officerIds.add(0);
        for (int i = 0; i < staff.length(); i++) {
            JSONObject s = staff.optJSONObject(i);
            if (s == null) continue;
            names.add(str(s, "name") + " (" + str(s, "service_number") + " · " + str(s, "designation") + ")");
            ids.add(s.optInt("id"));
            if (OFFICER_RANKS.contains(str(s, "designation"))) {
                officerNames.add(str(s, "name") + " (" + str(s, "designation") + ")");
                officerIds.add(s.optInt("id"));
            }
        }
        Spinner staffSpinner = spinner(names, 0);
        labeled(form, "Staff officer", staffSpinner);
        EditText wing = textField("e.g. Hyderabad City Task Force");
        labeled(form, "Attached wing / destination unit", wing);
        EditText order = textField("e.g. CP/ORDER/ATTACH/2026/91");
        labeled(form, "Order reference number", order);
        Spinner reporting = spinner(officerNames, 0);
        labeled(form, "Reporting officer in the attached wing", reporting);
        EditText start = a.dateField(a.today(), null);
        labeled(form, "Start date", start);
        EditText end = a.dateField("", start);
        labeled(form, "Expected end (optional, long-press to clear)", end);
        form("Create attachment order", form, "Record order", () -> {
            int staffId = ids.get(staffSpinner.getSelectedItemPosition());
            if (staffId == 0) {
                a.toast("Choose the staff officer.");
                return false;
            }
            if (wing.getText().toString().trim().isEmpty()) {
                wing.setError("Required");
                return false;
            }
            String s = start.getText().toString().trim();
            if (!a.validDate(s)) {
                start.setError("Choose a date");
                return false;
            }
            String e = end.getText().toString().trim();
            int rid = officerIds.get(reporting.getSelectedItemPosition());
            act("/attachments/", "POST", body("staff_id", staffId, "parent_unit", "Panjagutta Police Station",
                    "attached_wing", wing.getText().toString().trim(),
                    "order_reference", order.getText().toString().trim().isEmpty() ? null : order.getText().toString().trim(),
                    "start_date", s, "expected_end_date", a.validDate(e) ? e : null,
                    "reporting_officer_id", rid > 0 ? rid : null),
                    "Attachment order recorded. Personnel excluded from station duty rosters.");
            return true;
        });
    }
}
