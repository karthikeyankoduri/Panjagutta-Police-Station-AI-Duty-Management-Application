package com.panjagutta.dutymanagement;

import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Locale;

/** Everything waiting on the signed-in officer: roster, leave and movement decisions, alerts, AI copilot. */
final class ApprovalsScreen extends ModuleScreen {
    private JSONObject inbox;
    private String aiQuestion = "";
    private String aiAnswer = "";
    private String aiDisclaimer = "";

    ApprovalsScreen(MainActivity a) {
        super(a);
    }

    @Override
    void show() {
        load(() -> {
            JSONObject in = a.request("/dashboard/inbox", "GET", null, false);
            JSONArray changes = new JSONArray();
            if (RoleAccess.inboxShowsDutyChanges(role)) {
                changes = a.requestArray("/rosters/change-requests/?status=pending");
            }
            return new Object[]{in, changes};
        }, data -> {
            inbox = (JSONObject) data[0];
            dutyChanges = (JSONArray) data[1];
            render();
        });
    }

    private JSONArray dutyChanges = new JSONArray();

    private void render() {
        a.content.removeAllViews();
        heading("APPROVALS", "Approvals & Alerts",
                "Everything waiting on you: roster approvals, movement authorizations and alerts.");
        if (RoleAccess.canAskAI(role)) addCopilot();
        JSONObject counts = inbox.optJSONObject("counts");
        if (counts == null) counts = new JSONObject();
        LinearLayout stats = card(0);
        stats.addView(text("WAITING FOR YOU", 10, BLUE, true));
        stats.addView(text(Math.max(0, counts.optInt("total") - counts.optInt("leave")) + " item(s) in total", 16, Math.max(0, counts.optInt("total") - counts.optInt("leave")) > 0 ? AMBER : GREEN, true));
        stats.addView(muted("Rosters " + counts.optInt("rosters")
                + (RoleAccess.inboxShowsDutyChanges(role) ? " · Duty changes " + dutyChanges.length() : "")
                + " · Movements " + counts.optInt("movements")
                + " · Alerts " + counts.optInt("alerts")));
        add(stats);

        if (RoleAccess.inboxShowsRosters(role)) addRosters();
        if (RoleAccess.inboxShowsDutyChanges(role)) addDutyChanges();
        if (RoleAccess.inboxShowsMovements(role)) {
            addMovements();
        }
        addAlerts();
    }

    private void addCopilot() {
        LinearLayout card = card(BLUE);
        card.addView(text("AI STATION COPILOT", 10, BLUE, true));
        card.addView(muted("On-premises and explainable. Ask in plain language, e.g. 'What is the station strength?'"));
        EditText question = textField("Ask the station copilot…");
        question.setText(aiQuestion);
        card.addView(question, a.fieldParams());
        LinearLayout answerBox = new LinearLayout(a);
        answerBox.setOrientation(LinearLayout.VERTICAL);
        if (!aiAnswer.isEmpty()) fillAnswer(answerBox);
        card.addView(buttonRow(primary("Ask Copilot", () -> {
            String q = question.getText().toString().trim();
            if (q.isEmpty()) return;
            aiQuestion = q;
            answerBox.removeAllViews();
            answerBox.addView(muted("Thinking…"));
            a.executor.execute(() -> {
                try {
                    JSONObject res = a.request("/ai/query", "POST", body("query", q), false);
                    a.mainHandler.post(() -> {
                        aiAnswer = str(res, "response", "No answer.");
                        aiDisclaimer = str(res, "disclaimer");
                        if (active()) {
                            answerBox.removeAllViews();
                            fillAnswer(answerBox);
                        }
                    });
                } catch (Exception e) {
                    final String message = e.getMessage() == null ? "The copilot could not answer." : e.getMessage();
                    a.mainHandler.post(() -> {
                        if (active()) {
                            answerBox.removeAllViews();
                            answerBox.addView(text(message, 12, RED, false));
                        }
                    });
                }
            });
        })));
        card.addView(answerBox);
        add(card);
    }

    private void fillAnswer(LinearLayout box) {
        box.addView(text(aiAnswer, 13, INK, false));
        if (!aiDisclaimer.isEmpty()) box.addView(text(aiDisclaimer, 10, AMBER, false));
    }

    private void addRosters() {
        JSONArray rosters = arr(inbox, "rosters");
        section("ROSTERS AWAITING SHO APPROVAL (" + rosters.length() + ")");
        if (rosters.length() == 0) empty("No submitted rosters.");
        for (int i = 0; i < rosters.length(); i++) {
            JSONObject r = rosters.optJSONObject(i);
            if (r == null) continue;
            final int id = r.optInt("id");
            LinearLayout card = card(AMBER);
            card.addView(titleRow(text("Roster #" + id + " · " + day(str(r, "date")) + " · Shift " + str(r, "shift_code"), 14, INK, true),
                    badge("v" + str(r, "version"), BLUE, TINT)));
            card.addView(muted("Reason: " + str(r, "change_reason", "—") + " · waiting since " + dateTime(str(r, "waiting_since"))));
            card.addView(buttonRow(
                    primary("Approve", () -> prompt("Approve roster #" + id, "Approval comments (optional)", false,
                            c -> act("/rosters/" + id + "/approve", "POST", body("comments", c.isEmpty() ? null : c), "Roster #" + id + " approved."))),
                    danger("Return", () -> prompt("Return roster #" + id, "What must change? (required)", true,
                            c -> act("/rosters/" + id + "/reject", "POST", body("comments", c), "Roster #" + id + " returned to the Admin SI."))),
                    secondary("Open", () -> a.openModule(RoleAccess.ROSTER))));
            addTight(card);
        }
    }

