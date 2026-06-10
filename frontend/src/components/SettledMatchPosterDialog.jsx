import React, { useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { Download, Image as ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, fmtErr } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { fmtCoins, fmtSigned, toFaDigits } from "@/lib/format";

const BACKGROUNDS = ["/images/blue.jpg", "/images/green.jpg", "/images/purple.jpg", "/images/red.jpg"];
const DEFAULT_BG = "/images/blue.jpg";

function randomBackground() {
  return BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)];
}

async function ensureImageExists(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

function normalizePosterData(raw) {
  const teams = Array.isArray(raw?.teams) ? raw.teams : [];
  if (teams.length !== 2) return null;
  const hasBasics = raw?.match?.status && raw?.match?.date && raw?.match?.tournamentStage;
  if (!hasBasics) return null;
  for (const t of teams) {
    if (!t?.countryName || !t?.flagUrl || !t?.tierName) return null;
    if (!Array.isArray(t?.fantasyStats) || !Array.isArray(t?.usersROI)) return null;
  }
  return raw;
}

async function waitForImages(root) {
  if (!root) return;
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(images.map((img) => {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    return new Promise((resolve) => {
      img.onload = () => resolve();
      img.onerror = () => resolve();
    });
  }));
}

function TeamPosterColumn({ team }) {
  return (
    <div className="rounded-3xl border border-white/30 bg-white/10 backdrop-blur-xl p-6 shadow-[0_15px_60px_rgba(0,0,0,0.35)]">
      <div className="flex items-center gap-4">
        <img src={team.flagUrl} alt={team.countryName} className="w-16 h-11 object-cover rounded-lg ring-1 ring-white/60" crossOrigin="anonymous" />
        <div>
          <div className="text-2xl font-black text-white drop-shadow-[0_4px_16px_rgba(0,0,0,0.85)]">{team.countryName}</div>
          <div className="text-xs text-yellow-200 font-bold">{team.tierName}</div>
        </div>
        <div className="mr-auto text-4xl font-black text-cyan-200 drop-shadow-[0_4px_18px_rgba(0,255,255,0.35)]">{toFaDigits(team.matchResult ?? 0)}</div>
      </div>

      <div className="mt-5 min-h-[200px] rounded-2xl border border-white/25 bg-black/30 p-4">
        <div className="text-[13px] text-[center] font-bold text-white mb-4">جزئیات امتیازات فانتزی</div>
        <div className="space-y-1.5">
          {team.fantasyStats.map((s, idx) => (
            <div key={`${team.countryName}-${idx}`} className="flex items-center justify-between text-[13px] text-white/95">
              <span>{s.title}</span>
              <span style={{ direction: "ltr" }} className={`mono font-bold ${s.finalScore >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{fmtSigned(s.finalScore)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-yellow-300/40 bg-yellow-500/10 p-3">
          <div className="text-[11px] text-yellow-100">جمع امتیاز مسابقه</div>
          <div style={{ direction: "ltr" }} className={`mono text-xl font-black ${team.totalMatchScore >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{fmtSigned(team.totalMatchScore)}</div>
        </div>
        <div className="rounded-xl border border-cyan-300/40 bg-cyan-500/10 p-3">
          <div className="text-[11px] text-cyan-100">بازگشت سرمایه بازیکن</div>
          <div className="text-[11px] text-cyan-50 mt-1 space-y-1 max-h-16 overflow-hidden">
            {team.usersROI.length === 0 ? <div>بدون داده</div> : team.usersROI.slice(0, 3).map((u) => (
              <div key={`${team.countryName}-${u.userId}`} className="flex items-center justify-between gap-2">
                <span className="truncate">{u.userName}</span>
                <span style={{ direction: "ltr" }} className={`mono ${u.roi >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{fmtSigned(u.roi)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SettledMatchPosterDialog({ matchId }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [matchData, setMatchData] = useState(null);
  const [bgImage, setBgImage] = useState(randomBackground());
  const posterRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setMatchData(null);
    const selectedBg = randomBackground();
    setBgImage(selectedBg);
    ensureImageExists(selectedBg).then((ok) => {
      if (!ok && !cancelled) setBgImage(DEFAULT_BG);
    });
    api.get(`/admin/matches/${matchId}/poster`).then((res) => {
      if (cancelled) return;
      const normalized = normalizePosterData(res.data);
      if (!normalized) {
        toast.error("داده پوستر معتبر نیست");
        return;
      }
      setMatchData(normalized);
    }).catch((e) => toast.error(fmtErr(e))).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, matchId]);

  const filename = useMemo(() => {
    if (!matchData) return "wc2026-poster.png";
    const [h, a] = matchData.teams;
    return `wc2026-${h.countryName}-${a.countryName}-${matchData.match.date}.png`;
  }, [matchData]);

  async function exportPoster() {
    if (!posterRef.current || !matchData) return;
    setExporting(true);
    try {
      await waitForImages(posterRef.current);
      const dataUrl = await toPng(posterRef.current, {
        cacheBust: true,
        pixelRatio: 3,
        quality: 1,
        canvasWidth: 1080,
        canvasHeight: 1080,
        skipFonts: false,
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = filename;
      a.click();
      toast.success("پوستر با کیفیت بالا دانلود شد");
    } catch (e) {
      toast.error(`خطا در خروجی تصویر: ${fmtErr(e)}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="border-cyan-300/40 text-cyan-200 hover:bg-cyan-500/10">
          <ImageIcon className="w-3.5 h-3.5" /> خروجی پوستر
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-[#0F1626] text-white border-white/10 max-w-5xl" dir="rtl">
        <DialogHeader>
          <DialogTitle>پوستر بازی تسویه‌شده</DialogTitle>
          <DialogDescription>تم جام جهانی ۲۰۲۶ با خروجی PNG با کیفیت بالا</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-16 flex items-center justify-center text-gray-300 gap-2"><Loader2 className="w-4 h-4 animate-spin" /> در حال آماده‌سازی پوستر...</div>
        ) : !matchData ? (
          <div className="py-16 text-center text-rose-300">داده پوستر قابل نمایش نیست.</div>
        ) : (
          <>
            <div className="rounded-xl border border-white/15 overflow-hidden bg-black/20">
              <div className="origin-top-left scale-[0.62] w-[1080px] h-[1080px] -mb-[410px] -mr-[205px]">
                <PosterCanvas ref={posterRef} matchData={matchData} bgImage={bgImage} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button onClick={exportPoster} disabled={exporting} className="bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white font-bold">
                {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} دانلود PNG
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

const PosterCanvas = React.forwardRef(function PosterCanvas({ matchData, bgImage }, ref) {
  const [home, away] = matchData.teams;
  return (
    <div
      ref={ref}
      className="w-[1080px] h-[1080px] relative overflow-hidden text-white"
      style={{
        fontFamily: "Vazirmatn, sans-serif",
        backgroundImage: `linear-gradient(140deg, rgba(4,10,24,0.75), rgba(8,12,18,0.45)), url(${bgImage})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,215,0,0.2),transparent_55%)]" />
      <div className="relative h-full p-10 flex flex-col">
        <div className="rounded-3xl border border-yellow-200/40 bg-white/10 backdrop-blur-xl p-6 text-center shadow-[0_20px_80px_rgba(0,0,0,0.35)]">
          <div className="text-xs tracking-[0.2em] text-yellow-100/90">WORLD CUP 2026 · FANTASY SETTLEMENT</div>
          <div className="mt-2 text-4xl font-black drop-shadow-[0_4px_18px_rgba(0,0,0,0.7)]">نتیجه بازی</div>
          <div className="mt-2 flex items-center justify-center gap-4 text-sm text-cyan-100">
            <span>{matchData.match.status}</span>
            <span>•</span>
            <span>{matchData.match.tournamentStage}</span>
            <span>•</span>
            <span>{matchData.match.date}</span>
          </div>
          <div className="mt-4 text-5xl font-black text-emerald-200 tracking-wide">{matchData.match.finalScore}</div>
        </div>

        <div className="mt-8 grid {/*grid-cols-[1fr_180px_1fr]*/} grid-cols-2 gap-5 flex-1">
          <TeamPosterColumn team={home} />
          {/*<div className="h-full rounded-3xl border border-white/30 bg-white/10 backdrop-blur-xl flex flex-col items-center justify-center p-4">*/}
          {/*  <div className="text-[11px] text-gray-200 mb-2">وضعیت</div>*/}
          {/*  <div className="text-lg font-bold text-emerald-200">{matchData.match.status}</div>*/}
          {/*  <div className="w-full h-px bg-gradient-to-r from-transparent via-white/30 to-transparent my-4" />*/}
          {/*  <div className="text-[11px] text-gray-200">نتیجه نهایی</div>*/}
          {/*  <div className="text-4xl font-black text-white mt-2">{matchData.match.finalScore}</div>*/}
          {/*</div>*/}
          <TeamPosterColumn team={away} />
        </div>
      </div>
    </div>
  );
});
