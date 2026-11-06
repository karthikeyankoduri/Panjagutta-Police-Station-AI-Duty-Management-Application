package com.panjagutta.dutymanagement;

import android.graphics.Color;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Operational dashboard: status cards, shift views, alerts and the staff status list (web: /dashboard). */
final class DashboardScreen extends ModuleScreen {
    private static final String[][] CARDS = {
            {"total_staff", "Total Staff"}, {"scheduled_current_shift", "Scheduled"}, {"present", "Present"},
            {"on_duty", "On Duty"}, {"available", "Available"}, {"field_duty", "Field Duty"},
            {"court_duty", "Court Duty"}, {"patrol_beat", "Patrol / Beat"}, {"on_leave", "On Leave"},
            {"duty_off_rest", "Duty Off / Rest"}, {"attached_other_wing", "Attached"},
            {"official_movement", "Official Movement"}, {"absent", "Absent"}, {"vacant_positions", "Vacant Positions"},
    };
    private static final String[] VIEW_TABS = {"Current shift", "Upcoming shift", "Rest", "Vacancy"};

    // Filters (kept while the user stays on the screen)
    private String date = "";
    private String shift = "";
    private String designation = "";
    private String sectorId = "";
    private String section = "";
    private String dutyCategory = "";
    private String status = "";
    private boolean filtersOpen;
    private String selectedCard;
    private String search = "";
    private int viewTab;
    private int shown = 40;

    // Data
    private JSONObject summary;
    private JSONObject views;
    private JSONObject policy;
    private JSONArray alerts = new JSONArray();
    private JSONArray sectors = new JSONArray();
    private JSONArray sections = new JSONArray();
    private JSONObject lists = new JSONObject();
    private boolean referenceLoaded;

    DashboardScreen(MainActivity a) {
        super(a);
    }

    @Override
    void show() {
        load(() -> {
            Object[] r = new Object[6];
            r[0] = a.request("/dashboard/summary" + query(true), "GET", null, false);
            try {
                r[1] = a.request("/dashboard/views" + query(false), "GET", null, false);
            } catch (Exception e) {
                r[1] = null;
            }
            try {
                r[2] = a.requestArray("/dashboard/alerts");
            } catch (Exception e) {
                r[2] = new JSONArray();
            }
            try {
                r[3] = a.request("/policy/", "GET", null, false);
            } catch (Exception e) {
                r[3] = null;
            }
            if (!referenceLoaded) {
                try {
                    r[4] = new Object[]{a.requestArray("/config/sectors"), a.requestArray("/config/sections")};
                } catch (Exception e) {
                    r[4] = null;
                }
            }
            // Reloaded every time so an administrator's card changes show up on refresh.
            try {
                r[5] = a.request("/config/lists", "GET", null, false);
            } catch (Exception e) {
                r[5] = null; // keep what we have; with none, every card is shown
            }
            return r;
        }, r -> {
            summary = (JSONObject) r[0];
            views = (JSONObject) r[1];
            alerts = (JSONArray) r[2];
            policy = (JSONObject) r[3];
            if (r[4] != null) {
                Object[] ref = (Object[]) r[4];
                sectors = (JSONArray) ref[0];
                sections = (JSONArray) ref[1];
                referenceLoaded = true;
            }
            if (r[5] != null) lists = (JSONObject) r[5];
            render();
        });
    }

    private String query(boolean withFilters) {
        StringBuilder q = new StringBuilder("?");
        append(q, "for_date", date);
        append(q, "shift_code", shift);
        if (withFilters) {
            append(q, "designation", designation);
            append(q, "sector_id", sectorId);
            append(q, "section", section);
            append(q, "duty_category", dutyCategory);
            append(q, "status", status);
        }
        return q.toString();
    }

