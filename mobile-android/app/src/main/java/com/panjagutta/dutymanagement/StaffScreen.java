package com.panjagutta.dutymanagement;

import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.text.InputType;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Spinner;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/** Station staff register: search, add, edit (incl. login role/reset password), CSV/Excel import (web: /staff). */
final class StaffScreen extends ModuleScreen {
    private static final int PICK_IMPORT = 4101;
    private static final String[] DESIGNATIONS = {"INSPECTOR", "SI", "WSI", "ASI", "AWSI", "HC", "WHC", "PC", "WPC",
            "ARPC", "ARWPC", "HGS", "WHGS", "SPO"};
    private static final String[] CATEGORIES = {"SECTOR_STAFF", "SECTION_DUTY", "DRIVER", "ATTACHED"};
    private static final String[][] USER_ROLES = {
            {"STAFF", "STAFF — General Staff / Constable"}, {"SECTOR_SI", "SECTOR_SI — Sector Sub-Inspector"},
            {"DSI", "DSI — Duty Sub-Inspector"}, {"DI", "DI — Detective Inspector"},
            {"ADMIN_SI", "ADMIN_SI — Admin Sub-Inspector / Station Admin"}, {"SHO", "SHO — Station House Officer"},
            {"SUPER_ADMIN", "SUPER_ADMIN — Super Administrator"}};

    private String search = "";
    private String designation = "";
    private String sectorId = "";
    private String section = "";
    private String attached = "";
    private boolean filtersOpen;
    private int shown = 40;
    private JSONArray staff = new JSONArray();
    private JSONArray sectors = new JSONArray();
    private JSONArray sections = new JSONArray();

    // Import preview (web: review and edit before import). Null headers = not previewing.
    private List<String> previewHeaders;
    private List<List<String>> previewRows = new ArrayList<>();
    private int previewShown = 30;
    private List<String> previewNotes = new ArrayList<>();

    StaffScreen(MainActivity a) {
        super(a);
    }

    @Override
    boolean back() {
        if (previewHeaders == null) return false;
        confirm("Discard this import? Nothing has been saved.", () -> {
            previewHeaders = null;
            previewRows = new ArrayList<>();
            previewNotes = new ArrayList<>();
            show();
        });
        return true;
    }

    @Override
    void show() {
        if (previewHeaders != null) {
            a.content.removeAllViews();
            a.stopRefreshing();
            renderPreview();
            return;
        }
        load(() -> {
            StringBuilder q = new StringBuilder("/staff/?");
            if (!search.isEmpty()) q.append("search=").append(URLEncoder.encode(search, "UTF-8")).append('&');
            if (!designation.isEmpty()) q.append("designation=").append(URLEncoder.encode(designation, "UTF-8")).append('&');
            if (!sectorId.isEmpty()) q.append("sector_id=").append(sectorId).append('&');
            if (!section.isEmpty()) q.append("section=").append(URLEncoder.encode(section, "UTF-8")).append('&');
            if (!attached.isEmpty()) q.append("attached=").append("yes".equals(attached)).append('&');
            JSONArray s = a.requestArray(q.toString());
            JSONArray sec;
            JSONArray sect;
            try {
                sec = a.requestArray("/config/sections");
                sect = a.requestArray("/config/sectors");
            } catch (Exception e) {
                sec = new JSONArray();
                sect = new JSONArray();
            }
            return new JSONArray[]{s, sec, sect};
        }, r -> {
            staff = r[0];
            sections = r[1];
            sectors = r[2];
            render();
        });
    }

