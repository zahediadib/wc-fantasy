import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";
import { TeamFlag, TierBadge } from "@/components/TeamCard";
import { fmtCoins, fmtSigned, avatarUrl } from "@/lib/format";
import { X, Briefcase, Coins } from "lucide-react";

export default function PortfolioModal({ user, open, onClose }) {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open || !user) return;
    setLoading(true);
    api.get(`/portfolio/${user.id}`)
      .then((r) => setTeams(r.data))
      .finally(() => setLoading(false));
  }, [user, open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          data-testid="portfolio-modal"
        >
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
          <motion.div
            className="relative glass rounded-3xl border border-white/10 w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col"
            initial={{ scale: 0.85, opacity: 0, y: 30 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 30 }}
            transition={{ type: "spring", damping: 22, stiffness: 250 }}
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            <div className="p-6 border-b border-white/10 flex items-center gap-4">
              <motion.img
                src={avatarUrl(user.username)}
                alt=""
                className="w-16 h-16 rounded-2xl bg-white/5 ring-2 ring-fuchsia-500/50"
                initial={{ scale: 0 }} animate={{ scale: 1 }}
                transition={{ delay: 0.1, type: "spring" }}
              />
              <div className="flex-1">
                <div className="text-xl font-black">{user.name}</div>
                <div className="text-xs text-gray-400 mono">@{user.username}</div>
                <div className="mt-2 flex items-center gap-2">
                  <Coins className="w-4 h-4 text-yellow-300" />
                  <span className="mono text-lg font-bold text-cyan-300">{fmtCoins(user.balance)}</span>
                  <span className="text-xs text-gray-400">سکه</span>
                  <span className="mr-3 px-2 py-0.5 rounded bg-fuchsia-500/15 border border-fuchsia-500/30 text-[10px] mono">
                    <Briefcase className="inline w-3 h-3 ml-1" /> {teams.length} تیم
                  </span>
                </div>
              </div>
              <button
                onClick={onClose}
                data-testid="close-portfolio-modal"
                className="w-9 h-9 rounded-lg border border-white/10 hover:bg-white/5 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              {loading ? (
                <div className="text-center py-10 text-gray-400 text-sm">در حال بارگذاری...</div>
              ) : teams.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <Briefcase className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <div className="text-sm">این بازیکن هنوز تیمی در پورتفولیو ندارد</div>
                </div>
              ) : (
                <motion.div
                  className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
                  variants={{ shown: { transition: { staggerChildren: 0.05 } } }}
                  initial="hidden" animate="shown"
                >
                  {teams.map((t) => (
                    <motion.div
                      key={t.id}
                      variants={{ hidden: { opacity: 0, y: 12 }, shown: { opacity: 1, y: 0 } }}
                      className={`glass rounded-2xl p-4 ${t.alive ? "" : "opacity-60"}`}
                      data-testid={`modal-team-${t.code}`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <TeamFlag team={t} size={48} />
                        <TierBadge tier={t.tier} />
                      </div>
                      <div className="text-sm font-bold">{t.name_fa}</div>
                      <div className="text-[10px] text-gray-400 mono mb-2">گروه {t.group}</div>
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-400">ROI</span>
                        <span className={`mono font-bold ${(t.roi || 0) >= 0 ? "text-pos" : "text-neg"}`}>
                          {fmtSigned(t.roi || 0)}
                        </span>
                      </div>
                      {!t.alive && (
                        <div className="mt-2 text-center text-[9px] uppercase tracking-widest text-rose-400 border-t border-rose-400/30 pt-1">حذف شده</div>
                      )}
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