    private static void append(StringBuilder q, String key, String value) {
        if (value == null || value.isEmpty()) return;
        try {
            q.append(key).append('=').append(URLEncoder.encode(value, "UTF-8")).append('&');
        } catch (java.io.UnsupportedEncodingException ignored) {
            // UTF-8 is always available.
        }
    }

    private void render() {
        a.stopRefreshing();
        a.content.removeAllViews();
        addPolicyBanner();
        String sub = "Loading…";
        if (summary != null) {
            JSONObject cur = summary.optJSONObject("current_shift");
            sub = str(summary, "date") + " · " + ("all".equals(str(summary, "shift")) ? "All shifts" : "Shift " + str(summary, "shift"))
                    + (cur != null ? " · Running now: Shift " + str(cur, "code") + " (" + str(cur, "time") + ")" : "");
        }
        heading("OPERATIONS", "Operational Dashboard", sub);
        if (summary != null && summary.optBoolean("sector_scoped")) {
            LinearLayout b = hrow();
            b.addView(badge("SECTOR " + (a.profile.isNull("sector_id") ? "" : a.profile.optString("sector_id")) + " VIEW", BLUE, TINT));
            addTight(b);
        }
        addFilterBar();
        addCards();
        if (views != null) addShiftViews();
        addAlerts();
        addStaffList();
    }

    private void addPolicyBanner() {
        String state = policy == null ? "unconfirmed" : str(policy, "policy_status", "unconfirmed");
        LinearLayout box;
        if ("confirmed".equals(state)) {
            box = card(GREEN);
            box.addView(text("Rotation & Rest Policy: CONFIRMED BY SHO", 11, GREEN, true));
            box.addView(muted(str(policy, "rotation_sequence") + " · " + str(policy, "min_rest_hours_after_shift")
                    + "h rest after each shift · " + str(policy, "duty_off_after_shift_b_hours") + "h duty-off after Shift B"));
        } else if ("demo_simulated".equals(state)) {
            box = card(AMBER);
            box.addView(text("Rotation & Rest Policy: DEMO SIMULATION MODE", 11, AMBER, true));
            box.addView(muted("Simulated rotation/rest rules are active for evaluation. Not signed off by the SHO."));
        } else {
            box = card(RED);
            box.addView(text("Rotation & Rest Policy: UNCONFIRMED", 11, RED, true));
            box.addView(muted("Roster drafting is blocked until the SHO confirms the rotation/rest policy (or enables demo simulation). Rest status is not calculated until a rule is active."));
        }
        add(box);
    }

