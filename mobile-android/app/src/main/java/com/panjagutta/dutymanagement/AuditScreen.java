package com.panjagutta.dutymanagement;

import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.URLEncoder;

/** Immutable audit trail: filter and page through who did what, when (web: /audit). Read-only. */
final class AuditScreen extends ModuleScreen {
    private static final int PAGE = 50;
    private String actor = "";
    private String action = "";
    private String entity = "";
    private boolean exceptionsOnly;
    private int page;
    private JSONArray logs = new JSONArray();

    AuditScreen(MainActivity a) {
        super(a);
    }

    @Override
    void show() {
        load(() -> {
            StringBuilder q = new StringBuilder("/audit/?limit=" + PAGE + "&offset=" + (page * PAGE));
            if (!actor.isEmpty()) q.append("&actor_username=").append(URLEncoder.encode(actor, "UTF-8"));
            if (!action.isEmpty()) q.append("&action=").append(URLEncoder.encode(action, "UTF-8"));
            if (!entity.isEmpty()) q.append("&entity_type=").append(URLEncoder.encode(entity, "UTF-8"));
            if (exceptionsOnly) q.append("&exceptions_only=true");
            return a.requestArray(q.toString());
        }, data -> {
            logs = data;
            render();
        });
    }

    private void render() {
        a.content.removeAllViews();
        a.stopRefreshing();
        heading("AUDIT", "Immutable Audit Trail",
                "Append-only record of every sign-in, change, approval and authorized exception: who, what, when, old and new values, and who authorized it.");
        LinearLayout filter = card(0);
        EditText actorField = textField("e.g. sho_demo");
        actorField.setText(actor);
        labeled(filter, "Actor", actorField);
        EditText actionField = textField("e.g. ROSTER_APPROVED");
        actionField.setText(action);
        labeled(filter, "Action", actionField);
        EditText entityField = textField("e.g. Roster, LeaveRequest");
        entityField.setText(entity);
        labeled(filter, "Entity", entityField);
        CheckBox exceptions = new CheckBox(a);
        exceptions.setText("Authorized exceptions only");
        exceptions.setChecked(exceptionsOnly);
        filter.addView(exceptions);
        filter.addView(buttonRow(
                secondary("Reset", () -> {
                    actor = action = entity = "";
                    exceptionsOnly = false;
                    page = 0;
                    show();
                }),
                primary("Apply", () -> {
                    actor = actorField.getText().toString().trim();
                    action = actionField.getText().toString().trim();
                    entity = entityField.getText().toString().trim();
                    exceptionsOnly = exceptions.isChecked();
                    page = 0;
                    show();
                })));
        add(filter);

        section("AUDIT TRAIL RECORDS (" + logs.length() + ") · READ-ONLY");
        if (logs.length() == 0) empty("No audit log entries match your criteria.");
        for (int i = 0; i < logs.length(); i++) {
            JSONObject log = logs.optJSONObject(i);
            if (log == null) continue;
            boolean exception = !str(log, "exception_reason").isEmpty();
            LinearLayout card = card(exception ? AMBER : 0);
            card.addView(titleRow(text(str(log, "action"), 12, BLUE, true), muted(dateTime(str(log, "timestamp")))));
            card.addView(text(str(log, "actor_username") + " · " + str(log, "entity_type")
                    + (log.isNull("entity_id") ? "" : " #" + str(log, "entity_id")), 13, INK, true));
            if (!str(log, "authorizer_username").isEmpty()) card.addView(muted("Authorized by " + str(log, "authorizer_username")));
            if (exception) card.addView(text("Exception: " + str(log, "exception_reason"), 11, AMBER, true));
            if (!log.isNull("new_values")) card.addView(text("New: " + shorten(String.valueOf(log.opt("new_values"))), 10, GREEN, false));
            if (!log.isNull("old_values")) card.addView(text("Old: " + shorten(String.valueOf(log.opt("old_values"))), 10, RED, false));
            card.addView(muted((str(log, "ip_address").isEmpty() ? "" : str(log, "ip_address") + " · ")
                    + (str(log, "request_id").length() > 8 ? str(log, "request_id").substring(0, 8) + "…" : str(log, "request_id"))));
            addTight(card);
        }
        LinearLayout pager = hrow();
        android.widget.Button newer = secondary("‹ Newer", () -> {
            page--;
            show();
        });
        newer.setEnabled(page > 0);
        android.widget.Button older = secondary("Older ›", () -> {
            page++;
            show();
        });
        older.setEnabled(logs.length() >= PAGE);
        pager.addView(newer, new LinearLayout.LayoutParams(0, a.dp(42), 1));
        android.widget.TextView label = text("Page " + (page + 1), 12, MUTED, false);
        label.setGravity(android.view.Gravity.CENTER);
        pager.addView(label, new LinearLayout.LayoutParams(0, android.view.ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        pager.addView(older, new LinearLayout.LayoutParams(0, a.dp(42), 1));
        a.content.addView(pager);
    }

    private static String shorten(String s) {
        return s.length() > 300 ? s.substring(0, 300) + "…" : s;
    }
}
