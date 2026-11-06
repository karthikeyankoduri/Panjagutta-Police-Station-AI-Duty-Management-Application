package com.panjagutta.dutymanagement;

import android.widget.LinearLayout;
import android.widget.TextView;

/** Workflow Guide: static quick reference of the four main station workflows (same content as the web page). */
final class GuideScreen extends ModuleScreen {
    // {who, what, linkedModule or ""}
    private static final String[][][] FLOWS = {
            {{"1. Duty allocation and roster publishing", "From staff register to a published roster that staff can see."},
                    {"Admin SI", "Keep staff profiles current (rank, sector, section, attachments).", RoleAccess.STAFF_REGISTER},
                    {"SHO", "Confirm the rotation and rest rules. Roster drafting stays blocked until this is done (or demo simulation is enabled).", RoleAccess.POLICY},
                    {"Admin SI", "Create a draft roster for the date and shift, then allocate staff against each duty's required strength.", RoleAccess.ALLOCATION},
                    {"System", "Checks run while you allocate: duplicates, overlapping shifts, insufficient rest, approved leave, attachments, open movements, open tasks, unconfirmed attendance and vacancies. Violations block saving.", ""},
                    {"SHO / Admin SI", "An unavoidable violation can be saved only as an exception with a reason and a different authorizing officer. It is written to the audit log.", ""},
                    {"Admin SI", "Submit the draft for approval.", RoleAccess.ROSTER},
                    {"SHO", "Approve, or return it with comments.", RoleAccess.APPROVALS},
                    {"SHO / Admin SI", "Publish. Assigned staff are notified on the web and in the Android app.", ""},
                    {"SHO / Admin SI", "To change a published roster, use Revise. A new version is created with a reason; the original stays on record.", ""}},
            {{"2. Attendance and status", "Attendance is recorded automatically when you sign in and out, and how status is calculated."},
                    {"Everyone with a staff record", "Sign in (web or Android). Every sign-in marks you Present. If you are rostered for the shift, a sign-in more than 15 minutes after its start is flagged Late. Sign out when you finish. There is nothing to mark by hand.", RoleAccess.ATTENDANCE},
                    {"Sector SI / Admin SI / SHO", "Review who has signed in, who is late and who is scheduled but not signed in. This view is read-only.", RoleAccess.ATTENDANCE},
                    {"System", "Each person gets one current status: On Leave → Attached → Duty Off/Rest → Official Movement → assigned duty → Present-Available → Absent.", ""},
                    {"Officers", "Monitor the dashboard cards, current shift, rest and vacancy views. Tap a card to see who is in it.", RoleAccess.DASHBOARD}},
            {{"3. Leave and rest", "Only approved leave removes a person from the roster."},
                    {"Staff", "Request leave with type and dates (web or Android). A reference number is generated.", RoleAccess.LEAVE},
                    {"System", "The request is routed to the SHO and Admin SI. Overlapping requests are refused.", ""},
                    {"SHO / Admin SI", "Review the roster impact preview, then approve or reject with remarks. The officer is notified.", ""},
                    {"System", "Approved leave that clashes with a roster raises a vacancy alert for the Admin SI.", ""},
                    {"Staff / approver", "Pending (or future approved) leave can be cancelled; the decision is recorded.", ""}},
            {{"4. Outside movement", "Official work outside the station, from request to return."},
                    {"Staff", "Request a movement with purpose, destination and expected return (web or Android).", RoleAccess.MOVEMENTS},
                    {"Sector SI / Admin SI / SHO", "Authorize or reject. Officers can also log a movement directly.", ""},
                    {"System", "While open, the person shows as Outside on Official Duty. If the expected return passes, the movement is flagged overdue and the SI Admin is alerted.", ""},
                    {"Staff / officer", "Record the return. The movement closes, the alert resolves and availability recalculates.", ""}},
    };

    GuideScreen(MainActivity a) {
        super(a);
    }

    @Override
    void show() {
        a.stopRefreshing();
        a.content.removeAllViews();
        heading("REFERENCE", "Workflow Guide",
                "Quick reference for the four main station workflows. Your role: " + RoleAccess.roleLabel(role) + ".");
        for (String[][] flow : FLOWS) {
            LinearLayout card = card(BLUE);
            card.addView(text(flow[0][0], 15, INK, true));
            card.addView(muted(flow[0][1]));
            for (int i = 1; i < flow.length; i++) {
                String[] step = flow[i];
                addDividerSpace(card);
                card.addView(badge(step[0].toUpperCase(), BLUE, TINT));
                card.addView(text(step[1], 13, INK, false));
                if (!step[2].isEmpty() && RoleAccess.canSee(step[2], role)) {
                    final String module = step[2];
                    TextView link = text("Open " + RoleAccess.label(module) + "  ›", 12, BLUE, true);
                    link.setOnClickListener(v -> a.openModule(module));
                    card.addView(link);
                }
            }
            add(card);
        }
        add(muted("Rotation, rest and approval rules are provisional until the SHO signs them off."));
    }

    private void addDividerSpace(LinearLayout card) {
        android.view.View spacer = new android.view.View(a);
        card.addView(spacer, new LinearLayout.LayoutParams(1, a.dp(6)));
    }
}
