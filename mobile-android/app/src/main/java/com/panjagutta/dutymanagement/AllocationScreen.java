package com.panjagutta.dutymanagement;

import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Duty allocation workspace: pick a date and shift, allocate officers to duty points with live rule checks,
 * record authorized exceptions, then save, submit, approve and publish (web: /duty-allocation).
 * Editing is for the SHO and Admin SI; the Sector SI sees the allocation read-only.
 */
final class AllocationScreen extends ModuleScreen {
    private static final String[] SHIFTS = {"A", "B", "C"};

    private String date;
    private String shift = "A";
    private String sectionFilter = "";
    private String poolSector = "";
    private String changeReason = "Routine daily duty allocation update";

    private JSONObject roster; // active draft/roster for the date+shift, or null
    private final List<JSONObject> duties = new ArrayList<>();
    private JSONArray staff = new JSONArray();
    private JSONArray sectors = new JSONArray();
    private JSONArray authorizers = new JSONArray();
    private final Map<Integer, String> statusMap = new HashMap<>();
    private final Map<String, String> shiftTimes = new HashMap<>();
    private JSONArray issues = new JSONArray();
    private JSONArray restorable;
    private boolean dirty;

    AllocationScreen(MainActivity a) {
        super(a);
        date = a.allocationDate != null ? a.allocationDate : a.today();
        if (a.allocationShift != null) shift = a.allocationShift;
        a.allocationDate = null;
        a.allocationShift = null;
    }

    private boolean canEdit() {
        return RoleAccess.canEditAllocation(role);
    }

    private String draftKey() {
        return "alloc:" + date + ":" + shift;
    }

    @Override
    void show() {
        load(() -> {
            Object[] r = new Object[8];
            r[0] = a.requestArray("/staff/?is_active=true");
            try {
                r[1] = a.request("/dashboard/summary?for_date=" + date + "&shift_code=" + shift, "GET", null, false);
            } catch (Exception e) {
                r[1] = null;
            }
            r[2] = a.requestArray("/duties/?shift_code=" + shift + "&active_only=true");
            try {
                r[3] = a.request("/rosters/active-draft?roster_date=" + date + "&shift_code=" + shift, "GET", null, false).optJSONObject("roster");
            } catch (Exception e) {
                r[3] = null;
            }
            try {
                r[4] = a.requestArray("/config/sectors");
            } catch (Exception e) {
                r[4] = new JSONArray();
            }
            try {
                r[5] = a.requestArray("/config/authorizers");
            } catch (Exception e) {
                r[5] = new JSONArray();
            }
            try {
                r[6] = a.request("/policy/", "GET", null, false).optJSONArray("shifts");
            } catch (Exception e) {
                r[6] = null;
            }
            try {
                r[7] = a.request("/auth/drafts/" + java.net.URLEncoder.encode(draftKey(), "UTF-8"), "GET", null, false).optJSONArray("payload");
            } catch (Exception e) {
                r[7] = null;
            }
            return r;
        }, r -> {
            staff = (JSONArray) r[0];
            statusMap.clear();
            if (r[1] != null) {
                JSONArray list = arr((JSONObject) r[1], "staff_status_list");
                for (int i = 0; i < list.length(); i++) {
                    JSONObject s = list.optJSONObject(i);
                    if (s != null) statusMap.put(s.optInt("staff_id"), str(s, "status"));
                }
            }
            roster = (JSONObject) r[3];
            sectors = (JSONArray) r[4];
            authorizers = (JSONArray) r[5];
            if (r[6] != null) {
                JSONArray shifts = (JSONArray) r[6];
                for (int i = 0; i < shifts.length(); i++) {
                    JSONObject s = shifts.optJSONObject(i);
                    if (s != null) shiftTimes.put(str(s, "shift_code"), str(s, "start_time") + "–" + str(s, "end_time"));
                }
            }
            // Duty points merged with what is already allocated on the draft.
            Map<Integer, JSONArray> byDuty = new HashMap<>();
            if (roster != null) {
                JSONArray assignments = arr(roster, "assignments");
                for (int i = 0; i < assignments.length(); i++) {
                    JSONObject as = assignments.optJSONObject(i);
                    if (as == null) continue;
                    JSONArray list = byDuty.get(as.optInt("duty_master_id"));
                    if (list == null) {
                        list = new JSONArray();
                        byDuty.put(as.optInt("duty_master_id"), list);
                    }
                    list.put(officer(as.optInt("staff_id"), str(as, "staff_name"), str(as, "designation"),
                            str(as, "service_number"), as.isNull("sector_id") ? 0 : as.optInt("sector_id"),
                            as.optBoolean("is_exception"), str(as, "exception_reason"),
                            as.isNull("exception_authorized_by_id") ? 0 : as.optInt("exception_authorized_by_id")));
                }
            }
            duties.clear();
            JSONArray dutyList = (JSONArray) r[2];
            for (int i = 0; i < dutyList.length(); i++) {
                JSONObject d = dutyList.optJSONObject(i);
                if (d == null) continue;
                try {
                    d.put("assigned", byDuty.containsKey(d.optInt("id")) ? byDuty.get(d.optInt("id")) : new JSONArray());
                } catch (JSONException ignored) {
                    // Literal key.
                }
                duties.add(d);
            }
            dirty = false;
            issues = new JSONArray();
            restorable = null;
            JSONArray saved = (JSONArray) r[7];
            if (saved != null && roster != null && "draft".equals(str(roster, "status")) && !signature(saved).equals(signatureOfDuties())) {
                restorable = saved;
            }
            render();
        });
    }

