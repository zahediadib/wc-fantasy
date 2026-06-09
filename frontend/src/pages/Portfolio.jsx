import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import TeamCard from "@/components/TeamCard";
import { Briefcase } from "lucide-react";

export default function Portfolio() {
  const { user } = useAuth();
  const [teams, setTeams] = useState([]);

  useEffect(() => {
    if (!user) return;
    api.get("/portfolio/me").then((r) => setTeams(r.data));
  }, [user]);

  return (
    <div className="space-y-6" data-testid="portfolio-page">
      <div className="flex items-center gap-3">
        <Briefcase className="w-6 h-6 text-fuchsia-300" />
        <h1 className="text-2xl font-black">پورتفولیو من</h1>
        <span className="mono text-xs text-gray-400 mr-2">{teams.length} تیم در اختیار</span>
      </div>
      {teams.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center text-gray-400">
          <div className="text-lg font-semibold mb-2">هنوز هیچ تیمی نخریده‌اید</div>
          <div className="text-sm">منتظر مزایده باز یا پنجره نقل و انتقالات بمانید.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {teams.map((t) => (
            <TeamCard key={t.id} team={t} roi={t.roi} alive={t.alive} />
          ))}
        </div>
      )}
    </div>
  );
}
