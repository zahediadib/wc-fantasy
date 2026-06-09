import React, { useEffect, useMemo, useState } from "react";
import ReactApexChart from "react-apexcharts";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { fmtCoins, fmtSigned, avatarUrl } from "@/lib/format";
import { Coins, TrendingUp, Activity, Trophy } from "lucide-react";
import PortfolioModal from "@/components/PortfolioModal";

const PALETTE = ["#FF00FF", "#00FFFF", "#00FF41", "#9D4CDD", "#FFD700", "#FF6B6B", "#7DDFFF", "#FFA500", "#A29BFE", "#FF8FAB"];

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

  // Build series for ApexCharts time-series chart: each player is a series of [ts_ms, balance]
  const series = useMemo(() => {
    return history.map((u) => {
      let last = 100;
      const data = u.events.map((e) => {
        last = e.balance;
        return [new Date(e.ts).getTime(), Number(last.toFixed(2))];
      });
      // Always include now to extend lines to today
      if (data.length > 0) data.push([Date.now(), data[data.length - 1][1]]);
      return { name: u.name, data };
    }).filter((s) => s.data.length > 1);
  }, [history]);

  const chartOptions = useMemo(() => ({
    chart: {
      id: "balance-history",
      type: "area", background: "transparent", foreColor: "#9CA3AF",
      toolbar: { show: false }, zoom: { enabled: true, type: "x" },
      animations: { enabled: false },
      dropShadow: { enabled: true, top: 2, blur: 6, opacity: 0.25 },
      fontFamily: "Vazirmatn, sans-serif",
      redrawOnParentResize: false,
      redrawOnWindowResize: false,
    },
    colors: PALETTE,
    stroke: { width: 2.5, curve: "smooth" },
    fill: { type: "gradient", gradient: { shadeIntensity: 1, opacityFrom: 0.35, opacityTo: 0.02, stops: [0, 90, 100] } },
    grid: { borderColor: "rgba(255,255,255,0.06)", strokeDashArray: 4 },
    xaxis: { type: "datetime", labels: { style: { colors: "#6B7280", fontSize: "11px" } } },
    yaxis: { labels: { style: { colors: "#6B7280", fontSize: "11px" }, formatter: (v) => (v == null || Number.isNaN(v)) ? "" : Number(v).toFixed(0) } },
    legend: { position: "top", horizontalAlign: "right", labels: { colors: "#D1D5DB" }, markers: { width: 10, height: 10 } },
    tooltip: {
      theme: "dark", x: { format: "yyyy-MM-dd HH:mm" },
      style: { fontSize: "12px", fontFamily: "Vazirmatn" },
      shared: true,
      y: { formatter: (v) => (v == null || Number.isNaN(v)) ? "—" : `${Number(v).toFixed(2)} سکه` },
    },
    markers: { size: 0, strokeWidth: 0, hover: { size: 6 } },
    dataLabels: { enabled: false },
  }), []);

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
        {series.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-gray-500 text-sm">هنوز تراکنشی ثبت نشده — پس از اولین تسویه، نمودار فعال می‌شود</div>
        ) : (
          <ReactApexChart key={series.length} options={chartOptions} series={series} type="area" height={320} />
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
