package com.panjagutta.dutymanagement;

import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Spinner;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Duty and shift change requests (web: Roster & Duty -> Requests tab). Anyone can ask for a change to a
 * rostered duty; the SHO / Admin SI approve or reject; the requester can withdraw while it is pending.
 */
final class DutyRequestsScreen extends ModuleScreen {
    private static final String[] STATUSES = {"all", "pending", "approved", "rejected", "withdrawn"};
    private static final String[] SHIFTS = {"", "A", "B", "C"};

    private int statusIndex = 1; // open on pending, like a work queue
    private JSONArray requests = new JSONArray();
    private JSONArray myDuties = new JSONArray();

    DutyRequestsScreen(MainActivity activity) {
        super(activity);
    }

    @Override
    void show() {
        load(() -> {
            String q = statusIndex == 0 ? "" : "?status=" + STATUSES[statusIndex];
            JSONArray list = a.requestArray("/rosters/change-requests/" + q);
            JSONArray duties = new JSONArray();
            try {
                duties = a.requestArray("/mobile/rosters"); // only for logins linked to a staff profile
            } catch (Exception ignored) {
                // No linked staff profile: the form then asks for the roster details by hand.
            }
            return new JSONArray[]{list, duties};
        }, r -> {
            requests = r[0];
            myDuties = r[1];
            render();
        });
    }

    private void render() {
        a.content.removeAllViews();
        a.stopRefreshing();
        boolean supervisor = RoleAccess.isSupervisor(role);
        heading("DUTY CHANGES", "Duty & Shift Change Requests",
                supervisor ? "Review and approve or reject change requests raised when a rostered duty is infeasible."
                        : "Ask for a shift or duty change when your rostered assignment cannot be fulfilled.");
        a.content.addView(fullWidth(primary("+ New change request", () -> requestDialog(null))));

        Spinner status = spinner(new String[]{"All statuses", "Pending", "Approved", "Rejected", "Withdrawn"}, statusIndex);
        onSelect(status, i -> {
            statusIndex = i;
            show();
        });
        a.content.addView(status, a.fieldParams());

        int pending = 0;
        for (int i = 0; i < requests.length(); i++) {
            if ("pending".equals(str(obj(requests, i), "status"))) pending++;
        }
        LinearLayout kpi = card(pending > 0 ? AMBER : 0);
        kpi.addView(muted(requests.length() + " request(s) · " + pending + " pending review"));
        add(kpi);
        if (requests.length() == 0) {
            empty(statusIndex == 0 ? "No duty change requests have been recorded."
                    : "No requests match status \"" + STATUSES[statusIndex] + "\".");
        }
        for (int i = 0; i < requests.length(); i++) addRequest(requests.optJSONObject(i));
    }

    private void addRequest(JSONObject r) {
        if (r == null) return;
        final int id = r.optInt("id");
        final String status = str(r, "status");
        LinearLayout card = card("pending".equals(status) ? AMBER : "approved".equals(status) ? GREEN
                : "rejected".equals(status) ? RED : MUTED);
        card.addView(titleRow(text("#" + id + " · " + str(r, "officer_name", "Officer"), 14, INK, true), statusBadge(status)));
        if (!str(r, "service_number").isEmpty()) card.addView(muted(str(r, "service_number")));
        card.addView(text("Now: " + day(str(r, "current_roster_date")) + " · Shift " + str(r, "current_shift_code")
                + " · " + str(r, "current_duty_category", "General / Unassigned") + " (Roster #" + r.optInt("roster_id") + ")",
                13, INK, false));
        card.addView(text("Wants: Shift " + str(r, "requested_shift_code", str(r, "current_shift_code"))
                + " · " + str(r, "requested_duty_category", "any suitable duty point"), 13, BLUE, true));
        card.addView(muted("Reason: " + str(r, "reason")));
        if (!str(r, "submitted_at").isEmpty()) card.addView(muted("Submitted " + dateTime(str(r, "submitted_at"))));
        if (!str(r, "reviewer_remarks").isEmpty()) {
            card.addView(muted("Reviewer (" + str(r, "reviewed_by", "—") + "): " + str(r, "reviewer_remarks")));
        }
        if ("pending".equals(status)) {
            List<android.widget.Button> buttons = new ArrayList<>();
            if (RoleAccess.canDecideDutyChange(role)) {
                buttons.add(success("✓ Approve", () -> prompt("Approve request #" + id,
                        "Approval remarks / reassignment notes (optional)", false,
                        c -> act("/rosters/change-requests/" + id + "/approve", "POST", body("remarks", c.isEmpty() ? null : c),
                                "Request #" + id + " approved."))));
                buttons.add(danger("✗ Reject", () -> prompt("Reject request #" + id,
                        "Reason for rejecting this change request (required)", true,
                        c -> act("/rosters/change-requests/" + id + "/reject", "POST", body("remarks", c),
                                "Request #" + id + " rejected."))));
            } else {
                buttons.add(secondary("Withdraw", () -> confirm("Withdraw duty change request #" + id + "?",
                        () -> act("/rosters/change-requests/" + id, "DELETE", null, "Request #" + id + " withdrawn."))));
            }
            addButtons(card, buttons);
        }
        addTight(card);
    }