    private static JSONObject officer(int staffId, String name, String designation, String serviceNumber, int sectorId,
                                      boolean exception, String reason, int authorizerId) {
        JSONObject o = new JSONObject();
        try {
            o.put("staff_id", staffId);
            o.put("name", name);
            o.put("designation", designation);
            o.put("service_number", serviceNumber);
            o.put("sector_id", sectorId);
            o.put("is_exception", exception);
            o.put("exception_reason", reason);
            o.put("exception_authorized_by_id", authorizerId);
        } catch (JSONException ignored) {
            // Literal keys.
        }
        return o;
    }

    private String signatureOfDuties() {
        StringBuilder sb = new StringBuilder();
        for (JSONObject d : duties) {
            sb.append(d.optInt("id")).append(':');
            List<Integer> ids = new ArrayList<>();
            JSONArray as = arr(d, "assigned");
            for (int i = 0; i < as.length(); i++) ids.add(as.optJSONObject(i).optInt("staff_id"));
            java.util.Collections.sort(ids);
            sb.append(ids).append(';');
        }
        return sb.toString();
    }

    /** Signature of a saved-draft payload ([{duty_master_id, officers:[...]}]) over the current duty list. */
    private String signature(JSONArray saved) {
        StringBuilder sb = new StringBuilder();
        for (JSONObject d : duties) {
            sb.append(d.optInt("id")).append(':');
            List<Integer> ids = new ArrayList<>();
            for (int i = 0; i < saved.length(); i++) {
                JSONObject s = saved.optJSONObject(i);
                if (s != null && s.optInt("duty_master_id") == d.optInt("id")) {
                    JSONArray officers = arr(s, "officers");
                    for (int k = 0; k < officers.length(); k++) ids.add(officers.optJSONObject(k).optInt("staff_id"));
                }
            }
            java.util.Collections.sort(ids);
            sb.append(ids).append(';');
        }
        return sb.toString();
    }

    // ── Rendering ────────────────────────────────────────────────────────────────