    private void render() {
        a.content.removeAllViews();
        a.stopRefreshing();
        heading("STAFF", "Station Staff Register",
                "Manage station personnel, provision login credentials and import the staff register by CSV or Excel.");
        List<android.widget.Button> tools = new ArrayList<>();
        tools.add(primary("📂 Import CSV / Excel", this::pickImportFile));
        tools.add(secondary("+ Add staff", () -> staffDialog(null)));
        tools.add(secondary("🔑 Convert usernames", this::convertUsernames));
        tools.add(secondary("📥 Proforma CSV", () -> downloadAndOpen("/staff/download-template", "panjagutta_staff_template.csv")));
        tools.add(danger("🗑 Wipe demo data", () -> confirm(
                "Remove demo operational data and demo staff and prepare the station for the official roster? This cannot be undone.",
                () -> act("/staff/clear-demo-data", "POST", null, "Demo operational data and demo staff removed."))));
        LinearLayout toolbar = card(0);
        toolbar.addView(text("REGISTER TOOLS", 10, BLUE, true));
        addButtons(toolbar, tools);
        add(toolbar);

        int active = 0;
        int officers = 0;
        int constabulary = 0;
        List<String> officerRanks = Arrays.asList("INSPECTOR", "SI", "WSI", "ASI", "AWSI");
        List<String> constableRanks = Arrays.asList("HC", "WHC", "PC", "WPC", "ARPC", "ARWPC");
        for (int i = 0; i < staff.length(); i++) {
            JSONObject s = staff.optJSONObject(i);
            if (s == null) continue;
            if (s.optBoolean("is_active")) active++;
            if (officerRanks.contains(str(s, "designation"))) officers++;
            if (constableRanks.contains(str(s, "designation"))) constabulary++;
        }
        LinearLayout stats = card(0);
        stats.addView(text(staff.length() + " / 140 authorized", 16, INK, true));
        stats.addView(muted("Active " + active + " · Officers " + officers + " · Constabulary " + constabulary));
        add(stats);

        addFilters();

        section("PERSONNEL (" + staff.length() + ")");
        if (staff.length() == 0) {
            empty("No staff found. Import the authorized personnel file or add personnel individually.");
        }
        for (int i = 0; i < staff.length() && i < shown; i++) {
            JSONObject s = staff.optJSONObject(i);
            if (s == null) continue;
            LinearLayout card = card(s.optBoolean("is_active") ? 0 : MUTED);
            card.addView(titleRow(text(str(s, "name"), 14, INK, true),
                    s.optBoolean("is_active") ? badge("ACTIVE", GREEN, GREEN_BG) : badge("INACTIVE", MUTED, BACKGROUND)));
            card.addView(muted(str(s, "service_number") + " · " + str(s, "designation") + " · " + str(s, "category")));
            card.addView(muted((s.isNull("sector_id") ? "Station" : "Sector " + str(s, "sector_id"))
                    + (str(s, "section").isEmpty() ? "" : " · " + str(s, "section"))));
            if (!str(s, "contact_phone").isEmpty()) card.addView(muted("📞 " + str(s, "contact_phone")));
            if (!str(s, "user_username").isEmpty()) {
                card.addView(muted("Login: " + str(s, "user_username") + " (" + str(s, "user_role", "STAFF") + ")"));
            }
            if (!s.isNull("location_lat") && !s.isNull("location_lng")) {
                String place = str(s, "location_name").isEmpty() ? "View on map" : str(s, "location_name");
                card.addView(text("📍 " + place, 12, BLUE, true));
                card.addView(muted("Updated " + LocationsScreen.ago(str(s, "location_updated"))));
                final String mapsUrl = LocationsScreen.mapsUrl(s.optDouble("location_lat"), s.optDouble("location_lng"));
                card.addView(buttonRow(secondary("Open in Google Maps", () -> LocationsScreen.open(a, mapsUrl))));
            } else {
                card.addView(muted("📍 Location unavailable"));
            }
            if (!str(s, "attached_to").isEmpty()) card.addView(text("Attached to " + str(s, "attached_to"), 11, BLUE, true));
            card.addView(buttonRow(secondary("Edit profile & login", () -> staffDialog(s))));
            addTight(card);
        }
        if (staff.length() > shown) {
            a.content.addView(secondary("Show more (" + (staff.length() - shown) + " left)", () -> {
                shown += 40;
                render();
            }));
        }
    }