    /** New request form; `duty` pre-fills it from one of the caller's published duties. */
    private void requestDialog(JSONObject duty) {
        final LinearLayout form = formBody();
        form.addView(muted("Use this when your rostered shift or duty cannot be fulfilled for a medical, personal or operational reason."));

        Spinner pick = null;
        final List<JSONObject> dutyOptions = new ArrayList<>();
        if (myDuties.length() > 0) {
            List<String> names = new ArrayList<>();
            names.add("— enter roster details by hand —");
            dutyOptions.add(null);
            for (int i = 0; i < myDuties.length() && i < 12; i++) {
                JSONObject d = myDuties.optJSONObject(i);
                if (d == null) continue;
                names.add(day(str(d, "duty_date")) + " · Shift " + str(d, "shift_name") + " · " + str(d, "duty_category"));
                dutyOptions.add(d);
            }
            pick = spinner(names, 0);
            labeled(form, "My published duties", pick);
        }
        final EditText rosterId = numberField("Roster ID");
        final EditText date = textField("YYYY-MM-DD");
        final Spinner currentShift = spinner(Arrays.asList("A", "B", "C"), 0);
        final EditText currentDuty = textField("Current duty (optional)");
        final Spinner wantedShift = spinner(new String[]{"No change", "A", "B", "C"}, 0);
        final EditText wantedDuty = textField("Requested duty (optional)");
        final EditText reason = multiline("Why is this duty or shift infeasible?");
        labeled(form, "Roster ID", rosterId);
        labeled(form, "Current date", date);
        labeled(form, "Current shift", currentShift);
        labeled(form, "Current duty", currentDuty);
        labeled(form, "Requested shift", wantedShift);
        labeled(form, "Requested duty", wantedDuty);
        labeled(form, "Reason (required)", reason);

        if (pick != null) {
            onSelect(pick, i -> fill(dutyOptions.get(i), rosterId, date, currentShift, currentDuty, wantedShift));
        }
        if (duty != null) fill(duty, rosterId, date, currentShift, currentDuty, wantedShift);

        form("Submit duty / shift change request", form, "Submit", () -> {
            String why = reason.getText().toString().trim();
            String idText = rosterId.getText().toString().trim();
            String when = date.getText().toString().trim();
            String shiftWanted = SHIFTS[wantedShift.getSelectedItemPosition()];
            String dutyWanted = wantedDuty.getText().toString().trim();
            if (idText.isEmpty()) { rosterId.setError("Required"); return false; }
            if (!when.matches("\\d{4}-\\d{2}-\\d{2}")) { date.setError("Use YYYY-MM-DD"); return false; }
            if (why.isEmpty()) { reason.setError("A reason is required"); return false; }
            if (shiftWanted.isEmpty() && dutyWanted.isEmpty()) {
                wantedDuty.setError("Ask for a different shift or duty");
                return false;
            }
            String currentDutyText = currentDuty.getText().toString().trim();
            act("/rosters/change-requests/", "POST", body(
                    "roster_id", Integer.parseInt(idText),
                    "current_roster_date", when,
                    "current_shift_code", currentShift.getSelectedItem().toString(),
                    "current_duty_category", currentDutyText.isEmpty() ? null : currentDutyText,
                    "requested_shift_code", shiftWanted.isEmpty() ? null : shiftWanted,
                    "requested_duty_category", dutyWanted.isEmpty() ? null : dutyWanted,
                    "reason", why),
                    "Request submitted. It is waiting for SHO / Admin SI review.", () -> {
                        statusIndex = 1;
                        show();
                    });
            return true;
        });
    }

    private void fill(JSONObject d, EditText rosterId, EditText date, Spinner currentShift, EditText currentDuty,
                      Spinner wantedShift) {
        if (d == null) return;
        rosterId.setText(String.valueOf(d.optInt("roster_id")));
        date.setText(str(d, "duty_date"));
        currentDuty.setText(str(d, "duty_category"));
        String shift = str(d, "shift_name");
        int at = Math.max(0, Arrays.asList("A", "B", "C").indexOf(shift));
        currentShift.setSelection(at);
        wantedShift.setSelection(((at + 1) % 3) + 1); // suggest the next shift, as the web form does
    }
}