    private void addFilterBar() {
        LinearLayout card = card(0);
        LinearLayout top = hrow();
        top.addView(text("Date, shift & filters", 12, INK, true),
                new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        top.addView(secondary(filtersOpen ? "Hide" : "Show", () -> {
            filtersOpen = !filtersOpen;
            render();
        }));
        card.addView(top);
        if (filtersOpen) {
            EditText dateField = a.dateField(date.isEmpty() ? a.today() : date, null);
            labeled(card, "Date", dateField);
            String[] shiftNames = {"All shifts", "Shift A", "Shift B", "Shift C"};
            String[] shiftCodes = {"", "A", "B", "C"};
            Spinner shiftSpinner = spinner(shiftNames, indexOf(shiftCodes, shift));
            labeled(card, "Shift", shiftSpinner);

            List<String> desigLabels = new ArrayList<>();
            List<String> desigCodes = new ArrayList<>();
            desigLabels.add("All designations");
            desigCodes.add("");
            JSONArray designations = lists.optJSONArray("designation");
            if (designations != null) {
                for (int i = 0; i < designations.length(); i++) {
                    JSONObject d = designations.optJSONObject(i);
                    if (d == null) continue;
                    desigLabels.add(str(d, "label"));
                    desigCodes.add(str(d, "code"));
                }
            }
            Spinner desigSpinner = spinner(desigLabels, desigCodes.indexOf(designation));
            labeled(card, "Designation", desigSpinner);

            Spinner sectorSpinner = null;
            List<String> sectorIds = new ArrayList<>();
            if (!"SECTOR_SI".equals(role)) {
                List<String> names = new ArrayList<>();
                names.add("All sectors");
                sectorIds.add("");
                for (int i = 0; i < sectors.length(); i++) {
                    JSONObject s = sectors.optJSONObject(i);
                    if (s == null) continue;
                    names.add(str(s, "name"));
                    sectorIds.add(str(s, "id"));
                }
                sectorSpinner = spinner(names, sectorIds.indexOf(sectorId));
                labeled(card, "Sector", sectorSpinner);
            }

            List<String> sectionNames = new ArrayList<>();
            sectionNames.add("All sections");
            for (int i = 0; i < sections.length(); i++) {
                JSONObject s = sections.optJSONObject(i);
                if (s != null && s.optBoolean("is_active", true)) sectionNames.add(str(s, "name"));
            }
            Spinner sectionSpinner = spinner(sectionNames, sectionNames.indexOf(section));
            labeled(card, "Section", sectionSpinner);

            List<String> statusLabels = new ArrayList<>();
            List<String> statusCodes = new ArrayList<>();
            statusLabels.add("All statuses");
            statusCodes.add("");
            JSONArray statuses = lists.optJSONArray("staff_status");
            if (statuses != null) {
                for (int i = 0; i < statuses.length(); i++) {
                    JSONObject s = statuses.optJSONObject(i);
                    if (s == null || !s.optBoolean("is_active", true)) continue;
                    statusLabels.add(str(s, "label"));
                    statusCodes.add(str(s, "code"));
                }
            }
            Spinner statusSpinner = spinner(statusLabels, statusCodes.indexOf(status));
            labeled(card, "Current status", statusSpinner);

            final Spinner fSector = sectorSpinner;
            card.addView(buttonRow(
                    secondary("Clear", () -> {
                        date = shift = designation = sectorId = section = dutyCategory = status = "";
                        selectedCard = null;
                        show();
                    }),
                    primary("Apply", () -> {
                        date = dateField.getText().toString().trim();
                        shift = shiftCodes[shiftSpinner.getSelectedItemPosition()];
                        designation = desigCodes.get(desigSpinner.getSelectedItemPosition());
                        if (fSector != null) sectorId = sectorIds.get(fSector.getSelectedItemPosition());
                        int sp = sectionSpinner.getSelectedItemPosition();
                        section = sp <= 0 ? "" : sectionNames.get(sp);
                        status = statusCodes.get(statusSpinner.getSelectedItemPosition());
                        selectedCard = null;
                        show();
                    })));
        } else if (!date.isEmpty() || !shift.isEmpty() || !designation.isEmpty() || !sectorId.isEmpty()
                || !section.isEmpty() || !status.isEmpty()) {
            card.addView(muted("Filters applied. Tap Show to change them."));
        }
        add(card);
    }

    private static int indexOf(String[] values, String value) {
        for (int i = 0; i < values.length; i++) if (values[i].equals(value)) return i;
        return 0;
    }

    private void addCards() {
        JSONObject cards = summary == null ? new JSONObject() : summary.optJSONObject("cards");
        if (cards == null) cards = new JSONObject();
        List<String[]> items = new ArrayList<>();
        Set<String> hidden = hiddenCards();
        for (String[] c : CARDS) if (!hidden.contains(c[0])) items.add(c);
        if (cards.optInt("emergency_deployment") > 0 || cards.optInt("shift_change_pending") > 0) {
            items.add(new String[]{"emergency_deployment", "Emergency Deployment"});
            items.add(new String[]{"shift_change_pending", "Shift Change Pending"});
        }
        section("STATUS CARDS · tap to filter the list");
        for (int i = 0; i < items.size(); i += 2) {
            LinearLayout row = new LinearLayout(a);
            for (int j = 0; j < 2; j++) {
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
                if (j == 0) lp.setMarginEnd(a.dp(10));
                if (i + j < items.size()) row.addView(cardTile(items.get(i + j), cards), lp);
                else row.addView(new android.view.View(a), lp);
            }
            LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            rp.bottomMargin = a.dp(10);
            a.content.addView(row, rp);
        }
    }

    /** Card keys an administrator switched off (Configuration → Dashboard cards); none when the list is missing. */
    private Set<String> hiddenCards() {
        Set<String> hidden = new HashSet<>();
        JSONArray list = lists.optJSONArray("dashboard_card");
        if (list == null) return hidden;
        for (int i = 0; i < list.length(); i++) {
            JSONObject c = list.optJSONObject(i);
            if (c != null && !c.optBoolean("is_active", true)) hidden.add(str(c, "code"));
        }
        return hidden;
    }

    private LinearLayout cardTile(String[] def, JSONObject cards) {
        final String key = def[0];
        boolean selected = key.equals(selectedCard);
        LinearLayout tile = new LinearLayout(a);
        tile.setOrientation(LinearLayout.VERTICAL);
        tile.setPadding(a.dp(14), a.dp(10), a.dp(14), a.dp(10));
        tile.setBackground(a.roundRect(selected ? TINT : SURFACE, selected ? BLUE : LINE, 14));
        int accent = "absent".equals(key) || "vacant_positions".equals(key) ? RED
                : "on_leave".equals(key) || "duty_off_rest".equals(key) ? AMBER
                : "present".equals(key) || "available".equals(key) ? GREEN : INK;
        tile.addView(text(cards.has(key) ? String.valueOf(cards.optInt(key)) : "—", 22, accent, true));
        tile.addView(text(def[1], 10, MUTED, false));
        tile.setClickable(true);
        tile.setOnClickListener(v -> {
            if ("vacant_positions".equals(key)) {
                viewTab = 3;
            } else {
                selectedCard = key.equals(selectedCard) ? null : key;
                shown = 40;
            }
            render();
        });
        return tile;
    }

    private void addShiftViews() {
        JSONObject current = views.optJSONObject("current");
        JSONObject upcoming = views.optJSONObject("upcoming");
        JSONArray rest = arr(views, "rest");
        JSONObject vacancy = views.optJSONObject("vacancy");
        if (current == null || upcoming == null || vacancy == null) return;
        section("SHIFT VIEWS");
        tabs(new String[]{"Current " + str(current, "shift_code"), "Upcoming " + str(upcoming, "shift_code"),
                "Rest (" + rest.length() + ")", "Vacancy (" + vacancy.optInt("total_vacant") + ")"}, viewTab, i -> {
            viewTab = i;
            render();
        });
        LinearLayout card = card(BLUE);
        if (viewTab == 0 || viewTab == 1) {
            JSONObject v = viewTab == 0 ? current : upcoming;
            JSONArray deployment = arr(v, "deployment");
            card.addView(muted(str(v, "date") + " · Shift " + str(v, "shift_code") + " (" + str(v, "time") + ") · "
                    + (v.isNull("roster_id") ? "No published roster yet"
                    : "Published roster v" + str(v, "roster_version") + " · " + deployment.length() + " deployed")));
            if (viewTab == 1) {
                JSONArray vac = arr(v, "vacancies");
                if (vac.length() > 0) {
                    StringBuilder names = new StringBuilder();
                    for (int i = 0; i < vac.length(); i++) {
                        JSONObject x = vac.optJSONObject(i);
                        if (x == null) continue;
                        if (names.length() > 0) names.append(", ");
                        names.append(str(x, "category")).append(" (").append(x.optInt("vacant")).append(")");
                    }
                    card.addView(text(vac.length() + " duty position(s) still vacant for the next shift: " + names,
                            12, AMBER, true));
                }
            }
            for (int i = 0; i < deployment.length() && i < 60; i++) {
                JSONObject d = deployment.optJSONObject(i);
                if (d == null) continue;
                a.addDivider(card);
                card.addView(text(str(d, "duty") + (str(d, "section").isEmpty() ? "" : " · " + str(d, "section")), 13, INK, true));
                card.addView(muted(person(str(d, "name"), str(d, "service_number")) + " · " + str(d, "designation")
                        + (d.isNull("sector_id") ? "" : " · Sector " + str(d, "sector_id"))));
                if (!str(d, "notes").isEmpty()) card.addView(muted(str(d, "notes")));
            }
        } else if (viewTab == 2) {
            if (rest.length() == 0) {
                card.addView(muted("No one is in a rest window"
                        + (policy == null || "unconfirmed".equals(str(policy, "policy_status"))
                        ? " (rest is only calculated once a rotation rule is active)." : ".")));
            }
            for (int i = 0; i < rest.length(); i++) {
                JSONObject r = rest.optJSONObject(i);
                if (r == null) continue;
                if (i > 0) a.addDivider(card);
                card.addView(text(person(str(r, "name"), str(r, "service_number")), 13, INK, true));
                card.addView(muted(str(r, "reason") + " · until " + dateTime(str(r, "rest_until"))));
            }
        } else {
            card.addView(muted("Required " + vacancy.optInt("total_required") + " · Allocated " + vacancy.optInt("total_allocated")
                    + " · Vacant " + vacancy.optInt("total_vacant") + " (latest published roster)"));
            JSONArray rows = arr(vacancy, "rows");
            for (int i = 0; i < rows.length(); i++) {
                JSONObject r = rows.optJSONObject(i);
                if (r == null) continue;
                a.addDivider(card);
                LinearLayout line = titleRow(text("Shift " + str(r, "shift_code") + " · " + str(r, "category"), 13, INK, true),
                        r.optInt("vacant") > 0 ? badge(r.optInt("vacant") + " VACANT", RED, RED_BG) : badge("FILLED", GREEN, GREEN_BG));
                card.addView(line);
                card.addView(muted((str(r, "section").isEmpty() ? "" : str(r, "section") + " · ")
                        + "Required " + r.optInt("required") + " · Allocated " + r.optInt("allocated")));
            }
        }
        add(card);
    }

    private void addAlerts() {
        if (alerts.length() == 0) return;
        section("ACTIVE ALERTS (" + alerts.length() + ")");
        for (int i = 0; i < alerts.length() && i < 5; i++) {
            JSONObject al = alerts.optJSONObject(i);
            if (al == null) continue;
            boolean critical = "critical".equals(str(al, "severity"));
            LinearLayout card = card(critical ? RED : AMBER);
            card.addView(text(str(al, "alert_type").replace('_', ' ').toUpperCase(Locale.ROOT), 11, critical ? RED : AMBER, true));
            card.addView(text(str(al, "message"), 13, INK, false));
            if (RoleAccess.canResolveAlert(role)) {
                final int id = al.optInt("id");
                card.addView(buttonRow(secondary("Resolve", () -> act("/dashboard/alerts/" + id + "/resolve", "POST", null, "Alert resolved."))));
            }
            addTight(card);
        }
        if (alerts.length() > 5) {
            TextView more = text("Open Approvals & Alerts  ›", 12, BLUE, true);
            more.setOnClickListener(v -> a.openModule(RoleAccess.APPROVALS));
            a.content.addView(more);
        }
    }

    private void addStaffList() {
        JSONArray rows = summary == null ? new JSONArray() : arr(summary, "staff_status_list");
        Set<Integer> allowed = null;
        if (selectedCard != null && !"vacant_positions".equals(selectedCard) && summary != null) {
            JSONObject members = summary.optJSONObject("card_members");
            JSONArray ids = members == null ? null : members.optJSONArray(selectedCard);
            if (ids != null) {
                allowed = new HashSet<>();
                for (int i = 0; i < ids.length(); i++) allowed.add(ids.optInt(i));
            }
        }
        String q = search.toLowerCase(Locale.ROOT);
        List<JSONObject> filtered = new ArrayList<>();
        for (int i = 0; i < rows.length(); i++) {
            JSONObject s = rows.optJSONObject(i);
            if (s == null) continue;
            if (allowed != null && !allowed.contains(s.optInt("staff_id"))) continue;
            if (!q.isEmpty() && !str(s, "name").toLowerCase(Locale.ROOT).contains(q)
                    && !str(s, "service_number").toLowerCase(Locale.ROOT).contains(q)) continue;
            filtered.add(s);
        }
        section("STAFF STATUS (" + filtered.size() + ")");
        if (selectedCard != null) {
            String label = selectedCard.replace('_', ' ');
            for (String[] c : CARDS) if (c[0].equals(selectedCard)) label = c[1];
            LinearLayout chip = hrow();
            chip.addView(badge(label.toUpperCase(Locale.ROOT), BLUE, TINT));
            chip.addView(secondary("Clear card filter", () -> {
                selectedCard = null;
                render();
            }));
            addTight(chip);
        }
        EditText searchBox = searchField("Search staff name or service number", value -> {
            search = value;
            shown = 40;
            render();
        });
        searchBox.setText(search);
        addTight(searchBox);
        if (filtered.isEmpty()) {
            empty(search.isEmpty() ? "No staff in this view. Change the card or filters." : "No staff match your search.");
            return;
        }
        for (int i = 0; i < filtered.size() && i < shown; i++) {
            JSONObject s = filtered.get(i);
            int[] colors = statusColors(str(s, "status"));
            LinearLayout card = card(colors[0]);
            card.addView(titleRow(text(str(s, "name"), 14, INK, true), badge(str(s, "status").toUpperCase(Locale.ROOT), colors[0], colors[1])));
            card.addView(muted(str(s, "service_number") + " · " + str(s, "designation")
                    + (s.isNull("sector_id") ? "" : " · Sector " + str(s, "sector_id"))));
            if (!str(s, "duty_category").isEmpty()) {
                card.addView(muted("Duty: " + str(s, "duty_category")
                        + (str(s, "assigned_shift").isEmpty() ? "" : " (" + str(s, "assigned_shift") + ")")));
            }
            if (!str(s, "reason").isEmpty()) card.addView(muted(str(s, "reason")));
            if (s.optBoolean("is_conflicting")) {
                card.addView(text("⚠ Conflict" + (str(s, "conflict_detail").isEmpty() ? "" : ": " + str(s, "conflict_detail")), 11, RED, true));
            }
            addTight(card);
        }
        if (filtered.size() > shown) {
            a.content.addView(secondary("Show more (" + (filtered.size() - shown) + " left)", () -> {
                shown += 40;
                render();
            }));
        }
    }

    /** {foreground, background} by current-status text, matching the web badge colours. */
    static int[] statusColors(String status) {
        switch (status == null ? "" : status) {
            case "Present - Available": return new int[]{MainActivity.GREEN, MainActivity.GREEN_BG};
            case "On Duty":
            case "Patrol / Beat Duty":
            case "Attached to Other Wing": return new int[]{MainActivity.BLUE, MainActivity.TINT};
            case "Field Duty":
            case "Court Duty": return new int[]{Color.rgb(109, 40, 217), Color.rgb(237, 233, 254)};
            case "Official Movement": return new int[]{Color.rgb(194, 90, 10), MainActivity.AMBER_BG};
            case "On Leave":
            case "Shift Change Pending": return new int[]{MainActivity.AMBER, MainActivity.AMBER_BG};
            case "Absent":
            case "Emergency Deployment": return new int[]{MainActivity.RED, MainActivity.RED_BG};
            default: return new int[]{MainActivity.MUTED, MainActivity.BACKGROUND};
        }
    }
}
