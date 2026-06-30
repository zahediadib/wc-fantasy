import React, { useEffect, useMemo, useState } from "react";
import { api, fmtErr } from "@/lib/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { TeamFlag, TierBadge } from "@/components/TeamCard";
import SettledMatchPosterDialog from "@/components/SettledMatchPosterDialog";
import { fmtCoins, fmtSigned, avatarUrl, STAGE_LABEL } from "@/lib/format";
import { Shield, Trash2, Plus, RefreshCw, Gavel, Award, AlertOctagon, FileText } from "lucide-react";

const BONUSES = [
  { value: "golden_team", label: "تیم طلایی +۱۰" },
  { value: "giant_killer", label: "غول‌کش +۱۵" },
  { value: "clean_sheet", label: "بدون گل خورده +۱۰" },
  { value: "punching_bag", label: "کیسه بوکس +۱۵" },
  { value: "scapegoat", label: "سپر بلا +۱۰ (بخشش جرائم)" },
];

export default function AdminPanel() {
  return (
      <div className="space-y-6" data-testid="admin-page">
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-cyan-300" />
          <h1 className="text-2xl font-black">پنل ادمین</h1>
        </div>
        <Tabs defaultValue="matches">
          <TabsList className="bg-black/30 border border-white/10 flex-wrap h-auto">
            <TabsTrigger value="matches" data-testid="admin-tab-matches">تسویه بازی</TabsTrigger>
            <TabsTrigger value="auction" data-testid="admin-tab-auction">مزایده زنده</TabsTrigger>
            <TabsTrigger value="window" data-testid="admin-tab-window">پنجره نقل و انتقال</TabsTrigger>
            <TabsTrigger value="bonus" data-testid="admin-tab-bonus">بونوس‌ها</TabsTrigger>
            <TabsTrigger value="users" data-testid="admin-tab-users">کاربران</TabsTrigger>
            <TabsTrigger value="bracket" data-testid="admin-tab-bracket">ساخت حذفی</TabsTrigger>
            <TabsTrigger value="logs" data-testid="admin-tab-logs">لاگ سیستم</TabsTrigger>
            <TabsTrigger value="danger" data-testid="admin-tab-danger">منطقه خطر</TabsTrigger>
          </TabsList>

          <TabsContent value="matches" className="mt-6"><MatchesPanel /></TabsContent>
          <TabsContent value="auction" className="mt-6"><AuctionPanel /></TabsContent>
          <TabsContent value="window" className="mt-6"><WindowPanel /></TabsContent>
          <TabsContent value="bonus" className="mt-6"><BonusPanel /></TabsContent>
          <TabsContent value="users" className="mt-6"><UsersPanel /></TabsContent>
          <TabsContent value="bracket" className="mt-6"><BracketBuilder /></TabsContent>
          <TabsContent value="logs" className="mt-6"><LogsPanel /></TabsContent>
          <TabsContent value="danger" className="mt-6"><DangerPanel /></TabsContent>
        </Tabs>
      </div>
  );
}

/* ----------------- Matches panel ----------------- */
function MatchesPanel() {
  const [matches, setMatches] = useState([]);
  const [teams, setTeams] = useState({});
  async function reload() {
    const [m, t] = await Promise.all([api.get("/matches"), api.get("/teams")]);
    setMatches(m.data);
    setTeams(Object.fromEntries(t.data.map((x) => [x.id, x])));
  }
  useEffect(() => { reload(); }, []);
  const scheduled = matches.filter((m) => m.status === "scheduled" || m.status === "finished_pending");
  const settled = matches.filter((m) => m.status === "settled");
  const pending = matches.filter((m) => m.needs_settlement);

  return (
      <div className="space-y-6">
        <FetchPanel onDone={reload} />
        {pending.length > 0 && (
            <div className="glass rounded-2xl p-4 border border-amber-500/40 bg-amber-500/5 flex items-center gap-3" data-testid="pending-alert">
              <span className="w-3 h-3 rounded-full bg-amber-400 pulse-live" />
              <div className="flex-1 text-sm">
                <span className="font-bold text-amber-200">{pending.length} بازی</span> از API به‌عنوان «Finished» علامت خورده ولی هنوز تسویه نشده. لطفاً با دقت دوبار-چک، آن‌ها را تسویه کنید.
              </div>
            </div>
        )}
        <div className="glass rounded-2xl p-6">
          <h3 className="text-base font-bold mb-3">بازی‌های آماده تسویه ({scheduled.length})</h3>
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {scheduled.length === 0 ? (
                <div className="text-sm text-gray-400 text-center py-8">هیچ بازی‌ای در دیتابیس نیست. ابتدا روی «دریافت بازی‌ها از API» کلیک کنید.</div>
            ) : scheduled.map((m) => <MatchRow key={m.id} m={m} teams={teams} onDone={reload} />)}
          </div>
        </div>
        <div className="glass rounded-2xl p-6">
          <h3 className="text-base font-bold mb-3">بازی‌های تسویه‌شده ({settled.length})</h3>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {settled.map((m) => <SettledRow key={m.id} m={m} teams={teams} onDone={reload} />)}
          </div>
        </div>
      </div>
  );
}

