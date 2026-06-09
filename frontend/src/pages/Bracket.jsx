import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { TeamFlag } from "@/components/TeamCard";
import { GitBranch } from "lucide-react";
import { fmtCoins, STAGE_LABEL, avatarUrl } from "@/lib/format";

const STAGES = ["r32", "r16", "qf", "sf", "third", "final"];

export default function Bracket() {
  const [bracket, setBracket] = useState({});
  const [teams, setTeams] = useState({});
  const [users, setUsers] = useState({});
  useEffect(() => {
    Promise.all([api.get("/bracket"), api.get("/teams"), api.get("/users")]).then(([b, t, u]) => {
      setBracket(b.data);
      setTeams(Object.fromEntries(t.data.map((x) => [x.id, x])));
      setUsers(Object.fromEntries(u.data.map((x) => [x.id, x])));
    });
  }, []);

  return (
    <div className="space-y-6" data-testid="bracket-page">
      <div className="flex items-center gap-3">
        <GitBranch className="w-6 h-6 text-fuchsia-300" />
        <h1 className="text-2xl font-black">جدول حذفی</h1>
      </div>

      <div className="overflow-x-auto pb-4">
        <div className="flex gap-6 min-w-max">
          {STAGES.map((s) => {
            const ms = bracket[s] || [];
            return (
              <div key={s} className="w-72 shrink-0" data-testid={`bracket-col-${s}`}>
                <div className="text-center mb-3">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-300 mono">{s}</div>
                  <div className="text-sm font-bold">{STAGE_LABEL[s]}</div>
                </div>
                <div className="space-y-3">
                  {ms.length === 0 ? (
                    <div className="glass rounded-xl p-6 text-center text-[11px] text-gray-500">هنوز برنامه‌ریزی نشده</div>
                  ) : ms.map((m) => {
                    const h = teams[m.home_team_id], a = teams[m.away_team_id];
                    const ho = h?.current_owner_id ? users[h.current_owner_id] : null;
                    const ao = a?.current_owner_id ? users[a.current_owner_id] : null;
                    return (
                      <div key={m.id} className="glass rounded-xl p-3">
                        <BracketSide team={h} owner={ho} goals={m.result?.home_goals} winner={m.result && m.result.home_goals > m.result.away_goals} />
                        <div className="divider my-2" />
                        <BracketSide team={a} owner={ao} goals={m.result?.away_goals} winner={m.result && m.result.away_goals > m.result.home_goals} />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BracketSide({ team, owner, goals, winner }) {
  if (!team) return <div className="text-xs text-gray-500 italic py-1">برنده مرحله قبل</div>;
  return (
    <div className={`flex items-center gap-2 ${winner ? "text-pos" : ""}`}>
      <TeamFlag team={team} size={22} />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold truncate">{team.name_fa}</div>
        {owner && (
          <div className="flex items-center gap-1 text-[10px] text-gray-400">
            <img src={avatarUrl(owner.username)} alt="" className="w-3 h-3 rounded" />
            <span>{owner.name}</span>
          </div>
        )}
      </div>
      <span className="mono text-sm font-bold w-6 text-center">{goals !== undefined ? fmtCoins(goals) : "—"}</span>
    </div>
  );
}
