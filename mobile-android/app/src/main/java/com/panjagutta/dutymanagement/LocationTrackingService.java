package com.panjagutta.dutymanagement;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Foreground service that reports the signed-in officer's GPS position to the API once a minute.
 * Runs on its own thread (never the UI thread). Started by {@link MainActivity} after sign-in and
 * location permission, stopped on sign-out or when the server rejects the session.
 */
public final class LocationTrackingService extends Service {
    static final String EXTRA_URL = "url";
    private static final long INTERVAL_MS = 60_000L;
    private static final String CHANNEL = "location_tracking";
    private static final int NOTIFICATION_ID = 7001;
    private static final String TAG = "LocationTracking";

    private LocationManager manager;
    private HandlerThread thread;
    private final ExecutorService sender = Executors.newSingleThreadExecutor();
    private String url;
    private long lastSentAt;

    private final LocationListener listener = new LocationListener() {
        @Override
        public void onLocationChanged(Location location) {
            // GPS and network providers can both fire; keep to one report per interval.
            long now = System.currentTimeMillis();
            if (now - lastSentAt < INTERVAL_MS - 5_000L) return;
            lastSentAt = now;
            send(location);
        }

        @Override
        public void onStatusChanged(String provider, int status, Bundle extras) {
        }

        @Override
        public void onProviderEnabled(String provider) {
        }

        @Override
        public void onProviderDisabled(String provider) {
        }
    };

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        url = intent == null ? null : intent.getStringExtra(EXTRA_URL);
        if (url == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        startInForeground();
        startUpdates();
        return START_NOT_STICKY;
    }

    private void startInForeground() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26) {
            // IMPORTANCE_MIN: no sound, no vibration, no heads-up, minimised in shade — least intrusive allowed.
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Location sharing", NotificationManager.IMPORTANCE_MIN);
            channel.setShowBadge(false);
            nm.createNotificationChannel(channel);
        }
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        Notification notification = builder
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setContentTitle("Duty location sharing is on")
                .setContentText("Your location is shared with the station every minute while on duty.")
                .setOngoing(true)
                .setPriority(Notification.PRIORITY_MIN)
                .setVisibility(Notification.VISIBILITY_SECRET)  // hidden on lock screen
                .build();
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    @SuppressWarnings("MissingPermission") // granted before the service is started
    private void startUpdates() {
        if (thread != null) return;
        manager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        thread = new HandlerThread("location-updates");
        thread.start();
        Looper looper = thread.getLooper();
        boolean fineGranted = checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        for (String provider : new String[]{LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER}) {
            if (LocationManager.GPS_PROVIDER.equals(provider) && !fineGranted) continue;
            try {
                if (manager.getAllProviders().contains(provider)) {
                    // Register even while disabled, so updates resume when location is enabled.
                    manager.requestLocationUpdates(provider, INTERVAL_MS, 0f, listener, looper);
                    Location last = manager.getLastKnownLocation(provider);
                    if (last != null && System.currentTimeMillis() - last.getTime() < INTERVAL_MS && lastSentAt == 0) {
                        lastSentAt = System.currentTimeMillis();
                        send(last);
                    }
                }
            } catch (SecurityException | IllegalArgumentException exception) {
                Log.w(TAG, "Cannot use location provider " + provider, exception);
            }
        }
    }

    private void send(Location location) {
        final double lat = location.getLatitude();
        final double lng = location.getLongitude();
        final long fixTime = location.getTime();
        sender.execute(() -> {
            String token = new TokenStore(getSharedPreferences(MainActivity.PREFS_NAME, MODE_PRIVATE)).load();
            if (token == null || token.isEmpty()) {
                stopSelf();
                return;
            }
            HttpURLConnection connection = null;
            try {
                SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
                iso.setTimeZone(TimeZone.getTimeZone("UTC"));
                JSONObject body = new JSONObject();
                body.put("latitude", lat);
                body.put("longitude", lng);
                body.put("timestamp", iso.format(new Date(fixTime)));
                connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(10_000);
                connection.setReadTimeout(15_000);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setRequestProperty("Authorization", "Bearer " + token);
                try (OutputStream out = connection.getOutputStream()) {
                    out.write(body.toString().getBytes(StandardCharsets.UTF_8));
                }
                int status = connection.getResponseCode();
                // Session ended or this login has no staff profile: stop reporting.
                if (status == 401 || status == 403) stopSelf();
                else if (status < 200 || status >= 300) Log.w(TAG, "Location report failed: HTTP " + status);
            } catch (Exception exception) {
                Log.w(TAG, "Location report failed; will retry on the next fix", exception);
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    @Override
    public void onDestroy() {
        if (manager != null) manager.removeUpdates(listener);
        if (thread != null) thread.quitSafely();
        sender.shutdown();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
