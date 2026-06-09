import React, { useEffect, useState } from "react";
import { api, fmtErr } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { fmtCoins, fmtSigned, avatarUrl } from "@/lib/format";
import { TeamFlag, TierBadge } from "@/components/TeamCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { ArrowLeftRight, Gavel, Inbox, SendHorizonal, Coins as CoinsIcon } from "lucide-react";

export default function Market() {
  const { user, refresh } = useAuth();
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [inbox, setInbox] = useState([]);
  const [outbox, setOutbox] = useState([]);
  const [myBids, setMyBids] = useState([]);
  const [settings, setSettings] = useState({});

  async function reload() {
    const [t, u, ib, ob, b, s] = await Promise.all([
      api.get("/teams"), api.get("/users"),
      api.get("/trades/inbox"), api.get("/trades/outbox"),
      api.get("/bids/mine"), api.get("/settings"),
    ]);
    setTeams(t.data); setUsers(u.data); setInbox(ib.data);
    setOutbox(ob.data); setMyBids(b.data); setSettings(s.data);
  }
  useEffect(() => { reload(); }, []);

  const myTeams = teams.filter((t) => t.current_owner_id === user?.id);
  const freeTeams = teams.filter((t) => !t.current_owner_id);
  const usersById = Object.fromEntries(users.map((u) => [u.id, u]));
  const teamsById = Object.fromEntries(teams.map((t) => [t.id, t]));
  const windowOpen = settings.window_1_open || settings.window_2_open || settings.auction_open;

  async function acceptTrade(id) {
    try { await api.post(`/trades/${id}/accept`); toast.success("معامله پذیرفته شد"); await reload(); await refresh(); }
    catch (e) { toast.error(fmtErr(e)); }
  }
  async function rejectTrade(id) {
    try { await api.post(`/trades/${id}/reject`); toast.success("معامله رد شد"); await reload(); }
    catch (e) { toast.error(fmtErr(e)); }
  }

  return (
    <div className="space-y-6" data-testid="market-page">
      <div className="flex items-center gap-3">
        <ArrowLeftRight className="w-6 h-6 text-cyan-300" />
        <h1 className="text-2xl font-black">بازار نقل و انتقالات</h1>
      </div>

      <Tabs defaultValue="trade" className="w-full">
        <TabsList className="bg-black/30 border border-white/10">
          <TabsTrigger value="trade" data-testid="tab-trade">معامله شخصی</TabsTrigger>
          <TabsTrigger value="bid" data-testid="tab-bid">مزایده بلایند</TabsTrigger>
          <TabsTrigger value="inbox" data-testid="tab-inbox">
            صندوق ورودی {inbox.length > 0 && <span className="mr-1 bg-fuchsia-500 text-white text-[10px] px-1.5 rounded-full">{inbox.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="outbox" data-testid="tab-outbox">ارسالی‌ها</TabsTrigger>
        </TabsList>

        {/* TAB 1: P2P trade */}
        <TabsContent value="trade" className="mt-6">
          <div className="glass rounded-2xl p-6">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><SendHorizonal className="w-5 h-5 text-cyan-300" /> پیشنهاد فروش از پورتفولیو شما</h2>
            {myTeams.length === 0 ? (
              <div className="text-sm text-gray-400">هنوز تیمی برای فروش ندارید.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {myTeams.map((t) => (
                  <ProposeTradeCard key={t.id} team={t} users={users.filter((u) => u.id !== user.id && u.role === "player")} onDone={async () => { await reload(); await refresh(); }} />
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* TAB 2: blind bids on free agents */}
        <TabsContent value="bid" className="mt-6">
          <div className="glass rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold flex items-center gap-2"><Gavel className="w-5 h-5 text-fuchsia-300" /> تیم‌های آزاد (Free Agents)</h2>
              <span className={`mono text-[10px] uppercase tracking-widest px-2 py-1 rounded ${windowOpen ? "bg-green-400/10 text-green-300 border border-green-400/30" : "bg-rose-500/10 text-rose-300 border border-rose-400/30"}`} data-testid="window-status">
                {windowOpen ? "پنجره باز" : "پنجره بسته"}
              </span>
            </div>
            {!windowOpen && (
              <div className="mb-4 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                در حال حاضر پنجره مزایده باز نیست. مدیر تورنمنت می‌تواند پنجره را باز کند.
              </div>
            )}
            {freeTeams.length === 0 ? (
              <div className="text-sm text-gray-400">تیم آزادی وجود ندارد.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {freeTeams.map((t) => {
                  const myBid = myBids.find((b) => b.team_id === t.id);
                  return <BlindBidCard key={t.id} team={t} myBid={myBid} disabled={!windowOpen} onDone={reload} />;
                })}
              </div>
            )}
            {myBids.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-bold text-gray-300 mb-2">پیشنهادهای فعال من</h3>
                <div className="flex flex-wrap gap-2">
                  {myBids.map((b) => {
                    const t = teamsById[b.team_id];
                    return (
                      <span key={b.id} className="text-xs px-3 py-1.5 rounded-full bg-fuchsia-500/15 border border-fuchsia-500/30 mono">
                        {t?.name_fa} · {fmtCoins(b.amount)}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* TAB 3: inbox */}
        <TabsContent value="inbox" className="mt-6">
          <div className="glass rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold flex items-center gap-2"><Inbox className="w-5 h-5 text-fuchsia-300" /> پیشنهادهای رسیده</h2>
              <span className={`mono text-[10px] uppercase tracking-widest px-2 py-1 rounded ${(settings.window_1_open || settings.window_2_open) ? "bg-green-400/10 text-green-300 border border-green-400/30" : "bg-rose-500/10 text-rose-300 border border-rose-400/30"}`}>
                {(settings.window_1_open || settings.window_2_open) ? "پنجره معاملات باز" : "پنجره معاملات بسته"}
              </span>
            </div>
            {!(settings.window_1_open || settings.window_2_open) && inbox.length > 0 && (
              <div className="mb-3 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                معاملات شخصی فقط هنگام بازبودن پنجره نقل و انتقالات قابل پذیرش هستند. پیشنهادها در صف می‌مانند تا پنجره باز شود.
              </div>
            )}
            {inbox.length === 0 ? (
              <div className="text-sm text-gray-400">پیشنهاد جدیدی وجود ندارد.</div>
            ) : (
              <div className="space-y-2">
                {inbox.map((tr) => {
                  const t = teamsById[tr.team_id];
                  const from = usersById[tr.from_user_id];
                  return (
                    <div key={tr.id} className="flex items-center gap-3 p-3 rounded-lg bg-black/20 border border-white/5" data-testid={`inbox-${tr.id}`}>
                      {t && <TeamFlag team={t} size={36} />}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm">{from?.name} پیشنهاد فروش <b>{t?.name_fa}</b> به قیمت <span className="mono text-cyan-300">{fmtCoins(tr.price)}</span> سکه را داده است.</div>
                      </div>
                      <Button size="sm" onClick={() => acceptTrade(tr.id)} data-testid={`accept-trade-${tr.id}`} className="bg-green-500 hover:bg-green-400 text-black">قبول</Button>
                      <Button size="sm" variant="outline" onClick={() => rejectTrade(tr.id)} data-testid={`reject-trade-${tr.id}`}>رد</Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>

        {/* TAB 4: outbox */}
        <TabsContent value="outbox" className="mt-6">
          <div className="glass rounded-2xl p-6">
            <h2 className="text-lg font-bold mb-4">پیشنهادهای ارسالی</h2>
            {outbox.length === 0 ? (
              <div className="text-sm text-gray-400">پیشنهادی ارسال نشده.</div>
            ) : (
              <div className="space-y-2">
                {outbox.map((tr) => {
                  const t = teamsById[tr.team_id];
                  const to = usersById[tr.to_user_id];
                  const color = tr.status === "pending" ? "text-amber-300" : tr.status === "accepted" ? "text-pos" : "text-neg";
                  const fa = { pending: "در انتظار", accepted: "پذیرفته‌شده", rejected: "رد شده" }[tr.status];
                  return (
                    <div key={tr.id} className="flex items-center gap-3 p-3 rounded-lg bg-black/20 border border-white/5">
                      {t && <TeamFlag team={t} size={36} />}
                      <div className="flex-1 text-sm">
                        فروش <b>{t?.name_fa}</b> به {to?.name} · قیمت <span className="mono text-cyan-300">{fmtCoins(tr.price)}</span>
                      </div>
                      <span className={`mono text-[11px] ${color}`}>{fa}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProposeTradeCard({ team, users, onDone }) {
  const [open, setOpen] = useState(false);
  const [toUser, setToUser] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!toUser || !price) return;
    setBusy(true);
    try {
      await api.post("/trades/propose", { team_id: team.id, to_user_id: toUser, price: Number(price) });
      toast.success("پیشنهاد ارسال شد");
      setOpen(false); setPrice(""); setToUser("");
      onDone?.();
    } catch (e) { toast.error(fmtErr(e)); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <div data-testid={`propose-card-${team.code}`} className="glass p-3 rounded-xl cursor-pointer hover:glow-cyan flex items-center gap-3">
          <TeamFlag team={team} size={40} />
          <div className="flex-1">
            <div className="text-sm font-bold">{team.name_fa}</div>
            <div className="text-[10px] text-gray-400">{team.name_en}</div>
          </div>
          <TierBadge tier={team.tier} />
        </div>
      </DialogTrigger>
      <DialogContent className="bg-[#0F1626] text-white border-white/10" dir="rtl">
        <DialogHeader><DialogTitle>پیشنهاد فروش {team.name_fa}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs">خریدار</Label>
            <Select value={toUser} onValueChange={setToUser}>
              <SelectTrigger data-testid="trade-buyer-select"><SelectValue placeholder="انتخاب کاربر" /></SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name} ({fmtCoins(u.balance)} سکه)</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">قیمت پیشنهادی (سکه)</Label>
            <Input data-testid="trade-price-input" type="number" value={price} onChange={(e) => setPrice(e.target.value)} dir="ltr" />
          </div>
          <Button onClick={submit} disabled={busy} data-testid="trade-submit" className="w-full bg-cyan-500 text-black hover:bg-cyan-400">ارسال پیشنهاد</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BlindBidCard({ team, myBid, disabled, onDone }) {
  const [amount, setAmount] = useState(myBid?.amount || "");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await api.post("/bids", { team_id: team.id, amount: Number(amount) });
      toast.success("پیشنهاد ثبت شد");
      onDone?.();
    } catch (e) { toast.error(fmtErr(e)); }
    finally { setBusy(false); }
  }
  return (
    <div className="glass p-3 rounded-xl">
      <div className="flex items-center gap-3 mb-3">
        <TeamFlag team={team} size={40} />
        <div className="flex-1">
          <div className="text-sm font-bold">{team.name_fa}</div>
          <div className="text-[10px] text-gray-400 mono">گروه {team.group}</div>
        </div>
        <TierBadge tier={team.tier} />
      </div>
      <div className="flex gap-2">
        <Input type="number" data-testid={`bid-input-${team.code}`} placeholder="مبلغ" value={amount} onChange={(e) => setAmount(e.target.value)} dir="ltr" disabled={disabled} className="bg-black/40 border-white/10" />
        <Button size="sm" onClick={submit} disabled={busy || disabled || !amount} data-testid={`bid-submit-${team.code}`} className="bg-fuchsia-500 hover:bg-fuchsia-400">
          {myBid ? "به‌روزرسانی" : "ثبت"}
        </Button>
      </div>
    </div>
  );
}