/* ---------- apifootball.com fetch panel ---------- */
function FetchPanel({ onDone }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  async function doFetch() {
    setBusy(true);
    try {
      const r = await api.post("/admin/fetch");
      setResult(r.data);
      toast.success(`${r.data.events_count} بازی از API دریافت شد — ${r.data.created} جدید، ${r.data.updated} به‌روزرسانی، ${r.data.finished_pending} نیازمند تسویه، براکت حذفی همگام شد`);
      onDone?.();
    } catch (e) { toast.error(fmtErr(e)); }
    finally { setBusy(false); }
  }

  return (
      <div className="glass rounded-2xl p-6 border border-cyan-500/20" data-testid="fetch-panel">
        <div className="flex items-center justify-between gap-3 mb-2">
          <h3 className="text-base font-bold flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-400 pulse-live" />
            دریافت بازی‌ها از API (apifootball.com)
          </h3>
          <Button onClick={doFetch} disabled={busy} data-testid="fetch-btn" className="bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white font-bold hover:opacity-90">
            {busy ? "در حال دریافت..." : "دریافت بازی‌ها از API"}
          </Button>
        </div>
        <p className="text-[12px] text-gray-400 leading-6">
          با هر بار کلیک، لیست کامل بازی‌های جام جهانی ۲۰۲۶ (league_id=۲۸) از apifootball دریافت می‌شود.
          بازی‌های جدید (مثلاً مرحلهٔ حذفی پس از تعیین تیم‌ها) <b>ساخته می‌شوند</b>،
          بازی‌های موجود <b>به‌روزرسانی</b> می‌شوند، و بازی‌هایی که در API «Finished» شده‌اند ولی هنوز تسویه نشده‌اند با هشدار طلایی نشان داده می‌شوند.
          دریافت هیچ بازی‌ای را به‌صورت خودکار تسویه نمی‌کند – فقط شما را مطلع می‌سازد.
        </p>
        {result && (
            <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-2 text-[11px] mono">
              <Stat label="کل" v={result.events_count} />
              <Stat label="جدید" v={result.created} color="text-pos" />
              <Stat label="به‌روزرسانی" v={result.updated} color="text-cyan-300" />
              <Stat label="نیاز به تسویه" v={result.finished_pending} color="text-amber-300" />
              <Stat label="ناشناخته" v={result.unresolved} color={result.unresolved ? "text-neg" : "text-gray-400"} />
            </div>
        )}
        {result?.unresolved_names?.length > 0 && (
            <div className="mt-2 text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg p-2">
              نام‌های تطابق‌نیافته: {result.unresolved_names.join(" · ")}
            </div>
        )}
      </div>
  );
}
function Stat({ label, v, color }) {
  return <div className="bg-black/30 border border-white/5 rounded px-3 py-1.5"><span className="text-gray-400">{label}:</span> <span className={color || "text-white"}>{v}</span></div>;
}

function MatchRow({ m, teams, onDone }) {
  const [open, setOpen] = useState(false);
  const h = teams[m.home_team_id]; const a = teams[m.away_team_id];
  if (!h || !a) return null;
  const pending = m.needs_settlement;
  return (
      <div className={`flex items-center gap-3 p-3 rounded-xl ${pending ? "bg-amber-500/10 border border-amber-500/40" : "bg-black/20"}`} data-testid={`match-row-${m.id}`}>
        {pending && <span className="w-2.5 h-2.5 rounded-full bg-amber-400 pulse-live shrink-0" title="API می‌گوید این بازی تمام شده" />}
        <div className="flex-1 grid grid-cols-3 items-center gap-2 text-sm">
          <div className="flex items-center gap-2 justify-end"><span>{h.name_fa}</span><TeamFlag team={h} size={24} /></div>
          <div className="text-center text-[10px] text-gray-400 mono">
            {STAGE_LABEL[m.stage]}{m.group ? ` · گ ${m.group}` : ""}
            {pending && <div className="text-amber-300 mt-0.5">منتظر تسویه</div>}
          </div>
          <div className="flex items-center gap-2"><TeamFlag team={a} size={24} /><span>{a.name_fa}</span></div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid={`fetch-settle-${m.id}`} className={pending
                ? "bg-amber-400 text-black hover:bg-amber-300 font-bold"
                : "bg-gradient-to-r from-fuchsia-500 to-violet-500 text-white"}>
              {pending ? "بررسی و تسویه ⚠" : "تسویه دستی"}
            </Button>
          </DialogTrigger>
          <SettleDialog match={m} home={h} away={a} onClose={() => setOpen(false)} onDone={onDone} />
        </Dialog>
      </div>
  );
}

