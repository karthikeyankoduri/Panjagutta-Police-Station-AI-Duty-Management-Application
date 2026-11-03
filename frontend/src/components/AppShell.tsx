"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  getInbox,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  NotificationItem,
} from "@/lib/api";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  roles?: string[];
}

const OFFICERS = ["SHO", "ADMIN_SI", "SECTOR_SI", "DI", "DSI", "SUPER_ADMIN"];
const ADMINS = ["SHO", "ADMIN_SI", "SUPER_ADMIN"];

// Role matrix is provisional (guide §3.2). The server enforces every permission;
// this menu only hides what a role cannot use.
const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "📊", roles: OFFICERS },
  { href: "/staff", label: "Staff & CSV Import", icon: "👥", roles: ADMINS },
  { href: "/roster", label: "Shift Roster", icon: "📅" },
  { href: "/duty-allocation", label: "Duty Allocation", icon: "📋", roles: ["SHO", "ADMIN_SI", "SECTOR_SI", "SUPER_ADMIN"] },
  { href: "/attendance", label: "Attendance", icon: "✅" },
  { href: "/tasks", label: "Tasks", icon: "📌" },
  { href: "/movements", label: "Outside Movements", icon: "🚗" },
  { href: "/leave", label: "Leave & Rest", icon: "🏖️" },
  { href: "/attachments", label: "Attachments", icon: "🔗", roles: OFFICERS },
  { href: "/approvals", label: "Approvals & Alerts", icon: "🔔", roles: OFFICERS },
  { href: "/reports", label: "Reports", icon: "📄", roles: OFFICERS },
  { href: "/policy", label: "Policy & Shifts", icon: "⚙️", roles: ADMINS },
  { href: "/config", label: "Configuration", icon: "🧩", roles: ADMINS },
  { href: "/audit", label: "Audit Log", icon: "🔒", roles: ADMINS },
  { href: "/guide", label: "Workflow Guide", icon: "📘" },
];