    private void render() {
        a.content.removeAllViews();
        a.stopRefreshing();
        String time = shiftTimes.get(shift);
        heading("DUTY ALLOCATION", "Duty Allocation Workspace",
                "Shift " + shift + (time == null ? "" : " (" + time + ")") + " on " + day(date)
                        + " · required, allocated and vacant strength per duty");
        addControls();
        if (restorable != null) addRestoreBanner();
        addStatusCard();
        addIssues();
        addDuties();
    }

    private void addControls() {
        LinearLayout card = card(0);
        EditText dateField = a.dateField(date, null);
        labeled(card, "Date", dateField);
        Spinner shiftSpinner = spinner(new String[]{"Shift A", "Shift B", "Shift C"}, "ABC".indexOf(shift));
        labeled(card, "Shift", shiftSpinner);

        List<String> sectionNames = new ArrayList<>();
        sectionNames.add("All sections");
        for (JSONObject d : duties) {
            String s = str(d, "section");
            if (!s.isEmpty() && !sectionNames.contains(s)) sectionNames.add(s);
        }
        Spinner sectionSpinner = spinner(sectionNames, Math.max(0, sectionNames.indexOf(sectionFilter)));
        labeled(card, "Section", sectionSpinner);
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
        card.addView(buttonRow(primary("Load workspace", () -> {
            String d = dateField.getText().toString().trim();
            if (!a.validDate(d)) {
                dateField.setError("Choose a date");
                return;
            }
            if (dirty) {
                confirm("You have unsaved allocation changes. Continue without saving them?", () -> applyControls(d, shiftSpinner, sectionSpinner, sectionNames, poolSpinner, poolIds));
            } else {
                applyControls(d, shiftSpinner, sectionSpinner, sectionNames, poolSpinner, poolIds);
            }
        })));
        add(card);
    }

    private void applyControls(String d, Spinner shiftSpinner, Spinner sectionSpinner, List<String> sectionNames,
                               Spinner poolSpinner, List<String> poolIds) {
        date = d;
        shift = SHIFTS[shiftSpinner.getSelectedItemPosition()];
        int sp = sectionSpinner.getSelectedItemPosition();
        sectionFilter = sp <= 0 ? "" : sectionNames.get(sp);
        poolSector = poolIds.get(poolSpinner.getSelectedItemPosition());
        show();
    }

    private void addRestoreBanner() {
        LinearLayout card = card(BLUE);
        card.addView(text("You have an unsaved allocation draft for this shift from an earlier session.", 12, INK, true));
        card.addView(buttonRow(
                primary("Restore it", () -> {
                    for (JSONObject d : duties) {
                        JSONArray officers = new JSONArray();
                        for (int i = 0; i < restorable.length(); i++) {
                            JSONObject s = restorable.optJSONObject(i);
                            if (s != null && s.optInt("duty_master_id") == d.optInt("id")) officers = arr(s, "officers");
                        }
                        try {
                            d.put("assigned", officers);
                        } catch (JSONException ignored) {
                            // Literal key.
                        }
                    }
                    restorable = null;
                    changed();
                    a.toast("Restored your unsaved allocation draft. Review and save it.");
                }),
                secondary("Discard", () -> {
                    restorable = null;
                    saveDraftOnServer(null);
                    render();
                })));
        add(card);
    }

