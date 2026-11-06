"use client";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";

interface Step { who: string; what: string; where?: { href: string; label: string } }

const FLOWS: { id: string; title: string; summary: string; steps: Step[] }[] = [
  {
    id: "allocation",
    title: "1. Duty allocation and roster publishing",
    summary: "From staff register to a published roster that staff can see.",
    steps: [
      { who: "Admin SI", what: "Keep staff profiles current (rank, sector, section, attachments).", where: { href: "/staff", label: "Staff register" } },
      { who: "SHO", what: "Confirm the rotation and rest rules. Roster drafting stays blocked until this is done (or demo simulation is enabled).", where: { href: "/policy", label: "Policy & Shifts" } },
      { who: "Admin SI", what: "Create a draft roster for the date and shift, then allocate staff against each duty's required strength.", where: { href: "/duty-allocation", label: "Duty allocation" } },
      { who: "System", what: "Checks run while you allocate: duplicates, overlapping shifts, insufficient rest, approved leave, attachments, open movements, open tasks, unconfirmed attendance and vacancies. Violations block saving." },
      { who: "SHO / Admin SI", what: "An unavoidable violation can be saved only as an exception with a reason and a different authorizing officer. It is written to the audit log." },
      { who: "Admin SI", what: "Submit the draft for approval.", where: { href: "/roster", label: "Roster" } },
      { who: "SHO", what: "Approve, or return it with comments.", where: { href: "/approvals", label: "Approvals" } },
      { who: "SHO / Admin SI", what: "Publish. Assigned staff are notified on the web and in the Android app." },
      { who: "SHO / Admin SI", what: "To change a published roster, use Revise. A new version is created with a reason; the original stays on record." },
    ],
  },
  {
    id: "attendance",
    title: "2. Attendance and status",
    summary: "Attendance is recorded automatically when you sign in and out, and how status is calculated.",
    steps: [
      { who: "Everyone with a staff record", what: "Sign in (web or Android). Every sign-in marks you Present. If you are rostered for the shift, a sign-in more than 15 minutes after its start is flagged Late. Sign out when you finish. There is nothing to mark by hand.", where: { href: "/attendance", label: "Attendance" } },
      { who: "Sector SI / Admin SI / SHO", what: "Review who has signed in, who is late and who is scheduled but not signed in. This view is read-only.", where: { href: "/attendance", label: "Attendance → Scheduled vs Signed in" } },
      { who: "System", what: "Each person gets one current status: On Leave → Attached → Duty Off/Rest → Official Movement → assigned duty → Present-Available → Absent." },
      { who: "Officers", what: "Monitor the dashboard cards, current shift, rest and vacancy views. Click a card to see who is in it.", where: { href: "/dashboard", label: "Dashboard" } },
    ],
  },
  {
    id: "leave",
    title: "3. Leave and rest",
    summary: "Only approved leave removes a person from the roster.",
    steps: [
      { who: "Staff", what: "Request leave with type and dates (web or Android). A reference number is generated.", where: { href: "/leave", label: "Leave" } },
      { who: "System", what: "The request is routed to the SHO and Admin SI. Overlapping requests are refused." },
      { who: "SHO / Admin SI", what: "Review the roster impact preview, then approve or reject with remarks. The officer is notified." },
      { who: "System", what: "Approved leave that clashes with a roster raises a vacancy alert for the Admin SI." },
      { who: "Staff / approver", what: "Pending (or future approved) leave can be cancelled; the decision is recorded." },
    ],
  },
  {
    id: "movement",
    title: "4. Outside movement",
    summary: "Official work outside the station, from request to return.",
    steps: [
      { who: "Staff", what: "Request a movement with purpose, destination and expected return (web or Android).", where: { href: "/movements", label: "Movements" } },
      { who: "Sector SI / Admin SI / SHO", what: "Authorize or reject. Officers can also log a movement directly." },
      { who: "System", what: "While open, the person shows as Outside on Official Duty. If the expected return passes, the movement is flagged overdue and the SI Admin is alerted." },
      { who: "Staff / officer", what: "Record the return. The movement closes, the alert resolves and availability recalculates." },
    ],
  },
];

export default function GuidePage() {
  const { user } = useAuth();
  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Workflow Guide</h1>
          <div className="page-subtitle">Quick reference for the four main station workflows. Your role: <strong>{user?.role}</strong>.</div>
        </div>
      </div>
      <nav aria-label="Workflows" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {FLOWS.map((f) => <a key={f.id} href={`#${f.id}`} className="btn btn-secondary btn-sm">{f.title}</a>)}
      </nav>
      {FLOWS.map((f) => (
        <section key={f.id} id={f.id} className="card" style={{ marginBottom: 20 }}>
          <div className="card__header" style={{ display: "block" }}>
            <h2 className="card__title">{f.title}</h2>
            <div className="text-muted" style={{ fontSize: 13 }}>{f.summary}</div>
          </div>
          <div className="card__body">
            <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
              {f.steps.map((s, i) => (
                <li key={i} style={{ marginBottom: 8 }}>
                  <span className="badge badge-blue" style={{ marginRight: 6 }}>{s.who}</span>
                  {s.what}
                  {s.where && <> — <Link href={s.where.href}>{s.where.label}</Link></>}
                </li>
              ))}
            </ol>
          </div>
        </section>
      ))}
      <div className="text-muted" style={{ fontSize: 12 }}>
        Rotation, rest and approval rules are provisional until the SHO signs them off. See docs/user-guide.md for the full manual.
      </div>
    </AppShell>
  );
}
