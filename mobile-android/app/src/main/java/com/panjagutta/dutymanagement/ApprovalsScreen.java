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
        load(() -> a.request("/dashboard/inbox", "GET", null, false), data -> {
            inbox = data;
            render();
        });
    }

    private void render() {
        a.content.removeAllViews();
        heading("APPROVALS", "Approvals & Alerts",
                "Everything waiting on you: roster approvals, leave decisions, movement authorizations and alerts.");
        if (RoleAccess.canAskAI(role)) addCopilot();
        JSONObject counts = inbox.optJSONObject("counts");
        if (counts == null) counts = new JSONObject();
        LinearLayout stats = card(0);
        stats.addView(text("WAITING FOR YOU", 10, BLUE, true));
        stats.addView(text(counts.optInt("total") + " item(s) in total", 16, counts.optInt("total") > 0 ? AMBER : GREEN, true));
        stats.addView(muted("Rosters " + counts.optInt("rosters") + " · Leave " + counts.optInt("leave")
                + " · Movements " + counts.optInt("movements")
                + " · Alerts " + counts.optInt("alerts")));
        add(stats);

        if (RoleAccess.inboxShowsRosters(role)) addRosters();
        if (RoleAccess.inboxShowsLeave(role)) addLeave();
        if (RoleAccess.inboxShowsMovements(role)) {
            addMovements();
        }
        addAlerts();
    }

    private void addCopilot() {
        LinearLayout card = card(BLUE);
        card.addView(text("AI STATION COPILOT", 10, BLUE, true));
        card.addView(muted("On-premises and explainable. Ask in plain language, e.g. 'Who is on leave today?'"));
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
                        if (a.current == this) {
                            answerBox.removeAllViews();
                            fillAnswer(answerBox);
                        }
                    });
                } catch (Exception e) {
                    final String message = e.getMessage() == null ? "The copilot could not answer." : e.getMessage();
                    a.mainHandler.post(() -> {
                        if (a.current == this) {
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

    private void addLeave() {
        JSONArray leave = arr(inbox, "leave");
        section("LEAVE REQUESTS (" + leave.length() + ")");
        if (leave.length() == 0) empty("No pending leave requests.");
        for (int i = 0; i < leave.length(); i++) {
            JSONObject l = leave.optJSONObject(i);
            if (l == null) continue;
            final int id = l.optInt("id");
            final String ref = str(l, "reference_number", "#" + id);
            LinearLayout card = card(AMBER);
            card.addView(titleRow(text(person(str(l, "staff_name", "Staff #" + str(l, "staff_id")), str(l, "service_number")), 14, INK, true),
                    badge(str(l, "leave_type").toUpperCase(Locale.ROOT), BLUE, TINT)));
            card.addView(muted(ref + " · " + day(str(l, "start_date")) + " to " + day(str(l, "end_date"))));
            card.addView(buttonRow(
                    success("Quick approve", () -> prompt("Approve leave " + ref, "Approval remarks (optional). Check roster impact in Leave first.", false,
                            c -> act("/leave/" + id + "/approve", "POST", body("remarks", c.isEmpty() ? null : c), "Leave " + ref + " approved."))),
                    danger("Reject", () -> prompt("Reject leave " + ref, "Reason for rejection (required, shown to the officer)", true,
                            c -> act("/leave/" + id + "/reject", "POST", body("remarks", c), "Leave " + ref + " rejected."))),
                    secondary("Review", () -> a.openModule(RoleAccess.LEAVE))));
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
