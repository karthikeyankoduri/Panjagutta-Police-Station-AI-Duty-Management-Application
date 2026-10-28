"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  roles?: string[];
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/staff", label: "Staff & CSV Import", icon: "👥" },
  { href: "/roster", label: "Shift Roster", icon: "📅" },
  { href: "/duty-allocation", label: "Duty Allocation", icon: "📋" },
  { href: "/attendance", label: "Attendance", icon: "✅" },
  { href: "/tasks", label: "Tasks", icon: "📌" },
  { href: "/movements", label: "Outside Movements", icon: "🚗" },
  { href: "/leave", label: "Leave & Rest", icon: "🏖️" },
  { href: "/attachments", label: "Attachments", icon: "🔗" },
  { href: "/approvals", label: "Approvals & Alerts", icon: "🔔" },
  { href: "/reports", label: "Reports", icon: "📄" },
  { href: "/policy", label: "Policy Config", icon: "⚙️", roles: ["SHO", "ADMIN_SI"] },
  { href: "/audit", label: "Audit Log", icon: "🔒", roles: ["SHO", "ADMIN_SI"] },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.roles || (user && item.roles.includes(user.role))
  );

  const getRoleBadge = (role: string) => {
    const map: Record<string, string> = {
      SHO: "SHO", ADMIN_SI: "Admin SI", SECTOR_SI: "Sector SI",
      DI: "DI", DSI: "DSI", STAFF: "Staff",
    };
    return map[role] || role;
  };

  return (
    <div className="app-shell">
      {/* Header */}
      <header className="app-header">
        <div className="app-header__logo">
          <span style={{ fontSize: 24 }}>🚔</span>
          <div>
            <div className="app-header__title">Panjagutta Police Station</div>
            <div className="app-header__subtitle">AI Duty Management System</div>
          </div>
        </div>
        <div className="app-header__actions">
          {user?.is_demo && <span className="badge-demo">Demo Mode</span>}
          <div style={{ fontSize: 13, color: "#94a3b8" }}>
            <strong style={{ color: "#e2e8f0" }}>{user?.username}</strong>
            &nbsp;&middot;&nbsp;{user ? getRoleBadge(user.role) : ""}
          </div>
          <button className="btn btn-secondary btn-sm" onClick={handleLogout} id="btn-logout">
            Sign Out
          </button>
        </div>
      </header>

      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar__section-label">Navigation</div>
        <nav aria-label="Main navigation">
          <ul className="sidebar__nav">
            {visibleItems.map((item) => (
              <li key={item.href} className="sidebar__nav-item">
                <Link
                  href={item.href}
                  className={`sidebar__nav-link${pathname?.startsWith(item.href) ? " active" : ""}`}
                  aria-current={pathname?.startsWith(item.href) ? "page" : undefined}
                >
                  <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div style={{ padding: "16px", borderTop: "1px solid #243447", marginTop: "auto" }}>
          <div style={{ fontSize: 10, color: "#475569", textAlign: "center", lineHeight: 1.5 }}>
            Stage A+B Foundation · v0.1.0<br />
            <span style={{ color: "#dc2626" }}>⚠ DEMO DATA ONLY</span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="main-content" id="main-content">
        {children}
      </main>
    </div>
  );
}