    private void addStatusCard() {
        int required = 0;
        int allocated = 0;
        int vacant = 0;
        for (JSONObject d : duties) {
            int req = d.isNull("required_strength") ? 0 : d.optInt("required_strength");
            int count = arr(d, "assigned").length();
            required += req;
            allocated += count;
            vacant += Math.max(0, req - count);
        }
        LinearLayout card = card(roster == null ? AMBER : BLUE);
        if (roster == null) {
            card.addView(badge("NO DRAFT ROSTER FOR THIS SHIFT", AMBER, AMBER_BG));
        } else {
            card.addView(titleRow(text("Roster #" + roster.optInt("id") + " (v" + str(roster, "version") + ")", 14, INK, true),
                    statusBadge(str(roster, "status"))));
        }
        card.addView(muted("Required " + required + " · Allocated " + allocated + " · Vacant " + vacant));

        String status = roster == null ? "" : str(roster, "status");
        if (roster == null) {
            if (canEdit()) {
                EditText reason = textField("Reason for the draft");
                reason.setText(changeReason);
                card.addView(reason, a.fieldParams());
                card.addView(buttonRow(primary("+ Initialize draft roster", () -> {
                    changeReason = reason.getText().toString().trim();
                    call("/rosters/", "POST", body("roster_date", date, "shift_code", shift,
                            "change_reason", changeReason.isEmpty() ? "Draft for Shift " + shift + " on " + date : changeReason,
                            "assignments", new JSONArray()), "Draft roster created for Shift " + shift + ".", res -> show());
                })));
            } else {
                card.addView(muted("Only the SHO or Admin SI can allocate duties. You can review the allocation here."));
            }
        } else if ("draft".equals(status) && canEdit()) {
            EditText reason = textField("Reason for this change (audit log)");
            reason.setText(changeReason);
            card.addView(reason, a.fieldParams());
            List<android.widget.Button> buttons = new ArrayList<>();
            buttons.add(primary("💾 Save allocation draft" + (dirty ? " *" : ""), () -> {
                changeReason = reason.getText().toString().trim();
                save();
            }));
            if (RoleAccess.canSubmitRoster(role)) {
                buttons.add(secondary("📤 Submit for approval", () -> workflow("/rosters/" + roster.optInt("id") + "/submit",
                        "Roster #" + roster.optInt("id") + " submitted for SHO approval.")));
            }
            addButtons(card, buttons);
        } else if ("submitted".equals(status) && RoleAccess.canApproveRoster(role)) {
            card.addView(buttonRow(primary("✓ Approve roster (SHO)", () -> workflow("/rosters/" + roster.optInt("id") + "/approve",
                    "Roster #" + roster.optInt("id") + " approved."))));
        } else if ("approved".equals(status) && canEdit()) {
            card.addView(buttonRow(success("📢 Publish roster", () -> workflow("/rosters/" + roster.optInt("id") + "/publish",
                    "Roster #" + roster.optInt("id") + " published."))));
        } else if (!"draft".equals(status)) {
            card.addView(muted("This roster is " + status + ". Use Revise on the Roster screen to start a new version."));
        }
        add(card);
    }

    private void workflow(String path, String ok) {
        if (dirty) {
            confirm("You have unsaved allocation changes. Continue without saving them?", () -> act(path, "POST", null, ok));
        } else {
            act(path, "POST", null, ok);
        }
    }

    private void addIssues() {
        if (issues.length() == 0) return;
        int blocking = 0;
        for (int i = 0; i < issues.length(); i++) if (issues.optJSONObject(i) != null && issues.optJSONObject(i).optBoolean("blocking")) blocking++;
        LinearLayout card = card(blocking > 0 ? RED : BLUE);
        card.addView(text(blocking > 0 ? "⛔ " + blocking + " violation(s) block saving" : "✓ No blocking violations", 13, blocking > 0 ? RED : GREEN, true));
        card.addView(muted((issues.length() - blocking) + " advisory note(s)"));
        for (int i = 0; i < issues.length(); i++) {
            JSONObject issue = issues.optJSONObject(i);
            if (issue == null) continue;
            card.addView(text("• " + str(issue, "code").replace('_', ' ') + (issue.optBoolean("overridden") ? " (authorized exception)" : "")
                    + ": " + str(issue, "message"), 11, issue.optBoolean("blocking") ? RED : INK, issue.optBoolean("blocking")));
        }
        add(card);
    }

