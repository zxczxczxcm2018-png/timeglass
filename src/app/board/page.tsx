"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

type User = {
  id: string;
  name: string;
  role: string;
};

type Session = {
  id: string;
  employee_id: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  custom_note: string | null;
  is_paid: boolean;
  is_disputed: boolean;
  employees?: { name: string };
  session_activities?: {
    custom_text: string | null;
    activity_types?: { name: string } | null;
  }[];
};

type RunningInfo = {
  employee_id: string;
  name: string;
  started_at: string;
};

export default function BoardPage() {
  const supabase = createClient();

  const [user, setUser] = useState<User | null>(null);
  const [code, setCode] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [running, setRunning] = useState<RunningInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterPaid, setFilterPaid] = useState<"all" | "paid" | "unpaid">("all");
  const [filterEmployee, setFilterEmployee] = useState("all");
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);
  const [sortBy, setSortBy] = useState<"date" | "hours" | "name">("date");
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  const now = new Date();
  const [fromDate, setFromDate] = useState(
    new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  );
  const [toDate, setToDate] = useState(now.toISOString().slice(0, 10));

  // Check existing login
  useEffect(() => {
    const saved = localStorage.getItem("timeglass_board_user");
    if (saved) {
      try {
        setUser(JSON.parse(saved));
      } catch {}
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError("");
    const clean = code.trim().toUpperCase();
    const { data, error } = await supabase
      .from("employees")
      .select("id, name, role")
      .eq("access_code", clean)
      .eq("is_active", true)
      .single();
    if (error || !data) {
      setLoginError("Invalid access code");
      setLoginLoading(false);
      return;
    }
    localStorage.setItem("timeglass_board_user", JSON.stringify(data));
    setUser(data);
    setLoginLoading(false);
  };

  const handleLogout = () => {
    localStorage.removeItem("timeglass_board_user");
    setUser(null);
  };

  const load = useCallback(async () => {
    if (!user) return;

    const from = new Date(fromDate);
    from.setHours(0, 0, 0, 0);
    const to = new Date(toDate);
    to.setHours(23, 59, 59, 999);

    let q = supabase
      .from("work_sessions")
      .select(`
        id, employee_id, started_at, ended_at, status, custom_note, is_paid, is_disputed,
        employees ( name ),
        session_activities ( custom_text, activity_types ( name ) ),
        session_pauses ( paused_at, resumed_at )
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

    // Currently working: status=running, no open pause, unique by employee, started < 16h ago
    const cutoff = new Date(Date.now() - 16 * 60 * 60 * 1000).toISOString();
    const { data: runData } = await supabase
      .from("work_sessions")
      .select(`id, employee_id, started_at, employees ( name )`)
      .eq("status", "running")
      .gte("started_at", cutoff)
      .order("started_at", { ascending: false });

    if (runData && runData.length > 0) {
      // Get open pauses
      const ids = runData.map((r: any) => r.id);
      const { data: pauses } = await supabase
        .from("session_pauses")
        .select("session_id")
        .in("session_id", ids)
        .is("resumed_at", null);

      const pausedIds = new Set((pauses || []).map((p: any) => p.session_id));

      // Unique by employee_id, skip paused
      const seen = new Set<string>();
      const active: RunningInfo[] = [];
      for (const r of runData as any[]) {
        if (pausedIds.has(r.id)) continue;
        if (seen.has(r.employee_id)) continue;
        seen.add(r.employee_id);
        active.push({
          employee_id: r.employee_id,
          name: r.employees?.name || "Unknown",
          started_at: r.started_at,
        });
      }
      setRunning(active);
    } else {
      setRunning([]);
    }

    const { data: emps } = await supabase
      .from("employees")
      .select("id, name")
      .eq("is_active", true)
      .order("name");
    if (emps) setEmployees(emps);

    setLastUpdate(new Date());
    setLoading(false);
  }, [user, fromDate, toDate, filterPaid, filterEmployee]);

  useEffect(() => {
    if (!user) return;
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load, user]);

  // Times always in viewer's local timezone
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  const getHours = (s: { started_at: string; ended_at: string | null; session_pauses?: { paused_at: string; resumed_at: string | null }[] }) => {
    if (!s.ended_at) return 0;
    let ms = new Date(s.ended_at).getTime() - new Date(s.started_at).getTime();
    for (const p of s.session_pauses || []) {
      if (!p.paused_at) continue;
      const pEnd = p.resumed_at ? new Date(p.resumed_at).getTime() : new Date(s.ended_at).getTime();
      ms -= Math.max(0, pEnd - new Date(p.paused_at).getTime());
    }
    return Math.max(0, ms) / 3600000;
  };

  const getActivities = (s: Session) => {
    if (!s.session_activities?.length) return s.custom_note || "—";
    const names = s.session_activities
      .map((a) => a.activity_types?.name || a.custom_text || "")
      .filter(Boolean);
    return [...new Set(names)].join(", ") || "—";
  };

  const sorted = [...sessions].sort((a, b) => {
    if (sortBy === "name") return (a.employees?.name || "").localeCompare(b.employees?.name || "");
    if (sortBy === "hours") return getHours(b) - getHours(a);
    return new Date(b.started_at).getTime() - new Date(a.started_at).getTime();
  });

  const totalHours = sessions.reduce((s, x) => s + getHours(x), 0);
  const paidHours = sessions.filter((x) => x.is_paid).reduce((s, x) => s + getHours(x), 0);

  // LOGIN SCREEN
  if (!user) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-white tracking-tight">MANIAC</h1>
            <p className="text-white/30 text-xs tracking-[0.25em] uppercase mt-1">TimeGlass Board</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <input
              type="password"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ACCESS CODE"
              className="w-full text-center text-lg tracking-[0.3em] py-4 rounded-2xl outline-none text-white"
              style={{ background: "#111", border: "1px solid rgba(255,255,255,0.1)" }}
              autoFocus
            />
            {loginError && <p className="text-red-400 text-sm text-center">{loginError}</p>}
            <button
              type="submit"
              disabled={loginLoading || code.length < 3}
              className="w-full py-4 rounded-2xl font-medium text-white disabled:opacity-40"
              style={{ background: "linear-gradient(135deg, #7c3aed, #06b6d4)" }}
            >
              {loginLoading ? "..." : "Sign In"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // BOARD
  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-8 font-sans">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-xl font-bold">MANIAC</h1>
            <p className="text-white/30 text-xs tracking-[0.2em] uppercase">
              Board · {user.name} · times in your local timezone
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right text-xs text-white/30">
              <p>Live · 30s</p>
              <p>{lastUpdate.toLocaleTimeString()}</p>
            </div>
            <button onClick={handleLogout} className="text-xs px-3 py-1.5 rounded-lg text-white/40 border border-white/10">
              Logout
            </button>
          </div>
        </div>

        {/* Currently working */}
        {running.length > 0 && (
          <div className="mb-5 p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5">
            <p className="text-[10px] uppercase tracking-wider text-emerald-400/70 mb-2">Currently Working</p>
            <div className="flex flex-wrap gap-2">
              {running.map((r) => (
                <div key={r.employee_id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-sm text-emerald-300">{r.name}</span>
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
            <option value="paid" style={{ background: "#111" }}>Paid</option>
            <option value="unpaid" style={{ background: "#111" }}>Unpaid</option>
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}
            className="px-3 py-2 rounded-lg text-sm outline-none"
            style={{ background: "#111", color: "#fff", border: "1px solid rgba(255,255,255,0.1)" }}>
            <option value="date" style={{ background: "#111" }}>Sort: Date</option>
            <option value="hours" style={{ background: "#111" }}>Sort: Hours</option>
            <option value="name" style={{ background: "#111" }}>Sort: Name</option>
          </select>
        </div>

        {/* Summary */}
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
            <p className="text-lg font-medium text-white/60">{(totalHours - paidHours).toFixed(1)}h</p>
          </div>
          <div className="p-3 rounded-xl bg-[#111] border border-amber-500/20">
            <p className="text-[10px] text-amber-500/50 uppercase">Disputed</p>
            <p className="text-lg font-medium text-amber-400">{sessions.filter(s => s.is_disputed).length}</p>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-xl border border-white/5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-[10px] uppercase tracking-wider text-white/30">
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Time (your TZ)</th>
                <th className="px-4 py-3">Hours</th>
                <th className="px-4 py-3">Activity</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-white/30">Loading...</td></tr>
              ) : sorted.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-white/30">No sessions</td></tr>
              ) : (
                sorted.map((s) => (
                  <tr key={s.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5 font-medium whitespace-nowrap">{s.employees?.name || "—"}</td>
                    <td className="px-4 py-2.5 text-white/50 whitespace-nowrap">{formatDate(s.started_at)}</td>
                    <td className="px-4 py-2.5 text-white/50 whitespace-nowrap">
                      {formatTime(s.started_at)}{s.ended_at && ` – ${formatTime(s.ended_at)}`}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{getHours(s).toFixed(2)}h</td>
                    <td className="px-4 py-2.5 text-white/60 max-w-[220px] truncate">{getActivities(s)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
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
                  <td className="px-4 py-3 text-white/40" colSpan={3}>Total ({sorted.length} sessions)</td>
                  <td className="px-4 py-3 font-medium">{totalHours.toFixed(2)}h</td>
                  <td></td>
                  <td className="px-4 py-3 text-emerald-400/70">{paidHours.toFixed(1)}h paid</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
