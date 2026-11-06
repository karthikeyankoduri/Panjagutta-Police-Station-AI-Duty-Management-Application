package com.panjagutta.dutymanagement;

import android.app.AlertDialog;
import android.graphics.Color;
import android.graphics.Typeface;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Base class for one web-app module (page) rebuilt natively. A module loads its data through the
 * regular web endpoints with the signed-in token, renders into {@link MainActivity#content}, and shows
 * only the actions that {@link RoleAccess} allows for the signed-in role. The server still enforces
 * every permission.
 */
abstract class ModuleScreen {
    static final int NAVY = MainActivity.NAVY;
    static final int BLUE = MainActivity.BLUE;
    static final int GOLD = MainActivity.GOLD;
    static final int INK = MainActivity.INK;
    static final int MUTED = MainActivity.MUTED;
    static final int SURFACE = MainActivity.SURFACE;
    static final int BACKGROUND = MainActivity.BACKGROUND;
    static final int LINE = MainActivity.LINE;
    static final int GREEN = MainActivity.GREEN;
    static final int GREEN_BG = MainActivity.GREEN_BG;
    static final int AMBER = MainActivity.AMBER;
    static final int AMBER_BG = MainActivity.AMBER_BG;
    static final int RED = MainActivity.RED;
    static final int RED_BG = MainActivity.RED_BG;
    static final int TINT = MainActivity.TINT;
    static final int TINT_LINE = MainActivity.TINT_LINE;

    interface Work<T> { T run() throws Exception; }
    interface Done<T> { void run(T result); }
    interface Check { boolean run(); }
    interface Text { void run(String value); }

    final MainActivity a;
    final String role;
    private int generation;

    ModuleScreen(MainActivity activity) {
        this.a = activity;
        this.role = activity.role();
    }

    /** Loads fresh data and (re)draws the module. */
    abstract void show();

    /** Receives the result of an activity this module started with {@link MainActivity#startForResult}. */
    void onResult(int requestCode, android.content.Intent data) {
    }

    /** Handles the system Back key inside the module; return true when consumed. */
    boolean back() {
        return false;
    }

    // ── Loading and actions ──────────────────────────────────────────────────────

    /** Runs `work` off the main thread, then `done` on it, unless the user has moved on meanwhile. */
    <T> void load(Work<T> work, Done<T> done) {
        final int mine = ++generation;
        a.addSkeleton();
        a.executor.execute(() -> {
            try {
                final T result = work.run();
                a.mainHandler.post(() -> {
                    if (!live(mine)) return;
                    a.stopRefreshing();
                    a.stopSkeleton();
                    a.content.removeAllViews();
                    try {
                        done.run(result);
                    } catch (RuntimeException e) {
                        a.showErrorWith("This screen could not be drawn: " + e, this::show);
                    }
                });
            } catch (Exception e) {
                final String message = e.getMessage() == null ? "Unable to load data." : e.getMessage();
                a.mainHandler.post(() -> {
                    if (!live(mine)) return;
                    a.stopRefreshing();
                    a.showErrorWith(message, this::show);
                });
            }
        });
    }

    private boolean live(int mine) {
        return mine == generation && a.current == this && a.token != null;
    }

    /** Runs a write call, toasts the result, then reloads the module (or runs `after`). */
    void act(String path, String method, JSONObject body, String okMessage) {
        act(path, method, body, okMessage, this::show);
    }

    void act(String path, String method, JSONObject body, String okMessage, Runnable after) {
        call(path, method, body, okMessage, res -> {
            if (after != null) after.run();
        });
    }

    /** Runs a write call and hands the server's JSON response to `then` (on the main thread). */
    void call(String path, String method, JSONObject body, String okMessage, Done<JSONObject> then) {
        a.executor.execute(() -> {
            try {
                final JSONObject res = a.request(path, method, body == null ? new JSONObject() : body, false);
                a.mainHandler.post(() -> {
                    if (okMessage != null) a.toast(okMessage);
                    a.fetchNotifications(false);
                    if (a.current == this && then != null) then.run(res);
                });
            } catch (Exception e) {
                final String message = e.getMessage() == null ? "The action failed." : e.getMessage();
                a.mainHandler.post(() -> a.toast(message));
            }
        });
    }

    /** Fetches a file from an authenticated endpoint and hands it to the system share/open sheet. */
    void downloadAndOpen(String path, String fallbackName) {
        a.toast("Preparing " + fallbackName + "…");
        a.executor.execute(() -> {
            try {
                final MainActivity.Download file = a.download(path, fallbackName);
                a.mainHandler.post(() -> a.openDownloaded(file));
            } catch (Exception e) {
                final String message = e.getMessage() == null ? "Download failed." : e.getMessage();
                a.mainHandler.post(() -> a.toast(message));
            }
        });
    }

    // ── Dates ────────────────────────────────────────────────────────────────────

    static String iso(java.util.Calendar c) {
        return String.format(Locale.US, "%04d-%02d-%02d", c.get(java.util.Calendar.YEAR),
                c.get(java.util.Calendar.MONTH) + 1, c.get(java.util.Calendar.DAY_OF_MONTH));
    }

    static java.util.Calendar cal(String ymd) {
        java.util.Calendar c = java.util.Calendar.getInstance();
        if (ymd != null && ymd.length() >= 10) {
            try {
                c.set(Integer.parseInt(ymd.substring(0, 4)), Integer.parseInt(ymd.substring(5, 7)) - 1,
                        Integer.parseInt(ymd.substring(8, 10)), 12, 0, 0);
            } catch (NumberFormatException ignored) {
                // Falls back to today.
            }
        }
        return c;
    }

    static java.util.Calendar addDays(java.util.Calendar c, int days) {
        java.util.Calendar x = (java.util.Calendar) c.clone();
        x.add(java.util.Calendar.DAY_OF_YEAR, days);
        return x;
    }

    static String monthTitle(java.util.Calendar c) {
        return new java.text.SimpleDateFormat("MMMM yyyy", Locale.getDefault()).format(c.getTime());
    }

    static String weekdayTitle(java.util.Calendar c) {
        return new java.text.SimpleDateFormat("EEE d MMM", Locale.getDefault()).format(c.getTime());
    }

    // ── Drawing helpers ──────────────────────────────────────────────────────────

    TextView text(String value, int size, int color, boolean bold) {
        return a.text(value, size, color, bold);
    }

    TextView muted(String value) {
        return text(value, 12, MUTED, false);
    }

    LinearLayout card(int accent) {
        return a.card(accent);
    }

    void add(View view) {
        a.content.addView(view, a.cardParams());
    }

    void addTight(View view) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = a.dp(10);
        a.content.addView(view, lp);
    }

    void heading(String eyebrow, String title, String subtitle) {
        a.addPageHeading(eyebrow, title, subtitle);
    }

    void section(String title) {
        a.sectionHeader(title, null, null);
    }

    void empty(String message) {
        add(a.cardMessage(message));
    }

    TextView badge(String label, int fg, int bg) {
        return a.statusBadge(label, fg, bg);
    }

    /** Status pill coloured by meaning, used for roster, leave, movement, task and alert states. */
    TextView statusBadge(String status) {
        String s = status == null ? "" : status.toUpperCase(Locale.ROOT);
        int fg = MUTED;
        int bg = BACKGROUND;
        if (s.matches(".*(APPROVED|PUBLISHED|VERIFIED|COMPLETED|AUTHORIZED|CONFIRMED|PRESENT|ACTIVE|FILLED|RESOLVED|RETURNED_OK).*")) {
            fg = GREEN; bg = GREEN_BG;
        } else if (s.matches(".*(REJECTED|ABSENT|OVERDUE|CRITICAL|CANCELLED|VACANT|FAILED).*")) {
            fg = RED; bg = RED_BG;
        } else if (s.matches(".*(PENDING|SUBMITTED|DRAFT|WARNING|IN_PROGRESS|ASSIGNED|OPEN|AWAITING|SCHEDULED).*")) {
            fg = AMBER; bg = AMBER_BG;
        } else if (!s.isEmpty()) {
            fg = BLUE; bg = TINT;
        }
        return a.statusBadge(s.replace('_', ' '), fg, bg);
    }

    LinearLayout hrow() {
        LinearLayout row = new LinearLayout(a);
        row.setGravity(Gravity.CENTER_VERTICAL);
        return row;
    }

    /** Title on the left (fills the row), badge or small view on the right. */
    LinearLayout titleRow(View left, View right) {
        LinearLayout row = hrow();
        row.addView(left, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        if (right != null) row.addView(right);
        return row;
    }

    Button button(String label, int bg, int fg, Runnable onClick) {
        Button b = a.smallButton(label, bg, fg);
        b.setOnClickListener(v -> onClick.run());
        return b;
    }

    Button primary(String label, Runnable onClick) {
        return button(label, BLUE, Color.WHITE, onClick);
    }

    Button secondary(String label, Runnable onClick) {
        return button(label, TINT, BLUE, onClick);
    }

    Button danger(String label, Runnable onClick) {
        return button(label, RED_BG, RED, onClick);
    }

    Button success(String label, Runnable onClick) {
        return button(label, GREEN, Color.WHITE, onClick);
    }

    /** A row of equally sized buttons. */
    LinearLayout buttonRow(Button... buttons) {
        LinearLayout row = new LinearLayout(a);
        row.setPadding(0, a.dp(8), 0, 0);
        for (int i = 0; i < buttons.length; i++) {
            buttons[i].setTextSize(13);
            buttons[i].setSingleLine(true);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, a.dp(42), 1);
            if (i > 0) lp.setMarginStart(a.dp(8));
            row.addView(buttons[i], lp);
        }
        return row;
    }

    /** Wraps buttons onto as many rows as needed (2 per row). */
    void addButtons(LinearLayout parent, List<Button> buttons) {
        for (int i = 0; i < buttons.size(); i += 2) {
            Button first = buttons.get(i);
            if (i + 1 < buttons.size()) parent.addView(buttonRow(first, buttons.get(i + 1)));
            else parent.addView(buttonRow(first, spacer()));
        }
    }

    private Button spacer() {
        Button b = new Button(a);
        b.setVisibility(View.INVISIBLE);
        return b;
    }

    View fullWidth(Button b) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, a.dp(44));
        lp.bottomMargin = a.dp(10);
        b.setLayoutParams(lp);
        return b;
    }

    /** Back link shown above a detail view. */
    void backLink(String label, Runnable onClick) {
        TextView link = text("‹  " + label, 13, BLUE, true);
        link.setPadding(0, a.dp(2), a.dp(12), a.dp(10));
        link.setOnClickListener(v -> onClick.run());
        a.content.addView(link);
    }

    /** Horizontally scrolling pill tabs. */
    interface IndexListener { void run(int index); }

    void tabs(String[] labels, int selected, IndexListener onSelect) {
        HorizontalScrollView scroll = new HorizontalScrollView(a);
        scroll.setHorizontalScrollBarEnabled(false);
        LinearLayout row = new LinearLayout(a);
        row.setPadding(0, 0, 0, a.dp(2));
        for (int i = 0; i < labels.length; i++) {
            final int index = i;
            boolean on = i == selected;
            TextView pill = text(labels[i], 11, on ? Color.WHITE : BLUE, true);
            pill.setPadding(a.dp(14), a.dp(9), a.dp(14), a.dp(9));
            pill.setBackground(a.roundRect(on ? BLUE : TINT, on ? BLUE : TINT_LINE, 20));
            pill.setSingleLine(true);
            pill.setOnClickListener(v -> onSelect.run(index));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.setMarginEnd(a.dp(8));
            row.addView(pill, lp);
        }
        scroll.addView(row);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = a.dp(12);
        a.content.addView(scroll, lp);
    }

    /** Label above a form control. */
    void labeled(LinearLayout parent, String label, View control) {
        a.addFieldLabel(parent, label);
        if (control instanceof EditText && ((EditText) control).getMinLines() <= 1) {
            parent.addView(control, a.fieldParams());
        } else if (control instanceof Spinner) {
            parent.addView(control, a.fieldParams());
        } else {
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.bottomMargin = a.dp(10);
            parent.addView(control, lp);
        }
    }

    EditText field(String hint, int inputType) {
        return a.input(hint, inputType);
    }

    EditText textField(String hint) {
        return field(hint, InputType.TYPE_CLASS_TEXT);
    }

    EditText multiline(String hint) {
        EditText e = a.input(hint, InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE
                | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        e.setSingleLine(false);
        e.setMinLines(3);
        e.setGravity(Gravity.TOP);
        e.setPadding(a.dp(12), a.dp(10), a.dp(12), a.dp(10));
        return e;
    }

    EditText numberField(String hint) {
        return field(hint, InputType.TYPE_CLASS_NUMBER);
    }

    EditText searchField(String hint, Text onChange) {
        EditText e = field(hint, InputType.TYPE_CLASS_TEXT);
        e.setOnEditorActionListener((v, actionId, event) -> {
            onChange.run(e.getText().toString().trim());
            return false;
        });
        e.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH);
        return e;
    }

    Spinner spinner(List<String> options, int selected) {
        Spinner spinner = new Spinner(a);
        ArrayAdapter<String> adapter = new ArrayAdapter<>(a, android.R.layout.simple_spinner_dropdown_item, options);
        spinner.setAdapter(adapter);
        spinner.setBackground(a.roundRect(SURFACE, LINE, 8));
        spinner.setPadding(a.dp(8), 0, a.dp(8), 0);
        if (selected >= 0 && selected < options.size()) spinner.setSelection(selected);
        return spinner;
    }

    Spinner spinner(String[] options, int selected) {
        List<String> list = new ArrayList<>();
        for (String o : options) list.add(o);
        return spinner(list, selected);
    }

    /** Calls `l` only when the user changes the selection (not for the initial one). */
    void onSelect(Spinner spinner, IndexListener l) {
        final int[] last = {spinner.getSelectedItemPosition()};
        spinner.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id) {
                if (position != last[0]) {
                    last[0] = position;
                    l.run(position);
                }
            }

            @Override
            public void onNothingSelected(android.widget.AdapterView<?> parent) {
            }
        });
    }

    /** Shows `body` in a dialog; the OK button only closes it when `onOk` returns true. */
    void form(String title, View body, String okLabel, Check onOk) {
        ScrollView scroll = new ScrollView(a);
        LinearLayout holder = new LinearLayout(a);
        holder.setOrientation(LinearLayout.VERTICAL);
        holder.setPadding(a.dp(20), a.dp(8), a.dp(20), a.dp(4));
        holder.addView(body);
        scroll.addView(holder);
        AlertDialog dialog = new AlertDialog.Builder(a)
                .setTitle(title)
                .setView(scroll)
                .setNegativeButton("Cancel", null)
                .setPositiveButton(okLabel, null)
                .create();
        dialog.setOnShowListener(d -> dialog.getButton(AlertDialog.BUTTON_POSITIVE)
                .setOnClickListener(v -> {
                    if (onOk.run()) dialog.dismiss();
                }));
        dialog.show();
    }

    LinearLayout formBody() {
        LinearLayout body = new LinearLayout(a);
        body.setOrientation(LinearLayout.VERTICAL);
        return body;
    }

    /** Asks for one line of text (a reason, a comment). Empty input is refused when `required`. */
    void prompt(String title, String hint, boolean required, Text onOk) {
        LinearLayout body = formBody();
        EditText input = multiline(hint);
        body.addView(input, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        form(title, body, "Submit", () -> {
            String value = input.getText().toString().trim();
            if (required && value.isEmpty()) {
                input.setError("Required");
                return false;
            }
            onOk.run(value);
            return true;
        });
    }

    void confirm(String question, Runnable onYes) {
        a.confirm(question, onYes);
    }

    // ── JSON helpers ─────────────────────────────────────────────────────────────

    static String str(JSONObject o, String key) {
        if (o == null || o.isNull(key)) return "";
        return o.optString(key, "");
    }

    static String str(JSONObject o, String key, String fallback) {
        String v = str(o, key);
        return v.isEmpty() ? fallback : v;
    }

    static JSONObject obj(JSONArray array, int index) {
        return array == null ? null : array.optJSONObject(index);
    }

    static JSONArray arr(JSONObject o, String key) {
        JSONArray a = o == null ? null : o.optJSONArray(key);
        return a == null ? new JSONArray() : a;
    }

    static JSONObject body(Object... pairs) {
        JSONObject o = new JSONObject();
        try {
            for (int i = 0; i + 1 < pairs.length; i += 2) {
                Object v = pairs[i + 1];
                if (v != null) o.put((String) pairs[i], v);
            }
        } catch (org.json.JSONException ignored) {
            // Keys are literals; cannot fail.
        }
        return o;
    }

    String dateTime(String iso) {
        if (iso == null || iso.isEmpty() || "null".equals(iso)) return "—";
        return a.formatDate(iso) + (iso.length() > 10 ? " " + a.formatTime(iso) : "");
    }

    String day(String iso) {
        return iso == null || iso.isEmpty() || "null".equals(iso) ? "—" : a.formatDate(iso);
    }

    /** "Name · SVC123" line for a person. */
    static String person(String name, String serviceNumber) {
        String n = name == null || name.isEmpty() ? "Staff" : name;
        return serviceNumber == null || serviceNumber.isEmpty() ? n : n + " · " + serviceNumber;
    }

    TextView bold(String value) {
        TextView t = text(value, 14, INK, true);
        t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return t;
    }
}