    private void addDuties() {
        List<JSONObject> shown = new ArrayList<>();
        for (JSONObject d : duties) {
            if (sectionFilter.isEmpty() || sectionFilter.equals(str(d, "section"))) shown.add(d);
        }
        section("DUTY POINTS (" + shown.size() + ")");
        if (shown.isEmpty()) empty("No active duty points for Shift " + shift + ".");
        boolean editable = canEdit() && roster != null && "draft".equals(str(roster, "status"));
        for (JSONObject d : shown) {
            int req = d.isNull("required_strength") ? 0 : d.optInt("required_strength");
            JSONArray assigned = arr(d, "assigned");
            int vacant = Math.max(0, req - assigned.length());
            boolean configured = d.optBoolean("is_configured", true);
            LinearLayout card = card(!configured ? AMBER : vacant > 0 ? AMBER : GREEN);
            card.addView(titleRow(text(str(d, "category"), 14, INK, true),
                    !configured ? null : vacant > 0 ? badge(vacant + " VACANT", AMBER, AMBER_BG) : badge("FILLED", GREEN, GREEN_BG)));
            JSONArray ranks = arr(d, "eligible_designations");
            StringBuilder rank = new StringBuilder();
            for (int i = 0; i < ranks.length(); i++) rank.append(i > 0 ? ", " : "").append(ranks.optString(i));
            card.addView(muted((str(d, "section").isEmpty() ? "" : "Section: " + str(d, "section") + " · ")
                    + "Eligible: " + (rank.length() == 0 ? "All ranks" : rank)));
            card.addView(muted("Required " + (configured ? req : "—") + " · Allocated " + assigned.length()
                    + (configured ? "" : " · strength not configured")));
            if (assigned.length() == 0) card.addView(text("Unassigned", 12, RED, false));
            for (int i = 0; i < assigned.length(); i++) {
                JSONObject o = assigned.optJSONObject(i);
                if (o == null) continue;
                card.addView(officerRow(d, o, editable));
            }
            if (editable) {
                card.addView(buttonRow(secondary("+ Assign officer", () -> assignDialog(d))));
            }
            addTight(card);
        }
    }

    private LinearLayout officerRow(JSONObject duty, JSONObject o, boolean editable) {
        final int staffId = o.optInt("staff_id");
        List<String> own = new ArrayList<>();
        boolean bad = false;
        for (int i = 0; i < issues.length(); i++) {
            JSONObject issue = issues.optJSONObject(i);
            if (issue == null || issue.isNull("staff_id") || issue.optInt("staff_id") != staffId) continue;
            if ("VACANCY".equals(str(issue, "code"))) continue;
            own.add(str(issue, "message"));
            if (issue.optBoolean("blocking")) bad = true;
        }
        LinearLayout row = new LinearLayout(a);
        row.setOrientation(LinearLayout.VERTICAL);
        row.setPadding(0, a.dp(6), 0, 0);
        boolean exception = o.optBoolean("is_exception");
        row.addView(text((bad ? "⛔ " : exception ? "⚠ " : "") + str(o, "name") + " (" + str(o, "designation") + ")", 13,
                bad ? RED : exception ? AMBER : INK, true));
        row.addView(muted(str(o, "service_number")));
        for (String m : own) row.addView(text("• " + m, 11, bad ? RED : MUTED, false));
        if (exception) row.addView(text("Exception: " + str(o, "exception_reason"), 11, AMBER, false));
        if (editable) {
            List<android.widget.Button> buttons = new ArrayList<>();
            if (bad && !exception) buttons.add(secondary("Authorize exception", () -> authorizeDialog(duty, o, own)));
            buttons.add(danger("Remove", () -> remove(duty, staffId)));
            addButtons(row, buttons);
        }
        return row;
    }

    // ── Editing ──────────────────────────────────────────────────────────────────

    private boolean isAssigned(int staffId) {
        for (JSONObject d : duties) {
            JSONArray as = arr(d, "assigned");
            for (int i = 0; i < as.length(); i++) if (as.optJSONObject(i).optInt("staff_id") == staffId) return true;
        }
        return false;
    }

