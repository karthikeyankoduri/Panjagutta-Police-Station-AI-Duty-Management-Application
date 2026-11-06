package com.panjagutta.dutymanagement;

import android.app.AlertDialog;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Spinner;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Iterator;
import java.util.List;

/** Station configuration: duty requirements, sectors, sections and status lists (web: /config). */
final class ConfigScreen extends ModuleScreen {
    private static final String[] DESIGNATIONS = {"INSPECTOR", "SI", "WSI", "ASI", "AWSI", "HC", "WHC", "PC", "WPC",
            "ARPC", "ARWPC", "HGS", "WHGS", "SPO"};
    private static final String[] SHIFTS = {"A", "B", "C"};
    private static final String[][] LIST_TITLES = {
            {"staff_status", "Staff statuses"}, {"leave_status", "Leave states"}, {"task_status", "Task states"},
            {"leave_type", "Leave types"}, {"designation", "Designations"}, {"staff_category", "Staff categories"}};

    private int tab; // 0 duties, 1 sectors, 2 sections, 3 lists
    private JSONArray duties = new JSONArray();
    private JSONArray sectors = new JSONArray();
    private JSONArray sections = new JSONArray();
    private JSONObject lists = new JSONObject();

    ConfigScreen(MainActivity a) {
        super(a);
    }

    @Override
    void show() {
        load(() -> {
            Object[] r = new Object[4];
            r[0] = a.requestArray("/duties/?active_only=false");
            r[1] = a.requestArray("/config/sectors");
            r[2] = a.requestArray("/config/sections");
            r[3] = a.request("/config/lists", "GET", null, false);
            return r;
        }, r -> {
            duties = (JSONArray) r[0];
            sectors = (JSONArray) r[1];
            sections = (JSONArray) r[2];
            lists = (JSONObject) r[3];
            render();
        });
    }

    private boolean canWrite() {
        return RoleAccess.canWriteConfig(role);
    }

    private void render() {
        a.content.removeAllViews();
        a.stopRefreshing();
        heading("CONFIGURATION", "Station Configuration",
                "Every value here is stored in the database and editable by the SHO / Admin SI; every change is audited. Shift timings are in Policy & Shifts.");
        tabs(new String[]{"Duty requirements", "Sectors", "Sections", "Status & state lists", "Dashboard cards"}, tab, i -> {
            tab = i;
            render();
        });
        if (tab == 0) renderDuties();
        else if (tab == 1) renderSectors();
        else if (tab == 2) renderSections();
        else if (tab == 3) renderLists();
        else renderCards();
    }

    // ── Dashboard cards ──────────────────────────────────────────────────────────

    private void renderCards() {
        final JSONArray cards = lists.optJSONArray("dashboard_card") == null ? new JSONArray() : lists.optJSONArray("dashboard_card");
        final List<CheckBox> boxes = new ArrayList<>();
        final List<String> codes = new ArrayList<>();
        LinearLayout info = card(BLUE);
        info.addView(muted("Switch a card off to hide it from the dashboard for everyone (web and Android). "
                + "This only changes what the dashboard displays; it does not change any records or who can access the data."));
        add(info);
        section("DASHBOARD KPI CARDS (" + cards.length() + ")");
        if (cards.length() == 0) empty("No dashboard cards are configured yet. Restart the server to create them.");
        LinearLayout list = card(0);
        for (int i = 0; i < cards.length(); i++) {
            JSONObject c = cards.optJSONObject(i);
            if (c == null) continue;
            CheckBox box = new CheckBox(a);
            box.setText(str(c, "label"));
            box.setTextSize(15);
            box.setChecked(c.optBoolean("is_active", true));
            box.setEnabled(canWrite());
            boxes.add(box);
            codes.add(str(c, "code"));
            list.addView(box);
        }
        if (cards.length() > 0) add(list);
        if (canWrite() && cards.length() > 0) {
            a.content.addView(fullWidth(primary("Save changes", () -> {
                JSONObject chosen = new JSONObject();
                try {
                    for (int i = 0; i < boxes.size(); i++) chosen.put(codes.get(i), boxes.get(i).isChecked());
                } catch (JSONException e) {
                    return;
                }
                act("/config/dashboard-cards", "PUT", body("cards", chosen), "Dashboard cards updated.");
            })));
            a.content.addView(fullWidth(secondary("Show all cards", () -> {
                for (CheckBox b : boxes) b.setChecked(true);
            })));
        }
    }

