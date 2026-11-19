package com.panjagutta.dutymanagement;

import android.content.Intent;
import android.net.Uri;
import android.widget.LinearLayout;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Live Locations (web: /locations). Admin / Super Admin only. Lists each officer's latest reported
 * position with a Google Maps link; refreshes whenever the module is opened or pulled down.
 */
final class LocationsScreen extends ModuleScreen {
    private JSONArray rows = new JSONArray();

    LocationsScreen(MainActivity a) {
        super(a);
    }

    @Override
    void show() {
        load(() -> a.requestArray("/locations/"), data -> {
            rows = data;
            render();
        });
    }

    private void render() {
        a.content.removeAllViews();
        a.stopRefreshing();
        heading("LIVE", "Live Locations",
                "Latest GPS position reported by each officer's phone, updated every minute. Pull down to refresh.");
        section("OFFICERS REPORTING (" + rows.length() + ")");
        if (rows.length() == 0) {
            empty("No officer has reported a location yet. Positions appear once officers sign in on the app and allow location access.");
        }
        for (int i = 0; i < rows.length(); i++) {
            JSONObject r = rows.optJSONObject(i);
            if (r == null) continue;
            LinearLayout card = card(0);
            card.addView(titleRow(text(str(r, "name"), 14, INK, true), muted(ago(str(r, "last_updated")))));
            card.addView(muted(str(r, "service_number") + " · " + str(r, "designation")
                    + (str(r, "sector_name").isEmpty() ? "" : " · " + str(r, "sector_name"))));
            card.addView(text("📍 " + (str(r, "location_name").isEmpty() ? "Address unavailable" : str(r, "location_name")), 13, BLUE, true));
            final String url = mapsUrl(r.optDouble("latitude"), r.optDouble("longitude"));
            card.addView(buttonRow(secondary("Open in Google Maps", () -> open(a, url))));
            addTight(card);
        }
    }

    static String mapsUrl(double lat, double lng) {
        return String.format(Locale.US, "https://www.google.com/maps?q=%.6f,%.6f", lat, lng);
    }

    static void open(MainActivity a, String url) {
        try {
            a.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (RuntimeException exception) {
            a.toast("No app available to open the map.");
        }
    }

    /** "5 mins ago" from a server ISO timestamp (UTC). */
    static String ago(String iso) {
        if (iso == null || iso.length() < 19 || "null".equals(iso)) return "unknown";
        try {
            SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
            f.setTimeZone(TimeZone.getTimeZone("UTC"));
            Date d = f.parse(iso.substring(0, 19));
            long mins = Math.max(0, (System.currentTimeMillis() - d.getTime()) / 60_000L);
            if (mins < 1) return "just now";
            if (mins < 60) return mins + (mins == 1 ? " min ago" : " mins ago");
            long hrs = mins / 60;
            if (hrs < 24) return hrs + (hrs == 1 ? " hr ago" : " hrs ago");
            long days = hrs / 24;
            return days + (days == 1 ? " day ago" : " days ago");
        } catch (Exception exception) {
            return "unknown";
        }
    }
}
