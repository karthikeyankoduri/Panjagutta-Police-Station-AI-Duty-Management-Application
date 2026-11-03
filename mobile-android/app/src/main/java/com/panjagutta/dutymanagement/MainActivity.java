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
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final int NAVY = Color.rgb(15, 34, 56);
    private static final int BLUE = Color.rgb(26, 86, 219);
    private static final int GOLD = Color.rgb(201, 162, 39);
    private static final int INK = Color.rgb(30, 41, 59);
    private static final int MUTED = Color.rgb(100, 116, 139);
    private static final int SURFACE = Color.WHITE;
    private static final int BACKGROUND = Color.rgb(244, 246, 249);
    private static final int LINE = Color.rgb(226, 232, 240);
    private static final int GREEN = Color.rgb(22, 131, 78);
    private static final int GREEN_BG = Color.rgb(228, 245, 235);
    private static final int AMBER = Color.rgb(180, 110, 10);
    private static final int AMBER_BG = Color.rgb(255, 244, 222);
    private static final int RED = Color.rgb(192, 57, 43);
    private static final int RED_BG = Color.rgb(253, 236, 234);
    private static final int TINT = Color.rgb(233, 240, 254);
    private static final int TINT_LINE = Color.rgb(207, 221, 250);
    private static final String[] TAB_KEYS = {"Home", "Calendar", "Roster", "Attend", "Leave"};
    private static final String[] TAB_LABELS = {"Home", "Calendar", "Roster", "Attendance", "Requests"};
    private static final String NOTIFY_CHANNEL = "duty_updates";
    private static final long POLL_MS = 60_000L;
    private static final int[] TAB_ICONS = {R.drawable.ic_home, R.drawable.ic_calendar,
            R.drawable.ic_roster, R.drawable.ic_attendance, R.drawable.ic_leave};
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
    private SwipeRefreshLayout swipeRefresh;
    private JSONArray calendarData = new JSONArray();
    private final java.util.Set<String> loaded = new java.util.HashSet<>();
    private final LinearLayout[] navItems = new LinearLayout[TAB_KEYS.length];
    private android.animation.ObjectAnimator skeletonAnimator;
    private int insetTop;
    private int insetBottom;
    private TokenStore tokenStore;
    private JSONArray taskData = new JSONArray();
    private JSONArray movementData = new JSONArray();
    private JSONObject historyData;
    private JSONArray notificationData = new JSONArray();
    private int unreadCount;
    private TextView bellBadge;
    private String requestMode = "leave";
    private EditText movementPurpose;
    private EditText movementDestination;
    private EditText movementReturn;
    private long lastInteraction = System.currentTimeMillis();
    private long sessionTimeoutMs = 60 * 60_000L;
    private final Runnable pollNotifications = new Runnable() {
        @Override
        public void run() {
            fetchNotifications(true);
            mainHandler.postDelayed(this, POLL_MS);
        }
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(NAVY);
        getWindow().setNavigationBarColor(SURFACE);
        selectedCalendarDate = today();
        visibleMonth.set(Calendar.DAY_OF_MONTH, 1);
        String savedApiBase = getPreferences(MODE_PRIVATE).getString("api_base", DEFAULT_API_BASE);
        if (savedApiBase == null || savedApiBase.trim().isEmpty()) {
            apiBase = DEFAULT_API_BASE;
            getPreferences(MODE_PRIVATE).edit().putString("api_base", apiBase).apply();
        } else {
            apiBase = savedApiBase;
        }
        tokenStore = new TokenStore(getPreferences(MODE_PRIVATE));
        sessionTimeoutMs = getPreferences(MODE_PRIVATE).getLong("session_timeout_ms", sessionTimeoutMs);
        createNotificationChannel();
        token = savedInstanceState == null ? null : savedInstanceState.getString("token");
        if (token == null) token = tokenStore.load();
        if (token == null) {
            showLogin();
        } else {
            showSplash();
            fetchProfile();
        }
    }

    /** Branded loading screen shown while a saved session is restored. */
    private void showSplash() {
        LinearLayout splash = new LinearLayout(this);
        splash.setOrientation(LinearLayout.VERTICAL);
        splash.setGravity(Gravity.CENTER);
        splash.setBackgroundColor(NAVY);
        ImageView crest = new ImageView(this);
        crest.setImageResource(R.drawable.login_police_crest);
        splash.addView(crest, new LinearLayout.LayoutParams(dp(96), dp(108)));
        TextView title = text("HYDERABAD CITY POLICE", 14, GOLD, true);
        title.setLetterSpacing(0.12f);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, dp(14), 0, dp(2));
        splash.addView(title);
        TextView sub = text("Panjagutta Police Station", 12, Color.WHITE, false);
        sub.setGravity(Gravity.CENTER);
        splash.addView(sub);
        android.widget.ProgressBar progress = new android.widget.ProgressBar(this);
        progress.setIndeterminateTintList(android.content.res.ColorStateList.valueOf(GOLD));
        LinearLayout.LayoutParams pp = new LinearLayout.LayoutParams(dp(28), dp(28));
        pp.topMargin = dp(24);
        splash.addView(progress, pp);
        setContentView(splash);
        applyInsets(splash, null);
    }

    /** Pads the root so content clears the status and navigation bars (edge-to-edge on Android 15+). */
    private void applyInsets(View root, Runnable onChange) {
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            insetTop = insets.getSystemWindowInsetTop();
            insetBottom = insets.getSystemWindowInsetBottom();
            if (onChange != null) onChange.run();
            else v.setPadding(0, insetTop, 0, insetBottom);
            return insets;
        });
        root.requestApplyInsets();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (token != null) outState.putString("token", token);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onDestroy() {
        mainHandler.removeCallbacks(pollNotifications);
        executor.shutdownNow();
        super.onDestroy();
    }

    @Override
    public void onUserInteraction() {
        super.onUserInteraction();
        lastInteraction = System.currentTimeMillis();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (token != null && profile != null
                && System.currentTimeMillis() - lastInteraction > sessionTimeoutMs) {
            signOut("You were signed out after a period of inactivity.");
            return;
        }
        lastInteraction = System.currentTimeMillis();
        if (token != null && profile != null) startPolling();
    }

    @Override
    protected void onPause() {
        mainHandler.removeCallbacks(pollNotifications);
        super.onPause();
    }

    private void startPolling() {
        mainHandler.removeCallbacks(pollNotifications);
        mainHandler.post(pollNotifications);
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
            if (!BuildConfig.DEBUG && !base.regionMatches(true, 0, "https://", 0, 8)) {
                connectionStatus.setTextColor(Color.rgb(255, 190, 186));
                connectionStatus.setText("This app only connects over HTTPS. Enter the https:// address provided by IT.");
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
        applyInsets(page, null);

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
            if (!BuildConfig.DEBUG && !base.regionMatches(true, 0, "https://", 0, 8)) {
                error.setVisibility(View.VISIBLE);
                error.setText("This app only connects over HTTPS. Ask IT for the https:// API address.");
                connectionSettings.setVisibility(View.VISIBLE);
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
                    sessionTimeoutMs = Math.max(5, auth.optInt("session_timeout_minutes", 60)) * 60_000L;
                    getPreferences(MODE_PRIVATE).edit().putLong("session_timeout_ms", sessionTimeoutMs).apply();
                    tokenStore.save(accessToken);
                    final String typedPassword = password;
                    if (auth.optBoolean("must_change_password", false)) {
                        mainHandler.post(() -> showChangePassword(typedPassword, true));
                        return;
                    }
                    JSONObject staffProfile = request("/mobile/me", "GET", null, false);
                    profile = staffProfile;
                    mainHandler.post(this::enterWorkspace);
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
                JSONObject me = request("/mobile/me", "GET", null, false);
                if (me.optBoolean("must_change_password", false)) {
                    mainHandler.post(() -> showChangePassword("", true));
                    return;
                }
                profile = me;
                mainHandler.post(this::enterWorkspace);
            } catch (Exception exception) {
                // Only discard the saved session when the server rejected it, not on network failure.
                if (exception instanceof IllegalStateException) {
                    tokenStore.clear();
                }
                token = null;
                mainHandler.post(this::showLogin);
            }
        });
    }

    private void renderWorkspace() {
        page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(BACKGROUND);

        // ---- Branded header -------------------------------------------------
        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(16), dp(10), dp(14), dp(12));
        GradientDrawable headerBg = new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
                new int[]{Color.rgb(10, 24, 41), NAVY, Color.rgb(24, 52, 84)});
        header.setBackground(headerBg);
        ImageView crest = new ImageView(this);
        crest.setImageResource(R.drawable.login_police_crest);
        crest.setScaleType(ImageView.ScaleType.FIT_CENTER);
        crest.setContentDescription("Hyderabad City Police crest");
        LinearLayout.LayoutParams crestParams = new LinearLayout.LayoutParams(dp(36), dp(42));
        crestParams.setMarginEnd(dp(12));
        header.addView(crest, crestParams);
        LinearLayout identity = new LinearLayout(this);
        identity.setOrientation(LinearLayout.VERTICAL);
        identity.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        TextView org = text("HYDERABAD CITY POLICE", 9, GOLD, true);
        org.setLetterSpacing(0.14f);
        org.setPadding(0, 0, 0, 0);
        identity.addView(org);
        TextView station = text("Panjagutta Police Station", 15, Color.WHITE, true);
        station.setPadding(0, dp(1), 0, 0);
        identity.addView(station);
        header.addView(identity);
        String displayName = profile.optString("name", "Staff member").trim();
        if (displayName.isEmpty()) displayName = "Staff member";
        TextView avatar = text(displayName.substring(0, 1).toUpperCase(Locale.ROOT), 16, Color.WHITE, true);
        avatar.setGravity(Gravity.CENTER);
        avatar.setPadding(0, 0, 0, 0);
        GradientDrawable avatarBg = roundRect(0x33ffffff, GOLD, 22);
        avatarBg.setStroke(dp(2), GOLD);
        avatar.setBackground(avatarBg);
        avatar.setContentDescription("My profile");
        avatar.setOnClickListener(v -> selectTab("Profile"));

        android.widget.FrameLayout bell = new android.widget.FrameLayout(this);
        ImageView bellIcon = new ImageView(this);
        bellIcon.setImageResource(R.drawable.ic_bell);
        bellIcon.setColorFilter(Color.WHITE);
        bellIcon.setPadding(dp(9), dp(9), dp(9), dp(9));
        bell.addView(bellIcon, new android.widget.FrameLayout.LayoutParams(dp(42), dp(42)));
        bellBadge = text("", 8, Color.WHITE, true);
        bellBadge.setPadding(dp(5), 0, dp(5), 0);
        bellBadge.setBackground(roundRect(RED, RED, 10));
        bellBadge.setVisibility(View.GONE);
        android.widget.FrameLayout.LayoutParams badgeParams = new android.widget.FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.END);
        bell.addView(bellBadge, badgeParams);
        bell.setContentDescription("Notifications");
        bell.setClickable(true);
        bell.setOnClickListener(v -> selectTab("Alerts"));
        LinearLayout.LayoutParams bellParams = new LinearLayout.LayoutParams(dp(42), dp(42));
        bellParams.setMarginEnd(dp(6));
        header.addView(bell, bellParams);
        updateBell();
        header.addView(avatar, new LinearLayout.LayoutParams(dp(42), dp(42)));
        page.addView(header);
        View goldLine = new View(this);
        goldLine.setBackgroundColor(GOLD);
        page.addView(goldLine, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(2)));

        // ---- Scrolling content ----------------------------------------------
        swipeRefresh = new SwipeRefreshLayout(this);
        swipeRefresh.setColorSchemeColors(BLUE, GOLD);
        swipeRefresh.setOnRefreshListener(this::refreshData);
        ScrollView scroll = new ScrollView(this);
        scroll.setClipToPadding(false);
        scroll.setOverScrollMode(View.OVER_SCROLL_NEVER);
        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(16), dp(20), dp(16), dp(24));
        scroll.addView(content);
        swipeRefresh.addView(scroll);
        page.addView(swipeRefresh, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        // ---- Bottom navigation ----------------------------------------------
        LinearLayout nav = new LinearLayout(this);
        nav.setBackgroundColor(SURFACE);
        nav.setElevation(dp(8));
        nav.setPadding(dp(4), dp(6), dp(4), dp(6));
        for (int i = 0; i < TAB_KEYS.length; i++) {
            final String key = TAB_KEYS[i];
            LinearLayout item = new LinearLayout(this);
            item.setOrientation(LinearLayout.VERTICAL);
            item.setGravity(Gravity.CENTER_HORIZONTAL);
            item.setPadding(0, dp(4), 0, dp(4));
            ImageView icon = new ImageView(this);
            icon.setImageResource(TAB_ICONS[i]);
            icon.setPadding(dp(18), dp(4), dp(18), dp(4));
            item.addView(icon, new LinearLayout.LayoutParams(dp(64), dp(32)));
            TextView label = new TextView(this);
            label.setText(TAB_LABELS[i]);
            label.setTextSize(11);
            label.setGravity(Gravity.CENTER);
            label.setSingleLine(true);
            item.addView(label);
            item.setContentDescription(TAB_LABELS[i]);
            item.setClickable(true);
            item.setBackground(rippleOf(Color.TRANSPARENT, 12));
            item.setOnClickListener(v -> { if (!key.equals(selectedTab)) selectTab(key); });
            nav.addView(item, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            navItems[i] = item;
        }
        page.addView(nav);
        setContentView(page);
        applyInsets(page, () -> {
            page.setPadding(0, insetTop, 0, 0);
            nav.setPadding(dp(4), dp(6), dp(4), dp(6) + insetBottom);
        });
        updateNav();
    }

    /** Highlights the active bottom-nav item; Profile (opened from the avatar) highlights none. */
    private void updateNav() {
        for (int i = 0; i < TAB_KEYS.length; i++) {
            if (navItems[i] == null) continue;
            boolean selected = TAB_KEYS[i].equals(selectedTab);
            ImageView icon = (ImageView) navItems[i].getChildAt(0);
            TextView label = (TextView) navItems[i].getChildAt(1);
            icon.setColorFilter(selected ? BLUE : MUTED);
            icon.setBackground(selected ? roundRect(TINT, TINT, 16) : null);
            label.setTextColor(selected ? BLUE : MUTED);
            label.setTypeface(Typeface.DEFAULT, selected ? Typeface.BOLD : Typeface.NORMAL);
        }
    }

    private void stopRefreshing() {
        if (swipeRefresh != null) swipeRefresh.setRefreshing(false);
    }

    private void fadeIn() {
        content.setAlpha(0f);
        content.animate().alpha(1f).setDuration(180).start();
    }

    /** Draws the screen for a tab from data that is already in memory. */
    private void renderTab(String tab) {
        if (content == null) return;
        stopSkeleton();
        switch (tab) {
            case "Home": showDashboard(); break;
            case "Calendar": showCalendar(); break;
            case "Roster": showRosters(); break;
            case "Attend": showAttendance(); break;
            case "Leave":
                content.removeAllViews();
                addLeaveForm();
                showLeave();
                break;
            case "Alerts": showNotifications(); break;
            default: showProfile(); break;
        }
    }

    private void selectTab(String tab) {
        selectedTab = tab;
        updateNav();
        boolean cached = "Profile".equals(tab) || loaded.contains(tab);
        if (cached) renderTab(tab);
        fadeIn();
        if (!"Profile".equals(tab)) refreshData();
    }

    private void refreshData() {
        if (token == null) return;
        final String tab = selectedTab;
        if ("Profile".equals(tab)) {
            stopRefreshing();
            renderTab(tab);
            return;
        }
        final boolean cached = loaded.contains(tab);
        if (!cached) addSkeleton();
        executor.execute(() -> {
            try {
                final Object[] result = new Object[4];
                switch (tab) {
                    case "Home":
                        result[0] = requestArray("/mobile/rosters");
                        result[1] = requestArray("/mobile/attendance?attendance_date=" + today());
                        result[2] = requestArray("/mobile/leave");
                        result[3] = requestArray("/mobile/tasks");
                        break;
                    case "Calendar":
                        result[0] = requestArray(calendarDiaryPath());
                        break;
                    case "Roster":
                        result[0] = requestArray("/mobile/rosters");
                        break;
                    case "Attend":
                        result[0] = requestArray("/mobile/attendance?attendance_date=" + today());
                        result[1] = request("/mobile/attendance/history", "GET", null, false);
                        break;
                    case "Alerts":
                        result[0] = request("/notifications/?limit=50", "GET", null, false);
                        break;
                    default:
                        result[0] = requestArray("/mobile/leave");
                        result[1] = requestArray("/mobile/movements");
                        break;
                }
                mainHandler.post(() -> {
                    stopRefreshing();
                    switch (tab) {
                        case "Home":
                            rosterData = (JSONArray) result[0];
                            attendanceData = (JSONArray) result[1];
                            leaveData = (JSONArray) result[2];
                            taskData = (JSONArray) result[3];
                            break;
                        case "Calendar": calendarData = (JSONArray) result[0]; break;
                        case "Roster": rosterData = (JSONArray) result[0]; break;
                        case "Attend":
                            attendanceData = (JSONArray) result[0];
                            historyData = (JSONObject) result[1];
                            break;
                        case "Alerts": applyNotifications((JSONObject) result[0], false); break;
                        default:
                            leaveData = (JSONArray) result[0];
                            movementData = (JSONArray) result[1];
                            break;
                    }
                    loaded.add(tab);
                    if (!tab.equals(selectedTab)) return;
                    if ("Leave".equals(tab) && leaveHistory != null && leaveHistory.getParent() == content) {
                        showLeave(); // keep what the user is typing in the form
                    } else {
                        renderTab(tab);
                        if (!cached) fadeIn();
                    }
                });
            } catch (Exception exception) {
                String message = exception.getMessage() == null
                        ? "Unable to load your records." : exception.getMessage();
                mainHandler.post(() -> {
                    stopRefreshing();
                    if (!tab.equals(selectedTab) || token == null) return;
                    if (cached) toast(message);
                    else showError(message);
                });
            }
        });
    }

    private void showDashboard() {
        content.removeAllViews();
        LinearLayout hero = new LinearLayout(this);
        hero.setOrientation(LinearLayout.VERTICAL);
        hero.setPadding(dp(20), dp(18), dp(20), dp(18));
        GradientDrawable heroBg = new GradientDrawable(GradientDrawable.Orientation.TL_BR,
                new int[]{NAVY, Color.rgb(28, 62, 108)});
        heroBg.setCornerRadius(dp(20));
        hero.setBackground(heroBg);
        hero.setElevation(dp(4));
        TextView greet = text(greeting() + ",", 13, Color.rgb(176, 196, 222), false);
        greet.setPadding(0, 0, 0, 0);
        hero.addView(greet);
        TextView heroName = text(profile.optString("name", "Staff"), 22, Color.WHITE, true);
        heroName.setPadding(0, dp(2), 0, dp(8));
        hero.addView(heroName);
        String sector = profile.isNull("sector") ? "Station-wide" : profile.optString("sector");
        TextView heroMeta = text(profile.optString("designation", "STAFF") + "  ·  "
                + profile.optString("service_number") + "  ·  " + sector, 12, GOLD, true);
        heroMeta.setPadding(0, 0, 0, dp(2));
        hero.addView(heroMeta);
        TextView heroDate = text(new SimpleDateFormat("EEEE, d MMMM yyyy", Locale.getDefault())
                .format(new Date()), 12, Color.rgb(176, 196, 222), false);
        heroDate.setPadding(0, 0, 0, 0);
        hero.addView(heroDate);
        content.addView(hero, cardParams());

        JSONObject todayRoster = findTodayRoster();
        JSONObject todayAttendance = findTodayAttendance(todayRoster);
        LinearLayout todayCard = card(todayRoster == null ? MUTED
                : "VERIFIED".equals(attendanceStatus(todayAttendance)) ? GREEN
                : "NOT SUBMITTED".equals(attendanceStatus(todayAttendance)) ? BLUE : AMBER);
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

        sectionHeader("UPCOMING SHIFTS", "View calendar", () -> selectTab("Calendar"));
        int upcomingCount = 0;
        for (int i = 0; i < rosterData.length() && upcomingCount < 3; i++) {
            JSONObject item = rosterData.optJSONObject(i);
            if (item == null || isToday(item.optString("duty_date"))) continue;
            LinearLayout upcoming = card(BLUE);
            LinearLayout row = new LinearLayout(this);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.addView(text(formatDate(item.optString("duty_date")), 14, INK, true),
                    new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            row.addView(statusBadge("SHIFT " + item.optString("shift_name"),
                    BLUE, TINT));
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

        addTasksSection();

        sectionHeader("LEAVE REQUESTS", "View requests", () -> selectTab("Leave"));
        if (leaveData.length() == 0) {
            LinearLayout emptyLeave = card();
            emptyLeave.addView(text("You have no leave requests yet.", 12, MUTED, false));
            content.addView(emptyLeave, cardParams());
        } else {
            JSONObject latestLeave = leaveData.optJSONObject(0);
            if (latestLeave != null) {
                String status = latestLeave.optString("status");
                LinearLayout leaveCard = card(leaveAccent(latestLeave.optString("status")));
                LinearLayout row = new LinearLayout(this);
                row.setGravity(Gravity.CENTER_VERTICAL);
                row.addView(text(latestLeave.optString("kind"), 14, INK, true),
                        new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
                int statusColor = "Approved".equalsIgnoreCase(status)
                        ? GREEN
                        : "Rejected".equalsIgnoreCase(status)
                                ? RED : BLUE;
                int statusBackground = "Approved".equalsIgnoreCase(status)
                        ? GREEN_BG
                        : "Rejected".equalsIgnoreCase(status)
                                ? RED_BG : TINT;
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
        identityCard.setBackground(roundRect(TINT, TINT_LINE, 10));
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
                ? "Station-wide" : profile.optString("sector");
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

        Button changePw = button("Change password", BLUE);
        LinearLayout.LayoutParams changeParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48));
        changeParams.bottomMargin = dp(10);
        content.addView(changePw, changeParams);
        changePw.setOnClickListener(v -> showChangePassword("", false));

        Button logout = button("Sign out", Color.rgb(172, 65, 65));
        LinearLayout.LayoutParams logoutParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(48));
        logoutParams.topMargin = dp(4);
        content.addView(logout, logoutParams);
        logout.setOnClickListener(v -> confirmSignOut());
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

    private void confirmSignOut() {
        new android.app.AlertDialog.Builder(this)
                .setTitle("Sign out?")
                .setMessage("You will need to sign in again to view your duties.")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Sign out", (d, w) -> signOut())
                .show();
    }

    private void signOut() {
        signOut(null);
    }

    /** Ends the session on the server (token invalidated) and locally; `notice` explains why. */
    private void signOut(String notice) {
        final String oldToken = token;
        if (oldToken != null) {
            executor.execute(() -> logoutOnServer(oldToken));
        }
        mainHandler.removeCallbacks(pollNotifications);
        tokenStore.clear();
        loaded.clear();
        taskData = new JSONArray();
        movementData = new JSONArray();
        notificationData = new JSONArray();
        historyData = null;
        unreadCount = 0;
        calendarData = new JSONArray();
        selectedTab = "Home";
        token = null;
        profile = null;
        rosterData = new JSONArray();
        attendanceData = new JSONArray();
        leaveData = new JSONArray();
        showLogin();
        if (notice != null) toast(notice);
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
            loaded.remove("Calendar");
            refreshData();
        });
        nextMonth.setOnClickListener(v -> {
            visibleMonth.set(Calendar.DAY_OF_MONTH, 1);
            visibleMonth.add(Calendar.MONTH, 1);
            selectedCalendarDate = calendarDate(visibleMonth);
            loaded.remove("Calendar");
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
                        : hasDuty ? GREEN_BG : Color.WHITE;
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
                        selected ? Color.WHITE : GREEN,
                        selected ? Color.WHITE : GREEN, dotSize));
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
        legendDot.setBackground(roundRect(GREEN,
                GREEN, dotSize));
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
            selectedHeading.addView(statusBadge("TODAY", BLUE, TINT));
        }
        content.addView(selectedHeading);

        int selectedDutyCount = 0;
        for (int i = 0; i < calendarData.length(); i++) {
            JSONObject item = calendarData.optJSONObject(i);
            if (item == null || !selectedCalendarDate.equals(item.optString("duty_date"))) continue;
            LinearLayout dutyCard = card(GREEN);
            LinearLayout topRow = new LinearLayout(this);
            topRow.setGravity(Gravity.CENTER_VERTICAL);
            topRow.addView(text("SHIFT " + item.optString("shift_name").toUpperCase(Locale.ROOT),
                            10, BLUE, true),
                    new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            topRow.addView(statusBadge("PUBLISHED", GREEN,
                    GREEN_BG));
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
            JSONObject attendance = findAttendance(calendarData, item);
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
        for (int i = 0; i < calendarData.length(); i++) {
            JSONObject item = calendarData.optJSONObject(i);
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
                confirmed ? GREEN : BLUE,
                confirmed ? GREEN_BG : TINT));
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
                ? GREEN : AMBER;
    }

    private int attendanceStatusBackground(JSONObject attendance) {
        String status = attendanceStatus(attendance);
        return "VERIFIED".equals(status)
                ? GREEN_BG : AMBER_BG;
    }

    private JSONObject findTodayRoster() {
        for (int i = 0; i < rosterData.length(); i++) {
            JSONObject item = rosterData.optJSONObject(i);
            if (item != null && isToday(item.optString("duty_date"))) return item;
        }
        return null;
    }

    private JSONObject findTodayAttendance(JSONObject roster) {
        return findAttendance(attendanceData, roster);
    }

    private JSONObject findAttendance(JSONArray source, JSONObject roster) {
        if (roster == null) return null;
        int rosterId = roster.optInt("roster_id", -1);
        for (int i = 0; i < source.length(); i++) {
            JSONObject item = source.optJSONObject(i);
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
            LinearLayout card = card(GREEN);
            LinearLayout topRow = new LinearLayout(this);
            topRow.setGravity(Gravity.CENTER_VERTICAL);
            topRow.addView(text("SHIFT " + item.optString("shift_name").toUpperCase(Locale.ROOT),
                    10, BLUE, true), new LinearLayout.LayoutParams(0,
                    ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            topRow.addView(statusBadge("PUBLISHED", GREEN,
                    GREEN_BG));
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
            addAttendanceHistory();
            return;
        }
        for (int i = 0; i < attendanceData.length(); i++) {
            JSONObject item = attendanceData.optJSONObject(i);
            if (item == null) continue;
            LinearLayout card = card(BLUE);
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
        addAttendanceHistory();
    }

    private void addLeaveForm() {
        addPageHeading("REQUESTS", "Leave and outside movement",
                "Requests go to the SHO / Admin SI (leave) or your authorizing officer (movement). You are notified of every decision.");
        LinearLayout toggle = new LinearLayout(this);
        toggle.setPadding(0, 0, 0, dp(12));
        for (String mode : new String[]{"leave", "movement"}) {
            boolean on = mode.equals(requestMode);
            Button b = smallButton("leave".equals(mode) ? "Leave / rest" : "Outside movement", on ? BLUE : SURFACE, on ? Color.WHITE : BLUE);
            b.setBackground(roundRect(on ? BLUE : SURFACE, on ? BLUE : LINE, 20));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, dp(42), 1);
            lp.setMarginEnd(dp(8));
            toggle.addView(b, lp);
            b.setOnClickListener(v -> {
                requestMode = mode;
                renderTab("Leave");
            });
        }
        content.addView(toggle);
        if ("movement".equals(requestMode)) {
            addMovementForm();
            return;
        }
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
        leaveStart = dateField(daysFromToday(1), null);
        form.addView(leaveStart, fieldParams());
        addFieldLabel(form, "End date");
        leaveEnd = dateField(daysFromToday(1), leaveStart);
        form.addView(leaveEnd, fieldParams());
        leaveStart.setOnClickListener(v -> pickDate(leaveStart, null, leaveEnd));
        Button request = button("Submit request", BLUE);
        LinearLayout.LayoutParams params = fieldParams();
        params.topMargin = dp(6);
        form.addView(request, params);
        request.setOnClickListener(v -> postLeave(request));
        content.addView(form, cardParams());
        TextView historyTitle = text("My leave requests", 19, INK, true);
        historyTitle.setPadding(0, dp(12), 0, dp(2));
        content.addView(historyTitle);
        content.addView(text("Pending requests and future approved leave can be cancelled.", 12, MUTED, false));
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
        if ("movement".equals(requestMode)) {
            showMovements();
            return;
        }
        if (leaveData.length() == 0) {
            leaveHistory.addView(cardMessage("You have no leave requests yet."));
            return;
        }
        for (int i = 0; i < leaveData.length(); i++) {
            JSONObject item = leaveData.optJSONObject(i);
            if (item == null) continue;
            LinearLayout card = card(leaveAccent(item.optString("status")));
            card.addView(text(item.optString("kind"), 15, INK, true));
            card.addView(text(formatDate(item.optString("start")) + " – " + formatDate(item.optString("end")), 13, MUTED, false));
            String status = item.optString("status");
            int statusColor = "Approved".equalsIgnoreCase(status)
                    ? GREEN
                    : "Rejected".equalsIgnoreCase(status) ? RED : BLUE;
            int statusFill = "Approved".equalsIgnoreCase(status)
                    ? GREEN_BG
                    : "Rejected".equalsIgnoreCase(status) ? RED_BG
                    : TINT;
            card.addView(statusBadge(status.toUpperCase(Locale.ROOT), statusColor, statusFill));
            String ref = item.optString("reference_number", "");
            if (!ref.isEmpty() && !"null".equals(ref)) card.addView(text("Ref " + ref, 11, MUTED, false));
            String remarks = item.optString("approver_remarks", "");
            if (!remarks.isEmpty() && !"null".equals(remarks)) card.addView(text("Remarks: " + remarks, 12, INK, false));
            if (item.optBoolean("can_cancel", false)) {
                Button cancel = smallButton("Cancel request", RED_BG, RED);
                card.addView(cancel);
                final int leaveId = item.optInt("id");
                cancel.setOnClickListener(v -> confirm("Cancel this leave request?", () ->
                        postSimple("/mobile/leave/" + leaveId + "/cancel", null, "Leave request cancelled", "Leave")));
            }
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
                    loaded.remove("Home");
                    loaded.remove("Attend");
                    loaded.remove("Calendar");
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

    /** Read-only field that opens a calendar picker instead of asking staff to type YYYY-MM-DD. */
    private EditText dateField(String initial, EditText minimumFrom) {
        EditText field = input("Select date", InputType.TYPE_NULL);
        field.setText(initial);
        field.setFocusable(false);
        field.setCursorVisible(false);
        field.setCompoundDrawablePadding(dp(8));
        android.graphics.drawable.Drawable icon = getDrawable(R.drawable.ic_calendar).mutate();
        icon.setTint(BLUE);
        field.setCompoundDrawablesRelativeWithIntrinsicBounds(null, null, icon, null);
        if (minimumFrom != null) field.setOnClickListener(v -> pickDate(field, minimumFrom, null));
        return field;
    }

    private void pickDate(EditText target, EditText minimumFrom, EditText pushForward) {
        Calendar current = parseCalendarDate(target.getText().toString());
        if (current == null) current = Calendar.getInstance();
        android.app.DatePickerDialog dialog = new android.app.DatePickerDialog(this,
                (view, year, month, day) -> {
                    Calendar picked = Calendar.getInstance();
                    picked.clear();
                    picked.set(year, month, day);
                    target.setText(calendarDate(picked));
                    if (pushForward != null) {
                        Calendar other = parseCalendarDate(pushForward.getText().toString());
                        if (other == null || other.before(picked)) pushForward.setText(calendarDate(picked));
                    }
                }, current.get(Calendar.YEAR), current.get(Calendar.MONTH), current.get(Calendar.DAY_OF_MONTH));
        Calendar min = minimumFrom == null ? null : parseCalendarDate(minimumFrom.getText().toString());
        if (min != null) dialog.getDatePicker().setMinDate(min.getTimeInMillis());
        dialog.show();
    }

    private void postLeave(Button button) {
        String start = leaveStart.getText().toString().trim();
        String end = leaveEnd.getText().toString().trim();
        if (!validDate(start) || !validDate(end)) {
            toast("Choose the start and end dates.");
            return;
        }
        if (end.compareTo(start) < 0) {
            toast("The end date cannot be before the start date.");
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
                    toast("Leave request submitted. You will be notified of the decision.");
                    loaded.remove("Home");
                    renderTab("Leave");
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
        card.setBackground(roundRect(TINT, TINT_LINE, 16));
        card.addView(text("MY STAFF PROFILE", 9, BLUE, true));
        card.addView(text(profile.optString("name", "Staff member"), 15, INK, true));
        card.addView(text(profile.optString("designation", "Staff") + "  ·  "
                + profile.optString("service_number"), 12, MUTED, false));
        String sector = profile.isNull("sector") ? "Station-wide" : profile.optString("sector");
        card.addView(text(sector, 11, MUTED, false));
        content.addView(card, cardParams());
    }

    private int leaveAccent(String status) {
        return "Approved".equalsIgnoreCase(status) ? GREEN
                : "Rejected".equalsIgnoreCase(status) ? RED : AMBER;
    }

    private String greeting() {
        int hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY);
        return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    }

    private void sectionHeader(String title, String actionLabel, Runnable action) {
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        TextView heading = text(title, 10, MUTED, true);
        heading.setLetterSpacing(0.1f);
        row.addView(heading, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        if (actionLabel != null) {
            TextView link = text(actionLabel + "  ›", 12, BLUE, true);
            link.setPadding(dp(8), dp(8), dp(2), dp(8));
            link.setOnClickListener(v -> action.run());
            row.addView(link);
        }
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = dp(2);
        content.addView(row, lp);
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

    /** Shimmering placeholder cards shown while a tab loads for the first time. */
    private void addSkeleton() {
        stopSkeleton();
        content.removeAllViews();
        LinearLayout skeleton = new LinearLayout(this);
        skeleton.setOrientation(LinearLayout.VERTICAL);
        int[] heights = {22, 14, 120, 90, 90};
        int[] widths = {180, 240, -1, -1, -1};
        for (int i = 0; i < heights.length; i++) {
            View block = new View(this);
            block.setBackground(roundRect(Color.rgb(226, 232, 240), Color.rgb(226, 232, 240), i < 2 ? 6 : 16));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    widths[i] < 0 ? ViewGroup.LayoutParams.MATCH_PARENT : dp(widths[i]), dp(heights[i]));
            lp.bottomMargin = dp(i < 2 ? 10 : 16);
            skeleton.addView(block, lp);
        }
        content.addView(skeleton);
        skeletonAnimator = android.animation.ObjectAnimator.ofFloat(skeleton, "alpha", 0.45f, 1f);
        skeletonAnimator.setDuration(750);
        skeletonAnimator.setRepeatMode(android.animation.ValueAnimator.REVERSE);
        skeletonAnimator.setRepeatCount(android.animation.ValueAnimator.INFINITE);
        skeletonAnimator.start();
    }

    private void stopSkeleton() {
        if (skeletonAnimator != null) {
            skeletonAnimator.cancel();
            skeletonAnimator = null;
        }
    }

    private void showError(String message) {
        stopSkeleton();
        content.removeAllViews();
        LinearLayout box = card(RED);
        box.addView(text("Unable to load data", 17, INK, true));
        box.addView(text(message, 13, MUTED, false));
        Button retry = button("Try again", BLUE);
        LinearLayout.LayoutParams rp = fieldParams();
        rp.topMargin = dp(10);
        box.addView(retry, rp);
        retry.setOnClickListener(v -> refreshData());
        content.addView(box, cardParams());
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
        String passwordChange = connection.getHeaderField("X-Password-Change-Required");
        connection.disconnect();
        String result = bytes.toString(StandardCharsets.UTF_8.name());
        if (status == 401 && token != null && !path.startsWith("/auth/")) {
            mainHandler.post(() -> {
                if (token != null) signOut("Your session has ended. Please sign in again.");
            });
            throw new IllegalStateException("Session expired");
        }
        if (status == 403 && passwordChange != null) {
            mainHandler.post(() -> showChangePassword("", true));
            throw new IllegalStateException("Password change required");
        }
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

    // ─────────────────────────────────────────────────────────────────────────
    // Session handling
    // ─────────────────────────────────────────────────────────────────────────

    private void enterWorkspace() {
        loaded.clear();
        selectedTab = "Home";
        lastInteraction = System.currentTimeMillis();
        renderWorkspace();
        refreshData();
        startPolling();
        requestNotificationPermission();
    }

    private void logoutOnServer(String oldToken) {
        try {
            HttpURLConnection connection = (HttpURLConnection) new URL(apiUrl("/auth/logout")).openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setRequestProperty("Authorization", "Bearer " + oldToken);
            connection.getResponseCode();
            connection.disconnect();
        } catch (Exception ignored) {
            // The session also expires server-side after the inactivity limit.
        }
    }

    /** First-time / admin-reset password change (required before any other screen). */
    private void showChangePassword(String knownCurrent, boolean required) {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(NAVY);
        root.setPadding(dp(18), dp(20), dp(18), dp(20));
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        root.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER_HORIZONTAL);
        panel.setPadding(dp(22), dp(22), dp(22), dp(20));
        panel.setBackground(roundRect(0xee14253c, 0x6685b7e2, 14));
        scroll.addView(panel);
        ImageView crest = new ImageView(this);
        crest.setImageResource(R.drawable.login_police_crest);
        panel.addView(crest, new LinearLayout.LayoutParams(dp(64), dp(72)));
        TextView title = text(required ? "SET YOUR PASSWORD" : "CHANGE PASSWORD", 16, Color.WHITE, true);
        title.setGravity(Gravity.CENTER);
        panel.addView(title);
        TextView sub = text(required
                ? "Your account uses a temporary password. Choose your own before continuing."
                : "At least 10 characters, with letters and numbers.", 11, Color.rgb(167, 183, 201), false);
        sub.setGravity(Gravity.CENTER);
        sub.setPadding(0, dp(4), 0, dp(14));
        panel.addView(sub);
        EditText current = input("Current password", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        styleLoginInput(current);
        current.setText(knownCurrent == null ? "" : knownCurrent);
        panel.addView(current, fieldParams());
        EditText fresh = input("New password", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        styleLoginInput(fresh);
        panel.addView(fresh, fieldParams());
        EditText confirmField = input("Confirm new password", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        styleLoginInput(confirmField);
        panel.addView(confirmField, fieldParams());
        TextView error = text("", 12, Color.rgb(255, 190, 186), false);
        error.setVisibility(View.GONE);
        panel.addView(error);
        Button save = button("Save password", BLUE);
        panel.addView(save, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50)));
        Button back = smallButton(required ? "Sign out" : "Back", 0x22ffffff, Color.WHITE);
        LinearLayout.LayoutParams backParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(44));
        backParams.topMargin = dp(10);
        panel.addView(back, backParams);
        back.setOnClickListener(v -> {
            if (required) signOut();
            else renderWorkspace();
        });
        setContentView(root);
        applyInsets(root, null);

        save.setOnClickListener(v -> {
            String cur = current.getText().toString();
            String pw = fresh.getText().toString();
            String problem = pw.length() < 10 ? "Use at least 10 characters."
                    : !pw.matches(".*[A-Za-z].*") || !pw.matches(".*\\d.*") ? "Use both letters and numbers."
                    : !pw.equals(confirmField.getText().toString()) ? "The new passwords do not match."
                    : cur.isEmpty() ? "Enter your current password." : null;
            if (problem != null) {
                error.setText(problem);
                error.setVisibility(View.VISIBLE);
                return;
            }
            save.setEnabled(false);
            executor.execute(() -> {
                try {
                    JSONObject body = new JSONObject();
                    body.put("current_password", cur);
                    body.put("new_password", pw);
                    request("/auth/change-password", "POST", body, false);
                    JSONObject me = request("/mobile/me", "GET", null, false);
                    profile = me;
                    mainHandler.post(() -> {
                        toast("Password changed.");
                        enterWorkspace();
                    });
                } catch (Exception e) {
                    String msg = e.getMessage() == null ? "Could not change the password." : e.getMessage();
                    mainHandler.post(() -> {
                        save.setEnabled(true);
                        error.setText(msg);
                        error.setVisibility(View.VISIBLE);
                    });
                }
            });
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Requests: outside movement
    // ─────────────────────────────────────────────────────────────────────────

    private void addMovementForm() {
        LinearLayout form = card();
        form.addView(text("REQUEST PERMISSION TO MOVE OUT", 10, BLUE, true));
        addFieldLabel(form, "Purpose");
        movementPurpose = input("e.g. Court evidence, summons service", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        form.addView(movementPurpose, fieldParams());
        addFieldLabel(form, "Destination");
        movementDestination = input("e.g. Nampally Criminal Court", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS);
        form.addView(movementDestination, fieldParams());
        addFieldLabel(form, "Expected return");
        movementReturn = input("Select date and time", InputType.TYPE_NULL);
        movementReturn.setFocusable(false);
        movementReturn.setOnClickListener(v -> pickDateTime(movementReturn));
        form.addView(movementReturn, fieldParams());
        Button submit = button("Send request", BLUE);
        LinearLayout.LayoutParams params = fieldParams();
        params.topMargin = dp(6);
        form.addView(submit, params);
        submit.setOnClickListener(v -> postMovement(submit));
        content.addView(form, cardParams());
        TextView historyTitle = text("My movements", 19, INK, true);
        historyTitle.setPadding(0, dp(12), 0, dp(2));
        content.addView(historyTitle);
        content.addView(text("While a movement is open you are shown as Outside on Official Duty. Record your return when back.", 12, MUTED, false));
        leaveHistory = new LinearLayout(this);
        leaveHistory.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams historyParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        historyParams.topMargin = dp(10);
        content.addView(leaveHistory, historyParams);
    }

    private void pickDateTime(EditText target) {
        Calendar now = Calendar.getInstance();
        android.app.DatePickerDialog dateDialog = new android.app.DatePickerDialog(this, (dv, y, m, d) ->
                new android.app.TimePickerDialog(this, (tv, h, min) -> {
                    Calendar picked = Calendar.getInstance();
                    picked.set(y, m, d, h, min, 0);
                    target.setTag(picked.getTimeInMillis());
                    target.setText(new SimpleDateFormat("dd MMM yyyy, HH:mm", Locale.getDefault()).format(picked.getTime()));
                }, now.get(Calendar.HOUR_OF_DAY) + 2, 0, true).show(),
                now.get(Calendar.YEAR), now.get(Calendar.MONTH), now.get(Calendar.DAY_OF_MONTH));
        dateDialog.getDatePicker().setMinDate(now.getTimeInMillis() - 1000);
        dateDialog.show();
    }

    private void postMovement(Button button) {
        String purpose = movementPurpose.getText().toString().trim();
        String destination = movementDestination.getText().toString().trim();
        Object tag = movementReturn.getTag();
        if (purpose.isEmpty() || destination.isEmpty() || !(tag instanceof Long)) {
            toast("Enter the purpose, destination and expected return.");
            return;
        }
        if ((Long) tag <= System.currentTimeMillis()) {
            toast("The expected return must be in the future.");
            return;
        }
        SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
        iso.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
        String expected = iso.format(new Date((Long) tag));
        button.setEnabled(false);
        executor.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("purpose", purpose);
                body.put("destination", destination);
                body.put("expected_return", expected);
                request("/mobile/movements", "POST", body, false);
                mainHandler.post(() -> {
                    toast("Movement request sent for authorization.");
                    renderTab("Leave");
                    refreshData();
                });
            } catch (Exception e) {
                String msg = e.getMessage() == null ? "Unable to send the request." : e.getMessage();
                mainHandler.post(() -> {
                    button.setEnabled(true);
                    toast(msg);
                });
            }
        });
    }

    private void showMovements() {
        if (movementData.length() == 0) {
            leaveHistory.addView(cardMessage("No movement requests yet."));
            return;
        }
        for (int i = 0; i < movementData.length(); i++) {
            JSONObject m = movementData.optJSONObject(i);
            if (m == null) continue;
            String status = m.optString("status");
            boolean overdue = m.optBoolean("is_overdue", false);
            int accent = overdue ? RED : "returned".equals(status) || "cancelled".equals(status) ? MUTED
                    : "pending_authorization".equals(status) ? AMBER : BLUE;
            LinearLayout card = card(accent);
            card.addView(text(m.optString("destination"), 15, INK, true));
            card.addView(text(m.optString("purpose"), 12, MUTED, false));
            String expected = m.optString("expected_return", "");
            if (!expected.isEmpty() && !"null".equals(expected)) {
                card.addView(text("Expected back " + formatDate(expected) + " " + formatTime(expected), 12, MUTED, false));
            }
            String label = overdue ? "OVERDUE" : status.replace('_', ' ').toUpperCase(Locale.ROOT);
            card.addView(statusBadge(label, overdue ? RED : accent, overdue ? RED_BG : TINT));
            String notes = m.optString("close_notes", "");
            if (!notes.isEmpty() && !"null".equals(notes)) card.addView(text(notes, 12, INK, false));
            final int id = m.optInt("id");
            if ("pending_authorization".equals(status)) {
                Button cancel = smallButton("Cancel request", RED_BG, RED);
                card.addView(cancel);
                cancel.setOnClickListener(v -> confirm("Cancel this movement request?", () ->
                        postSimple("/mobile/movements/" + id + "/cancel", null, "Movement request cancelled", "Leave")));
            } else if ("authorized".equals(status) || "open".equals(status) || "overdue".equals(status)) {
                Button back = smallButton("I have returned", GREEN_BG, GREEN);
                card.addView(back);
                back.setOnClickListener(v -> confirm("Record your return to the station now?", () ->
                        postSimple("/mobile/movements/" + id + "/return", null, "Return recorded", "Leave")));
            }
            leaveHistory.addView(card, cardParams());
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Tasks and attendance history
    // ─────────────────────────────────────────────────────────────────────────

    private void addTasksSection() {
        java.util.List<JSONObject> open = new java.util.ArrayList<>();
        for (int i = 0; i < taskData.length(); i++) {
            JSONObject t = taskData.optJSONObject(i);
            if (t == null) continue;
            String s = t.optString("status");
            if ("Not Started".equals(s) || "In Progress".equals(s) || "On Hold".equals(s)) open.add(t);
        }
        if (open.isEmpty()) return;
        sectionHeader("MY TASKS", null, null);
        for (JSONObject t : open) {
            boolean overdue = t.optBoolean("is_overdue", false);
            LinearLayout card = card(overdue ? RED : AMBER);
            card.addView(text(t.optString("description"), 14, INK, true));
            String due = t.optString("expected_completion", "");
            if (!due.isEmpty() && !"null".equals(due)) {
                card.addView(text((overdue ? "Overdue · was due " : "Due ") + formatDate(due) + " " + formatTime(due), 12, overdue ? RED : MUTED, false));
            }
            LinearLayout row = new LinearLayout(this);
            row.setPadding(0, dp(6), 0, 0);
            card.addView(row);
            final int id = t.optInt("id");
            String status = t.optString("status");
            if (!"In Progress".equals(status)) {
                Button start = smallButton("Start", TINT, BLUE);
                row.addView(start);
                start.setOnClickListener(v -> updateTask(id, "In Progress"));
            }
            Button done = smallButton("Mark completed", GREEN_BG, GREEN);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.setMarginStart(dp(8));
            row.addView(done, lp);
            done.setOnClickListener(v -> confirm("Mark this task as completed?", () -> updateTask(id, "Completed")));
            content.addView(card, cardParams());
        }
    }

    private void updateTask(int id, String status) {
        try {
            JSONObject body = new JSONObject();
            body.put("status", status);
            postSimple("/mobile/tasks/" + id + "/status", body, "Task updated", "Home");
        } catch (JSONException ignored) {
        }
    }

    private void addAttendanceHistory() {
        if (historyData == null) return;
        sectionHeader("LAST 30 DAYS", null, null);
        LinearLayout summary = card();
        summary.addView(text(historyData.optInt("scheduled") + " duties · " + historyData.optInt("submitted")
                + " submitted · " + historyData.optInt("verified") + " verified", 13, INK, true));
        content.addView(summary, cardParams());
        JSONArray items = historyData.optJSONArray("items");
        if (items == null) return;
        for (int i = 0; i < Math.min(items.length(), 20); i++) {
            JSONObject e = items.optJSONObject(i);
            if (e == null || isToday(e.optString("duty_date"))) continue;
            boolean verified = e.optBoolean("attendance_confirmed", false);
            String submitted = e.optString("attendance_submitted_at", "");
            boolean sent = !submitted.isEmpty() && !"null".equals(submitted);
            LinearLayout row = card(verified ? GREEN : sent ? AMBER : MUTED);
            LinearLayout line = new LinearLayout(this);
            line.setGravity(Gravity.CENTER_VERTICAL);
            line.addView(text(formatDate(e.optString("duty_date")) + " · Shift " + e.optString("shift_name"), 13, INK, true),
                    new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            line.addView(statusBadge(verified ? "VERIFIED" : sent ? "AWAITING" : "NOT SUBMITTED",
                    verified ? GREEN : sent ? AMBER : MUTED, verified ? GREEN_BG : sent ? AMBER_BG : BACKGROUND));
            row.addView(line);
            row.addView(text(e.optString("duty_category"), 12, MUTED, false));
            content.addView(row, cardParams());
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Notifications
    // ─────────────────────────────────────────────────────────────────────────

    private void createNotificationChannel() {
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            android.app.NotificationChannel channel = new android.app.NotificationChannel(
                    NOTIFY_CHANNEL, "Duty updates", android.app.NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("Published duties, leave and movement decisions, tasks");
            getSystemService(android.app.NotificationManager.class).createNotificationChannel(channel);
        }
    }

    private void requestNotificationPermission() {
        if (android.os.Build.VERSION.SDK_INT >= 33
                && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED
                && !getPreferences(MODE_PRIVATE).getBoolean("asked_notify", false)) {
            getPreferences(MODE_PRIVATE).edit().putBoolean("asked_notify", true).apply();
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 41);
        }
    }

    private void fetchNotifications(boolean alert) {
        if (token == null) return;
        executor.execute(() -> {
            try {
                JSONObject res = request("/notifications/?limit=50", "GET", null, false);
                mainHandler.post(() -> applyNotifications(res, alert));
            } catch (Exception ignored) {
                // Polling is best-effort.
            }
        });
    }

    private void applyNotifications(JSONObject res, boolean alert) {
        notificationData = res.optJSONArray("items") == null ? new JSONArray() : res.optJSONArray("items");
        unreadCount = res.optInt("unread", 0);
        updateBell();
        if (!alert) return;
        long lastShown = getPreferences(MODE_PRIVATE).getLong("last_notified_id", 0);
        long newest = lastShown;
        for (int i = notificationData.length() - 1; i >= 0; i--) {
            JSONObject n = notificationData.optJSONObject(i);
            if (n == null || n.optBoolean("is_read", false)) continue;
            long id = n.optLong("id");
            if (id > lastShown) {
                if (lastShown > 0) postSystemNotification((int) id, n.optString("title"), n.optString("message"));
                newest = Math.max(newest, id);
            }
        }
        if (newest > lastShown) getPreferences(MODE_PRIVATE).edit().putLong("last_notified_id", newest).apply();
        if ("Alerts".equals(selectedTab)) showNotifications();
    }

    private void postSystemNotification(int id, String title, String message) {
        if (android.os.Build.VERSION.SDK_INT >= 33
                && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            return;
        }
        android.content.Intent open = new android.content.Intent(this, MainActivity.class)
                .setFlags(android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP | android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP);
        android.app.PendingIntent pending = android.app.PendingIntent.getActivity(this, 0, open,
                android.app.PendingIntent.FLAG_IMMUTABLE | android.app.PendingIntent.FLAG_UPDATE_CURRENT);
        android.app.Notification.Builder builder = android.os.Build.VERSION.SDK_INT >= 26
                ? new android.app.Notification.Builder(this, NOTIFY_CHANNEL)
                : new android.app.Notification.Builder(this);
        android.app.Notification notification = builder
                .setSmallIcon(R.drawable.ic_bell)
                .setContentTitle(title)
                .setContentText(message)
                .setStyle(new android.app.Notification.BigTextStyle().bigText(message))
                .setAutoCancel(true)
                .setContentIntent(pending)
                .build();
        getSystemService(android.app.NotificationManager.class).notify(id, notification);
    }

    private void updateBell() {
        if (bellBadge == null) return;
        bellBadge.setText(unreadCount > 99 ? "99+" : String.valueOf(unreadCount));
        bellBadge.setVisibility(unreadCount > 0 ? View.VISIBLE : View.GONE);
    }

    private void showNotifications() {
        content.removeAllViews();
        addPageHeading("NOTIFICATIONS", "Updates for you",
                "Published duties, decisions on your requests and new tasks.");
        if (unreadCount > 0) {
            Button readAll = smallButton("Mark all as read", TINT, BLUE);
            content.addView(readAll);
            readAll.setOnClickListener(v -> postSimple("/notifications/read-all", null, null, "Alerts"));
        }
        if (notificationData.length() == 0) {
            content.addView(cardMessage("No notifications yet."));
            return;
        }
        for (int i = 0; i < notificationData.length(); i++) {
            JSONObject n = notificationData.optJSONObject(i);
            if (n == null) continue;
            boolean read = n.optBoolean("is_read", false);
            LinearLayout card = card(read ? 0 : BLUE);
            card.addView(text(n.optString("title"), 14, INK, !read));
            card.addView(text(n.optString("message"), 12, MUTED, false));
            String at = n.optString("created_at", "");
            card.addView(text(formatDate(at) + " " + formatTime(at), 10, MUTED, false));
            final int id = n.optInt("id");
            final String entity = n.optString("entity_type", "");
            card.setClickable(true);
            card.setOnClickListener(v -> {
                if (!read) postSimple("/notifications/" + id + "/read", null, null, null);
                String target = "Roster".equals(entity) ? "Roster" : "Task".equals(entity) ? "Home"
                        : "LeaveRequest".equals(entity) || "Movement".equals(entity) ? "Leave" : null;
                if ("Movement".equals(entity)) requestMode = "movement";
                if ("LeaveRequest".equals(entity)) requestMode = "leave";
                if (target != null) selectTab(target);
            });
            content.addView(card, cardParams());
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Small helpers
    // ─────────────────────────────────────────────────────────────────────────

    private void confirm(String question, Runnable onYes) {
        new android.app.AlertDialog.Builder(this)
                .setMessage(question)
                .setNegativeButton("No", null)
                .setPositiveButton("Yes", (d, w) -> onYes.run())
                .show();
    }

    /** POST, then refresh `reloadTab` (null = just refresh notifications). */
    private void postSimple(String path, JSONObject body, String okMessage, String reloadTab) {
        executor.execute(() -> {
            try {
                request(path, "POST", body == null ? new JSONObject() : body, false);
                mainHandler.post(() -> {
                    if (okMessage != null) toast(okMessage);
                    if (reloadTab != null) {
                        loaded.remove(reloadTab);
                        loaded.remove("Home");
                        if (reloadTab.equals(selectedTab)) refreshData();
                    }
                    fetchNotifications(false);
                });
            } catch (Exception e) {
                String msg = e.getMessage() == null ? "Request failed." : e.getMessage();
                mainHandler.post(() -> toast(msg));
            }
        });
    }

    private LinearLayout card() {
        return card(0);
    }

    /** White elevated card; a non-zero accent colour adds a status stripe on the left edge. */
    private LinearLayout card(int accent) {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(dp(accent == 0 ? 16 : 20), dp(14), dp(16), dp(14));
        if (accent == 0) {
            layout.setBackground(roundRect(SURFACE, LINE, 16));
        } else {
            LayerDrawable layers = new LayerDrawable(new android.graphics.drawable.Drawable[]{
                    roundRect(accent, accent, 16), roundRect(SURFACE, SURFACE, 16)});
            layers.setLayerInset(1, dp(5), 0, 0, 0);
            layout.setBackground(layers);
        }
        layout.setElevation(dp(2));
        return layout;
    }

    private android.graphics.drawable.Drawable rippleOf(int fill, int radius) {
        return new android.graphics.drawable.RippleDrawable(
                android.content.res.ColorStateList.valueOf(0x221a56db),
                roundRect(fill, fill, radius), roundRect(Color.WHITE, Color.WHITE, radius));
    }

    private View cardMessage(String message) {
        LinearLayout card = card();
        card.addView(text(message, 14, MUTED, false));
        return card;
    }

    private TextView text(String value, int size, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size + 3);
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
        button.setTextSize(16);
        button.setAllCaps(false);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        button.setBackground(roundRect(color, color, 8));
        return button;
    }

    private Button smallButton(String label, int background, int foreground) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(foreground);
        button.setTextSize(14);
        button.setAllCaps(false);
        button.setMinHeight(dp(42));
        button.setPadding(dp(12), 0, dp(12), 0);
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
        params.bottomMargin = dp(16);
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

    /** Parses server timestamps such as 2026-11-03T08:30:00.123456+00:00 (API 23 safe). */
    private Date parseIso(String value) {
        if (value == null || value.length() < 19 || value.charAt(10) != 'T') return null;
        try {
            String s = value.replaceAll("\\.\\d+", "").replace("Z", "+0000");
            s = s.replaceAll("([+-]\\d\\d):(\\d\\d)$", "$1$2");
            if (!s.matches(".*[+-]\\d{4}$")) s = s + "+0000";
            return new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssZ", Locale.US).parse(s);
        } catch (Exception e) {
            return null;
        }
    }

    private String formatDate(String value) {
        Date parsed = parseIso(value);
        if (parsed != null) return new SimpleDateFormat("dd/MM/yyyy", Locale.getDefault()).format(parsed);
        if (value == null || value.length() < 10) return value == null ? "" : value;
        return value.substring(8, 10) + "/" + value.substring(5, 7) + "/" + value.substring(0, 4);
    }

    private String formatTime(String value) {
        Date parsed = parseIso(value);
        if (parsed != null) return new SimpleDateFormat("HH:mm", Locale.getDefault()).format(parsed);
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