    private void addFilters() {
        LinearLayout card = card(0);
        EditText box = textField("Name, service number, username or section");
        box.setText(search);
        card.addView(titleRow(text("Search & filters", 12, INK, true),
                secondary(filtersOpen ? "Hide" : "More", () -> {
                    filtersOpen = !filtersOpen;
                    render();
                })));
        card.addView(box, a.fieldParams());
        Spinner desig = null;
        Spinner sector = null;
        Spinner sec = null;
        Spinner att = null;
        List<String> sectorIds = new ArrayList<>();
        List<String> sectionNames = new ArrayList<>();
        if (filtersOpen) {
            List<String> d = new ArrayList<>();
            d.add("All designations");
            d.addAll(Arrays.asList(DESIGNATIONS));
            desig = spinner(d, designation.isEmpty() ? 0 : d.indexOf(designation));
            labeled(card, "Designation", desig);
            List<String> sn = new ArrayList<>();
            sn.add("All sectors");
            sectorIds.add("");
            for (int i = 0; i < sectors.length(); i++) {
                JSONObject s = sectors.optJSONObject(i);
                if (s == null) continue;
                sn.add(str(s, "name"));
                sectorIds.add(str(s, "id"));
            }
            sector = spinner(sn, Math.max(0, sectorIds.indexOf(sectorId)));
            labeled(card, "Sector", sector);
            sectionNames.add("All sections");
            for (int i = 0; i < sections.length(); i++) {
                JSONObject s = sections.optJSONObject(i);
                if (s != null) sectionNames.add(str(s, "name"));
            }
            sec = spinner(sectionNames, Math.max(0, sectionNames.indexOf(section)));
            labeled(card, "Section", sec);
            att = spinner(new String[]{"Attached & station", "Attached to other wings", "Not attached"},
                    "yes".equals(attached) ? 1 : "no".equals(attached) ? 2 : 0);
            labeled(card, "Attachment", att);
        }
        final Spinner fDesig = desig;
        final Spinner fSector = sector;
        final Spinner fSec = sec;
        final Spinner fAtt = att;
        card.addView(buttonRow(
                secondary("Reset", () -> {
                    search = designation = sectorId = section = attached = "";
                    show();
                }),
                primary("Apply filters", () -> {
                    search = box.getText().toString().trim();
                    if (fDesig != null) {
                        int p = fDesig.getSelectedItemPosition();
                        designation = p == 0 ? "" : DESIGNATIONS[p - 1];
                        sectorId = sectorIds.get(fSector.getSelectedItemPosition());
                        int sp = fSec.getSelectedItemPosition();
                        section = sp == 0 ? "" : sectionNames.get(sp);
                        int ap = fAtt.getSelectedItemPosition();
                        attached = ap == 1 ? "yes" : ap == 2 ? "no" : "";
                    }
                    shown = 40;
                    show();
                })));
        add(card);
    }

    // ── Add / edit ───────────────────────────────────────────────────────────────