const ROLE_LABELS: Record<string, string> = {
  SHO: "SHO", ADMIN_SI: "Admin SI", SECTOR_SI: "Sector SI", DI: "DI", DSI: "DSI", STAFF: "Staff", SUPER_ADMIN: "Super Admin",
};

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, token, isLoading, logout, idleWarning, keepAlive } = useAuth();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notes, setNotes] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [bellOpen, setBellOpen] = useState(false);
  const [approvalCount, setApprovalCount] = useState(0);
  const bellRef = useRef<HTMLDivElement>(null);

  // Every page behind the shell requires a signed-in user who has set their own password.
  useEffect(() => {
    if (isLoading) return;
    if (!token) router.replace("/login");
    else if (user?.must_change_password) router.replace("/change-password");
  }, [isLoading, token, user?.must_change_password, router]);

  useEffect(() => setMobileMenuOpen(false), [pathname]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobileMenuOpen(false);
        setBellOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileMenuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const isOfficer = Boolean(user && OFFICERS.includes(user.role));

  const refreshBadges = useCallback(async () => {
    if (!token || user?.must_change_password) return;
    const n = await getNotifications(token);
    setNotes(n.items.slice(0, 15));
    setUnread(n.unread);
    if (isOfficer) {
      try {
        const inbox = await getInbox(token);
        setApprovalCount(inbox.counts.total - inbox.counts.alerts);
      } catch {
        /* badge is best-effort */
      }
    }
  }, [token, user?.must_change_password, isOfficer]);

  useEffect(() => {
    refreshBadges();
    const t = window.setInterval(refreshBadges, 60000);
    return () => window.clearInterval(t);
  }, [refreshBadges, pathname]);

  const handleLogout = async () => {
    setMobileMenuOpen(false);
    await logout();
    router.push("/login");
  };

  const currentNav = NAV_ITEMS.find((item) => pathname?.startsWith(item.href));
  const isUnauthorized = Boolean(user && currentNav?.roles && !currentNav.roles.includes(user.role));

  useEffect(() => {
    if (isUnauthorized) router.replace(user?.role === "STAFF" ? "/roster" : "/dashboard");
  }, [isUnauthorized, user, router]);

  if (isLoading || !token || !user || user.must_change_password || isUnauthorized) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div className="spinner" />
      </div>
    );
  }

  const visibleItems = NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(user.role));
  const isStaff = user.role === "STAFF";
  const bottomNavItems = isStaff
    ? [
        { href: "/roster", label: "My Duty", icon: "📅" },
        { href: "/attendance", label: "Attendance", icon: "✅" },
        { href: "/leave", label: "Leave", icon: "🏖️" },
        { href: "/movements", label: "Movements", icon: "🚗" },
      ]
    : [
        { href: "/dashboard", label: "Dashboard", icon: "📊" },
        { href: "/roster", label: "Roster", icon: "📅" },
        { href: "/approvals", label: "Approvals", icon: "🔔" },
        { href: "/attendance", label: "Attendance", icon: "✅" },
      ];

  const openNote = async (n: NotificationItem) => {
    if (!token) return;
    if (!n.is_read) await markNotificationRead(token, n.id);
    setBellOpen(false);
    refreshBadges();
    const target: Record<string, string> = {
      LeaveRequest: "/leave", Movement: "/movements", Roster: "/roster", Task: "/tasks",
      RosterAssignment: "/duty-allocation", AttachmentOrder: "/attachments",
    };
    if (n.entity_type && target[n.entity_type]) router.push(target[n.entity_type]);
  };

  return (
    <div className="app-shell">
      <a href="#main-content" className="sr-only">Skip to main content</a>
      <header className="app-header">
        <div className="app-header__left">
          <button
            type="button"
            className="mobile-menu-btn"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileMenuOpen}
          >
            <span className="hamburger-icon" aria-hidden="true">{mobileMenuOpen ? "✕" : "☰"}</span>
          </button>
          <div className="app-header__logo">
            <span className="station-icon" aria-hidden="true">🚔</span>
            <div>
              <div className="app-header__title">
                <span className="desktop-title">Panjagutta Police Station</span>
                <span className="mobile-title">Panjagutta PS</span>
              </div>
              <div className="app-header__subtitle">Hyderabad City Police · Duty Management</div>
            </div>
          </div>
        </div>

        <div className="app-header__actions">
          {user.is_demo && <span className="badge-demo">Demo</span>}
          <div ref={bellRef} style={{ position: "relative" }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setBellOpen(!bellOpen)}
              aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
              aria-expanded={bellOpen}
              style={{ position: "relative" }}
            >
              🔔
              {unread > 0 && (
                <span style={{ position: "absolute", top: -6, right: -6, background: "var(--color-danger, #dc2626)", color: "#fff", borderRadius: 10, fontSize: 10, padding: "1px 6px", fontWeight: 700 }}>
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </button>
            {bellOpen && (
              <div role="dialog" aria-label="Notifications" className="card" style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", width: 340, maxWidth: "90vw", zIndex: 200, maxHeight: 420, overflowY: "auto" }}>
                <div className="card__header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>Notifications</strong>
                  {unread > 0 && (
                    <button className="btn btn-secondary btn-sm" onClick={async () => { if (token) { await markAllNotificationsRead(token); refreshBadges(); } }}>
                      Mark all read
                    </button>
                  )}
                </div>
                {notes.length === 0 ? (
                  <div className="card__body text-muted" style={{ fontSize: 13 }}>No notifications yet.</div>
                ) : (
                  notes.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => openNote(n)}
                      style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px", border: 0, borderBottom: "1px solid var(--color-border, #e2e8f0)", background: n.is_read ? "transparent" : "var(--color-blue-50, #eff6ff)", cursor: "pointer" }}
                    >
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{n.title}</div>
                      <div style={{ fontSize: 12, color: "var(--color-muted, #64748b)" }}>{n.message}</div>
                      <div style={{ fontSize: 11, color: "var(--color-muted, #64748b)", marginTop: 2 }}>{new Date(n.created_at).toLocaleString()}</div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <div className="app-header__user-info">
            <strong className="user-name">{user.staff_name || user.username}</strong>
            <span className="user-role-separator">&nbsp;&middot;&nbsp;</span>
            <span className="user-role">{ROLE_LABELS[user.role] || user.role}</span>
          </div>
          <button className="btn btn-secondary btn-sm app-header__signout-btn" onClick={handleLogout} id="btn-logout" title="Sign out of system">
            <span className="signout-text">Sign Out</span>
            <span className="signout-icon" aria-hidden="true">🚪</span>
          </button>
        </div>
      </header>

      {idleWarning && (
        <div role="alertdialog" aria-live="assertive" className="alert-banner alert-banner--warning" style={{ position: "fixed", bottom: 76, left: "50%", transform: "translateX(-50%)", zIndex: 300, display: "flex", gap: 12, alignItems: "center", boxShadow: "0 8px 24px rgba(0,0,0,.2)" }}>
          You will be signed out in about a minute because of inactivity.
          <button className="btn btn-primary btn-sm" onClick={keepAlive}>Stay signed in</button>
        </div>
      )}

      <div className={`mobile-backdrop ${mobileMenuOpen ? "active" : ""}`} onClick={() => setMobileMenuOpen(false)} aria-hidden={!mobileMenuOpen} />

      <aside className={`sidebar ${mobileMenuOpen ? "mobile-drawer-open" : ""}`} aria-label="Main sidebar navigation">
        <div className="drawer-header">
          <div className="drawer-officer-info">
            <div className="drawer-officer-avatar">👮</div>
            <div style={{ overflow: "hidden" }}>
              <div className="drawer-officer-name truncate">{user.staff_name || user.username}</div>
              <div className="drawer-officer-role">
                {ROLE_LABELS[user.role] || user.role}
                {user.sector_id ? ` · Sector ${user.sector_id}` : ""}
                {user.is_demo ? " · Demo" : ""}
              </div>
            </div>
          </div>
          <button type="button" className="drawer-close-btn" onClick={() => setMobileMenuOpen(false)} aria-label="Close menu">✕</button>
        </div>

        <div className="sidebar__section-label">Main Navigation</div>
        <nav aria-label="Main navigation">
          <ul className="sidebar__nav">
            {visibleItems.map((item) => {
              const active = pathname?.startsWith(item.href);
              return (
                <li key={item.href} className="sidebar__nav-item">
                  <Link
                    href={item.href}
                    className={`sidebar__nav-link${active ? " active" : ""}`}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                    <span className="nav-label">{item.label}</span>
                    {item.href === "/approvals" && approvalCount > 0 && (
                      <span className="badge badge-warning" style={{ marginLeft: "auto" }} aria-label={`${approvalCount} waiting`}>
                        {approvalCount}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="drawer-logout-container">
          <button className="btn btn-danger btn-sm drawer-logout-btn" onClick={handleLogout}>
            <span>🚪 Sign Out</span>
          </button>
        </div>

        <div className="sidebar__footer">
          <div style={{ fontSize: 10, color: "#475569", textAlign: "center", lineHeight: 1.5 }}>
            Hyderabad City Police · Panjagutta PS<br />
            Duty Management v0.2
            {user.is_demo && <><br /><span style={{ color: "#dc2626" }}>⚠ Demo account</span></>}
          </div>
        </div>
      </aside>

      <main className="main-content" id="main-content">{children}</main>

      <nav className="mobile-bottom-nav" aria-label="Quick mobile navigation">
        {bottomNavItems.map((item) => {
          const isActive = pathname?.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className={`mobile-bottom-nav__item ${isActive ? "active" : ""}`} aria-current={isActive ? "page" : undefined}>
              <span className="bottom-nav-icon">{item.icon}</span>
              <span className="bottom-nav-label">{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          className={`mobile-bottom-nav__item ${mobileMenuOpen ? "active" : ""}`}
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Open full station menu"
        >
          <span className="bottom-nav-icon">☰</span>
          <span className="bottom-nav-label">More</span>
        </button>
      </nav>
    </div>
  );
}
