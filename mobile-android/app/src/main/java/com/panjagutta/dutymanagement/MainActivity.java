package com.panjagutta.dutymanagement;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.LayerDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.MalformedURLException;
import java.net.HttpURLConnection;
import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final int NAVY = Color.rgb(20, 42, 66);
    private static final int BLUE = Color.rgb(23, 105, 170);
    private static final int INK = Color.rgb(32, 49, 68);
    private static final int MUTED = Color.rgb(112, 128, 145);
    private static final int SURFACE = Color.WHITE;
    private static final int BACKGROUND = Color.rgb(245, 247, 250);
    private static final int LINE = Color.rgb(226, 232, 239);
    private static final String DEFAULT_API_BASE = BuildConfig.API_BASE_URL;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private String apiBase;
    private String token;
    private JSONObject profile;
    private LinearLayout page;
    private LinearLayout content;
    private EditText serverInput;
    private EditText usernameInput;
    private EditText passwordInput;
    private Spinner leaveKind;
    private EditText leaveStart;
    private EditText leaveEnd;
    private LinearLayout leaveHistory;
    private String selectedTab = "Home";
    private JSONArray rosterData = new JSONArray();
    private JSONArray attendanceData = new JSONArray();
    private JSONArray leaveData = new JSONArray();
    private Calendar visibleMonth = Calendar.getInstance();
    private String selectedCalendarDate;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(NAVY);
        getWindow().setNavigationBarColor(BACKGROUND);
        selectedCalendarDate = today();
        visibleMonth.set(Calendar.DAY_OF_MONTH, 1);
        String savedApiBase = getPreferences(MODE_PRIVATE).getString("api_base", DEFAULT_API_BASE);
        if (savedApiBase == null || savedApiBase.trim().isEmpty()) {
            apiBase = DEFAULT_API_BASE;
            getPreferences(MODE_PRIVATE).edit().putString("api_base", apiBase).apply();
        } else {
            apiBase = savedApiBase;
        }
        token = savedInstanceState == null ? null : savedInstanceState.getString("token");
        if (token == null) {
            showLogin();
        } else {
            fetchProfile();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (token != null) outState.putString("token", token);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }

    private void showLogin() {
        page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setGravity(Gravity.CENTER);
        page.setPadding(dp(18), dp(20), dp(18), dp(20));
        page.setBackground(new LayerDrawable(new android.graphics.drawable.Drawable[]{
                getDrawable(R.drawable.login_background),
                new ColorDrawable(0x8c08172c),
        }));

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout.LayoutParams scrollParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1);
        page.addView(scroll, scrollParams);
        LinearLayout center = new LinearLayout(this);
        center.setGravity(Gravity.CENTER);
        center.setOrientation(LinearLayout.VERTICAL);
        scroll.addView(center, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout panel = new LinearLayout(this);
        panel.setGravity(Gravity.CENTER_HORIZONTAL);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(22), dp(22), dp(22), dp(20));
        panel.setBackground(roundRect(0xee14253c, 0x6685b7e2, 14));
        center.addView(panel, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        ImageView crest = new ImageView(this);
        crest.setImageResource(R.drawable.login_police_crest);
        crest.setScaleType(ImageView.ScaleType.FIT_CENTER);
        LinearLayout.LayoutParams crestParams = new LinearLayout.LayoutParams(dp(96), dp(108));
        crestParams.bottomMargin = dp(8);
        panel.addView(crest, crestParams);
        TextView title = text("PANJAGUTTA POLICE STATION", 18, Color.rgb(247, 249, 252), true);
        title.setGravity(Gravity.CENTER);
        panel.addView(title);
        TextView subtitle = text("HYDERABAD CITY POLICE PORTAL", 11, Color.rgb(167, 183, 201), false);
        subtitle.setGravity(Gravity.CENTER);
        subtitle.setPadding(0, dp(4), 0, dp(18));
        panel.addView(subtitle);

        serverInput = input("API server URL", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        serverInput.setText(apiBase);
        styleLoginInput(serverInput);
        LinearLayout connectionSettings = new LinearLayout(this);
        connectionSettings.setOrientation(LinearLayout.VERTICAL);
        connectionSettings.setVisibility(apiBase.isEmpty() ? View.VISIBLE : View.GONE);
        connectionSettings.addView(serverInput, fieldParams());
        TextView serverHint = text("For mobile data, enter the approved HTTPS API address provided by your IT administrator. A private address such as 172.16.x.x or 192.168.x.x works only on that local network, not over mobile data.", 12, Color.rgb(198, 210, 224), false);
        serverHint.setPadding(dp(2), 0, dp(2), dp(10));
        connectionSettings.addView(serverHint);
        TextView networkHelp = text("This app's API currently runs on a development computer; no department-hosted internet address is configured yet. Ask IT to deploy the FastAPI backend over HTTPS, then enter that API URL here. The server and phone must both have working access.", 12, Color.rgb(218, 231, 244), false);
        networkHelp.setPadding(dp(2), 0, dp(2), dp(10));
        connectionSettings.addView(networkHelp);
        TextView connectionStatus = text("", 12, Color.rgb(167, 224, 190), false);
        connectionStatus.setVisibility(apiBase.isEmpty() ? View.VISIBLE : View.GONE);
        if (apiBase.isEmpty()) {
            connectionStatus.setTextColor(Color.rgb(255, 190, 186));
            connectionStatus.setText("No API server address is configured. The app cannot connect over mobile data until IT provides a hosted HTTPS API address.");
        }
        connectionSettings.addView(connectionStatus);
        Button checkConnection = smallButton("Check API connection", Color.rgb(23, 105, 170), Color.WHITE);
        connectionSettings.addView(checkConnection, fieldParams());
        panel.addView(connectionSettings);
        TextView connectionToggle = text("API CONNECTION SETTINGS", 11, Color.rgb(121, 185, 241), true);
        connectionToggle.setGravity(Gravity.CENTER);
        connectionToggle.setPadding(0, 0, 0, dp(12));
        panel.addView(connectionToggle);
        connectionToggle.setOnClickListener(v -> connectionSettings.setVisibility(
                connectionSettings.getVisibility() == View.VISIBLE ? View.GONE : View.VISIBLE));
        checkConnection.setOnClickListener(v -> {
            String base = serverInput.getText().toString().trim().replaceAll("/+$", "");
            if (base.isEmpty()) {
                connectionStatus.setTextColor(Color.rgb(255, 190, 186));
                connectionStatus.setText("Enter the API HTTPS address supplied by your IT administrator.");
                connectionStatus.setVisibility(View.VISIBLE);
                return;
            }
            apiBase = base;
            getPreferences(MODE_PRIVATE).edit().putString("api_base", apiBase).apply();
            checkConnection.setEnabled(false);
            connectionStatus.setTextColor(Color.rgb(198, 210, 224));
            connectionStatus.setText("Checking " + base + " …");
            connectionStatus.setVisibility(View.VISIBLE);
            executor.execute(() -> {
                try {
                    request("/health", "GET", null, false);
                    mainHandler.post(() -> {
                        checkConnection.setEnabled(true);
                        connectionStatus.setTextColor(Color.rgb(167, 224, 190));
                        connectionStatus.setText("API reachable at " + base + ". You can sign in.");
                    });
                } catch (Exception exception) {
                    mainHandler.post(() -> {
                        checkConnection.setEnabled(true);
                        connectionStatus.setTextColor(Color.rgb(255, 190, 186));
                        connectionStatus.setText(connectionFailureMessage(base));
                    });
                }
            });
        });

        usernameInput = input("Staff username", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        styleLoginInput(usernameInput);
        panel.addView(usernameInput, fieldParams());
        passwordInput = input("Password", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        styleLoginInput(passwordInput);
        panel.addView(passwordInput, fieldParams());

        TextView error = text("", 12, Color.rgb(255, 190, 186), false);
        error.setPadding(dp(10), dp(8), dp(10), dp(8));
        error.setBackground(roundRect(0x332d1b24, 0x66d47b79, 8));
        error.setVisibility(View.GONE);
        panel.addView(error);
        Button signIn = button("Sign in", BLUE);
        LinearLayout.LayoutParams signInParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(50));
        signInParams.topMargin = dp(8);
        panel.addView(signIn, signInParams);
        TextView note = text("STAFF MOBILE ACCESS  ·  AUTHORIZED API REQUIRED", 10, Color.rgb(167, 183, 201), false);
        note.setGravity(Gravity.CENTER);
        note.setPadding(0, dp(16), 0, 0);
        panel.addView(note);
        setContentView(page);

        signIn.setOnClickListener(v -> {
            String base = serverInput.getText().toString().trim().replaceAll("/+$", "");
            String username = usernameInput.getText().toString().trim();
            String password = passwordInput.getText().toString();
            if (base.isEmpty()) {
                error.setVisibility(View.VISIBLE);
                error.setText("An API server address is required. Ask IT for the department-hosted HTTPS API URL.");
                connectionSettings.setVisibility(View.VISIBLE);
                return;
            }
            if (username.isEmpty() || password.isEmpty()) {
                error.setVisibility(View.VISIBLE);
                error.setText("Enter your staff username and password.");
                return;
            }
            apiBase = base;
            getPreferences(MODE_PRIVATE).edit().putString("api_base", apiBase).apply();
            signIn.setEnabled(false);
            error.setVisibility(View.VISIBLE);
            error.setText("Connecting…");
            executor.execute(() -> {
                try {
                    JSONObject form = new JSONObject();
                    form.put("username", username);
                    form.put("password", password);
                    JSONObject auth = request("/auth/login", "POST", form, false);
                    String accessToken = auth.optString("access_token", "");
                    if (accessToken.isEmpty()) throw new JSONException("The API did not return a sign-in token.");
                    token = accessToken;
                    JSONObject staffProfile = request("/mobile/me", "GET", null, false);
                    profile = staffProfile;
                    mainHandler.post(() -> {
                        selectedTab = "Home";
                        renderWorkspace();
                        refreshData();
                    });
                } catch (Exception exception) {
                    token = null;
                    boolean connectionError = exception instanceof ConnectException
                            || exception instanceof SocketTimeoutException
                            || exception instanceof UnknownHostException;
                    String message = connectionError
                            ? connectionFailureMessage(apiBase)
                            : exception.getMessage() == null ? "Unable to sign in." : exception.getMessage();
                    mainHandler.post(() -> {
                        signIn.setEnabled(true);
                        error.setVisibility(View.VISIBLE);
                        error.setText(message);
                        if (connectionError) {
                            connectionSettings.setVisibility(View.VISIBLE);
                            connectionStatus.setTextColor(Color.rgb(255, 190, 186));
                            connectionStatus.setText(connectionFailureMessage(apiBase));
                            connectionStatus.setVisibility(View.VISIBLE);
                        }
                    });
                }
            });
        });
    }

    private void fetchProfile() {
        executor.execute(() -> {
            try {
                profile = request("/mobile/me", "GET", null, false);
                mainHandler.post(() -> {
                    renderWorkspace();
                    refreshData();
                });
            } catch (Exception exception) {
                token = null;
                mainHandler.post(this::showLogin);
            }
        });
    }

    private void renderWorkspace() {
        page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(BACKGROUND);

        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(16), dp(10), dp(14), dp(10));
        header.setBackgroundColor(NAVY);
        String displayName = profile.optString("name", "Staff member").trim();
        if (displayName.isEmpty()) displayName = "Staff member";
        TextView avatar = text(
                displayName.substring(0, 1).toUpperCase(Locale.ROOT),
                16, Color.WHITE, true);
        avatar.setGravity(Gravity.CENTER);
        avatar.setBackground(roundRect(0x33ffffff, 0x55ffffff, 24));
        LinearLayout.LayoutParams avatarParams = new LinearLayout.LayoutParams(dp(42), dp(42));
        avatarParams.setMarginEnd(dp(11));
        header.addView(avatar, avatarParams);
        LinearLayout identity = new LinearLayout(this);
        identity.setOrientation(LinearLayout.VERTICAL);
        identity.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        identity.addView(text("PANJAGUTTA POLICE", 9, Color.rgb(166, 202, 231), true));
        identity.addView(text(displayName, 15, Color.WHITE, true));
        identity.addView(text(profile.optString("designation", "STAFF") + "  ·  "
                + profile.optString("service_number"), 10, Color.rgb(181, 197, 212), false));
        header.addView(identity);
        Button logout = smallButton("Logout", 0x22ffffff, Color.rgb(255, 220, 220));
        logout.setBackground(roundRect(0x22ffffff, 0x33ffffff, 8));
        header.addView(logout);
        logout.setOnClickListener(v -> signOut());
        page.addView(header);

        LinearLayout tabs = new LinearLayout(this);
        tabs.setPadding(dp(10), dp(8), dp(10), dp(8));
        tabs.setBackgroundColor(SURFACE);
        tabs.setElevation(dp(2));
        for (String tab : new String[]{"Home", "Calendar", "Roster", "Attend", "Leave", "Profile"}) {
            boolean selected = tab.equals(selectedTab);
            String tabLabel = "Attend".equals(tab) ? "ATTEND"
                    : "Profile".equals(tab) ? "ME" : tab.toUpperCase(Locale.ROOT);
            Button tabButton = smallButton(tabLabel,
                    selected ? Color.rgb(234, 243, 251) : Color.WHITE,
                    selected ? BLUE : MUTED);
            tabButton.setTextSize(10);
            tabButton.setTypeface(Typeface.DEFAULT, selected ? Typeface.BOLD : Typeface.NORMAL);
            tabButton.setBackground(roundRect(selected ? Color.rgb(234, 243, 251) : Color.WHITE,
                    selected ? Color.rgb(207, 226, 242) : Color.WHITE, 8));
            LinearLayout.LayoutParams tabParams = new LinearLayout.LayoutParams(0, dp(44), 1);
            tabParams.setMargins(dp(3), 0, dp(3), 0);
            tabs.addView(tabButton, tabParams);
            tabButton.setOnClickListener(v -> {
                selectedTab = tab;
                renderWorkspace();
                refreshData();
            });
        }
        page.addView(tabs);

        ScrollView scroll = new ScrollView(this);
        scroll.setClipToPadding(false);
        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(16), dp(20), dp(16), dp(28));
        scroll.addView(content);
        page.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(page);
        if ("Leave".equals(selectedTab)) addLeaveForm();
    }

    private void refreshData() {
        if (token == null) return;
        final String requestedTab = selectedTab;
        if ("Home".equals(requestedTab)) {
            addLoading();
            executor.execute(() -> {
                try {
                    JSONArray rosters = requestArray("/mobile/rosters");
                    JSONArray attendance = requestArray("/mobile/attendance?attendance_date=" + today());
                    JSONArray leaves = requestArray("/mobile/leave");
                    mainHandler.post(() -> {
                        if (!"Home".equals(selectedTab)) return;
                        rosterData = rosters;
                        attendanceData = attendance;
                        leaveData = leaves;
                        showDashboard();
                    });
                } catch (Exception exception) {
                    String message = exception.getMessage() == null
                            ? "Unable to load your dashboard." : exception.getMessage();
                    mainHandler.post(() -> {
                        if ("Home".equals(selectedTab)) showError(message);
                    });
                }
            });
            return;
        }
        if ("Calendar".equals(requestedTab)) {
            addLoading();
            executor.execute(() -> {
                try {
                    JSONArray diary = requestArray(calendarDiaryPath());
                    mainHandler.post(() -> {
                        if (!"Calendar".equals(selectedTab)) return;
                        rosterData = diary;
                        attendanceData = diary;
                        showCalendar();
                    });
                } catch (Exception exception) {
                    String message = exception.getMessage() == null
                            ? "Unable to load your published shifts." : exception.getMessage();
                    mainHandler.post(() -> {
                        if ("Calendar".equals(selectedTab)) showError(message);
                    });
                }
            });
            return;
        }
        if ("Profile".equals(requestedTab)) {
            showProfile();
            return;
        }
        final String path;
        if ("Roster".equals(requestedTab)) {
            path = "/mobile/rosters";
        } else if ("Attendance".equals(requestedTab) || "Attend".equals(requestedTab)) {
            path = "/mobile/attendance?attendance_date=" + today();
        } else {
            path = "/mobile/leave";
        }
        if (!"Leave".equals(requestedTab)) addLoading();
        executor.execute(() -> {
            try {
                JSONArray data = requestArray(path);
                mainHandler.post(() -> {
                    if (!requestedTab.equals(selectedTab)) return;
                    if ("Roster".equals(requestedTab)) {
                        rosterData = data;
                        showRosters();
                    } else if ("Attendance".equals(requestedTab) || "Attend".equals(requestedTab)) {
                        attendanceData = data;
                        showAttendance();
                    } else {
                        leaveData = data;
                        showLeave();
                    }
                });
            } catch (Exception exception) {
                String message = exception.getMessage() == null ? "Unable to load records." : exception.getMessage();
                mainHandler.post(() -> {
                    if (!requestedTab.equals(selectedTab)) return;
                    if ("Leave".equals(requestedTab)) toast(message);
                    else showError(message);
                });
            }
        });
    }

    private void showDashboard() {
        content.removeAllViews();
        addPageHeading("STAFF HOME", "Good day, " + firstName(profile.optString("name", "Staff")),
                "Here is your duty and attendance at a glance.");

        LinearLayout profileCard = card();
        profileCard.setBackground(roundRect(Color.rgb(237, 245, 252), Color.rgb(216, 231, 243), 10));
        profileCard.addView(text(profile.optString("designation", "STAFF") + "  ·  "
                + profile.optString("service_number"), 12, BLUE, true));
        String sector = profile.isNull("sector") ? "Station-wide" : "Sector " + profile.optString("sector");
        profileCard.addView(text(sector, 11, MUTED, false));
        content.addView(profileCard, cardParams());

        JSONObject todayRoster = findTodayRoster();
        JSONObject todayAttendance = findTodayAttendance(todayRoster);
        LinearLayout todayCard = card();
        LinearLayout todayHeading = new LinearLayout(this);
        todayHeading.setGravity(Gravity.CENTER_VERTICAL);
        todayHeading.addView(text("TODAY'S DUTY", 10, BLUE, true),
                new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        todayHeading.addView(statusBadge(todayRoster == null ? "NO SHIFT"
                        : attendanceStatus(todayAttendance),
                todayRoster == null ? MUTED : attendanceStatusColor(todayAttendance),
                todayRoster == null ? BACKGROUND : attendanceStatusBackground(todayAttendance)));
        todayCard.addView(todayHeading);
        if (todayRoster == null) {
            TextView emptyDuty = text("No published shift assigned today.", 14, INK, true);
            emptyDuty.setPadding(0, dp(10), 0, dp(3));
            todayCard.addView(emptyDuty);
            todayCard.addView(text("Your upcoming published shifts will appear below.",
                    12, MUTED, false));
        } else {
            TextView category = text(todayRoster.optString("duty_category"), 18, INK, true);
            category.setPadding(0, dp(9), 0, dp(2));
            todayCard.addView(category);
            todayCard.addView(text("Shift " + todayRoster.optString("shift_name") + "  ·  "
                    + todayRoster.optString("start_time") + " – "
                    + todayRoster.optString("end_time"), 12, MUTED, false));
            String task = todayRoster.optString("current_task", "");
            if (!task.isEmpty() && !"null".equals(task)) {
                todayCard.addView(text("Current task: " + task, 12, INK, false));
            }
            addDivider(todayCard);
            addDashboardAttendance(todayCard, todayAttendance, todayRoster);
        }
        content.addView(todayCard, cardParams());

        LinearLayout upcomingHeader = new LinearLayout(this);
        upcomingHeader.setGravity(Gravity.CENTER_VERTICAL);
        upcomingHeader.addView(text("UPCOMING SHIFTS", 10, BLUE, true),
                new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button viewCalendar = smallButton("View calendar", Color.rgb(234, 243, 251), BLUE);
        upcomingHeader.addView(viewCalendar);
        viewCalendar.setOnClickListener(v -> selectTab("Calendar"));
        content.addView(upcomingHeader);
        int upcomingCount = 0;
        for (int i = 0; i < rosterData.length() && upcomingCount < 3; i++) {
            JSONObject item = rosterData.optJSONObject(i);
            if (item == null || isToday(item.optString("duty_date"))) continue;
            LinearLayout upcoming = card();
            LinearLayout row = new LinearLayout(this);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.addView(text(formatDate(item.optString("duty_date")), 14, INK, true),
                    new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            row.addView(statusBadge("SHIFT " + item.optString("shift_name"),
                    BLUE, Color.rgb(234, 243, 251)));
            upcoming.addView(row);
            upcoming.addView(text(item.optString("duty_category") + "  ·  "
                    + item.optString("start_time") + " – " + item.optString("end_time"),
                    12, MUTED, false));
            content.addView(upcoming, cardParams());
            upcomingCount++;
        }
        if (upcomingCount == 0) {
            LinearLayout emptyUpcoming = card();
            emptyUpcoming.addView(text("No upcoming published shifts.", 12, MUTED, false));
            content.addView(emptyUpcoming, cardParams());
        }

        LinearLayout leaveHeader = new LinearLayout(this);
        leaveHeader.setGravity(Gravity.CENTER_VERTICAL);
        leaveHeader.addView(text("LEAVE REQUESTS", 10, BLUE, true),
                new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button viewLeave = smallButton("View requests", Color.rgb(234, 243, 251), BLUE);
        leaveHeader.addView(viewLeave);
        viewLeave.setOnClickListener(v -> selectTab("Leave"));
        content.addView(leaveHeader);
        if (leaveData.length() == 0) {
            LinearLayout emptyLeave = card();
            emptyLeave.addView(text("You have no leave requests yet.", 12, MUTED, false));
            content.addView(emptyLeave, cardParams());
        } else {
            JSONObject latestLeave = leaveData.optJSONObject(0);
            if (latestLeave != null) {
                String status = latestLeave.optString("status");
                LinearLayout leaveCard = card();
                LinearLayout row = new LinearLayout(this);
                row.setGravity(Gravity.CENTER_VERTICAL);
                row.addView(text(latestLeave.optString("kind"), 14, INK, true),
                        new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
                int statusColor = "Approved".equalsIgnoreCase(status)
                        ? Color.rgb(35, 133, 103)
                        : "Rejected".equalsIgnoreCase(status)
                                ? Color.rgb(175, 75, 68) : BLUE;
                int statusBackground = "Approved".equalsIgnoreCase(status)
                        ? Color.rgb(234, 246, 240)
                        : "Rejected".equalsIgnoreCase(status)
                                ? Color.rgb(255, 240, 239) : Color.rgb(234, 243, 251);
                row.addView(statusBadge(status.toUpperCase(Locale.ROOT),
                        statusColor, statusBackground));
                leaveCard.addView(row);
                leaveCard.addView(text(formatDate(latestLeave.optString("start")) + " – "
                        + formatDate(latestLeave.optString("end")), 12, MUTED, false));
                content.addView(leaveCard, cardParams());
            }
        }
    }

    private void showProfile() {
        content.removeAllViews();
        addPageHeading("MY ACCOUNT", "My profile",
                "Your staff account and app connection details.");

        String displayName = profile.optString("name", "Staff member").trim();
        if (displayName.isEmpty()) displayName = "Staff member";
        LinearLayout identityCard = card();
        identityCard.setGravity(Gravity.CENTER_HORIZONTAL);
        identityCard.setBackground(roundRect(Color.rgb(237, 245, 252), Color.rgb(216, 231, 243), 10));
        TextView avatar = text(displayName.substring(0, 1).toUpperCase(Locale.ROOT),
                24, Color.WHITE, true);
        avatar.setGravity(Gravity.CENTER);
        avatar.setBackground(roundRect(NAVY, NAVY, 40));
        LinearLayout.LayoutParams avatarParams = new LinearLayout.LayoutParams(dp(72), dp(72));
        avatarParams.bottomMargin = dp(10);
        identityCard.addView(avatar, avatarParams);
        TextView name = text(displayName, 19, INK, true);
        name.setGravity(Gravity.CENTER);
        identityCard.addView(name);
        TextView role = text(profile.optString("designation", "STAFF") + "  ·  "
                + profile.optString("service_number"), 12, BLUE, true);
        role.setGravity(Gravity.CENTER);
        identityCard.addView(role);
        content.addView(identityCard, cardParams());

        LinearLayout details = card();
        details.addView(text("STAFF DETAILS", 10, BLUE, true));
        addProfileDetail(details, "Full name", displayName);
        addProfileDetail(details, "Service number",
                profile.optString("service_number", "Not available"));
        addProfileDetail(details, "Designation",
                profile.optString("designation", "Staff"));
        String sector = profile.isNull("sector")
                ? "Station-wide" : "Sector " + profile.optString("sector");
        addProfileDetail(details, "Sector", sector);
        addProfileDetail(details, "Account", profile.optString("username", "Staff mobile account"));
        content.addView(details, cardParams());

        LinearLayout connection = card();
        connection.addView(text("APP CONNECTION", 10, BLUE, true));
        addProfileDetail(connection, "API address", apiBase);
        addProfileDetail(connection, "Connection type",
                apiBase.regionMatches(true, 0, "https://", 0, 8)
                        ? "Secure HTTPS" : "Local development HTTP");
        content.addView(connection, cardParams());

        Button logout = button("Sign out", Color.rgb(172, 65, 65));
        LinearLayout.LayoutParams logoutParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(48));
        logoutParams.topMargin = dp(4);
        content.addView(logout, logoutParams);
        logout.setOnClickListener(v -> signOut());
    }

    private void addProfileDetail(LinearLayout card, String label, String value) {
        TextView labelView = text(label, 10, MUTED, false);
        labelView.setPadding(0, dp(8), 0, 0);
        card.addView(labelView);
        TextView valueView = text(value == null || value.trim().isEmpty()
                ? "Not available" : value, 14, INK, true);
        valueView.setPadding(0, 0, 0, dp(4));
        valueView.setTextIsSelectable(true);
        card.addView(valueView);
    }

    private void signOut() {
        token = null;
        profile = null;
        rosterData = new JSONArray();
        attendanceData = new JSONArray();
        leaveData = new JSONArray();
        showLogin();
    }

    private void showCalendar() {
        content.removeAllViews();
        addPageHeading("MY DUTIES", "My duty diary",
                "Tap any date to view your assigned shift time, duty, task, and attendance history.");

        LinearLayout calendarCard = card();
        LinearLayout monthNavigation = new LinearLayout(this);
        monthNavigation.setGravity(Gravity.CENTER_VERTICAL);
        Button previousMonth = smallButton("‹", Color.rgb(245, 247, 250), INK);
        previousMonth.setTextSize(22);
        previousMonth.setMinWidth(dp(44));
        Button nextMonth = smallButton("›", Color.rgb(245, 247, 250), INK);
        nextMonth.setTextSize(22);
        nextMonth.setMinWidth(dp(44));
        TextView monthTitle = text(monthLabel(visibleMonth), 16, INK, true);
        monthTitle.setGravity(Gravity.CENTER);
        monthNavigation.addView(previousMonth);
        monthNavigation.addView(monthTitle, new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        monthNavigation.addView(nextMonth);
        calendarCard.addView(monthNavigation);
        previousMonth.setOnClickListener(v -> {
            visibleMonth.set(Calendar.DAY_OF_MONTH, 1);
            visibleMonth.add(Calendar.MONTH, -1);
            selectedCalendarDate = calendarDate(visibleMonth);
            refreshData();
        });
        nextMonth.setOnClickListener(v -> {
            visibleMonth.set(Calendar.DAY_OF_MONTH, 1);
            visibleMonth.add(Calendar.MONTH, 1);
            selectedCalendarDate = calendarDate(visibleMonth);
            refreshData();
        });

        LinearLayout weekdays = new LinearLayout(this);
        weekdays.setPadding(0, dp(12), 0, dp(4));
        String[] dayLabels = {"S", "M", "T", "W", "T", "F", "S"};
        for (String label : dayLabels) {
            TextView day = text(label, 10, MUTED, true);
            day.setGravity(Gravity.CENTER);
            weekdays.addView(day, new LinearLayout.LayoutParams(
                    0, dp(28), 1));
        }
        calendarCard.addView(weekdays);

        Calendar firstOfMonth = (Calendar) visibleMonth.clone();
        firstOfMonth.set(Calendar.DAY_OF_MONTH, 1);
        int firstWeekday = firstOfMonth.get(Calendar.DAY_OF_WEEK) - Calendar.SUNDAY;
        int daysInMonth = firstOfMonth.getActualMaximum(Calendar.DAY_OF_MONTH);
        for (int week = 0; week < 6; week++) {
            LinearLayout row = new LinearLayout(this);
            for (int weekday = 0; weekday < 7; weekday++) {
                int dayOfMonth = week * 7 + weekday - firstWeekday + 1;
                if (dayOfMonth < 1 || dayOfMonth > daysInMonth) {
                    row.addView(new View(this), new LinearLayout.LayoutParams(
                            0, dp(48), 1));
                    continue;
                }
                Calendar cellDate = (Calendar) firstOfMonth.clone();
                cellDate.set(Calendar.DAY_OF_MONTH, dayOfMonth);
                String dateKey = calendarDate(cellDate);
                boolean today = dateKey.equals(today());
                boolean selected = dateKey.equals(selectedCalendarDate);
                boolean hasDuty = hasRosterOn(dateKey);

                LinearLayout cell = new LinearLayout(this);
                cell.setGravity(Gravity.CENTER);
                cell.setOrientation(LinearLayout.VERTICAL);
                int fill = selected ? BLUE
                        : hasDuty ? Color.rgb(234, 246, 240) : Color.WHITE;
                int stroke = selected ? BLUE
                        : today ? Color.rgb(76, 142, 194)
                        : hasDuty ? Color.rgb(198, 228, 213) : Color.WHITE;
                cell.setBackground(roundRect(fill, stroke, 8));
                TextView dayNumber = text(String.valueOf(dayOfMonth), 12,
                        selected ? Color.WHITE : INK, selected || today);
                dayNumber.setGravity(Gravity.CENTER);
                dayNumber.setPadding(0, 0, 0, 0);
                cell.addView(dayNumber);
                View dutyDot = new View(this);
                int dotSize = dp(4);
                LinearLayout.LayoutParams dotParams = new LinearLayout.LayoutParams(dotSize, dotSize);
                dutyDot.setBackground(roundRect(
                        selected ? Color.WHITE : Color.rgb(35, 133, 103),
                        selected ? Color.WHITE : Color.rgb(35, 133, 103), dotSize));
                dutyDot.setVisibility(hasDuty ? View.VISIBLE : View.INVISIBLE);
                cell.addView(dutyDot, dotParams);
                cell.setContentDescription(new SimpleDateFormat("EEEE, d MMMM yyyy", Locale.getDefault())
                        .format(cellDate.getTime()) + (hasDuty ? ", assigned duty" : "")
                        + (today ? ", today" : ""));
                cell.setClickable(true);
                cell.setOnClickListener(v -> {
                    selectedCalendarDate = dateKey;
                    showCalendar();
                });
                LinearLayout.LayoutParams cellParams = new LinearLayout.LayoutParams(
                        0, dp(48), 1);
                cellParams.setMargins(dp(2), dp(2), dp(2), dp(2));
                row.addView(cell, cellParams);
            }
            calendarCard.addView(row);
        }
        LinearLayout legend = new LinearLayout(this);
        legend.setGravity(Gravity.CENTER_VERTICAL);
        legend.setPadding(0, dp(10), 0, 0);
        View legendDot = new View(this);
        int dotSize = dp(7);
        legendDot.setBackground(roundRect(Color.rgb(35, 133, 103),
                Color.rgb(35, 133, 103), dotSize));
        legend.addView(legendDot, new LinearLayout.LayoutParams(dotSize, dotSize));
        TextView legendText = text("Published shift", 10, MUTED, false);
        legendText.setPadding(dp(6), dp(3), 0, dp(3));
        legend.addView(legendText);
        calendarCard.addView(legend);
        content.addView(calendarCard, cardParams());

        Calendar selectedDate = parseCalendarDate(selectedCalendarDate);
        LinearLayout selectedHeading = new LinearLayout(this);
        selectedHeading.setGravity(Gravity.CENTER_VERTICAL);
        String selectedLabel = selectedDate == null ? selectedCalendarDate
                : new SimpleDateFormat("EEEE, d MMMM", Locale.getDefault())
                        .format(selectedDate.getTime());
        selectedHeading.addView(text(selectedLabel.toUpperCase(Locale.ROOT),
                        10, BLUE, true),
                new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        if (selectedCalendarDate.equals(today())) {
            selectedHeading.addView(statusBadge("TODAY", BLUE, Color.rgb(234, 243, 251)));
        }
        content.addView(selectedHeading);

        int selectedDutyCount = 0;
        for (int i = 0; i < rosterData.length(); i++) {
            JSONObject item = rosterData.optJSONObject(i);
            if (item == null || !selectedCalendarDate.equals(item.optString("duty_date"))) continue;
            LinearLayout dutyCard = card();
            LinearLayout topRow = new LinearLayout(this);
            topRow.setGravity(Gravity.CENTER_VERTICAL);
            topRow.addView(text("SHIFT " + item.optString("shift_name").toUpperCase(Locale.ROOT),
                            10, BLUE, true),
                    new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            topRow.addView(statusBadge("PUBLISHED", Color.rgb(35, 133, 103),
                    Color.rgb(234, 246, 240)));
            dutyCard.addView(topRow);
            TextView category = text(item.optString("duty_category"), 17, INK, true);
            category.setPadding(0, dp(8), 0, dp(2));
            dutyCard.addView(category);
            dutyCard.addView(text("DUTY TIME", 9, MUTED, true));
            dutyCard.addView(text(item.optString("start_time") + " – "
                    + item.optString("end_time"), 12, MUTED, false));
            String task = item.optString("current_task", "");
            if (!task.isEmpty() && !"null".equals(task)) {
                addDivider(dutyCard);
                dutyCard.addView(text("DUTY TASK", 9, MUTED, true));
                dutyCard.addView(text(task, 12, INK, false));
            }
            JSONObject attendance = findTodayAttendance(item);
            addDivider(dutyCard);
            if (selectedCalendarDate.equals(today())) {
                addDashboardAttendance(dutyCard, attendance, item);
            } else if (selectedCalendarDate.compareTo(today()) < 0) {
                addDutyDiaryAttendance(dutyCard, attendance);
            } else {
                dutyCard.addView(text("ATTENDANCE", 9, MUTED, true));
                dutyCard.addView(text("Attendance can be recorded on the duty date.",
                        12, MUTED, false));
            }
            content.addView(dutyCard, cardParams());
            selectedDutyCount++;
        }
        if (selectedDutyCount == 0) {
            LinearLayout empty = card();
            empty.addView(text("No published duty diary entry was found for this date.", 12, INK, true));
            empty.addView(text("Only shifts that were published and assigned to your staff account appear here.",
                    11, MUTED, false));
            content.addView(empty, cardParams());
        }
    }

    private boolean hasRosterOn(String date) {
        for (int i = 0; i < rosterData.length(); i++) {
            JSONObject item = rosterData.optJSONObject(i);
            if (item != null && date.equals(item.optString("duty_date"))) return true;
        }
        return false;
    }

    private String monthLabel(Calendar calendar) {
        return new SimpleDateFormat("MMMM yyyy", Locale.getDefault()).format(calendar.getTime());
    }

    private String calendarDiaryPath() {
        Calendar first = (Calendar) visibleMonth.clone();
        first.set(Calendar.DAY_OF_MONTH, 1);
        Calendar last = (Calendar) first.clone();
        last.set(Calendar.DAY_OF_MONTH, last.getActualMaximum(Calendar.DAY_OF_MONTH));
        return "/mobile/diary?start_date=" + calendarDate(first)
                + "&end_date=" + calendarDate(last);
    }

    private String calendarDate(Calendar calendar) {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(calendar.getTime());
    }

    private Calendar parseCalendarDate(String value) {
        if (value == null || !value.matches("\\d{4}-\\d{2}-\\d{2}")) return null;
        try {
            String[] parts = value.split("-");
            Calendar calendar = Calendar.getInstance();
            calendar.clear();
            calendar.setLenient(false);
            calendar.set(Integer.parseInt(parts[0]), Integer.parseInt(parts[1]) - 1,
                    Integer.parseInt(parts[2]));
            calendar.getTime();
            return calendar;
        } catch (IllegalArgumentException exception) {
            return null;
        }
    }

    private void addDashboardAttendance(LinearLayout card, JSONObject attendance,
                                        JSONObject roster) {
        String submittedAt = attendance == null ? "" : attendance.optString("attendance_submitted_at", "");
        boolean submitted = !submittedAt.isEmpty() && !"null".equals(submittedAt);
        if (submitted) {
            addAttendanceStatus(card, attendance);
            return;
        }
        Button attendanceAction = button("Submit attendance", BLUE);
        LinearLayout.LayoutParams actionParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(46));
        actionParams.topMargin = dp(8);
        card.addView(attendanceAction, actionParams);
        attendanceAction.setOnClickListener(v ->
                postAttendance(roster.optInt("roster_id"), attendanceAction));
    }

    private void addDutyDiaryAttendance(LinearLayout card, JSONObject attendance) {
        card.addView(text("ATTENDANCE RECORD", 9, MUTED, true));
        if (attendance == null) {
            card.addView(text("No attendance submission was found for this shift.", 12, MUTED, false));
            return;
        }
        addAttendanceStatus(card, attendance);
    }

    private void addAttendanceStatus(LinearLayout card, JSONObject attendance) {
        String submittedAt = attendance.optString("attendance_submitted_at", "");
        boolean submitted = !submittedAt.isEmpty() && !"null".equals(submittedAt);
        if (submitted) {
            card.addView(text("Submitted " + formatTime(submittedAt), 12, INK, true));
        }
        boolean confirmed = attendance.optBoolean("attendance_confirmed", false);
        if (confirmed) {
            String verifiedAt = attendance.optString("attendance_verified_at", "");
            if (!verifiedAt.isEmpty() && !"null".equals(verifiedAt)) {
                card.addView(text("Verified " + formatTime(verifiedAt), 12, MUTED, false));
            }
        }
        card.addView(statusBadge(
                confirmed ? "VERIFIED" : submitted ? "AWAITING VERIFICATION" : "NOT SUBMITTED",
                confirmed ? Color.rgb(35, 133, 103) : BLUE,
                confirmed ? Color.rgb(234, 246, 240) : Color.rgb(234, 243, 251)));
    }

    private String attendanceStatus(JSONObject attendance) {
        if (attendance == null) return "NOT SUBMITTED";
        String submittedAt = attendance.optString("attendance_submitted_at", "");
        if (submittedAt.isEmpty() || "null".equals(submittedAt)) return "NOT SUBMITTED";
        return attendance.optBoolean("attendance_confirmed", false)
                ? "VERIFIED" : "AWAITING VERIFICATION";
    }

    private int attendanceStatusColor(JSONObject attendance) {
        String status = attendanceStatus(attendance);
        return "VERIFIED".equals(status)
                ? Color.rgb(35, 133, 103) : Color.rgb(174, 117, 34);
    }

    private int attendanceStatusBackground(JSONObject attendance) {
        String status = attendanceStatus(attendance);
        return "VERIFIED".equals(status)
                ? Color.rgb(234, 246, 240) : Color.rgb(255, 246, 232);
    }

    private JSONObject findTodayRoster() {
        for (int i = 0; i < rosterData.length(); i++) {
            JSONObject item = rosterData.optJSONObject(i);
            if (item != null && isToday(item.optString("duty_date"))) return item;
        }
        return null;
    }

    private JSONObject findTodayAttendance(JSONObject roster) {
        if (roster == null) return null;
        int rosterId = roster.optInt("roster_id", -1);
        for (int i = 0; i < attendanceData.length(); i++) {
            JSONObject item = attendanceData.optJSONObject(i);
            if (item != null && item.optInt("roster_id", -2) == rosterId) return item;
        }
        return null;
    }

    private boolean isToday(String value) {
        return today().equals(value);
    }

    private String firstName(String name) {
        String trimmed = name == null ? "" : name.trim();
        if (trimmed.isEmpty()) return "there";
        int separator = trimmed.indexOf(' ');
        return separator < 0 ? trimmed : trimmed.substring(0, separator);
    }

    private void selectTab(String tab) {
        selectedTab = tab;
        renderWorkspace();
        refreshData();
    }

    private void showRosters() {
        content.removeAllViews();
        addPageHeading("MY DUTIES", "Published roster", "Your assigned shifts and duty details.");
        addProfileSummary();
        if (rosterData.length() == 0) {
            content.addView(cardMessage("No published roster assignments were found for your account."));
            return;
        }
        for (int i = 0; i < rosterData.length(); i++) {
            JSONObject item = rosterData.optJSONObject(i);
            if (item == null) continue;
            LinearLayout card = card();
            LinearLayout topRow = new LinearLayout(this);
            topRow.setGravity(Gravity.CENTER_VERTICAL);
            topRow.addView(text("SHIFT " + item.optString("shift_name").toUpperCase(Locale.ROOT),
                    10, BLUE, true), new LinearLayout.LayoutParams(0,
                    ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            topRow.addView(statusBadge("PUBLISHED", Color.rgb(35, 133, 103),
                    Color.rgb(234, 246, 240)));
            card.addView(topRow);
            TextView date = text(formatDate(item.optString("duty_date")), 20, INK, true);
            date.setPadding(0, dp(10), 0, dp(3));
            card.addView(date);
            card.addView(text(item.optString("start_time") + " – " + item.optString("end_time"),
                    13, MUTED, false));
            addDivider(card);
            card.addView(text("DUTY ASSIGNMENT", 9, MUTED, true));
            card.addView(text(item.optString("duty_category"), 15, INK, true));
            String task = item.optString("current_task", "");
            if (!task.isEmpty() && !"null".equals(task)) {
                card.addView(text("Current task", 10, MUTED, true));
                card.addView(text(task, 13, INK, false));
            }
            content.addView(card, cardParams());
        }
    }

    private void showAttendance() {
        content.removeAllViews();
        addPageHeading("ATTENDANCE", "Today’s attendance", "Submit attendance for today's assigned published duty. An officer will verify it.");
        if (attendanceData.length() == 0) {
            content.addView(cardMessage("There is no published shift assigned to you today."));
            return;
        }
        for (int i = 0; i < attendanceData.length(); i++) {
            JSONObject item = attendanceData.optJSONObject(i);
            if (item == null) continue;
            LinearLayout card = card();
            card.addView(text("SHIFT " + item.optString("shift_name").toUpperCase(Locale.ROOT),
                    10, BLUE, true));
            TextView category = text(item.optString("duty_category"), 17, INK, true);
            category.setPadding(0, dp(5), 0, dp(3));
            card.addView(category);
            card.addView(text(item.optString("start_time") + " – " + item.optString("end_time"),
                    13, MUTED, false));
            addDivider(card);
            String submittedAt = item.optString("attendance_submitted_at", "");
            boolean submitted = !submittedAt.isEmpty() && !"null".equals(submittedAt);
            if (submitted) {
                addAttendanceStatus(card, item);
            } else {
                Button mark = button("Submit attendance", BLUE);
                LinearLayout.LayoutParams markParams = fieldParams();
                markParams.topMargin = dp(12);
                card.addView(mark, markParams);
                mark.setOnClickListener(v -> postAttendance(item.optInt("roster_id"), mark));
            }
            content.addView(card, cardParams());
        }
    }

    private void addLeaveForm() {
        addPageHeading("TIME OFF", "Request leave or rest", "Submit a request for your station manager to review.");
        LinearLayout form = card();
        form.addView(text("REQUEST DETAILS", 10, BLUE, true));
        addFieldLabel(form, "Leave type");
        leaveKind = new Spinner(this);
        ArrayAdapter<String> kinds = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item,
                new String[]{"Casual", "Medical", "Rest day", "Duty off"});
        kinds.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        leaveKind.setAdapter(kinds);
        leaveKind.setPadding(dp(10), 0, dp(10), 0);
        leaveKind.setBackground(roundRect(SURFACE, LINE, 8));
        form.addView(leaveKind, fieldParams());
        addFieldLabel(form, "Start date");
        leaveStart = input("Start date (YYYY-MM-DD)", InputType.TYPE_CLASS_DATETIME | InputType.TYPE_DATETIME_VARIATION_DATE);
        leaveStart.setText(daysFromToday(1));
        form.addView(leaveStart, fieldParams());
        addFieldLabel(form, "End date");
        leaveEnd = input("End date (YYYY-MM-DD)", InputType.TYPE_CLASS_DATETIME | InputType.TYPE_DATETIME_VARIATION_DATE);
        leaveEnd.setText(daysFromToday(1));
        form.addView(leaveEnd, fieldParams());
        Button request = button("Submit request", BLUE);
        LinearLayout.LayoutParams params = fieldParams();
        params.topMargin = dp(6);
        form.addView(request, params);
        request.setOnClickListener(v -> postLeave(request));
        content.addView(form, cardParams());
        TextView historyTitle = text("My requests", 19, INK, true);
        historyTitle.setPadding(0, dp(12), 0, dp(2));
        content.addView(historyTitle);
        content.addView(text("Your submitted leave and rest requests.", 12, MUTED, false));
        leaveHistory = new LinearLayout(this);
        leaveHistory.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams historyParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        historyParams.topMargin = dp(10);
        content.addView(leaveHistory, historyParams);
    }

    private void showLeave() {
        if (!"Leave".equals(selectedTab) || leaveHistory == null) return;
        leaveHistory.removeAllViews();
        if (leaveData.length() == 0) {
            leaveHistory.addView(cardMessage("You have no leave requests yet."));
            return;
        }
        for (int i = 0; i < leaveData.length(); i++) {
            JSONObject item = leaveData.optJSONObject(i);
            if (item == null) continue;
            LinearLayout card = card();
            card.addView(text(item.optString("kind"), 15, INK, true));
            card.addView(text(formatDate(item.optString("start")) + " – " + formatDate(item.optString("end")), 13, MUTED, false));
            String status = item.optString("status");
            int statusColor = "Approved".equalsIgnoreCase(status)
                    ? Color.rgb(35, 133, 103)
                    : "Rejected".equalsIgnoreCase(status) ? Color.rgb(175, 75, 68) : BLUE;
            int statusFill = "Approved".equalsIgnoreCase(status)
                    ? Color.rgb(234, 246, 240)
                    : "Rejected".equalsIgnoreCase(status) ? Color.rgb(255, 240, 239)
                    : Color.rgb(234, 243, 251);
            card.addView(statusBadge(status.toUpperCase(Locale.ROOT), statusColor, statusFill));
            leaveHistory.addView(card, cardParams());
        }
    }

    private void postAttendance(int rosterId, Button button) {
        button.setEnabled(false);
        executor.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("roster_id", rosterId);
                request("/mobile/attendance", "POST", body, false);
                mainHandler.post(() -> {
                    toast("Attendance submitted for officer verification");
                    refreshData();
                });
            } catch (Exception exception) {
                String message = exception.getMessage() == null ? "Unable to record attendance." : exception.getMessage();
                mainHandler.post(() -> {
                    button.setEnabled(true);
                    toast(message);
                });
            }
        });
    }

    private void postLeave(Button button) {
        String start = leaveStart.getText().toString().trim();
        String end = leaveEnd.getText().toString().trim();
        if (!validDate(start) || !validDate(end)) {
            toast("Enter dates in YYYY-MM-DD format.");
            return;
        }
        button.setEnabled(false);
        executor.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("start", start);
                body.put("end", end);
                body.put("kind", leaveKind.getSelectedItem().toString());
                request("/mobile/leave", "POST", body, false);
                mainHandler.post(() -> {
                    toast("Leave request submitted for approval");
                    renderWorkspace();
                    refreshData();
                });
            } catch (Exception exception) {
                String message = exception.getMessage() == null ? "Unable to submit leave request." : exception.getMessage();
                mainHandler.post(() -> {
                    button.setEnabled(true);
                    toast(message);
                });
            }
        });
    }

    private void addProfileSummary() {
        LinearLayout card = card();
        card.setBackground(roundRect(Color.rgb(237, 245, 252), Color.rgb(216, 231, 243), 10));
        card.addView(text("MY STAFF PROFILE", 9, BLUE, true));
        card.addView(text(profile.optString("name", "Staff member"), 15, INK, true));
        card.addView(text(profile.optString("designation", "Staff") + "  ·  "
                + profile.optString("service_number"), 12, MUTED, false));
        String sector = profile.isNull("sector") ? "Station-wide" : "Sector " + profile.optString("sector");
        card.addView(text(sector, 11, MUTED, false));
        content.addView(card, cardParams());
    }

    private void addPageHeading(String eyebrow, String title, String subtitle) {
        TextView section = text(eyebrow, 9, BLUE, true);
        section.setLetterSpacing(0.08f);
        content.addView(section);
        TextView heading = text(title, 23, INK, true);
        heading.setPadding(0, dp(3), 0, dp(1));
        content.addView(heading);
        TextView description = text(subtitle, 12, MUTED, false);
        description.setPadding(0, 0, 0, dp(15));
        content.addView(description);
    }

    private void addFieldLabel(LinearLayout parent, String label) {
        TextView view = text(label, 11, INK, true);
        view.setPadding(dp(2), dp(3), dp(2), dp(2));
        parent.addView(view);
    }

    private TextView statusBadge(String label, int foreground, int background) {
        TextView badge = text(label, 9, foreground, true);
        badge.setGravity(Gravity.CENTER);
        badge.setPadding(dp(9), dp(5), dp(9), dp(5));
        badge.setBackground(roundRect(background, background, 20));
        return badge;
    }

    private void addDivider(LinearLayout parent) {
        View divider = new View(this);
        divider.setBackgroundColor(LINE);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(1));
        params.setMargins(0, dp(10), 0, dp(10));
        parent.addView(divider, params);
    }

    private void addLoading() {
        content.removeAllViews();
        content.addView(text("Loading…", 14, MUTED, false));
    }

    private void showError(String message) {
        content.removeAllViews();
        content.addView(text("Unable to load data", 20, INK, true));
        content.addView(cardMessage(message));
        Button retry = button("Try again", BLUE);
        content.addView(retry, fieldParams());
        retry.setOnClickListener(v -> refreshData());
    }

    private JSONArray requestArray(String path) throws Exception {
        String body = requestText(path, "GET", null, false);
        return new JSONArray(body);
    }

    private JSONObject request(String path, String method, JSONObject body, boolean form) throws Exception {
        String response = requestText(path, method, body, form);
        return response.isEmpty() ? new JSONObject() : new JSONObject(response);
    }

    private String connectionFailureMessage(String base) {
        try {
            String host = new URL(base).getHost().toLowerCase(Locale.ROOT);
            boolean localAddress = host.equals("localhost")
                    || host.equals("127.0.0.1")
                    || host.equals("10.0.2.2")
                    || host.startsWith("10.")
                    || host.startsWith("192.168.")
                    || host.startsWith("169.254.")
                    || host.matches("172\\.(1[6-9]|2[0-9]|3[01])\\..*")
                    || host.endsWith(".local");
            if (localAddress) {
                return "This is a private/local address and cannot be reached over 4G/5G. It works only on its Wi-Fi network or a connected private VPN. Ask IT for the department-hosted HTTPS API address.";
            }
        } catch (MalformedURLException exception) {
            return "The API address is invalid. Enter the complete API URL provided by your IT administrator.";
        }
        return "Cannot reach " + base + ". Check the internet connection, confirm this is the approved HTTPS API URL, and ask IT to verify the API service is running.";
    }

    private String apiUrl(String path) {
        String base = apiBase.replaceAll("/+$", "");
        String apiPrefix = base.endsWith("/api") ? "" : "/api";
        String route = path.startsWith("/") ? path : "/" + path;
        return base + apiPrefix + route;
    }

    private String requestText(String path, String method, JSONObject body, boolean form) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(apiUrl(path)).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(12000);
        connection.setReadTimeout(12000);
        connection.setRequestProperty("Accept", "application/json");
        if (token != null) connection.setRequestProperty("Authorization", "Bearer " + token);
        if (body != null) {
            connection.setDoOutput(true);
            if (form) {
                connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
                String encoded = "username=" + URLEncoder.encode(body.getString("username"), "UTF-8")
                        + "&password=" + URLEncoder.encode(body.getString("password"), "UTF-8");
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(encoded.getBytes(StandardCharsets.UTF_8));
                }
            } else {
                connection.setRequestProperty("Content-Type", "application/json");
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(body.toString().getBytes(StandardCharsets.UTF_8));
                }
            }
        }
        int status = connection.getResponseCode();
        InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        if (stream != null) {
            try (InputStream input = stream) {
                byte[] buffer = new byte[4096];
                int count;
                while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count);
            }
        }
        connection.disconnect();
        String result = bytes.toString(StandardCharsets.UTF_8.name());
        if (status < 200 || status >= 300) {
            try {
                String detail = new JSONObject(result).optString("detail");
                if (!detail.isEmpty()) throw new IllegalStateException(detail);
            } catch (JSONException ignored) {
                if (result.trim().isEmpty()) throw new IllegalStateException("The API returned HTTP " + status + ".");
            }
            throw new IllegalStateException("Request failed (HTTP " + status + ").");
        }
        return result;
    }

    private LinearLayout card() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(dp(16), dp(14), dp(16), dp(14));
        layout.setBackground(roundRect(SURFACE, LINE, 12));
        return layout;
    }

    private View cardMessage(String message) {
        LinearLayout card = card();
        card.addView(text(message, 14, MUTED, false));
        return card;
    }

    private TextView text(String value, int size, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        view.setPadding(0, dp(4), 0, dp(4));
        return view;
    }

    private EditText input(String hint, int inputType) {
        EditText edit = new EditText(this);
        edit.setSingleLine(true);
        edit.setTextSize(14);
        edit.setTextColor(INK);
        edit.setHintTextColor(MUTED);
        edit.setHint(hint);
        edit.setInputType(inputType);
        edit.setPadding(dp(12), 0, dp(12), 0);
        edit.setBackground(roundRect(SURFACE, LINE, 8));
        return edit;
    }

    private void styleLoginInput(EditText edit) {
        edit.setTextColor(Color.rgb(245, 248, 252));
        edit.setHintTextColor(0xffc0c9d5);
        edit.setBackground(roundRect(0x1cffffff, 0x66b1c2d2, 9));
    }

    private Button button(String label, int color) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(Color.WHITE);
        button.setTextSize(14);
        button.setAllCaps(false);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        button.setBackground(roundRect(color, color, 8));
        return button;
    }

    private Button smallButton(String label, int background, int foreground) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(foreground);
        button.setTextSize(12);
        button.setAllCaps(false);
        button.setMinHeight(dp(38));
        button.setPadding(dp(8), 0, dp(8), 0);
        button.setBackground(roundRect(background, background, 8));
        return button;
    }

    private GradientDrawable roundRect(int fill, int stroke, int radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(dp(radius));
        if (fill != stroke) drawable.setStroke(dp(1), stroke);
        return drawable;
    }

    private LinearLayout.LayoutParams fieldParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(48));
        params.bottomMargin = dp(10);
        return params;
    }

    private LinearLayout.LayoutParams cardParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.bottomMargin = dp(12);
        return params;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private String today() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    private String daysFromToday(int days) {
        Calendar calendar = Calendar.getInstance();
        calendar.add(Calendar.DAY_OF_YEAR, days);
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(calendar.getTime());
    }

    private String formatDate(String value) {
        if (value == null || value.length() < 10) return value == null ? "" : value;
        return value.substring(8, 10) + "/" + value.substring(5, 7) + "/" + value.substring(0, 4);
    }

    private String formatTime(String value) {
        if (value == null || value.length() < 16) return value == null ? "" : value;
        return value.substring(11, 16);
    }

    private boolean validDate(String value) {
        if (value.length() != 10) return false;
        try {
            SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
            format.setLenient(false);
            format.parse(value);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }
}