    private void staffDialog(JSONObject s) {
        final boolean editing = s != null;
        LinearLayout form = formBody();
        EditText service = textField("Service number");
        service.setText(editing ? str(s, "service_number") : "");
        if (editing) service.setEnabled(false);
        labeled(form, "Service number", service);
        EditText name = textField("Full name");
        name.setText(editing ? str(s, "name") : "");
        labeled(form, "Full name", name);
        Spinner desig = spinner(DESIGNATIONS, Math.max(0, Arrays.asList(DESIGNATIONS).indexOf(editing ? str(s, "designation") : "PC")));
        labeled(form, "Designation", desig);
        Spinner category = spinner(CATEGORIES, Math.max(0, Arrays.asList(CATEGORIES).indexOf(editing ? str(s, "category") : "SECTOR_STAFF")));
        labeled(form, "Category", category);
        List<String> sectorNames = new ArrayList<>();
        List<String> sectorIds = new ArrayList<>();
        sectorNames.add("— Station-wide —");
        sectorIds.add("");
        for (int i = 0; i < sectors.length(); i++) {
            JSONObject x = sectors.optJSONObject(i);
            if (x == null) continue;
            sectorNames.add(str(x, "name"));
            sectorIds.add(str(x, "id"));
        }
        Spinner sector = spinner(sectorNames, editing ? Math.max(0, sectorIds.indexOf(str(s, "sector_id"))) : 0);
        labeled(form, "Sector", sector);
        List<String> sectionNames = new ArrayList<>();
        sectionNames.add("— None —");
        for (int i = 0; i < sections.length(); i++) {
            JSONObject x = sections.optJSONObject(i);
            if (x != null) sectionNames.add(str(x, "name"));
        }
        Spinner sec = spinner(sectionNames, editing ? Math.max(0, sectionNames.indexOf(str(s, "section"))) : 0);
        labeled(form, "Section", sec);
        EditText phone = field("Contact phone", InputType.TYPE_CLASS_PHONE);
        phone.setText(editing ? str(s, "contact_phone") : "");
        labeled(form, "Contact phone", phone);

        EditText username = null;
        Spinner userRole = null;
        EditText reset = null;
        CheckBox active = new CheckBox(a);
        active.setText("Active");
        active.setChecked(!editing || s.optBoolean("is_active", true));
        if (editing) {
            form.addView(active);
            a.addFieldLabel(form, "LOGIN ACCOUNT");
            username = textField("Login username");
            username.setText(str(s, "user_username"));
            labeled(form, "Login username", username);
            form.addView(suggestButton(username, desig, phone, s.optInt("user_id")));
            String[] roleLabels = new String[USER_ROLES.length];
            int selected = 0;
            String current = str(s, "user_role", "STAFF").toUpperCase(Locale.ROOT);
            for (int i = 0; i < USER_ROLES.length; i++) {
                roleLabels[i] = USER_ROLES[i][1];
                if (USER_ROLES[i][0].equals(current)) selected = i;
            }
            userRole = spinner(roleLabels, selected);
            labeled(form, "System role", userRole);
            reset = field("Leave blank to keep the current password", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
            labeled(form, "Reset password (optional)", reset);
        }
        if (!editing) {
            a.addFieldLabel(form, "LOGIN ACCOUNT");
            username = textField("pg + designation + last 4 phone digits");
            labeled(form, "Login username (blank = suggested)", username);
            form.addView(suggestButton(username, desig, phone, 0));
            form.addView(muted("Default password PJ@2024, changed at first login."));
        }
        final EditText fUser = username;
        final Spinner fRole = userRole;
        final EditText fReset = reset;
        form(editing ? "Edit " + str(s, "name") : "Add individual staff", form, "Save", () -> {
            if (service.getText().toString().trim().isEmpty() || name.getText().toString().trim().isEmpty()) {
                a.toast("Service number and name are required.");
                return false;
            }
            String sid = sectorIds.get(sector.getSelectedItemPosition());
            int secPos = sec.getSelectedItemPosition();
            JSONObject payload = new JSONObject();
            try {
                payload.put("name", name.getText().toString().trim());
                payload.put("designation", DESIGNATIONS[desig.getSelectedItemPosition()]);
                payload.put("category", CATEGORIES[category.getSelectedItemPosition()]);
                payload.put("contact_phone", phone.getText().toString().trim().isEmpty() ? JSONObject.NULL : phone.getText().toString().trim());
                if (editing) {
                    payload.put("sector_id", sid.isEmpty() ? JSONObject.NULL : Integer.parseInt(sid));
                    payload.put("section", secPos == 0 ? JSONObject.NULL : sectionNames.get(secPos));
                    payload.put("is_active", active.isChecked());
                    if (!fUser.getText().toString().trim().isEmpty()) payload.put("user_username", fUser.getText().toString().trim());
                    payload.put("user_role", USER_ROLES[fRole.getSelectedItemPosition()][0]);
                    if (!fReset.getText().toString().isEmpty()) payload.put("reset_password", fReset.getText().toString());
                } else {
                    payload.put("service_number", service.getText().toString().trim());
                    payload.put("create_user", true);
                    if (!fUser.getText().toString().trim().isEmpty()) payload.put("username", fUser.getText().toString().trim());
                    if (!sid.isEmpty()) payload.put("sector_id", Integer.parseInt(sid));
                    if (secPos > 0) payload.put("section", sectionNames.get(secPos));
                }
            } catch (org.json.JSONException e) {
                return false;
            }
            if (editing) act("/staff/" + s.optInt("id"), "PATCH", payload, "Updated staff profile for " + name.getText().toString().trim() + ".");
            else act("/staff/", "POST", payload, "Staff member added successfully.");
            return true;
        });
    }

    // ── Import ───────────────────────────────────────────────────────────────────

    private void pickImportFile() {
        Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType("*/*")
                .putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"text/csv", "text/comma-separated-values", "text/plain",
                        "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        "application/octet-stream"});
        a.startForResult(pick, PICK_IMPORT);
    }

    @Override
    void onResult(int requestCode, Intent data) {
        if (requestCode != PICK_IMPORT || data.getData() == null) return;
        final Uri uri = data.getData();
        a.toast("Reading file…");
        a.executor.execute(() -> {
            try {
                String filename = "staff.csv";
                try (android.database.Cursor c = a.getContentResolver().query(uri, null, null, null, null)) {
                    if (c != null && c.moveToFirst()) {
                        int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                        if (idx >= 0 && c.getString(idx) != null) filename = c.getString(idx);
                    }
                }
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                try (InputStream in = a.getContentResolver().openInputStream(uri)) {
                    if (in == null) throw new java.io.IOException("Cannot read the selected file");
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) != -1) bytes.write(buf, 0, n);
                }
                String lower = filename.toLowerCase(Locale.ROOT);
                String mime = lower.endsWith(".xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        : lower.endsWith(".xls") ? "application/vnd.ms-excel" : "text/csv";
                final JSONObject res = a.uploadFile("/staff/import-preview", "file", filename, mime, bytes.toByteArray());
                a.mainHandler.post(() -> startPreview(res));
            } catch (Exception e) {
                final String message = e.getMessage() == null ? "Staff import failed." : e.getMessage();
                a.mainHandler.post(() -> a.toast(message));
            }
        });
    }

