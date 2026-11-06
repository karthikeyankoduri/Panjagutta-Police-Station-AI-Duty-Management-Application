package com.panjagutta.dutymanagement;

import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Leave & rest: request, approve/reject with roster impact, cancel (web: /leave). */
final class LeaveScreen extends ModuleScreen {
    private JSONArray leaves = new JSONArray();
    private JSONArray staff = new JSONArray();
    private JSONArray leaveTypes = new JSONArray();
    private JSONObject policy;
    private JSONArray rest = new JSONArray();
    private int tab; // 0 pending, 1 history

    LeaveScreen(MainActivity a) {
        super(a);
    }

    @Override
    void show() {
        load(() -> {
            Object[] r = new Object[5];
            r[0] = a.requestArray("/leave/");
            r[1] = RoleAccess.isStaff(role) ? new JSONArray() : a.requestArray("/staff/?is_active=true");
            try {
                r[2] = a.request("/config/lists", "GET", null, false).optJSONArray("leave_type");
            } catch (Exception e) {
                r[2] = null;
            }
            try {
                r[3] = a.request("/policy/", "GET", null, false);
            } catch (Exception e) {
                r[3] = null;
            }
            try {
                r[4] = RoleAccess.isStaff(role) ? null : a.request("/dashboard/views", "GET", null, false).optJSONArray("rest");
            } catch (Exception e) {
                r[4] = null;
            }
            return r;
        }, r -> {
            leaves = (JSONArray) r[0];
            staff = (JSONArray) r[1];
            leaveTypes = r[2] == null ? new JSONArray() : (JSONArray) r[2];
            policy = (JSONObject) r[3];
            rest = r[4] == null ? new JSONArray() : (JSONArray) r[4];
            render();
        });
    }

    private String typeLabel(String code) {
        for (int i = 0; i < leaveTypes.length(); i++) {
            JSONObject t = leaveTypes.optJSONObject(i);
            if (t != null && code.equals(str(t, "code"))) return str(t, "label", code);
        }
        return code;
    }

    private int ownStaffId() {
        return a.profile == null ? 0 : a.profile.optInt("staff_id", 0);
    }

    private boolean canCancel(JSONObject l) {
        boolean approver = RoleAccess.canApproveLeave(role);
        boolean own = ownStaffId() > 0 && l.optInt("staff_id") == ownStaffId();
        String status = str(l, "status");
        return ("Pending".equals(status) && (approver || own))
                || ("Approved".equals(status) && (approver || (own && str(l, "start_date").compareTo(a.today()) > 0)));
    }

    private void render() {
        a.content.removeAllViews();
        a.stopRefreshing();
        heading("LEAVE", "Leave & Rest Management",
                "Only approved leave removes a person from roster eligibility. Pending requests stay visible but do not count.");
        a.content.addView(fullWidth(primary(RoleAccess.isStaff(role) ? "+ Request leave" : "+ Submit leave application", this::applyDialog)));
        addPolicyCard();

        List<JSONObject> pending = new ArrayList<>();
        List<JSONObject> history = new ArrayList<>();
        for (int i = 0; i < leaves.length(); i++) {
            JSONObject l = leaves.optJSONObject(i);
            if (l == null) continue;
            if ("Pending".equals(str(l, "status"))) pending.add(l);
            else history.add(l);
        }
        tabs(new String[]{"Pending (" + pending.size() + ")", "History (" + history.size() + ")"}, tab, i -> {
            tab = i;
            render();
        });
        List<JSONObject> list = tab == 0 ? pending : history;
        if (list.isEmpty()) empty(tab == 0 ? "No pending leave requests." : "No historical leave records.");
        for (JSONObject l : list) addLeaveCard(l);
    }