    private void assignDialog(JSONObject duty) {
        List<JSONObject> pool = new ArrayList<>();
        List<String> names = new ArrayList<>();
        names.add("-- Choose officer --");
        for (int i = 0; i < staff.length(); i++) {
            JSONObject s = staff.optJSONObject(i);
            if (s == null || isAssigned(s.optInt("id"))) continue;
            if (!poolSector.isEmpty()) {
                boolean station = "STATION".equals(poolSector);
                if (station ? !s.isNull("sector_id") : s.isNull("sector_id") || !poolSector.equals(str(s, "sector_id"))) continue;
            }
            pool.add(s);
            String status = statusMap.containsKey(s.optInt("id")) ? statusMap.get(s.optInt("id")) : "Unknown";
            names.add(str(s, "name") + " (" + str(s, "designation") + ") — " + status
                    + (str(s, "attached_to").isEmpty() ? "" : " · attached"));
        }
        LinearLayout form = formBody();
        form.addView(text(str(duty, "category"), 14, INK, true));
        Spinner officerSpinner = spinner(names, 0);
        labeled(form, "Select officer", officerSpinner);
        CheckBox exception = new CheckBox(a);
        exception.setText("Authorized exception (needs a reason and an authorizing officer)");
        form.addView(exception);
        EditText reason = multiline("e.g. Emergency deployment for VIP bandobast");
        LinearLayout exceptionBox = formBody();
        labeled(exceptionBox, "Exception justification *", reason);
        List<JSONObject> allowedAuthorizers = allowedAuthorizers();
        List<String> authorizerNames = new ArrayList<>();
        authorizerNames.add("-- Select officer --");
        for (JSONObject au : allowedAuthorizers) authorizerNames.add(str(au, "name") + " (" + str(au, "role") + ")");
        Spinner authorizer = spinner(authorizerNames, 0);
        labeled(exceptionBox, "Authorizing officer *", authorizer);
        exceptionBox.setVisibility(android.view.View.GONE);
        form.addView(exceptionBox);
        exception.setOnCheckedChangeListener((b, on) -> exceptionBox.setVisibility(on ? android.view.View.VISIBLE : android.view.View.GONE));
        form("Assign officer", form, "Assign", () -> {
            int pos = officerSpinner.getSelectedItemPosition();
            if (pos == 0) {
                a.toast("Select an officer first.");
                return false;
            }
            JSONObject s = pool.get(pos - 1);
            JSONArray eligible = arr(duty, "eligible_designations");
            boolean rankOk = eligible.length() == 0;
            for (int i = 0; i < eligible.length(); i++) if (eligible.optString(i).equals(str(s, "designation"))) rankOk = true;
            boolean isException = exception.isChecked();
            if (!rankOk && !isException) {
                a.toast("Rank mismatch: " + str(s, "name") + " (" + str(s, "designation")
                        + ") is not eligible. Tick \"Authorized exception\" to override.");
                return false;
            }
            int authorizerId = 0;
            if (isException) {
                int ap = authorizer.getSelectedItemPosition();
                if (reason.getText().toString().trim().isEmpty() || ap == 0) {
                    a.toast("An exception needs a reason and the authorizing officer.");
                    return false;
                }
                authorizerId = allowedAuthorizers.get(ap - 1).optInt("user_id");
            }
            arr(duty, "assigned").put(officer(s.optInt("id"), str(s, "name"), str(s, "designation"), str(s, "service_number"),
                    s.isNull("sector_id") ? 0 : s.optInt("sector_id"), isException,
                    isException ? reason.getText().toString().trim() : "", authorizerId));
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

    private void authorizeDialog(JSONObject duty, JSONObject o, List<String> violations) {
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
        form("Authorize exception for " + str(o, "name"), form, "Authorize", () -> {
            int ap = authorizer.getSelectedItemPosition();
            if (reason.getText().toString().trim().isEmpty() || ap == 0) {
                a.toast("An exception needs a reason and the authorizing officer.");
                return false;
            }
            try {
                o.put("is_exception", true);
                o.put("exception_reason", reason.getText().toString().trim());
                o.put("exception_authorized_by_id", allowed.get(ap - 1).optInt("user_id"));
            } catch (JSONException e) {
                return false;
            }
            changed();
            return true;
        });
    }

    private void remove(JSONObject duty, int staffId) {
        JSONArray current = arr(duty, "assigned");
        JSONArray next = new JSONArray();
        for (int i = 0; i < current.length(); i++) {
            if (current.optJSONObject(i).optInt("staff_id") != staffId) next.put(current.optJSONObject(i));
        }
        try {
            duty.put("assigned", next);
        } catch (JSONException ignored) {
            // Literal key.
        }
        changed();
    }

    /** After any edit: redraw, re-run the rule checks and keep the server-side draft. */
    private void changed() {
        dirty = true;
        render();
        validate(null);
        JSONArray payload = new JSONArray();
        for (JSONObject d : duties) {
            JSONObject entry = new JSONObject();
            try {
                entry.put("duty_master_id", d.optInt("id"));
                entry.put("officers", arr(d, "assigned"));
            } catch (JSONException ignored) {
                // Literal keys.
            }
            payload.put(entry);
        }
        saveDraftOnServer(payload);
    }

    private void saveDraftOnServer(JSONArray payload) {
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

    private JSONArray toPayload() {
        JSONArray out = new JSONArray();
        for (JSONObject d : duties) {
            JSONArray as = arr(d, "assigned");
            for (int i = 0; i < as.length(); i++) {
                JSONObject o = as.optJSONObject(i);
                JSONObject row = new JSONObject();
                try {
                    row.put("duty_master_id", d.optInt("id"));
                    row.put("staff_id", o.optInt("staff_id"));
                    String reason = str(o, "exception_reason");
                    row.put("notes", reason.isEmpty() ? JSONObject.NULL : reason);
                    row.put("is_exception", o.optBoolean("is_exception"));
                    row.put("exception_reason", reason.isEmpty() ? JSONObject.NULL : reason);
                    int auth = o.optInt("exception_authorized_by_id", 0);
                    row.put("exception_authorized_by_id", auth > 0 ? auth : JSONObject.NULL);
                } catch (JSONException ignored) {
                    // Literal keys.
                }
                out.put(row);
            }
        }
        return out;
    }

    /** Runs the rule checks on the current allocation; `then` receives the result (null on failure). */
    private void validate(Done<JSONObject> then) {
        final JSONObject payload = body("roster_date", date, "shift_code", shift, "assignments", toPayload());
        a.executor.execute(() -> {
            JSONObject result = null;
            try {
                result = a.request("/rosters/validate", "POST", payload, false);
            } catch (Exception ignored) {
                // Checks are advisory until saving.
            }
            final JSONObject res = result;
            a.mainHandler.post(() -> {
                if (a.current != this) return;
                if (res != null) {
                    issues = arr(res, "issues");
                    if (then == null) render();
                }
                if (then != null) then.run(res);
            });
        });
    }

    private void save() {
        if (roster == null) {
            a.toast("Create a draft roster first.");
            return;
        }
        validate(check -> {
            if (check != null && !check.optBoolean("can_save", true)) {
                a.toast(check.optInt("blocking_count") + " rule violation(s) must be fixed or authorized as exceptions before saving. See the checks panel.");
                render();
                return;
            }
            call("/rosters/" + roster.optInt("id") + "/assignments", "PUT",
                    body("change_reason", changeReason, "assignments", toPayload()), null, res -> {
                        a.toast("Allocations saved to Roster #" + roster.optInt("id") + " (v" + str(res.optJSONObject("roster"), "version") + ").");
                        saveDraftOnServer(null);
                        show();
                    });
        });
    }
}