    // ── Duties ───────────────────────────────────────────────────────────────────

    private void renderDuties() {
        if (canWrite()) a.content.addView(fullWidth(primary("+ Add duty", () -> dutyDialog(null))));
        section("DUTY MASTER — REQUIRED STRENGTH PER SHIFT (" + duties.length() + ")");
        for (int i = 0; i < duties.length(); i++) {
            JSONObject d = duties.optJSONObject(i);
            if (d == null) continue;
            LinearLayout card = card(d.optBoolean("is_active") ? BLUE : MUTED);
            card.addView(titleRow(text(str(d, "category"), 14, INK, true),
                    d.optBoolean("is_active") ? badge("ACTIVE", GREEN, GREEN_BG) : badge("INACTIVE", MUTED, BACKGROUND)));
            card.addView(muted((str(d, "section").isEmpty() ? "No section" : str(d, "section")) + " · "
                    + (str(d, "shift_code").isEmpty() ? "All shifts" : "Shift " + str(d, "shift_code"))
                    + " · Required " + (d.isNull("required_strength") ? "not set" : str(d, "required_strength"))));
            JSONArray ranks = arr(d, "eligible_designations");
            card.addView(muted("Eligible ranks: " + (ranks.length() == 0 ? "All ranks" : join(ranks))));
            if (!d.optBoolean("is_configured", true)) card.addView(text("Not configured", 11, AMBER, true));
            if (canWrite()) card.addView(buttonRow(secondary("Edit", () -> dutyDialog(d))));
            addTight(card);
        }
    }

