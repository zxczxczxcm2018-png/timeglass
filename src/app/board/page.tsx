"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

type Session = {
  id: string;
  employee_id: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  custom_note: string | null;
  is_paid: boolean;
  is_disputed: boolean;
  employees?: { name: string; is_active?: boolean };
  session_activities?: {
    custom_text: string | null;
    activity_types?: { name: string } | null;
  }[];
};

type RunningSession = {
  id: string;
  employee_id: string;
  started_at: string;
  employees?: { name: string };
};

export default function BoardPage() {
  const supabase = createClient();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [running, setRunning] = useState<RunningSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterPaid, setFilterPaid] = useState<"all" | "paid" | "unpaid">("all");
  const [filterEmployee, setFilterEmployee] = useState("all");
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);
  const [sortBy, setSortBy] = useState<"date" | "hours" | "name">("date");
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  // Date range - current month by default
  const now = new Date();
  const [fromDate, setFromDate] = useState(
    new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  );
  const [toDate, setToDate] = useState(now.toISOString().slice(0, 10));

  const load = useCallback(async () => {
    const from = new Date(fromDate);
    from.setHours(0, 0, 0, 0);
    const to = new Date(toDate);
    to.setHours(23, 59, 59, 999);

    // Completed sessions
    let q = supabase
      .from("work_sessions")
      .select(`
        id, employee_id, started_at, ended_at, status, custom_note, is_paid, is_disputed,
        employees ( name, is_active ),
        session_activities ( custom_text, activity_types ( name ) )
      `)
      .eq("status", "completed")
      .gte("started_at", from.toISOString())
      .lte("started_at", to.toISOString())
      .order("started_at", { ascending: false });

    if (filterEmployee !== "all") q = q.eq("employee_id", filterEmployee);
    if (filterPaid === "paid") q = q.eq("is_paid", true);
    if (filterPaid === "unpaid") q = q.eq("is_paid", false);

    const { data } = await q;
    if (data) setSessions(data as any);

    // Currently running
    const { data: run } = await supabase
      .from("work_sessions")
      .select(`id, employee_id, started_at, employees ( name )`)
      .eq("status", "running")
      .order("started_at", { ascending: false });
    if (run) setRunning(run as any);

    // Employees list
    const { data: emps } = await supabase
      .from("employees")
      .select("id, name")
      .eq("is_active", true)
      .order("name");
    if (emps) setEmployees(emps);

    setLastUpdate(new Date());
    setLoading(false);
  }, [fromDate, toDate, filterPaid, filterEmployee]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000); // live every 30s
    return () => clearInterval(interval);
  }, [load]);

  const getHours = (start: string, end: string | null) => {
    if (!end) return 0;
    return (new Date(end).getTime() - new Date(start).getTime()) / 3600000;
  };

  const getActivities = (s: Session) => {
    if (!s.session_activities?.length) return s.custom_note || "—";
    const names = s.session_activities
      .map((a) => a.activity_types?.name || a.custom_text || "")
      .filter(Boolean);
    return [...new Set(names)].join(", ") || "—";
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  // Sort
  const sorted = [...sessions].sort((a, b) => {
    if (sortBy === "name") {
      return (a.employees?.name || "").localeCompare(b.employees?.name || "");
    }
    if (sortBy === "hours") {
      return getHours(b.started_at, b.ended_at) - getHours(a.started_at, a.ended_at);
    }
    return new Date(b.started_at).getTime() - new Date(a.started_at).getTime();
  });

  // Totals
  const totalHours = sessions.reduce((sum, s) => sum + getHours(s.started_at, s.ended_at), 0);
  const paidHours = sessions.filter((s) => s.is_paid).reduce((sum, s) => sum + getHours(s.started_at, s.ended_at), 0);
  const unpaidHours = totalHours - paidHours;
  const disputedCount = sessions.filter((s) => s.is_disputed).length;

  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-6 font-sans">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight">MANIAC</h1>
          <p className="text-white/30 text-xs tracking-[0.2em] uppercase">TimeGlass Board · View Only</p>
        </div>
        <div className="text-right text-xs text-white/30">
          <p>Live · updates every 30s</p>
          <p>Last: {lastUpdate.toLocaleTimeString("en-GB")}</p>
        </div>
      </div>

      {/* Currently working */}
      {running.length > 0 && (
        <div className="mb-5 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5">
          <p className="text-[10px] uppercase tracking-wider text-emerald-400/70 mb-2">Currently Working</p>
          <div className="flex flex-wrap gap-2">
            {running.map((r) => (
              <div key={r.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-sm text-emerald-300">{r.employees?.name || "Unknown"}</span>
                <span className="text-xs text-emerald-500/60">since {formatTime(r.started_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm bg-[#111] border border-white/10 text-white outline-none" />
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm bg-[#111] border border-white/10 text-white outline-none" />

        <select value={filterEmployee} onChange={(e) => setFilterEmployee(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm outline-none"
          style={{ background: "#111", color: "#fff", border: "1px solid rgba(255,255,255,0.1)" }}>
          <option value="all" style={{ background: "#111" }}>All employees</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id} style={{ background: "#111" }}>{e.name}</option>
          ))}
        </select>

        <select value={filterPaid} onChange={(e) => setFilterPaid(e.target.value as any)}
          className="px-3 py-2 rounded-lg text-sm outline-none"
          style={{ background: "#111", color: "#fff", border: "1px solid rgba(255,255,255,0.1)" }}>
          <option value="all" style={{ background: "#111" }}>All status</option>
          <option value="paid" style={{ background: "#111" }}>Paid only</option>
          <option value="unpaid" style={{ background: "#111" }}>Unpaid only</option>
        </select>

        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}
          className="px-3 py-2 rounded-lg text-sm outline-none"
          style={{ background: "#111", color: "#fff", border: "1px solid rgba(255,255,255,0.1)" }}>
          <option value="date" style={{ background: "#111" }}>Sort: Date</option>
          <option value="hours" style={{ background: "#111" }}>Sort: Hours</option>
          <option value="name" style={{ background: "#111" }}>Sort: Name</option>
        </select>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <div className="p-3 rounded-xl bg-[#111] border border-white/5">
          <p className="text-[10px] text-white/30 uppercase">Total</p>
          <p className="text-lg font-medium">{totalHours.toFixed(1)}h</p>
        </div>
        <div className="p-3 rounded-xl bg-[#111] border border-emerald-500/20">
          <p className="text-[10px] text-emerald-500/50 uppercase">Paid</p>
          <p className="text-lg font-medium text-emerald-400">{paidHours.toFixed(1)}h</p>
        </div>
        <div className="p-3 rounded-xl bg-[#111] border border-white/5">
          <p className="text-[10px] text-white/30 uppercase">Unpaid</p>
          <p className="text-lg font-medium text-white/60">{unpaidHours.toFixed(1)}h</p>
        </div>
        <div className="p-3 rounded-xl bg-[#111] border border-amber-500/20">
          <p className="text-[10px] text-amber-500/50 uppercase">Disputed</p>
          <p className="text-lg font-medium text-amber-400">{disputedCount}</p>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-white/5">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-[10px] uppercase tracking-wider text-white/30">
              <th className="px-3 py-2.5 font-medium">Employee</th>
              <th className="px-3 py-2.5 font-medium">Date</th>
              <th className="px-3 py-2.5 font-medium">Time</th>
              <th className="px-3 py-2.5 font-medium">Hours</th>
              <th className="px-3 py-2.5 font-medium">Activity</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-white/30">Loading...</td></tr>
            ) : sorted.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-white/30">No sessions</td></tr>
            ) : (
              sorted.map((s) => (
                <tr key={s.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-3 py-2.5 font-medium whitespace-nowrap">
                    {s.employees?.name || "Unknown"}
                  </td>
                  <td className="px-3 py-2.5 text-white/50 whitespace-nowrap">
                    {formatDate(s.started_at)}
                  </td>
                  <td className="px-3 py-2.5 text-white/50 whitespace-nowrap">
                    {formatTime(s.started_at)}
                    {s.ended_at && ` – ${formatTime(s.ended_at)}`}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {getHours(s.started_at, s.ended_at).toFixed(2)}h
                  </td>
                  <td className="px-3 py-2.5 text-white/60 max-w-[200px] truncate">
                    {getActivities(s)}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <div className="flex gap-1.5">
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium uppercase"
                        style={{
                          background: s.is_paid ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.05)",
                          color: s.is_paid ? "#4ade80" : "rgba(255,255,255,0.35)"
                        }}>
                        {s.is_paid ? "Paid" : "Unpaid"}
                      </span>
                      {s.is_disputed && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium uppercase"
                          style={{ background: "rgba(245,158,11,0.15)", color: "#fbbf24" }}>
                          Disputed
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {sorted.length > 0 && (
            <tfoot>
              <tr className="border-t border-white/10 text-xs">
                <td className="px-3 py-2.5 text-white/40" colSpan={3}>Total ({sorted.length} sessions)</td>
                <td className="px-3 py-2.5 font-medium">{totalHours.toFixed(2)}h</td>
                <td></td>
                <td className="px-3 py-2.5 text-emerald-400/70">{paidHours.toFixed(1)}h paid</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="text-center text-white/15 text-[10px] mt-6">
        TimeGlass Board · Read-only · No authentication required
      </p>
    </div>
  );
}
