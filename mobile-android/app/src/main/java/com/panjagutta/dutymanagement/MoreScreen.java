package com.panjagutta.dutymanagement;

import android.view.Gravity;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

/** The "More" tab: every module the signed-in role may open that is not on the bottom bar. */
final class MoreScreen extends ModuleScreen {
    MoreScreen(MainActivity a) {
        super(a);
    }

    @Override
    void show() {
        a.stopRefreshing();
        a.content.removeAllViews();
        heading("MODULES", "Everything for your role",
                "You are signed in as " + RoleAccess.roleLabel(role) + ". Your menu matches the web application.");
        for (String module : RoleAccess.moreModules(role)) {
            LinearLayout card = card(0);
            LinearLayout row = hrow();
            ImageView icon = new ImageView(a);
            icon.setImageResource(MainActivity.iconFor(module));
            icon.setColorFilter(BLUE);
            icon.setPadding(a.dp(8), a.dp(8), a.dp(8), a.dp(8));
            icon.setBackground(a.roundRect(TINT, TINT, 12));
            LinearLayout.LayoutParams ip = new LinearLayout.LayoutParams(a.dp(40), a.dp(40));
            ip.setMarginEnd(a.dp(14));
            row.addView(icon, ip);
            row.addView(text(RoleAccess.label(module), 15, INK, true),
                    new LinearLayout.LayoutParams(0, android.view.ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            TextView chevron = text("›", 20, MUTED, false);
            chevron.setGravity(Gravity.CENTER);
            row.addView(chevron);
            card.addView(row);
            card.setClickable(true);
            card.setOnClickListener(v -> a.openModule(module));
            addTight(card);
        }
    }
}
