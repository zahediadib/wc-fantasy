import React, { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { TeamFlag, TierBadge } from "@/components/TeamCard";
import { avatarUrl, fmtCoins } from "@/lib/format";
import { Trophy } from "lucide-react";

export default function Groups() {
  const [groups, setGroups] = useState({});
  useEffect(() => { api.get("/standings").then((r) => setGroups(r.data)); }, []);

  const sortedGroups = useMemo(() => Object.entries(groups).sort(), [groups]);

  return (
    <div className="space-y-6" data-testid="groups-page">
      <div className="flex items-center gap-3">
        <Trophy className="w-6 h-6 text-yellow-300" />
        <h1 className="text-2xl font-black">جدول گروه‌ها</h1>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {sortedGroups.map(([letter, rows]) => (
          <div key={letter} className="glass rounded-2xl p-4" data-testid={`group-${letter}`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-black tracking-tight">گروه {letter}</h3>
              <span className="mono text-[10px] text-gray-500">{rows.length} تیم</span>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 mono">
                  <th className="text-right pb-1">تیم</th>
                  <th className="pb-1">P</th><th className="pb-1">W</th><th className="pb-1">D</th><th className="pb-1">L</th>
                  <th className="pb-1">GF</th><th className="pb-1">GA</th><th className="pb-1">GD</th>
                  <th className="pb-1 text-fuchsia-300">امتیاز</th>
                </tr>
                <tr className="text-[9px] text-gray-500 mono">
                  <th></th><th>بازی</th><th>برد</th><th>مساوی</th><th>باخت</th><th>زده</th><th>خورده</th><th>تفاضل</th><th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-white/5">
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <TeamFlag team={r} size={22} />
                        <div className="min-w-0">
                          <div className="text-[12px] font-semibold truncate">{r.name_fa}</div>
                          {r.owner && (
                            <div className="flex items-center gap-1 text-[10px] text-gray-400">
                              <img src={avatarUrl(r.owner.username)} alt="" className="w-3.5 h-3.5 rounded" />
                              <span>{r.owner.name}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="text-center mono">{fmtCoins(r.stats.played)}</td>
                    <td className="text-center mono">{fmtCoins(r.stats.wins)}</td>
                    <td className="text-center mono">{fmtCoins(r.stats.draws)}</td>
                    <td className="text-center mono">{fmtCoins(r.stats.losses)}</td>
                    <td className="text-center mono">{fmtCoins(r.stats.gf)}</td>
                    <td className="text-center mono">{fmtCoins(r.stats.ga)}</td>
                    <td className={`text-center mono ${r.gd >= 0 ? "text-pos" : "text-neg"}`}>{fmtCoins(r.gd)}</td>
                    <td className="text-center mono font-bold text-cyan-300">{fmtCoins(r.points)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
