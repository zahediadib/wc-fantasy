import React, { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { fmtSigned, avatarUrl } from "@/lib/format";
import { ScrollText, Filter } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function Ledger() {
  const [rows, setRows] = useState([]);
  const [users, setUsers] = useState([]);
  const [filterUserId, setFilterUserId] = useState("all");

  useEffect(() => {
    api.get("/users").then((r) => setUsers(r.data));
  }, []);

  useEffect(() => {
    const params = filterUserId === "all" ? "" : `&user_id=${filterUserId}`;
    api.get(`/ledger?limit=300${params}`).then((r) => setRows(r.data));
  }, [filterUserId]);

  const totals = useMemo(() => {
    const positive = rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
    const negative = rows.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0);
    return { positive, negative, net: positive + negative, count: rows.length };
  }, [rows]);

  return (
    <div className="space-y-6" data-testid="ledger-page">
      <div className="flex flex-wrap items-center gap-3">
        <ScrollText className="w-6 h-6 text-cyan-300" />
        <h1 className="text-2xl font-black">دفتر کل عمومی</h1>
      </div>

      <div className="glass rounded-2xl p-4 flex flex-wrap items-center gap-3">
        <Filter className="w-4 h-4 text-gray-400" />
        <span className="text-xs text-gray-400">فیلتر بازیکن:</span>
        <div className="w-56">
          <Select value={filterUserId} onValueChange={setFilterUserId}>
            <SelectTrigger data-testid="ledger-user-filter" className="bg-black/30 border-white/10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">همه بازیکنان</SelectItem>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap gap-3 mr-auto text-[11px] mono">
          <Badge label="تعداد" value={totals.count} />
          <Badge label="مثبت" value={fmtSigned(totals.positive)} color="text-pos" />
          <Badge label="منفی" value={fmtSigned(totals.negative)} color="text-neg" />
          <Badge label="خالص" value={fmtSigned(totals.net)} color={totals.net >= 0 ? "text-pos" : "text-neg"} />
        </div>
      </div>

      <div className="glass rounded-2xl p-3">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-gray-400">برای این فیلتر تراکنشی وجود ندارد</div>
        ) : (
          <div className="space-y-1">
            {rows.map((e) => (
              <div key={e.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5" data-testid={`ledger-${e.id}`}>
                <span className={`mono text-base font-bold w-20 text-left ${e.amount >= 0 ? "text-pos" : "text-neg"}`}>{fmtSigned(e.amount)}</span>
                <img src={avatarUrl(e.username)} alt="" className="w-8 h-8 rounded bg-white/5" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{e.user_name_fa}</div>
                  <div className="text-xs text-gray-400 truncate">{e.reason_fa}</div>
                </div>
                <span className="mono text-xs text-gray-500 whitespace-nowrap">موجودی: {Number(e.balance_after).toFixed(1)}</span>
                <span className="mono text-[10px] text-gray-500">{e.ts.slice(5, 16).replace("T", " ")}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Badge({ label, value, color }) {
  return (
    <span className="px-3 py-1.5 rounded-lg bg-black/30 border border-white/5">
      <span className="text-gray-400">{label}: </span>
      <span className={color || "text-white"}>{value}</span>
    </span>
  );
}
