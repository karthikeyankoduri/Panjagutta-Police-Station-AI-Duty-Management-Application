package com.panjagutta.dutymanagement;

import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Spinner;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;

/** Station reports (shift-end, daily, vacancy, workload) with PDF/Excel/CSV export (web: /reports). */
final class ReportsScreen extends ModuleScreen {
    private static final String[] TAB_LABELS = {"Shift-end handover", "Daily report", "Vacancy report", "Workload report"};
    private static final String[] TAB_KEYS = {"shift-end", "daily", "vacancy", "workload"};
    private static final String[] SHIFTS = {"A", "B", "C"};

    private int tab;
    private String date;
    private String shift = "A";
    private String start;
    private String end;
    private JSONObject data;

    ReportsScreen(MainActivity a) {
        super(a);
        date = a.today();
        end = a.today();
        start = iso(addDays(Calendar.getInstance(), -6));
    }

    @Override
    void show() {
        load(() -> {
            switch (tab) {
                case 0: return a.request("/reports/shift-end?report_date=" + date + "&shift_code=" + shift, "GET", null, false);
                case 1: return a.request("/reports/daily?report_date=" + date, "GET", null, false);
                case 2: return a.request("/reports/daily-vacancy?report_date=" + date, "GET", null, false);
                default: return a.request("/reports/workload?start_date=" + start + "&end_date=" + end, "GET", null, false);
            }
        }, r -> {
            data = r;
            render();
        });
    }

    private void render() {
        a.content.removeAllViews();
        a.stopRefreshing();
        heading("REPORTS", "Station Reports & Exports",
                "Generated from records using the same rules as the dashboard. Export as PDF, Excel or CSV.");
        tabs(TAB_LABELS, tab, i -> {
            tab = i;
            show();
        });
        LinearLayout filter = card(0);
        EditText dateField = null;
        EditText endField = null;
        Spinner shiftSpinner = null;
        if (tab == 3) {
            dateField = a.dateField(start, null);
            labeled(filter, "From", dateField);
            endField = a.dateField(end, dateField);
            labeled(filter, "To", endField);
        } else {
            dateField = a.dateField(date, null);
            labeled(filter, "Date", dateField);
            if (tab == 0) {
                shiftSpinner = spinner(new String[]{"Shift A", "Shift B", "Shift C"}, "ABC".indexOf(shift));
                labeled(filter, "Shift", shiftSpinner);
            }
        }
        final EditText fDate = dateField;
        final EditText fEnd = endField;
        final Spinner fShift = shiftSpinner;
        filter.addView(buttonRow(primary("Generate", () -> {
            String d = fDate.getText().toString().trim();
            if (!a.validDate(d)) {
                fDate.setError("Choose a date");
                return;
            }
            if (tab == 3) {
                String e = fEnd.getText().toString().trim();
                if (!a.validDate(e)) {
                    fEnd.setError("Choose a date");
                    return;
                }
                start = d;
                end = e;
            } else {
                date = d;
            }
            if (fShift != null) shift = SHIFTS[fShift.getSelectedItemPosition()];
            show();
        })));
        add(filter);

        LinearLayout export = card(0);
        export.addView(text("EXPORT", 10, BLUE, true));
        export.addView(buttonRow(
                primary("PDF", () -> export("pdf")),
                primary("Excel", () -> export("xlsx")),
                primary("CSV", () -> export("csv"))));
        add(export);

        if (data == null) return;
        LinearLayout header = card(BLUE);
        header.addView(text("HYDERABAD CITY POLICE — PANJAGUTTA POLICE STATION", 9, MUTED, true));
        header.addView(text(str(data, "report_type"), 16, INK, true));
        StringBuilder meta = new StringBuilder();
        if (!str(data, "report_date").isEmpty()) meta.append("Date ").append(day(str(data, "report_date")));
        if (!str(data, "shift_code").isEmpty()) meta.append(" · Shift ").append(str(data, "shift_code"));
        if (!str(data, "shift_window").isEmpty()) meta.append(" (").append(str(data, "shift_window")).append(')');
        if (!str(data, "start_date").isEmpty()) meta.append(day(str(data, "start_date"))).append(" to ").append(day(str(data, "end_date")));
        if (!data.isNull("roster_version")) meta.append(" · Roster v").append(str(data, "roster_version"));
        if (data.optBoolean("sector_scoped")) meta.append(" · Sector ").append(str(data, "sector_id")).append(" only");
        meta.append(" · Generated ").append(dateTime(str(data, "generated_at"))).append(" by ").append(str(data, "generated_by"));
        header.addView(muted(meta.toString()));
        if (!str(data, "note").isEmpty()) header.addView(muted(str(data, "note")));
        add(header);

        JSONArray sections = arr(data, "sections");
        for (int s = 0; s < sections.length(); s++) {
            JSONObject sec = sections.optJSONObject(s);
            if (sec == null) continue;
            JSONArray columns = arr(sec, "columns");
            JSONArray rows = arr(sec, "rows");
            section(str(sec, "title").toUpperCase() + " (" + rows.length() + ")");
            if (rows.length() == 0) empty("No records.");
            for (int r = 0; r < rows.length() && r < 200; r++) {
                JSONArray row = rows.optJSONArray(r);
                if (row == null) continue;
                LinearLayout card = card(0);
                for (int c = 0; c < row.length(); c++) {
                    String value = row.isNull(c) || row.optString(c).isEmpty() ? "—" : row.optString(c);
                    String col = c < columns.length() ? columns.optString(c) : "";
                    if (c == 0) {
                        card.addView(text(value, 13, INK, true));
                    } else {
                        card.addView(muted(col + ": " + value));
                    }
                }
                addTight(card);
            }
        }
        if (!str(data, "disclaimer").isEmpty()) add(muted(str(data, "disclaimer")));
    }

    private void export(String format) {
        StringBuilder q = new StringBuilder("/reports/export?report_type=" + TAB_KEYS[tab] + "&format=" + format);
        if (tab == 3) q.append("&start_date=").append(start).append("&end_date=").append(end);
        else q.append("&report_date=").append(date);
        if (tab == 0) q.append("&shift_code=").append(shift);
        downloadAndOpen(q.toString(), "panjagutta_" + TAB_KEYS[tab] + "." + format);
    }
}
