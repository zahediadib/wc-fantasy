import React from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { fmtCoins, avatarUrl } from "@/lib/format";
import {
  LayoutDashboard, Briefcase, ArrowLeftRight, Trophy, Calendar,
  GitBranch, ScrollText, Settings, LogOut, Coins, Shield,
} from "lucide-react";

const NAV = [
  { to: "/", label: "داشبورد", icon: LayoutDashboard, testid: "nav-dashboard" },
  { to: "/portfolio", label: "پورتفولیو من", icon: Briefcase, testid: "nav-portfolio" },
  { to: "/market", label: "بازار نقل و انتقالات", icon: ArrowLeftRight, testid: "nav-market" },
  { to: "/groups", label: "جدول گروه‌ها", icon: Trophy, testid: "nav-groups" },
  { to: "/fixtures", label: "برنامه بازی‌ها", icon: Calendar, testid: "nav-fixtures" },
  { to: "/bracket", label: "جدول حذفی", icon: GitBranch, testid: "nav-bracket" },
  { to: "/ledger", label: "دفتر کل", icon: ScrollText, testid: "nav-ledger" },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();

  function handleLogout() {
    logout();
    nav("/login");
  }

  return (
    <div className="min-h-screen flex" dir="rtl" data-testid="app-shell">
      {/* Sidebar (desktop) */}
      <aside className="hidden lg:flex w-64 flex-col glass border-l border-white/10 sticky top-0 h-screen" data-testid="sidebar">
        <div className="px-6 py-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-fuchsia-500 via-violet-500 to-cyan-400 flex items-center justify-center glow-purple">
              <Trophy className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-sm font-black tracking-tight">جام جهانی ۲۰۲۶</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-300 mono">Fantasy Trading</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              data-testid={n.testid}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                  isActive
                    ? "bg-fuchsia-500/15 text-white border border-fuchsia-500/30 glow-magenta"
                    : "text-gray-300 hover:bg-white/5 hover:text-white"
                }`
              }
            >
              <n.icon className="w-4 h-4" />
              <span>{n.label}</span>
            </NavLink>
          ))}
          {user?.role === "admin" && (
            <NavLink
              to="/admin"
              data-testid="nav-admin"
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all mt-3 ${
                  isActive
                    ? "bg-cyan-500/15 text-white border border-cyan-500/40 glow-cyan"
                    : "text-cyan-200 hover:bg-cyan-500/10 border border-transparent"
                }`
              }
            >
              <Shield className="w-4 h-4" />
              <span>پنل ادمین</span>
            </NavLink>
          )}
        </nav>
        <div className="p-3 border-t border-white/10">
          <div className="flex items-center gap-3 mb-3">
            <img src={avatarUrl(user?.username)} alt="" className="w-9 h-9 rounded-lg bg-white/5" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate">{user?.name}</div>
              <div className="text-[10px] text-gray-400 mono truncate">@{user?.username}</div>
            </div>
          </div>
          <div className="flex items-center justify-between bg-black/30 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2">
              <Coins className="w-4 h-4 text-yellow-300" />
              <span className="text-xs text-gray-400">موجودی</span>
            </div>
            <span className="mono text-base font-bold text-cyan-300" data-testid="sidebar-balance">{fmtCoins(user?.balance)}</span>
          </div>
          <button
            onClick={handleLogout}
            data-testid="logout-btn"
            className="mt-3 w-full text-xs text-gray-300 hover:text-white flex items-center justify-center gap-2 py-2 rounded-lg border border-white/10 hover:border-white/30 transition"
          >
            <LogOut className="w-3.5 h-3.5" />
            خروج
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 inset-x-0 z-40 glass border-b border-white/10 px-4 py-3 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-fuchsia-500 to-cyan-400 flex items-center justify-center">
            <Trophy className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm font-black">WC 2026</span>
        </Link>
        <div className="flex items-center gap-2 bg-black/30 rounded-lg px-3 py-1">
          <Coins className="w-3.5 h-3.5 text-yellow-300" />
          <span className="mono text-sm font-bold text-cyan-300">{fmtCoins(user?.balance)}</span>
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 min-w-0 pt-16 lg:pt-0 pb-20 lg:pb-0">
        <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">{children}</div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 glass border-t border-white/10 px-2 py-2 flex justify-around" data-testid="bottom-nav">
        {NAV.slice(0, 5).map((n) => {
          const active = loc.pathname === n.to;
          return (
            <Link
              key={n.to}
              to={n.to}
              data-testid={`m-${n.testid}`}
              className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-md text-[10px] ${
                active ? "text-cyan-300" : "text-gray-400"
              }`}
            >
              <n.icon className="w-5 h-5" />
              <span>{n.label.split(" ")[0]}</span>
            </Link>
          );
        })}
        {user?.role === "admin" && (
          <Link to="/admin" data-testid="m-nav-admin" className="flex flex-col items-center gap-0.5 px-2 py-1 rounded-md text-[10px] text-fuchsia-300">
            <Shield className="w-5 h-5" />
            <span>ادمین</span>
          </Link>
        )}
      </nav>
    </div>
  );
}