    // ── Review and edit before import ───────────────────────────────────────────

    private void startPreview(JSONObject res) {
        JSONArray headers = arr(res, "headers");
        JSONArray rows = arr(res, "rows");
        previewHeaders = new ArrayList<>();
        for (int i = 0; i < headers.length(); i++) previewHeaders.add(headers.optString(i));
        previewRows = new ArrayList<>();
        for (int i = 0; i < rows.length(); i++) {
            JSONArray r = rows.optJSONArray(i);
            List<String> row = new ArrayList<>();
            for (int c = 0; c < previewHeaders.size(); c++) row.add(r == null ? "" : r.optString(c, ""));
            previewRows.add(row);
        }
        previewShown = 30;
        previewNotes = new ArrayList<>();
        JSONArray notes = arr(res, "username_notes");
        for (int i = 0; i < notes.length(); i++) previewNotes.add(notes.optString(i));
        show();
    }

    /** Column holding the officer name; the importer skips a row that has none. */
    private int nameColumn() {
        for (int c = 0; c < previewHeaders.size(); c++) {
            String h = previewHeaders.get(c).toLowerCase(Locale.ROOT);
            if (h.contains("name") && !h.matches(".*(station|division|zone|range|father|mother|user|file|unit).*")) return c;
        }
        return -1;
    }

    private boolean missingName(List<String> row, int nameCol) {
        return nameCol >= 0 && row.get(nameCol).trim().isEmpty();
    }

    private void discardPreview() {
        previewHeaders = null;
        previewRows = new ArrayList<>();
        previewNotes = new ArrayList<>();
        show();
    }

    private void renderPreview() {
        final int nameCol = nameColumn();
        int missing = 0;
        for (List<String> r : previewRows) if (missingName(r, nameCol)) missing++;
        heading("STAFF IMPORT", "Review & edit before import",
                "Fix any cell, remove rows you do not want, or add a row. Nothing is saved until you press Import.");
        LinearLayout summary = card(missing > 0 ? RED : BLUE);
        summary.addView(text(previewRows.size() + " row(s) ready", 15, INK, true));
        if (missing > 0) {
            summary.addView(text("⚠ " + missing + " row(s) have no name (highlighted) and will be skipped unless you fill the name in.",
                    12, RED, false));
        }
        int clashes = 0;
        int noPhone = 0;
        for (String n : previewNotes) {
            if ("clash".equals(n)) clashes++;
            if ("no-phone".equals(n)) noPhone++;
        }
        summary.addView(muted("ℹ The Username column is pre-filled as pg + designation + last 4 phone digits (e.g. pgpc3210); edit it if needed."
                + (clashes > 0 ? " " + clashes + " had a clash and use more digits." : "")
                + (noPhone > 0 ? " " + noPhone + " have no phone number and keep their PG-ID based login." : "")));
        add(summary);
        a.content.addView(fullWidth(success("🚀 Import " + previewRows.size() + " rows", this::runImport)));
        LinearLayout tools = formBody();
        tools.addView(buttonRow(
                secondary("+ Add row", () -> editRow(-1)),
                danger("Discard", () -> confirm("Discard this import? Nothing has been saved.", this::discardPreview))));
        add(tools);

        for (int i = 0; i < previewRows.size() && i < previewShown; i++) {
            final int index = i;
            List<String> row = previewRows.get(i);
            boolean bad = missingName(row, nameCol);
            LinearLayout rowCard = card(bad ? RED : 0);
            String title = nameCol >= 0 && !row.get(nameCol).trim().isEmpty() ? row.get(nameCol) : "(no name)";
            rowCard.addView(titleRow(text((i + 1) + ". " + title, 14, bad ? RED : INK, true), bad ? badge("NO NAME", RED, RED_BG) : null));
            StringBuilder detail = new StringBuilder();
            for (int c = 0; c < row.size() && detail.length() < 110; c++) {
                if (c == nameCol || row.get(c).trim().isEmpty() || previewHeaders.get(c).trim().isEmpty()) continue;
                if (detail.length() > 0) detail.append(" · ");
                detail.append(previewHeaders.get(c)).append(": ").append(row.get(c));
            }
            if (detail.length() > 0) rowCard.addView(muted(detail.toString()));
            for (int c = 0; c < row.size(); c++) {
                String h = previewHeaders.get(c).toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
                if ((h.equals("username") || h.equals("user")) && !row.get(c).trim().isEmpty()) {
                    rowCard.addView(text("Login: " + row.get(c), 12, BLUE, true));
                    break;
                }
            }
            rowCard.addView(buttonRow(
                    secondary("Edit", () -> editRow(index)),
                    danger("Remove", () -> {
                        previewRows.remove(index);
                        show();
                    })));
            addTight(rowCard);
        }
        if (previewRows.size() > previewShown) {
            a.content.addView(fullWidth(secondary("Show more (" + (previewRows.size() - previewShown) + " left)", () -> {
                previewShown += 30;
                show();
            })));
        }
    }

