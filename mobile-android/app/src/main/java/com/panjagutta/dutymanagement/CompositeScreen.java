package com.panjagutta.dutymanagement;

import android.content.Intent;

import java.util.ArrayList;
import java.util.List;

/**
 * One web page that has several tabs (Roster & Duty, Administration). Each tab is an existing
 * {@link ModuleScreen}; this class owns the tab strip, which the active tab draws above its heading,
 * and forwards Back and activity results to the tab on display. Tab visibility comes from
 * {@link RoleAccess} so it matches the web page for every role.
 */
final class CompositeScreen extends ModuleScreen {
    private static final class Entry {
        final String id;
        final String label;
        final ModuleScreen screen;
        final int sub;

        Entry(String id, String label, ModuleScreen screen, int sub) {
            this.id = id;
            this.label = label;
            this.screen = screen;
            this.sub = sub;
        }
    }

    private final List<Entry> entries = new ArrayList<>();
    private int selected;

    CompositeScreen(MainActivity activity) {
        super(activity);
    }

    /** Adds a tab backed by `screen` (or by its `sub`-th part when the screen has several). */
    CompositeScreen tab(String id, String label, ModuleScreen screen, int sub) {
        screen.host = this;
        entries.add(new Entry(id, label, screen, sub));
        return this;
    }

    @Override
    void show() {
        String wanted = a.takePendingTab();
        if (wanted != null) {
            for (int i = 0; i < entries.size(); i++) {
                if (entries.get(i).id.equals(wanted)) selected = i;
            }
        }
        select(selected);
    }

    private void select(int index) {
        if (entries.isEmpty()) return;
        selected = index;
        Entry e = entries.get(index);
        e.screen.selectSub(e.sub);
        e.screen.show();
    }

    /** Called by the active tab's heading(); draws the strip so it stays at the top of every view. */
    void drawTabs() {
        if (entries.size() < 2) return;
        String[] labels = new String[entries.size()];
        for (int i = 0; i < labels.length; i++) labels[i] = entries.get(i).label;
        tabs(labels, selected, i -> {
            if (i != selected) select(i);
        });
    }

    @Override
    boolean back() {
        return !entries.isEmpty() && entries.get(selected).screen.back();
    }

    @Override
    void onResult(int requestCode, Intent data) {
        if (!entries.isEmpty()) entries.get(selected).screen.onResult(requestCode, data);
    }
}