    private void addPolicyCard() {
        if (policy == null) return;
        LinearLayout card = card(0);
        String state = str(policy, "policy_status");
        card.addView(titleRow(text("Rest & duty-off rules", 13, INK, true),
                badge(state.replace('_', ' ').toUpperCase(Locale.ROOT), "confirmed".equals(state) ? GREEN : AMBER,
                        "confirmed".equals(state) ? GREEN_BG : AMBER_BG)));
        if ("unconfirmed".equals(state)) {
            card.addView(muted("Rest and duty-off are not calculated until the SHO confirms the rotation rules."));
        } else {
            card.addView(muted("Rotation " + str(policy, "rotation_sequence") + " · minimum " + str(policy, "min_rest_hours_after_shift")
                    + "h rest after each shift · " + str(policy, "duty_off_after_shift_b_hours") + "h duty-off after Shift B."));
        }
        if (!RoleAccess.isStaff(role) && rest.length() > 0) {
            StringBuilder names = new StringBuilder();
            for (int i = 0; i < rest.length() && i < 12; i++) {
                JSONObject r = rest.optJSONObject(i);
                if (r == null) continue;
                if (names.length() > 0) names.append(" · ");
                names.append(str(r, "name"));
                if (!str(r, "rest_until").isEmpty()) names.append(" until ").append(dateTime(str(r, "rest_until")));
            }
            card.addView(text("Currently on rest (" + rest.length() + "): " + names + (rest.length() > 12 ? " …" : ""), 12, INK, false));
        }
        add(card);
    }

    private void addLeaveCard(JSONObject l) {
        final String status = str(l, "status");
        int accent = "Approved".equals(status) ? GREEN : "Rejected".equals(status) ? RED : "Pending".equals(status) ? AMBER : MUTED;
        final String ref = str(l, "reference_number", "#" + l.optInt("id"));
        LinearLayout card = card(accent);
        card.addView(titleRow(text(person(str(l, "staff_name", "Staff #" + str(l, "staff_id")), str(l, "service_number")), 14, INK, true),
                statusBadge(status)));
        card.addView(muted(ref + " · " + typeLabel(str(l, "leave_type")) + " · " + day(str(l, "start_date")) + " to "
                + day(str(l, "end_date")) + (l.has("days") && !l.isNull("days") ? " (" + l.optInt("days") + " days)" : "")));
        if (!str(l, "remarks").isEmpty()) card.addView(muted("Remarks: " + str(l, "remarks")));
        if (!"Pending".equals(status) && !str(l, "approver_username").isEmpty()) {
            card.addView(muted("Decided by " + str(l, "approver_username") + " · " + dateTime(str(l, "decision_at"))));
            if (!str(l, "approver_remarks").isEmpty()) card.addView(muted("“" + str(l, "approver_remarks") + "”"));
        }
        List<android.widget.Button> buttons = new ArrayList<>();
        if ("Pending".equals(status) && RoleAccess.canApproveLeave(role)) {
            buttons.add(success("Approve", () -> decisionDialog(l, "approve")));
            buttons.add(danger("Reject", () -> decisionDialog(l, "reject")));
        }
        if (canCancel(l)) buttons.add(secondary("Cancel leave", () -> decisionDialog(l, "cancel")));
        if (!buttons.isEmpty()) addButtons(card, buttons);
        else if ("Pending".equals(status)) card.addView(muted("Awaiting decision"));
        addTight(card);
    }

    private void decisionDialog(JSONObject l, String kind) {
        final int id = l.optInt("id");
        final String ref = str(l, "reference_number", "#" + id);
        LinearLayout body = formBody();
        body.addView(text(str(l, "staff_name") + " · " + typeLabel(str(l, "leave_type")) + " · "
                + day(str(l, "start_date")) + " to " + day(str(l, "end_date")), 12, INK, true));
        if ("approve".equals(kind)) {
            TextView impactView = muted("Checking roster impact…");
            body.addView(impactView);
            a.executor.execute(() -> {
                try {
                    JSONObject impact = a.request("/leave/" + id + "/impact", "GET", null, false);
                    a.mainHandler.post(() -> {
                        int vacancies = impact.optInt("vacancies_if_approved");
                        if (vacancies > 0) {
                            StringBuilder sb = new StringBuilder("Approving creates " + vacancies + " roster vacancy(ies):\n");
                            JSONArray affected = arr(impact, "affected_assignments");
                            for (int i = 0; i < affected.length(); i++) {
                                JSONObject x = affected.optJSONObject(i);
                                if (x == null) continue;
                                sb.append("• ").append(day(str(x, "date"))).append(" Shift ").append(str(x, "shift")).append(" — ")
                                        .append(str(x, "duty")).append(" (roster v").append(str(x, "version")).append(", ")
                                        .append(str(x, "status")).append(")\n");
                            }
                            impactView.setText(sb.toString());
                            impactView.setTextColor(AMBER);
                        } else {
                            impactView.setText("No submitted, approved or published roster duty is affected.");
                            impactView.setTextColor(GREEN);
                        }
                    });
                } catch (Exception e) {
                    a.mainHandler.post(() -> impactView.setText("Roster impact preview unavailable."));
                }
            });
        }
        EditText remarks = multiline("reject".equals(kind) ? "Reason (required, shown to the officer)" : "Remarks (optional)");
        labeled(body, "reject".equals(kind) ? "Reason (required)" : "Remarks (optional)", remarks);
        String title = ("approve".equals(kind) ? "Approve" : "reject".equals(kind) ? "Reject" : "Cancel") + " leave " + ref;
        form(title, body, "Confirm", () -> {
            String text = remarks.getText().toString().trim();
            if ("reject".equals(kind) && text.isEmpty()) {
                remarks.setError("Required");
                return false;
            }
            call("/leave/" + id + "/" + kind, "POST", body("remarks", text.isEmpty() ? null : text),
                    "Leave " + ref + " " + ("approve".equals(kind) ? "approved." : "reject".equals(kind) ? "rejected." : "cancelled."),
                    res -> show());
            return true;
        });
    }

