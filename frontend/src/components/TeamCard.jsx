import React from "react";
import { flagUrl, fmtCoins, fmtSigned, TIER_COLOR } from "@/lib/format";

export function TeamFlag({ team, size = 48 }) {
  if (!team) return null;
  const w = size <= 24 ? 40 : 80;
  return (
    <img
      src={flagUrl(team.code, w)}
      alt={team.name_en}
      style={{ width: size, height: Math.round(size * 0.65), objectFit: "cover" }}
      className="rounded-md ring-1 ring-white/10"
    />
  );
}

export function TierBadge({ tier }) {
  return (
    <span
      className={`text-[10px] mono px-2 py-0.5 rounded-full bg-gradient-to-r ${TIER_COLOR[tier]} font-bold tracking-wide`}
      data-testid={`tier-badge-${tier}`}
    >
      T{tier} ×{tier <= 2 ? "1.0" : tier <= 4 ? "1.5" : "2.0"}
    </span>
  );
}

export default function TeamCard({ team, ownerName, roi, alive = true, onClick, action }) {
  return (
    <div
      data-testid={`team-card-${team.code}`}
      onClick={onClick}
      className={`relative glass rounded-2xl p-4 transition-all hover:-translate-y-1 ${
        alive ? "hover:glow-purple cursor-pointer" : "opacity-60"
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <TeamFlag team={team} size={56} />
        <TierBadge tier={team.tier} />
      </div>
      <div className="text-base font-bold text-white mb-0.5">{team.name_fa}</div>
      <div className="text-[10px] text-gray-400 mono mb-3">گروه {team.group} · {team.name_en}</div>
      {ownerName !== undefined && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-400">مالک:</span>
          <span className="text-white" data-testid={`team-owner-${team.code}`}>{ownerName || "آزاد"}</span>
        </div>
      )}
      {roi !== undefined && (
        <div className="flex items-center justify-between text-xs mt-1">
          <span className="text-gray-400">سود تحقق‌یافته:</span>
          <span className={`mono font-bold ${roi >= 0 ? "text-pos" : "text-neg"}`} data-testid={`team-roi-${team.code}`}>
            {fmtSigned(roi)}
          </span>
        </div>
      )}
      {!alive && (
        <div className="mt-2 text-center text-[10px] uppercase tracking-widest text-rose-400 border-t border-rose-400/30 pt-2">
          حذف شده
        </div>
      )}
      {action}
    </div>
  );
}