    private static String join(JSONArray a) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < a.length(); i++) {
            if (i > 0) sb.append(", ");
            sb.append(a.optString(i));
        }
        return sb.toString();
    }

    private void dutyDialog(JSONObject d) {
        final boolean editing = d != null;
        LinearLayout form = formBody();
        EditText category = textField("Duty category");
        category.setText(editing ? str(d, "category") : "");
        labeled(form, "Category", category);
        List<String> sectionNames = new ArrayList<>();
        sectionNames.add("—");
        for (int i = 0; i < sections.length(); i++) {
            JSONObject s = sections.optJSONObject(i);
            if (s != null) sectionNames.add(str(s, "name"));
        }
        Spinner sectionSpinner = spinner(sectionNames, editing ? Math.max(0, sectionNames.indexOf(str(d, "section"))) : 0);
        labeled(form, "Section", sectionSpinner);
        Spinner shiftSpinner = spinner(new String[]{"All shifts", "Shift A", "Shift B", "Shift C"},
                editing && !str(d, "shift_code").isEmpty() ? Arrays.asList(SHIFTS).indexOf(str(d, "shift_code")) + 1 : 0);
        labeled(form, "Shift", shiftSpinner);
        EditText required = numberField("Required strength");
        required.setText(editing && !d.isNull("required_strength") ? str(d, "required_strength") : "");
        labeled(form, "Required strength", required);
        List<CheckBox> rankBoxes = new ArrayList<>();
        List<String> current = new ArrayList<>();
        if (editing) {
            JSONArray ranks = arr(d, "eligible_designations");
            for (int i = 0; i < ranks.length(); i++) current.add(ranks.optString(i));
        }
        if (editing) {
            a.addFieldLabel(form, "Eligible ranks (none ticked = all ranks)");
            for (String r : DESIGNATIONS) {
                CheckBox box = new CheckBox(a);
                box.setText(r);
                box.setChecked(current.contains(r));
                rankBoxes.add(box);
                form.addView(box);
            }
        }
        CheckBox active = new CheckBox(a);
        active.setText("Active");
        active.setChecked(!editing || d.optBoolean("is_active", true));
        if (editing) form.addView(active);
        form(editing ? "Edit duty" : "Add duty", form, "Save", () -> {
            String cat = category.getText().toString().trim();
            if (cat.isEmpty()) {
                category.setError("Required");
                return false;
            }
            int sp = sectionSpinner.getSelectedItemPosition();
            int sh = shiftSpinner.getSelectedItemPosition();
            String req = required.getText().toString().trim();
            JSONObject payload = new JSONObject();
            try {
                payload.put("category", cat);
                payload.put("section", sp == 0 ? JSONObject.NULL : sectionNames.get(sp));
                if (editing) {
                    if (sh == 0) payload.put("clear_shift", true);
                    else payload.put("shift_code", SHIFTS[sh - 1]);
                    payload.put("required_strength", req.isEmpty() ? 0 : Integer.parseInt(req));
                    JSONArray ranks = new JSONArray();
                    for (CheckBox b : rankBoxes) if (b.isChecked()) ranks.put(b.getText().toString());
                    payload.put("eligible_designations", ranks);
                    payload.put("is_active", active.isChecked());
                } else {
                    payload.put("shift_code", sh == 0 ? JSONObject.NULL : SHIFTS[sh - 1]);
                    payload.put("required_strength", req.isEmpty() ? JSONObject.NULL : Integer.parseInt(req));
                }
            } catch (JSONException e) {
                return false;
            }
            if (editing) act("/duties/" + d.optInt("id"), "PATCH", payload, "Duty updated.");
            else act("/duties/", "POST", payload, "Duty added.");
            return true;
        });
    }

    // ── Sectors / sections ───────────────────────────────────────────────────────

    private void renderSectors() {
        if (canWrite()) a.content.addView(fullWidth(primary("+ Add sector", () -> nameDialog(true, null))));
        section("SECTORS (" + sectors.length() + ")");
        for (int i = 0; i < sectors.length(); i++) {
            JSONObject s = sectors.optJSONObject(i);
            if (s == null) continue;
            LinearLayout card = card(s.optBoolean("is_active") ? BLUE : MUTED);
            card.addView(titleRow(text(str(s, "name") + " (" + str(s, "code") + ")", 14, INK, true),
                    s.optBoolean("is_active") ? badge("ACTIVE", GREEN, GREEN_BG) : badge("INACTIVE", MUTED, BACKGROUND)));
            card.addView(muted(str(s, "description", "No description") + " · Staff " + s.optInt("staff_count")));
            if (canWrite()) card.addView(buttonRow(secondary("Edit", () -> nameDialog(true, s))));
            addTight(card);
        }
    }

    private void renderSections() {
        if (canWrite()) a.content.addView(fullWidth(primary("+ Add section", () -> nameDialog(false, null))));
        section("SECTIONS (" + sections.length() + ")");
        for (int i = 0; i < sections.length(); i++) {
            JSONObject s = sections.optJSONObject(i);
            if (s == null) continue;
            LinearLayout card = card(s.optBoolean("is_active") ? BLUE : MUTED);
            card.addView(titleRow(text(str(s, "name"), 14, INK, true),
                    s.optBoolean("is_active") ? badge("ACTIVE", GREEN, GREEN_BG) : badge("INACTIVE", MUTED, BACKGROUND)));
            card.addView(muted(str(s, "description", "No description")));
            if (canWrite()) card.addView(buttonRow(secondary("Edit", () -> nameDialog(false, s))));
            addTight(card);
        }
    }

    private void nameDialog(boolean isSector, JSONObject item) {
        final boolean editing = item != null;
        LinearLayout form = formBody();
        EditText name = textField("Name");
        name.setText(editing ? str(item, "name") : "");
        labeled(form, "Name", name);
        EditText code = null;
        if (isSector) {
            code = textField("Code");
            code.setText(editing ? str(item, "code") : "");
            labeled(form, "Code", code);
        }
        EditText description = textField("Description");
        description.setText(editing ? str(item, "description") : "");
        labeled(form, "Description", description);
        CheckBox active = new CheckBox(a);
        active.setText("Active");
        active.setChecked(!editing || item.optBoolean("is_active", true));
        if (editing) form.addView(active);
        final EditText fCode = code;
        form((editing ? "Edit " : "Add ") + (isSector ? "sector" : "section"), form, "Save", () -> {
            if (name.getText().toString().trim().isEmpty() || (fCode != null && fCode.getText().toString().trim().isEmpty())) {
                a.toast("Fill in the required fields.");
                return false;
            }
            JSONObject payload = body("name", name.getText().toString().trim(),
                    "description", description.getText().toString().trim(),
                    "code", fCode == null ? null : fCode.getText().toString().trim(),
                    "is_active", editing ? active.isChecked() : null);
            String base = isSector ? "/config/sectors" : "/config/sections";
            act(editing ? base + "/" + item.optInt("id") : base, editing ? "PATCH" : "POST", payload,
                    (isSector ? "Sector " : "Section ") + (editing ? "updated." : "added."));
            return true;
        });
    }

    // ── Lists ────────────────────────────────────────────────────────────────────

    private void renderLists() {
        LinearLayout info = card(BLUE);
        info.addView(muted("Status codes drive the availability engine and cannot be renamed, but their labels, descriptions, order and visibility can be edited. New leave types can be added."));
        add(info);
        Iterator<String> names = lists.keys();
        List<String> order = new ArrayList<>();
        while (names.hasNext()) order.add(names.next());
        for (String name : order) {
            if ("dashboard_card".equals(name)) continue; // has its own tab
            JSONArray items = lists.optJSONArray(name);
            if (items == null) continue;
            String title = name;
            for (String[] t : LIST_TITLES) if (t[0].equals(name)) title = t[1];
            section(title.toUpperCase() + " (" + items.length() + ")");
            if ("leave_type".equals(name) && canWrite()) {
                final int count = items.length();
                a.content.addView(fullWidth(secondary("+ Add leave type", () -> addLeaveType(count))));
            }
            for (int i = 0; i < items.length(); i++) {
                JSONObject it = items.optJSONObject(i);
                if (it == null) continue;
                LinearLayout card = card(it.optBoolean("is_active") ? 0 : MUTED);
                card.addView(titleRow(text(str(it, "label"), 13, INK, true), muted(str(it, "code"))));
                if (!str(it, "description").isEmpty()) card.addView(muted(str(it, "description")));
                card.addView(muted("Order " + it.optInt("sort_order") + " · " + (it.optBoolean("is_active") ? "Shown" : "Hidden")));
                if (canWrite()) card.addView(buttonRow(secondary("Edit", () -> itemDialog(it))));
                addTight(card);
            }
        }
    }

    private void itemDialog(JSONObject it) {
        LinearLayout form = formBody();
        EditText label = textField("Label");
        label.setText(str(it, "label"));
        labeled(form, "Label (code " + str(it, "code") + " cannot change)", label);
        EditText description = textField("Description");
        description.setText(str(it, "description"));
        labeled(form, "Description", description);
        EditText order = numberField("Order");
        order.setText(str(it, "sort_order", "0"));
        labeled(form, "Order", order);
        CheckBox shown = new CheckBox(a);
        shown.setText("Shown");
        shown.setChecked(it.optBoolean("is_active", true));
        form.addView(shown);
        form("Edit list item", form, "Save", () -> {
            if (label.getText().toString().trim().isEmpty()) {
                label.setError("Required");
                return false;
            }
            int sort;
            try {
                sort = Integer.parseInt(order.getText().toString().trim());
            } catch (NumberFormatException e) {
                sort = it.optInt("sort_order");
            }
            act("/config/lists/items/" + it.optInt("id"), "PATCH", body("label", label.getText().toString().trim(),
                    "description", description.getText().toString().trim(), "sort_order", sort, "is_active", shown.isChecked()),
                    "List item updated.");
            return true;
        });
    }

    private void addLeaveType(int count) {
        LinearLayout form = formBody();
        EditText code = textField("e.g. HPL");
        labeled(form, "Code", code);
        EditText label = textField("Label");
        labeled(form, "Label", label);
        form("Add leave type", form, "Add", () -> {
            String c = code.getText().toString().trim().toUpperCase();
            if (c.isEmpty() || label.getText().toString().trim().isEmpty()) {
                a.toast("Enter the code and label.");
                return false;
            }
            act("/config/lists/leave_type", "POST", body("code", c, "label", label.getText().toString().trim(), "sort_order", count),
                    "Leave type added.");
            return true;
        });
    }
}