    private void applyDialog() {
        LinearLayout body = formBody();
        Spinner staffSpinner = null;
        List<Integer> staffIds = new ArrayList<>();
        if (!RoleAccess.isStaff(role)) {
            List<String> names = new ArrayList<>();
            names.add("-- Select officer --");
            staffIds.add(0);
            for (int i = 0; i < staff.length(); i++) {
                JSONObject s = staff.optJSONObject(i);
                if (s == null) continue;
                names.add(str(s, "name") + " (" + str(s, "service_number") + " · " + str(s, "designation") + ")");
                staffIds.add(s.optInt("id"));
            }
            staffSpinner = spinner(names, 0);
            labeled(body, "Staff officer", staffSpinner);
        }
        List<String> typeNames = new ArrayList<>();
        List<String> typeCodes = new ArrayList<>();
        for (int i = 0; i < leaveTypes.length(); i++) {
            JSONObject t = leaveTypes.optJSONObject(i);
            if (t == null || !t.optBoolean("is_active", true)) continue;
            typeNames.add(str(t, "label") + " (" + str(t, "code") + ")");
            typeCodes.add(str(t, "code"));
        }
        if (typeCodes.isEmpty()) {
            typeNames.add("Casual Leave (CL)");
            typeCodes.add("CL");
        }
        Spinner typeSpinner = spinner(typeNames, Math.max(0, typeCodes.indexOf("CL")));
        labeled(body, "Leave type", typeSpinner);
        EditText from = a.dateField(a.today(), null);
        EditText to = a.dateField(a.today(), from);
        labeled(body, "From date", from);
        labeled(body, "To date", to);
        EditText ref = textField("Order reference (optional)");
        labeled(body, "Order reference (generated if blank)", ref);
        EditText remarks = multiline("Reason / remarks");
        labeled(body, "Reason / remarks", remarks);
        final Spinner fStaff = staffSpinner;
        form(RoleAccess.isStaff(role) ? "Request leave" : "Submit leave application", body, "Submit request", () -> {
            String start = from.getText().toString().trim();
            String end = to.getText().toString().trim();
            if (!a.validDate(start) || !a.validDate(end)) {
                to.setError("Choose valid dates");
                return false;
            }
            if (end.compareTo(start) < 0) {
                to.setError("The end date cannot be before the start date.");
                return false;
            }
            int staffId = fStaff == null ? ownStaffId() : staffIds.get(fStaff.getSelectedItemPosition());
            if (fStaff != null && staffId == 0) {
                a.toast("Select the staff officer.");
                return false;
            }
            JSONObject payload = body("leave_type", typeCodes.get(typeSpinner.getSelectedItemPosition()),
                    "start_date", start, "end_date", end,
                    "staff_id", staffId > 0 ? staffId : null,
                    "reference_number", ref.getText().toString().trim().isEmpty() ? null : ref.getText().toString().trim(),
                    "remarks", remarks.getText().toString().trim().isEmpty() ? null : remarks.getText().toString().trim());
            call("/leave/", "POST", payload, null, res -> {
                a.toast("Leave request " + str(res, "reference_number") + " submitted and routed to the SHO / Admin SI.");
                show();
            });
            return true;
        });
    }
}