    /** Edit one imported row (index >= 0) or add a blank one (-1). Every column of the file is editable. */
    private void editRow(final int index) {
        final LinearLayout form = formBody();
        final List<EditText> inputs = new ArrayList<>();
        for (int c = 0; c < previewHeaders.size(); c++) {
            EditText input = textField(previewHeaders.get(c));
            if (index >= 0) input.setText(previewRows.get(index).get(c));
            inputs.add(input);
            String label = previewHeaders.get(c).trim().isEmpty() ? "Column " + (c + 1) : previewHeaders.get(c);
            labeled(form, label, input);
        }
        form(index >= 0 ? "Edit row " + (index + 1) : "Add a row", form, "Save", () -> {
            List<String> row = new ArrayList<>();
            for (EditText e : inputs) row.add(e.getText().toString().trim());
            if (index >= 0) previewRows.set(index, row);
            else previewRows.add(row);
            show();
            return true;
        });
    }

    private static String csvCell(String v) {
        boolean quote = v.indexOf(',') >= 0 || v.indexOf('"') >= 0 || v.indexOf('\n') >= 0 || v.indexOf('\r') >= 0;
        return quote ? "\"" + v.replace("\"", "\"\"") + "\"" : v;
    }

    private String toCsv() {
        StringBuilder sb = new StringBuilder();
        for (int c = 0; c < previewHeaders.size(); c++) sb.append(c > 0 ? "," : "").append(csvCell(previewHeaders.get(c)));
        for (List<String> row : previewRows) {
            sb.append("\r\n");
            for (int c = 0; c < row.size(); c++) sb.append(c > 0 ? "," : "").append(csvCell(row.get(c)));
        }
        return sb.toString();
    }

    private void runImport() {
        if (previewRows.isEmpty()) {
            a.toast("There are no rows to import.");
            return;
        }
        final String csv = toCsv();
        a.toast("Importing…");
        a.executor.execute(() -> {
            try {
                final JSONObject res = a.request("/staff/import-csv", "POST", body("csv_content", csv), false);
                a.mainHandler.post(() -> {
                    previewHeaders = null;
                    previewRows = new ArrayList<>();
                    previewNotes = new ArrayList<>();
                    showImportResult(res);
                    show();
                });
            } catch (Exception e) {
                final String message = e.getMessage() == null ? "Staff import failed." : e.getMessage();
                a.mainHandler.post(() -> a.toast(message));
            }
        });
    }

    private void showImportResult(JSONObject res) {
        StringBuilder sb = new StringBuilder(str(res, "message", "Import finished.")).append("\n\n");
        sb.append("Processed: ").append(res.optInt("imported_count"))
                .append("  ·  New: ").append(res.optInt("imported_new"))
                .append("  ·  Updated: ").append(res.optInt("updated_staff"))
                .append("  ·  Register total: ").append(res.optInt("total_staff_count")).append('\n');
        JSONArray errors = arr(res, "errors");
        for (int i = 0; i < errors.length() && i < 15; i++) sb.append("\n⚠ ").append(errors.optString(i));
        JSONArray details = arr(res, "details");
        for (int i = 0; i < details.length() && i < 8; i++) sb.append("\n• ").append(details.optString(i));
        new AlertDialog.Builder(a).setTitle("Import result").setMessage(sb.toString())
                .setPositiveButton("OK", null).show();
    }

