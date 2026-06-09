import React, { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { TeamFlag } from "@/components/TeamCard";
import { fmtCoins, STAGE_LABEL } from "@/lib/format";
import { Calendar } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const Empty = () => (
  <div className="glass rounded-xl p-8 text-center text-gray-400 text-sm">بازی‌ای یافت نشد</div>
);

function FixtureRow({ m, teams }) {
  const h = teams[m.home_team_id];
  const a = teams[m.away_team_id];
  if (!h || !a) return null;
  const r = m.result;
  return (
    <div className="glass rounded-xl p-3 flex items-center gap-3" data-testid={`fixture-${m.id}`}>
      <div className="text-[10px] mono text-gray-400 w-24 text-center">
        <div>{STAGE_LABEL[m.stage]}</div>
        {m.group && <div className="text-cyan-300">گروه {m.group}</div>}
        <div className="mt-1">{m.kickoff.slice(0, 10)}</div>
      </div>
      <div className="flex-1 grid grid-cols-3 items-center gap-2">
        <div className="flex items-center gap-2 justify-end">
          <span className="text-sm font-bold truncate">{h.name_fa}</span>
          <TeamFlag team={h} size={28} />
        </div>
        <div className="text-center mono font-bold">
          {r ? `${fmtCoins(r.home_goals)} - ${fmtCoins(r.away_goals)}` : "vs"}
        </div>
        <div className="flex items-center gap-2">
          <TeamFlag team={a} size={28} />
          <span className="text-sm font-bold truncate">{a.name_fa}</span>
        </div>
      </div>
    </div>
  );
}

export default function Fixtures() {
  const [matches, setMatches] = useState([]);
  const [teams, setTeams] = useState({});

  useEffect(() => {
    Promise.all([api.get("/matches"), api.get("/teams")]).then(([m, t]) => {
      setMatches(m.data);
      setTeams(Object.fromEntries(t.data.map((x) => [x.id, x])));
    });
  }, []);

  const { todays, upcoming, completed } = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const live = (m) => m.status === "scheduled" || m.status === "finished_pending";
    return {
      todays: matches.filter((m) => live(m) && m.kickoff.slice(0, 10) === today),
      upcoming: matches.filter((m) => live(m) && m.kickoff.slice(0, 10) > today),
      completed: matches.filter((m) => m.status === "settled" || (m.status === "finished_pending" && m.kickoff.slice(0, 10) < today)),
    };
  }, [matches]);

  return (
    <div className="space-y-6" data-testid="fixtures-page">
      <div className="flex items-center gap-3">
        <Calendar className="w-6 h-6 text-cyan-300" />
        <h1 className="text-2xl font-black">برنامه بازی‌ها</h1>
      </div>
      <Tabs defaultValue="upcoming">
        <TabsList className="bg-black/30 border border-white/10">
          <TabsTrigger value="today" data-testid="tab-today">امروز ({todays.length})</TabsTrigger>
          <TabsTrigger value="upcoming" data-testid="tab-upcoming">آینده ({upcoming.length})</TabsTrigger>
          <TabsTrigger value="completed" data-testid="tab-completed">انجام شده ({completed.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="today" className="mt-4 space-y-2">
          {todays.length === 0 ? <Empty /> : todays.map((m) => <FixtureRow key={m.id} m={m} teams={teams} />)}
        </TabsContent>
        <TabsContent value="upcoming" className="mt-4 space-y-2">
          {upcoming.length === 0 ? <Empty /> : upcoming.map((m) => <FixtureRow key={m.id} m={m} teams={teams} />)}
        </TabsContent>
        <TabsContent value="completed" className="mt-4 space-y-2">
          {completed.length === 0 ? <Empty /> : completed.map((m) => <FixtureRow key={m.id} m={m} teams={teams} />)}
        </TabsContent>
      </Tabs>
    </div>
  );
}
