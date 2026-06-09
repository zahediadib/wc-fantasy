import React, { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { fmtCoins, fmtSigned, avatarUrl } from "@/lib/format";
import { Coins, TrendingUp, Activity, Trophy } from "lucide-react";
import PortfolioModal from "@/components/PortfolioModal";

const PALETTE = ["#FFD700", "#00FFFF", "#00FF41", "#9D4CDD", "#FF6B6B", "#7DDFFF", "#FFA500", "#A29BFE", "#FF8FAB", "#FF00FF"];

export default function Dashboard() {
  const { user } = useAuth();
  const [ledger, setLedger] = useState([]);
  const [users, setUsers] = useState([]);
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState({ matches: 0, settled: 0 });
  const [modalUser, setModalUser] = useState(null);

  useEffect(() => {
    Promise.all([
      api.get("/ledger?limit=30"),
      api.get("/users"),
      api.get("/ledger/history"),
      api.get("/matches"),
    ]).then(([l, u, h, m]) => {
      setLedger(l.data);
      setUsers(u.data.filter((x) => x.role === "player"));
      setHistory(h.data);
      const arr = m.data;
      setStats({ matches: arr.length, settled: arr.filter((x) => x.status === "settled").length });
    });
  }, []);

  const balanceChart = useMemo(() => {
    const withEvents = history.filter((u) => Array.isArray(u.events) && u.events.length > 0);
    if (!withEvents.length) return { rows: [], lines: [] };

    const eventsByUser = withEvents.map((u) => ({
      key: u.username,
      name: u.name,
      color: PALETTE[Math.abs(u.username.split("").reduce((s, c) => s + c.charCodeAt(0), 0)) % PALETTE.length],
      events: u.events
        .map((e) => ({ ts: new Date(e.ts).getTime(), balance: Number(e.balance) }))
        .filter((e) => Number.isFinite(e.ts) && Number.isFinite(e.balance))
        .sort((a, b) => a.ts - b.ts),
    })).filter((u) => u.events.length > 0);

    if (!eventsByUser.length) return { rows: [], lines: [] };

    const now = Date.now();
    const timeSet = new Set([now]);
    for (const u of eventsByUser) {
      for (const e of u.events) timeSet.add(e.ts);
    }
    const timeline = Array.from(timeSet).sort((a, b) => a - b);

    const pointers = Object.fromEntries(eventsByUser.map((u) => [u.key, 0]));
    const running = Object.fromEntries(eventsByUser.map((u) => [u.key, 100]));

    const rows = timeline.map((ts) => {
      const row = { ts };
      for (const u of eventsByUser) {
        let idx = pointers[u.key];
        while (idx < u.events.length && u.events[idx].ts <= ts) {
          running[u.key] = u.events[idx].balance;
          idx += 1;
        }
        pointers[u.key] = idx;
        row[u.key] = Number(running[u.key].toFixed(2));
      }
      return row;
    });

    return {
      rows,
      lines: eventsByUser.map((u) => ({ key: u.key, name: u.name, color: u.color })),
    };
  }, [history]);

  return (
    <div className="space-y-6" data-testid="dashboard-page">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-2 glass rounded-2xl p-6 glow-purple relative overflow-hidden">
          <div className="absolute -top-6 -left-6 w-40 h-40 rounded-full bg-fuchsia-500/20 blur-3xl" />
          <div className="relative">
            <div className="text-xs uppercase tracking-[0.2em] text-cyan-300 mono mb-2">موجودی شما</div>
            <div className="flex items-end gap-3">
              <Coins className="w-10 h-10 text-yellow-300 mb-2" />
              <div className="mono text-6xl font-black tabular text-white" data-testid="hero-balance">{fmtCoins(user?.balance)}</div>
              <div className="text-sm text-gray-300 mb-3">سکه</div>
            </div>
            <div className="mt-3 text-sm text-gray-300">سلام {user?.name} 👋 آماده‌ای برای جام جهانی؟</div>
          </div>
        </div>
        <StatCard icon={Activity} label="کل بازی‌ها" value={fmtCoins(stats.matches)} color="cyan" />
        <StatCard icon={Trophy} label="تسویه‌شده" value={fmtCoins(stats.settled)} color="green" />
      </div>

      <div className="glass rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2"><TrendingUp className="w-5 h-5 text-cyan-300" /> تاریخچه موجودی بازیکنان</h2>
          <span className="text-[10px] uppercase tracking-widest text-gray-400 mono">live</span>
        </div>
        {balanceChart.rows.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-gray-500 text-sm">هنوز تراکنشی ثبت نشده — پس از اولین تسویه، نمودار فعال می‌شود</div>
        ) : (
          <div className="h-80" data-testid="players-balance-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={balanceChart.rows} margin={{ top: 10, right: 16, bottom: 4, left: 8 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="4 4" />
                <XAxis
                  dataKey="ts"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tick={{ fill: "#9CA3AF", fontSize: 11 }}
                  tickFormatter={(v) => new Date(v).toLocaleString("fa-IR", { month: "2-digit", day: "2-digit" })}
                />
                <YAxis
                  tick={{ fill: "#9CA3AF", fontSize: 11 }}
                  tickFormatter={(v) => fmtCoins(v)}
                  width={52}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload || !payload.length) return null;
                    const sorted = [...payload].sort((a, b) => Number(b.value) - Number(a.value));
                    return (
                      <div className="rounded-xl border border-white/15 bg-[#0D1322]/95 px-3 py-2 shadow-2xl backdrop-blur">
                        <div className="text-[11px] text-cyan-200 mb-1">
                          {new Date(label).toLocaleString("fa-IR", {
                            year: "numeric",
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                        <div className="space-y-1 max-h-52 overflow-y-auto pr-1">
                          {sorted.map((item) => (
                            <div key={item.dataKey} className="flex items-center justify-between gap-4 text-[11px]">
                              <span className="flex items-center gap-1.5 text-gray-100">
                                <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: item.stroke }} />
                                {item.name}
                              </span>
                              <span className="mono font-bold text-white">{fmtCoins(item.value)} سکه</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  }}
                />
                <Legend verticalAlign="top" align="right" wrapperStyle={{ color: "#D1D5DB", fontSize: 12 }} />
                {balanceChart.lines.map((line) => (
                  <Line
                    key={line.key}
                    type="monotone"
                    dataKey={line.key}
                    name={line.name}
                    stroke={line.color}
                    strokeWidth={2.4}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-2 glass rounded-2xl p-6" data-testid="leaderboard">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><Trophy className="w-5 h-5 text-yellow-300" /> رده‌بندی بازیکنان</h2>
          <div className="space-y-2">
            {users.map((u, i) => (
              <button
                type="button"
                key={u.id}
                onClick={() => setModalUser(u)}
                data-testid={`leader-${u.username}`}
                className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-fuchsia-500/10 hover:translate-x-[-2px] transition border border-transparent hover:border-fuchsia-500/30 text-right"
              >
                <span className="mono text-sm w-6 text-gray-400">{i + 1}.</span>
                <img src={avatarUrl(u.username)} alt="" className="w-8 h-8 rounded-md bg-white/5" />
                <span className="flex-1 text-sm">{u.name}</span>
                <span className="mono text-base font-bold text-cyan-300">{fmtCoins(u.balance)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-3 glass rounded-2xl p-6" data-testid="live-ledger">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">فید لحظه‌ای دفتر کل</h2>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-400 pulse-live" />
              <span className="text-[10px] uppercase tracking-widest text-green-300 mono">LIVE</span>
            </div>
          </div>
          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {ledger.length === 0 && <div className="text-sm text-gray-500 text-center py-8">هنوز رویدادی ثبت نشده است</div>}
            {ledger.map((e) => (
              <div key={e.id} className="flex items-center gap-3 p-2 rounded-lg bg-black/20 slide-in" data-testid={`ledger-row-${e.id}`}>
                <span className={`mono text-base font-bold w-16 text-left ${e.amount >= 0 ? "text-pos" : "text-neg"}`}>{fmtSigned(e.amount)}</span>
                <img src={avatarUrl(e.username)} alt="" className="w-7 h-7 rounded bg-white/5" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold truncate">{e.user_name_fa}</div>
                  <div className="text-[11px] text-gray-400 truncate">{e.reason_fa}</div>
                </div>
                <span className="text-[10px] mono text-gray-500">{e.ts.slice(11, 16)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <PortfolioModal user={modalUser} open={!!modalUser} onClose={() => setModalUser(null)} />
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }) {
  const glow = { cyan: "glow-cyan", green: "glow-green", magenta: "glow-magenta" }[color] || "";
  return (
    <div className={`glass rounded-2xl p-6 ${glow}`}>
      <div className="text-xs uppercase tracking-[0.2em] mono text-gray-400 mb-2">{label}</div>
      <div className="flex items-center gap-3">
        <Icon className="w-7 h-7 text-cyan-300" />
        <span className="mono text-3xl font-black">{value}</span>
      </div>
    </div>
  );
}