    private void addDutyChanges() {
        section("DUTY CHANGE REQUESTS (" + dutyChanges.length() + ")");
        if (dutyChanges.length() == 0) empty("No pending duty change requests.");
        for (int i = 0; i < dutyChanges.length(); i++) {
            JSONObject r = dutyChanges.optJSONObject(i);
            if (r == null) continue;
            final int id = r.optInt("id");
            LinearLayout card = card(AMBER);
            card.addView(titleRow(text(person(str(r, "officer_name", "Officer"), str(r, "service_number")), 14, INK, true),
                    badge("#" + id, BLUE, TINT)));
            card.addView(muted("Now: " + day(str(r, "current_roster_date")) + " · Shift " + str(r, "current_shift_code")
                    + " · " + str(r, "current_duty_category", "General / Unassigned")));
            card.addView(muted("Wants: Shift " + str(r, "requested_shift_code", str(r, "current_shift_code"))
                    + " · " + str(r, "requested_duty_category", "any suitable duty point")));
            card.addView(muted("Reason: " + str(r, "reason")));
            card.addView(buttonRow(
                    success("Approve", () -> prompt("Approve request #" + id, "Approval remarks / reassignment notes (optional)", false,
                            c -> act("/rosters/change-requests/" + id + "/approve", "POST", body("remarks", c.isEmpty() ? null : c),
                                    "Duty change request #" + id + " approved."))),
                    danger("Reject", () -> prompt("Reject request #" + id, "Reason for rejecting (required)", true,
                            c -> act("/rosters/change-requests/" + id + "/reject", "POST", body("remarks", c),
                                    "Duty change request #" + id + " rejected."))),
                    secondary("Open", () -> a.openModule(RoleAccess.ROSTER_REQUESTS))));
            addTight(card);
        }
    }

    private void addMovements() {
        JSONArray movements = arr(inbox, "movements");
        section("MOVEMENTS AWAITING AUTHORIZATION (" + movements.length() + ")");
        if (movements.length() == 0) empty("No pending movement requests.");
        for (int i = 0; i < movements.length(); i++) {
            JSONObject m = movements.optJSONObject(i);
            if (m == null) continue;
            final int id = m.optInt("id");
            LinearLayout card = card(AMBER);
            card.addView(text("#" + id + " · " + str(m, "staff_name", "Staff #" + str(m, "staff_id")), 14, INK, true));
            card.addView(muted(str(m, "destination") + " — " + str(m, "purpose")));
            card.addView(muted("Expected return: " + dateTime(str(m, "expected_return"))));
            card.addView(buttonRow(
                    primary("Authorize", () -> act("/movements/" + id + "/authorize", "POST", null, "Movement #" + id + " authorized.")),
                    danger("Reject", () -> prompt("Reject movement #" + id, "Reason for not authorizing", false,
                            c -> act("/movements/" + id + "/reject", "POST", body("notes", c.isEmpty() ? null : c), "Movement #" + id + " rejected.")))));
            addTight(card);
        }
    }

    private void addAlerts() {
        JSONArray alerts = arr(inbox, "alerts");
        section("ALERTS (" + alerts.length() + ")");
        if (alerts.length() == 0) empty("All background checks clear.");
        for (int i = 0; i < alerts.length(); i++) {
            JSONObject al = alerts.optJSONObject(i);
            if (al == null) continue;
            final int id = al.optInt("id");
            String severity = str(al, "severity");
            int accent = "critical".equals(severity) ? RED : "warning".equals(severity) ? AMBER : BLUE;
            LinearLayout card = card(accent);
            card.addView(titleRow(text(str(al, "alert_type").replace('_', ' ').toUpperCase(Locale.ROOT), 12, accent, true),
                    badge(severity.toUpperCase(Locale.ROOT), accent, "critical".equals(severity) ? RED_BG : "warning".equals(severity) ? AMBER_BG : TINT)));
            card.addView(text(str(al, "message"), 13, INK, false));
            card.addView(muted("Raised " + dateTime(str(al, "created_at"))));
            if (RoleAccess.canResolveAlert(role)) {
                card.addView(buttonRow(secondary("Resolve", () -> act("/dashboard/alerts/" + id + "/resolve", "POST", null, "Alert resolved."))));
            }
            addTight(card);
        }
    }
}
