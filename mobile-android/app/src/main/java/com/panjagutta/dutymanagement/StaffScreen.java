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

    StaffScreen(MainActivity a) {
        super(a);
    }

    @Override
    void show() {
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
        a.toast("Importing…");
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
                final JSONObject res = a.uploadFile("/staff/import-csv", "file", filename, mime, bytes.toByteArray());
                a.mainHandler.post(() -> {
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
}