function SettleDialog({ match, home, away, onClose, onDone }) {
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);
  const [r, setR] = useState({
    home_goals: 0, away_goals: 0, home_yellow: 0, home_red: 0,
    away_yellow: 0, away_red: 0,
    penalty_winner: null, home_pen_goals: null, away_pen_goals: null,
  });

  useEffect(() => {
    api.get(`/admin/matches/${match.id}/preview`).then((res) => {
      setPreview(res.data);
      const f = res.data.fetched;
      setR({
        home_goals: f.home_goals, away_goals: f.away_goals,
        home_yellow: f.home_yellow, home_red: f.home_red,
        away_yellow: f.away_yellow, away_red: f.away_red,
        penalty_winner: f.penalty_winner ?? null,
        home_pen_goals: f.home_pen_goals ?? null,
        away_pen_goals: f.away_pen_goals ?? null,
      });
    }).finally(() => setLoading(false));
  }, [match.id]);

  const isKnockout = match.stage !== "group";
  const isDrawn = r.home_goals === r.away_goals;
  // آیا باید فیلد پنالتی نمایش داده شود؟
  const showPenalty = isKnockout && isDrawn;

  async function confirm() {
    // اعتبارسنجی client-side: اگر حذفی + تساوی باید penalty_winner مشخص باشد
    if (showPenalty && !r.penalty_winner) {
      toast.error("لطفاً برنده ضربات پنالتی را انتخاب کنید.");
      return;
    }
    // پاک‌سازی: اگر بازی حذفی نیست یا تساوی نیست، penalty_winner را null ارسال می‌کنیم
    const payload = { match_id: match.id, ...r };
    if (!showPenalty) {
      payload.penalty_winner = null;
      payload.home_pen_goals = null;
      payload.away_pen_goals = null;
    }
    try {
      await api.post("/admin/matches/settle", payload);
      toast.success("بازی با موفقیت تسویه شد");
      onDone?.(); onClose?.();
    } catch (e) { toast.error(fmtErr(e)); }
  }

  return (
      <DialogContent className="bg-[#0F1626] text-white border-white/10 max-w-2xl" dir="rtl">
        <DialogHeader>
          <DialogTitle>تسویه {home.name_fa} vs {away.name_fa}</DialogTitle>
        </DialogHeader>
        {loading ? <div className="text-center py-8 text-gray-400">در حال دریافت داده...</div> : (
            <div className="space-y-4">
              <div className="text-[11px] text-gray-400 mono">
                منبع: {preview?.fetched?.source}
                {preview?.fetched?.went_to_penalties && (
                    <span className="mr-2 text-amber-300 font-bold">⚡ این بازی به ضربات پنالتی رفته است</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <SideInputs title={home.name_fa} prefix="home" r={r} setR={setR} />
                <SideInputs title={away.name_fa} prefix="away" r={r} setR={setR} />
              </div>

              {/* بخش پنالتی — فقط در بازی‌های حذفی با تساوی نمایش داده می‌شود */}
              {showPenalty && (
                  <div className="glass rounded-xl p-4 border border-amber-500/40 bg-amber-500/5 space-y-3">
                    <div className="text-sm font-bold text-amber-200">⚽ نتیجه ضربات پنالتی</div>
                    <div className="text-xs text-gray-400">بازی با تساوی تمام شده — برنده پنالتی را مشخص کنید.</div>
                    <div className="flex gap-3">
                      <button
                          type="button"
                          data-testid="pen-winner-home"
                          onClick={() => setR({ ...r, penalty_winner: "home" })}
                          className={`flex-1 rounded-lg py-2 text-sm font-bold border transition-all ${
                              r.penalty_winner === "home"
                                  ? "bg-green-500/30 border-green-400 text-green-200"
                                  : "bg-black/30 border-white/10 text-gray-300 hover:border-white/30"
                          }`}
                      >
                        🏆 {home.name_fa} برنده
                      </button>
                      <button
                          type="button"
                          data-testid="pen-winner-away"
                          onClick={() => setR({ ...r, penalty_winner: "away" })}
                          className={`flex-1 rounded-lg py-2 text-sm font-bold border transition-all ${
                              r.penalty_winner === "away"
                                  ? "bg-green-500/30 border-green-400 text-green-200"
                                  : "bg-black/30 border-white/10 text-gray-300 hover:border-white/30"
                          }`}
                      >
                        🏆 {away.name_fa} برنده
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Row label={`گل پنالتی ${home.name_fa}`} v={r.home_pen_goals ?? ""} onChange={(v) => setR({ ...r, home_pen_goals: v === "" ? null : Number(v) })} testid="in-home-pen" />
                      <Row label={`گل پنالتی ${away.name_fa}`} v={r.away_pen_goals ?? ""} onChange={(v) => setR({ ...r, away_pen_goals: v === "" ? null : Number(v) })} testid="in-away-pen" />
                    </div>
                  </div>
              )}

              <PreviewBreakdown match={match} home={home} away={away} r={r} />
              <DialogFooter>
                <Button
                    onClick={confirm}
                    data-testid="confirm-settle"
                    disabled={showPenalty && !r.penalty_winner}
                    className="bg-green-500 hover:bg-green-400 text-black w-full disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  تأیید و واریز سکه‌ها
                </Button>
              </DialogFooter>
            </div>
        )}
      </DialogContent>
  );
}

function SideInputs({ title, prefix, r, setR }) {
  const set = (k, v) => setR({ ...r, [k]: Number(v) || 0 });
  return (
      <div className="glass rounded-xl p-4 space-y-2">
        <div className="text-sm font-bold mb-2">{title}</div>
        <Row label="گل‌ها" v={r[`${prefix}_goals`]} onChange={(v) => set(`${prefix}_goals`, v)} testid={`in-${prefix}-goals`} />
        <Row label="کارت زرد (هرکدام −۰.۵)" v={r[`${prefix}_yellow`]} onChange={(v) => set(`${prefix}_yellow`, v)} testid={`in-${prefix}-yellow`} />
        <Row label="کارت قرمز (هرکدام −۱)" v={r[`${prefix}_red`]} onChange={(v) => set(`${prefix}_red`, v)} testid={`in-${prefix}-red`} />
      </div>
  );
}
const Row = ({ label, v, onChange, testid }) => (
    <div className="flex items-center justify-between gap-2">
      <Label className="text-xs text-gray-300 flex-1">{label}</Label>
      <Input type="number" value={v} onChange={(e) => onChange(e.target.value)} className="w-24 bg-black/30 border-white/10 text-center mono" dir="ltr" data-testid={testid} />
    </div>
);

function PreviewBreakdown({ match, home, away, r }) {
  const tier_mult = (t) => (t <= 2 ? 2 : t <= 4 ? 1.5 : 1);
  const stageMap = { group: { win: 5, draw: 2 }, r32: { win: 6 }, r16: { win: 7 }, qf: { win: 8 }, sf: { win: 9 }, final: { win: 10 }, third: { win: 5 } };

  function side(team, my, other, mySide) {
    const arr = [];
    const m = tier_mult(team.tier);
    const cfg = stageMap[match.stage] || { win: 0, draw: 0 };

    if (my > other) {
      arr.push({ label: `برد (${m}×)`, amount: cfg.win * m });
    } else if (my === other && match.stage === "group") {
      arr.push({ label: `تساوی (${m}×)`, amount: cfg.draw * m });
    } else if (my === other && match.stage !== "group" && r.penalty_winner === mySide) {
      // برنده پنالتی
      arr.push({ label: `برد پنالتی (${m}×)`, amount: cfg.win * m });
    }

    if (my) arr.push({ label: `${my} گل زده (${m}×)`, amount: my * m });
    if (other) arr.push({ label: `${other} گل خورده`, amount: -other });

    return arr;
  }

  const h = side(home, r.home_goals, r.away_goals, "home");
  const a = side(away, r.away_goals, r.home_goals, "away");

  for (const [pref, list] of [["home", h], ["away", a]]) {
    if (r[`${pref}_yellow`]) list.push({ label: `${r[`${pref}_yellow`]} زرد`, amount: -0.5 * r[`${pref}_yellow`] });
    if (r[`${pref}_red`]) list.push({ label: `${r[`${pref}_red`]} قرمز`, amount: -1 * r[`${pref}_red`] });
  }

  const ht = h.reduce((s, x) => s + x.amount, 0);
  const at = a.reduce((s, x) => s + x.amount, 0);

  return (
      <div className="glass rounded-xl p-4 text-xs">
        <div className="text-gray-400 mb-2">پیش‌نمایش محاسبه سکه‌ها (پیش از تأیید):</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="font-bold mb-1">{home.name_fa}</div>
            {h.map((x) => <div key={x.label} className="flex justify-between"><span>{x.label}</span><span className={`mono ${x.amount >= 0 ? "text-pos" : "text-neg"}`}>{fmtSigned(x.amount)}</span></div>)}
            <div className="flex justify-between mt-1 pt-1 border-t border-white/10 font-bold"><span>جمع</span><span className={`mono ${ht >= 0 ? "text-pos" : "text-neg"}`}>{fmtSigned(ht)}</span></div>
          </div>
          <div>
            <div className="font-bold mb-1">{away.name_fa}</div>
            {a.map((x) => <div key={x.label} className="flex justify-between"><span>{x.label}</span><span className={`mono ${x.amount >= 0 ? "text-pos" : "text-neg"}`}>{fmtSigned(x.amount)}</span></div>)}
            <div className="flex justify-between mt-1 pt-1 border-t border-white/10 font-bold"><span>جمع</span><span className={`mono ${at >= 0 ? "text-pos" : "text-neg"}`}>{fmtSigned(at)}</span></div>
          </div>
        </div>
      </div>
  );
}

function SettledRow({ m, teams, onDone }) {
  const h = teams[m.home_team_id]; const a = teams[m.away_team_id];
  if (!h || !a) return null;
  const r = m.result;
  const penLabel = r?.penalty_winner
      ? ` (pen. ${r.home_pen_goals ?? "?"}-${r.away_pen_goals ?? "?"})`
      : "";
  async function rollback() {
    if (!window.confirm(`بازگشت تسویه ${h.name_fa} vs ${a.name_fa} ؟`)) return;
    try { await api.post(`/admin/matches/${m.id}/rollback`); toast.success("تسویه برگشت داده شد"); onDone?.(); }
    catch (e) { toast.error(fmtErr(e)); }
  }
  return (
      <div className="flex items-center gap-3 p-3 bg-black/20 rounded-xl">
        <div className="flex-1 grid grid-cols-3 items-center gap-2 text-sm">
          <div className="flex items-center gap-2 justify-end"><span>{h.name_fa}</span><TeamFlag team={h} size={24} /></div>
          <div className="text-center font-bold">
            <span className="mono">{r.home_goals} - {r.away_goals}</span>
            {penLabel && <div className="text-[10px] text-amber-300 mono">{penLabel}</div>}
          </div>
          <div className="flex items-center gap-2"><TeamFlag team={a} size={24} /><span>{a.name_fa}</span></div>
        </div>
        <Button size="sm" variant="outline" data-testid={`rollback-${m.id}`} onClick={rollback}><RefreshCw className="w-3 h-3" /> بازگشت</Button>
        <SettledMatchPosterDialog matchId={m.id} />
      </div>
  );
}

/* ----------------- Auction panel ----------------- */
function AuctionPanel() {
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [settings, setSettings] = useState({});
  const [selTeam, setSelTeam] = useState("");
  const [selUser, setSelUser] = useState("");
  const [price, setPrice] = useState("");
  async function reload() {
    const [t, u, s] = await Promise.all([api.get("/teams"), api.get("/users"), api.get("/settings")]);
    setTeams(t.data); setUsers(u.data.filter((x) => x.role === "player")); setSettings(s.data);
  }
  useEffect(() => { reload(); }, []);
  async function toggle(open) {
    try { await api.post(open ? "/admin/auction/open" : "/admin/auction/close"); toast.success("به‌روزرسانی شد"); reload(); }
    catch (e) { toast.error(fmtErr(e)); }
  }
  async function assign() {
    if (!selTeam || !selUser || !price) return;
    try {
      await api.post("/admin/auction/assign", { team_id: selTeam, user_id: selUser, price: Number(price) });
      toast.success("تیم واگذار شد");
      setSelTeam(""); setPrice(""); reload();
    } catch (e) { toast.error(fmtErr(e)); }
  }
  const free = teams.filter((t) => !t.current_owner_id);
  return (
      <div className="glass rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold flex items-center gap-2"><Gavel className="w-5 h-5 text-fuchsia-300" /> مزایده اولیه (سقف ۶۵ سکه)</h3>
          <div className="flex items-center gap-2">
            <Switch checked={settings.auction_open || false} onCheckedChange={toggle} data-testid="toggle-auction" />
            <span className="text-xs text-gray-300">{settings.auction_open ? "باز" : "بسته"}</span>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <Label className="text-xs">تیم</Label>
            <Select value={selTeam} onValueChange={setSelTeam}>
              <SelectTrigger data-testid="auction-team-select"><SelectValue placeholder="انتخاب تیم آزاد" /></SelectTrigger>
              <SelectContent>
                {free.map((t) => <SelectItem key={t.id} value={t.id}>{t.name_fa} (T{t.tier})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">برنده</Label>
            <Select value={selUser} onValueChange={setSelUser}>
              <SelectTrigger data-testid="auction-user-select"><SelectValue placeholder="بازیکن" /></SelectTrigger>
              <SelectContent>
                {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name} ({fmtCoins(u.balance)})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">قیمت نهایی</Label>
            <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} max={65} dir="ltr" data-testid="auction-price" className="bg-black/30 border-white/10" />
          </div>
          <div className="flex items-end">
            <Button onClick={assign} data-testid="auction-assign-btn" className="w-full bg-fuchsia-500 hover:bg-fuchsia-400">واگذاری</Button>
          </div>
        </div>
        <div className="divider" />
        <div>
          <div className="text-xs text-gray-400 mb-2">تیم‌های آزاد ({free.length})</div>
          <div className="flex flex-wrap gap-2">
            {free.map((t) => (
                <span key={t.id} className="text-xs px-2 py-1 rounded bg-white/5 flex items-center gap-1.5">
              <TeamFlag team={t} size={16} /> {t.name_fa}
            </span>
            ))}
          </div>
        </div>
      </div>
  );
}

/* ----------------- Window panel ----------------- */
function WindowPanel() {
  const [settings, setSettings] = useState({});
  const [bids, setBids] = useState([]);
  const [teams, setTeams] = useState({});
  const [users, setUsers] = useState({});
  async function reload() {
    const [s, b, t, u] = await Promise.all([api.get("/settings"), api.get("/admin/bids"), api.get("/teams"), api.get("/users")]);
    setSettings(s.data); setBids(b.data);
    setTeams(Object.fromEntries(t.data.map((x) => [x.id, x])));
    setUsers(Object.fromEntries(u.data.map((x) => [x.id, x])));
  }
  useEffect(() => { reload(); }, []);
  async function toggle(win, open) {
    try { await api.post("/admin/transfer-window", { window: win, open }); reload(); toast.success("اعمال شد"); }
    catch (e) { toast.error(fmtErr(e)); }
  }
  async function resolve() {
    if (!window.confirm("تأیید نهایی: همه پیشنهادها برنده‌گذاری و واگذار شوند؟")) return;
    try { const r = await api.post("/admin/bids/resolve"); toast.success(`${r.data.transferred} تیم منتقل شد`); reload(); }
    catch (e) { toast.error(fmtErr(e)); }
  }
  const byTeam = useMemo(
      () => bids.reduce((m, b) => { (m[b.team_id] ||= []).push(b); return m; }, {}),
      [bids]
  );

  return (
      <div className="space-y-4">
        <div className="glass rounded-2xl p-6">
          <h3 className="text-base font-bold mb-3">پنجره‌های نقل و انتقالات</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <WindowRow label="پنجره ۱ (پس از گروهی)" open={settings.window_1_open} onChange={(v) => toggle("window_1", v)} testid="window-1" />
            <WindowRow label="پنجره ۲ (پس از ۱.۱۶ نهایی)" open={settings.window_2_open} onChange={(v) => toggle("window_2", v)} testid="window-2" />
          </div>
        </div>
        <div className="glass rounded-2xl p-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-bold">پیشنهادهای بلایند فعال ({bids.length})</h3>
            <Button onClick={resolve} data-testid="resolve-bids" className="bg-cyan-500 text-black hover:bg-cyan-400">پایان پنجره و واگذاری</Button>
          </div>
          {Object.keys(byTeam).length === 0 ? (
              <div className="text-sm text-gray-400">پیشنهادی ثبت نشده.</div>
          ) : (
              <div className="space-y-3">
                {Object.entries(byTeam).map(([tid, list]) => {
                  const t = teams[tid];
                  list.sort((a, b) => b.amount - a.amount);
                  return (
                      <div key={tid} className="bg-black/20 rounded-xl p-3">
                        <div className="flex items-center gap-2 mb-2">
                          {t && <TeamFlag team={t} size={24} />}
                          <span className="text-sm font-bold">{t?.name_fa}</span>
                          <TierBadge tier={t?.tier || 1} />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {list.map((b, i) => (
                              <span key={b.id} className={`text-xs px-2 py-1 rounded mono ${i === 0 ? "bg-green-400/15 border border-green-400/30 text-pos" : "bg-white/5"}`}>
                        {users[b.user_id]?.name} · {fmtCoins(b.amount)}
                      </span>
                          ))}
                        </div>
                      </div>
                  );
                })}
              </div>
          )}
        </div>
      </div>
  );
}
function WindowRow({ label, open, onChange, testid }) {
  return (
      <div className="flex items-center justify-between bg-black/20 p-3 rounded-xl">
        <span className="text-sm">{label}</span>
        <div className="flex items-center gap-2">
          <Switch checked={open || false} onCheckedChange={onChange} data-testid={`toggle-${testid}`} />
          <span className="text-xs text-gray-300">{open ? "باز" : "بسته"}</span>
        </div>
      </div>
  );
}

/* ----------------- Bonus panel ----------------- */
function BonusPanel() {
  const [teams, setTeams] = useState([]);
  const [bt, setBT] = useState("");
  const [teamId, setTeamId] = useState("");
  useEffect(() => { api.get("/teams").then((r) => setTeams(r.data.filter((x) => x.current_owner_id))); }, []);
  async function award() {
    if (!bt || !teamId) return;
    try { await api.post("/admin/bonus/award", { bonus_type: bt, team_id: teamId }); toast.success("بونوس واریز شد"); setBT(""); setTeamId(""); }
    catch (e) { toast.error(fmtErr(e)); }
  }
  return (
      <div className="glass rounded-2xl p-6">
        <h3 className="text-base font-bold flex items-center gap-2 mb-3"><Award className="w-5 h-5 text-yellow-300" /> اعطای بونوس ویژه</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">نوع بونوس</Label>
            <Select value={bt} onValueChange={setBT}>
              <SelectTrigger data-testid="bonus-type-select"><SelectValue placeholder="انتخاب" /></SelectTrigger>
              <SelectContent>{BONUSES.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">تیم (دارای مالک)</Label>
            <Select value={teamId} onValueChange={setTeamId}>
              <SelectTrigger data-testid="bonus-team-select"><SelectValue placeholder="انتخاب تیم" /></SelectTrigger>
              <SelectContent>{teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name_fa}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button onClick={award} data-testid="bonus-award-btn" className="w-full bg-yellow-400 text-black hover:bg-yellow-300">اعطای بونوس</Button>
          </div>
        </div>
      </div>
  );
}

/* ----------------- Users panel ----------------- */
function UsersPanel() {
  const [users, setUsers] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ username: "", password: "", name: "", role: "player", initial_balance: 100 });
  async function reload() { const r = await api.get("/users"); setUsers(r.data); }
  useEffect(() => { reload(); }, []);
  async function create() {
    try { await api.post("/admin/users", form); toast.success("کاربر ایجاد شد"); setOpen(false); setForm({ username: "", password: "", name: "", role: "player", initial_balance: 100 }); reload(); }
    catch (e) { toast.error(fmtErr(e)); }
  }
  return (
      <div className="glass rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold">کاربران ({users.length})</h3>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button data-testid="new-user-btn"><Plus className="w-4 h-4" /> کاربر جدید</Button></DialogTrigger>
            <DialogContent className="bg-[#0F1626] text-white border-white/10" dir="rtl">
              <DialogHeader><DialogTitle>کاربر جدید</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label className="text-xs">نام فارسی</Label><Input data-testid="user-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-black/30 border-white/10" /></div>
                <div><Label className="text-xs">نام کاربری</Label><Input data-testid="user-username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} dir="ltr" className="bg-black/30 border-white/10" /></div>
                <div><Label className="text-xs">رمز عبور</Label><Input data-testid="user-password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} dir="ltr" className="bg-black/30 border-white/10" /></div>
                <div><Label className="text-xs">موجودی اولیه</Label><Input data-testid="user-balance" type="number" value={form.initial_balance} onChange={(e) => setForm({ ...form, initial_balance: Number(e.target.value) })} dir="ltr" className="bg-black/30 border-white/10" /></div>
                <Button onClick={create} data-testid="create-user-btn" className="w-full bg-cyan-500 text-black hover:bg-cyan-400">ایجاد</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
        <div className="space-y-1">
          {users.map((u) => (
              <UserRow key={u.id} u={u} onDeleted={reload} onAdjusted={reload} />
          ))}
        </div>
      </div>
  );
}

function UserRow({ u, onDeleted, onAdjusted }) {
  const [delta, setDelta] = useState("");
  async function del(id) {
    if (!window.confirm("حذف این کاربر؟")) return;
    try { await api.delete(`/admin/users/${id}`); toast.success("حذف شد"); onDeleted?.(); }
    catch (e) { toast.error(fmtErr(e)); }
  }
  async function adjust(sign) {
    const v = Number(delta);
    if (!v) return;
    try {
      await api.patch(`/admin/users/${u.id}`, { balance_delta: sign * Math.abs(v) });
      toast.success(`${sign > 0 ? "افزایش" : "کاهش"} ${Math.abs(v)} سکه`);
      setDelta("");
      onAdjusted?.();
    } catch (e) { toast.error(fmtErr(e)); }
  }
  return (
      <div className="flex flex-wrap items-center gap-3 p-2 bg-black/20 rounded-lg" data-testid={`user-row-${u.username}`}>
        <img src={avatarUrl(u.username)} className="w-8 h-8 rounded" alt="" />
        <div className="flex-1 min-w-[140px]">
          <div className="text-sm font-semibold">{u.name} <span className="text-[10px] text-gray-400 mono">@{u.username}</span></div>
          <div className="text-[10px] text-gray-500">{u.role === "admin" ? "ادمین" : "بازیکن"}</div>
        </div>
        <span className="mono text-sm text-cyan-300 w-16 text-center">{fmtCoins(u.balance)}</span>
        {u.role !== "admin" && (
            <>
              <Input type="number" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="مبلغ"
                     className="w-24 bg-black/30 border-white/10 mono text-center" dir="ltr"
                     data-testid={`adjust-input-${u.username}`} />
              <Button size="sm" onClick={() => adjust(1)} data-testid={`adjust-plus-${u.username}`}
                      className="bg-green-500 text-black hover:bg-green-400 px-3">+</Button>
              <Button size="sm" onClick={() => adjust(-1)} data-testid={`adjust-minus-${u.username}`}
                      className="bg-rose-500 hover:bg-rose-400 px-3">−</Button>
              <Button size="sm" variant="outline" onClick={() => del(u.id)} data-testid={`delete-user-${u.username}`}>
                <Trash2 className="w-3 h-3 text-rose-400" />
              </Button>
            </>
        )}
      </div>
  );
}

/* ----------------- Bracket Builder ----------------- */
function BracketBuilder() {
  const [teams, setTeams] = useState([]);
  const [stage, setStage] = useState("r32");
  const [h, setH] = useState(""); const [a, setA] = useState("");
  const [bracket, setBracket] = useState({});
  async function reload() {
    const [t, b] = await Promise.all([api.get("/teams"), api.get("/bracket")]);
    setTeams(t.data); setBracket(b.data);
  }
  useEffect(() => { reload(); }, []);
  async function add() {
    if (!h || !a || h === a) return;
    try { await api.post("/admin/matches", { stage, home_team_id: h, away_team_id: a }); toast.success("بازی اضافه شد"); setH(""); setA(""); reload(); }
    catch (e) { toast.error(fmtErr(e)); }
  }
  return (
      <div className="space-y-4">
        <div className="glass rounded-2xl p-6">
          <h3 className="text-base font-bold mb-3">افزودن بازی حذفی</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">مرحله</Label>
              <Select value={stage} onValueChange={setStage}>
                <SelectTrigger data-testid="ko-stage"><SelectValue /></SelectTrigger>
                <SelectContent>{["r32","r16","qf","sf","third","final"].map((s) => <SelectItem key={s} value={s}>{STAGE_LABEL[s]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">میزبان</Label>
              <Select value={h} onValueChange={setH}>
                <SelectTrigger data-testid="ko-home"><SelectValue placeholder="انتخاب تیم" /></SelectTrigger>
                <SelectContent>{teams.filter((t) => t.alive).map((t) => <SelectItem key={t.id} value={t.id}>{t.name_fa}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">میهمان</Label>
              <Select value={a} onValueChange={setA}>
                <SelectTrigger data-testid="ko-away"><SelectValue placeholder="انتخاب تیم" /></SelectTrigger>
                <SelectContent>{teams.filter((t) => t.alive).map((t) => <SelectItem key={t.id} value={t.id}>{t.name_fa}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex items-end"><Button onClick={add} data-testid="ko-add-btn" className="w-full bg-fuchsia-500 hover:bg-fuchsia-400">افزودن</Button></div>
          </div>
        </div>
      </div>
  );
}

/* ----------------- Logs panel ----------------- */
function LogsPanel() {
  const [logs, setLogs] = useState([]);
  useEffect(() => { api.get("/admin/logs?limit=300").then((r) => setLogs(r.data)); }, []);
  return (
      <div className="glass rounded-2xl p-6">
        <h3 className="text-base font-bold mb-3 flex items-center gap-2"><FileText className="w-5 h-5" /> لاگ‌های سیستم</h3>
        <div className="space-y-1 max-h-[500px] overflow-y-auto mono text-[11px]">
          {logs.map((l) => (
              <div key={l.id} className="grid grid-cols-[140px_180px_1fr] gap-2 p-1.5 bg-black/20 rounded">
                <span className="text-gray-500">{l.ts.slice(0, 19).replace("T", " ")}</span>
                <span className="text-cyan-300">{l.action}</span>
                <span className="text-gray-300 truncate">{JSON.stringify(l.payload)}</span>
              </div>
          ))}
        </div>
      </div>
  );
}

/* ----------------- Danger panel ----------------- */
function DangerPanel() {
  const [text, setText] = useState("");
  async function reset() {
    if (!window.confirm("آیا مطمئن هستید؟ تمام داده‌های بازی پاک خواهد شد.")) return;
    if (!window.confirm("تأیید نهایی! این کار قابل بازگشت نیست.")) return;
    try { await api.post("/admin/reset", null, { params: { confirm: text } }); toast.success("بازنشانی انجام شد"); }
    catch (e) { toast.error(fmtErr(e)); }
  }
  return (
      <div className="glass rounded-2xl p-6 border border-rose-500/30">
        <h3 className="text-base font-bold flex items-center gap-2 text-rose-300 mb-3"><AlertOctagon className="w-5 h-5" /> منطقه خطر</h3>
        <p className="text-sm text-gray-300 mb-3">تمام تیم‌ها، بازی‌ها، تراکنش‌ها و موجودی‌ها (به جز ادمین) به حالت اولیه بازنشانی می‌شوند.</p>
        <div className="flex gap-2 items-center">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="برای تأیید RESET-ALL را تایپ کنید" dir="ltr" className="bg-black/30 border-rose-400/30" data-testid="reset-confirm-input" />
          <Button onClick={reset} disabled={text !== "RESET-ALL"} className="bg-rose-500 hover:bg-rose-400" data-testid="reset-btn">بازنشانی همه چیز</Button>
        </div>
      </div>
  );
}