    // ── Login usernames: pg + designation + last 4 phone digits ─────────────────

    private android.widget.Button suggestButton(final EditText target, final Spinner desig, final EditText phone, final int userId) {
        return secondary("Use suggested username", () -> {
            final String d = DESIGNATIONS[desig.getSelectedItemPosition()];
            final String ph = phone.getText().toString().trim();
            a.executor.execute(() -> {
                try {
                    String path = "/staff/username-suggestion?designation=" + URLEncoder.encode(d, "UTF-8")
                            + "&phone=" + URLEncoder.encode(ph, "UTF-8") + (userId > 0 ? "&exclude_user_id=" + userId : "");
                    final JSONObject res = a.request(path, "GET", null, false);
                    final String u = res.isNull("username") ? "" : res.optString("username", "");
                    a.mainHandler.post(() -> {
                        if (u.isEmpty()) a.toast("Enter a phone number (4+ digits) to get a suggestion.");
                        else target.setText(u);
                    });
                } catch (Exception e) {
                    final String message = e.getMessage() == null ? "Could not suggest a username." : e.getMessage();
                    a.mainHandler.post(() -> a.toast(message));
                }
            });
        });
    }

    /** Review-then-apply rename of existing logins (web: Convert Usernames). */
    private void convertUsernames() {
        a.toast("Building the preview…");
        a.executor.execute(() -> {
            try {
                final JSONObject res = a.request("/staff/usernames/preview", "POST", null, false);
                a.mainHandler.post(() -> showConvertPreview(res));
            } catch (Exception e) {
                final String message = e.getMessage() == null ? "Could not build the username preview." : e.getMessage();
                a.mainHandler.post(() -> a.toast(message));
            }
        });
    }

    private void showConvertPreview(JSONObject res) {
        final JSONArray rows = arr(res, "rows");
        final JSONArray changes = new JSONArray();
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < rows.length(); i++) {
            JSONObject r = rows.optJSONObject(i);
            if (r == null || !r.optBoolean("will_change")) continue;
            try {
                changes.put(new JSONObject().put("user_id", r.optInt("user_id")).put("new_username", r.optString("new_username")));
            } catch (org.json.JSONException ignored) {
                continue;
            }
            if (changes.length() <= 40) {
                sb.append(str(r, "name")).append(": ").append(str(r, "current_username")).append(" → ")
                        .append(str(r, "new_username")).append("clash".equals(str(r, "note")) ? " (clash: more digits)" : "").append('\n');
            }
        }
        if (changes.length() == 0) {
            new AlertDialog.Builder(a).setTitle("Convert usernames")
                    .setMessage("Nothing to change. Every login already matches, or has no phone number.")
                    .setPositiveButton("OK", null).show();
            return;
        }
        if (changes.length() > 40) sb.append("… and ").append(changes.length() - 40).append(" more\n");
        new AlertDialog.Builder(a).setTitle(changes.length() + " login(s) will change")
                .setMessage("Passwords stay the same. Accounts without a phone number keep their username.\n\n" + sb)
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Apply", (d, w) -> applyConvert(changes)).show();
    }

    private void applyConvert(final JSONArray changes) {
        a.executor.execute(() -> {
            try {
                final JSONObject res = a.request("/staff/usernames/apply", "POST", body("changes", changes), false);
                a.mainHandler.post(() -> {
                    StringBuilder sb = new StringBuilder();
                    JSONArray sheet = arr(res, "credentials");
                    for (int i = 0; i < sheet.length(); i++) {
                        JSONObject c = sheet.optJSONObject(i);
                        if (c != null) sb.append(str(c, "name")).append(": ").append(str(c, "new_username")).append('\n');
                    }
                    new AlertDialog.Builder(a).setTitle(res.optInt("changed") + " login(s) changed")
                            .setMessage("Give each officer their new username; passwords are unchanged.\n\n" + sb)
                            .setPositiveButton("OK", null).show();
                    show();
                });
            } catch (Exception e) {
                final String message = e.getMessage() == null ? "Could not apply the username changes." : e.getMessage();
                a.mainHandler.post(() -> a.toast(message));
            }
        });
    }
}
