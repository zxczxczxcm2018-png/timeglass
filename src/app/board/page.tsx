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
  session_pauses?: {
    paused_at: string;
    resumed_at: string | null;
  }[];
};

type WorkBlock = {
  from: Date;
  to: Date;
  activities: string;
  sessionId: string;
};

type DayEmployee = {
  employeeId: string;
  name: string;
  blocks: WorkBlock[];
  totalHours: number;
  paidHours: number;
  sessionIds: string[];
  allPaid: boolean;
  anyDisputed: boolean;
};

type DayGroup = {
  dayKey: string;
  label: string;
  employees: DayEmployee[];
};

export default function BoardPage() {
  const supabase = createClient();

  const [user, setUser] = useState<User | null>(null);
  const [code, setCode] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filterEmployee, setFilterEmployee] = useState("all");
  const [filterPaid, setFilterPaid] = useState<"all" | "paid" | "unpaid">("all");
  const [period, setPeriod] = useState<"day" | "week" | "month" | "year" | "custom">("month");
  const [running, setRunning] = useState<{ employee_id: string; name: string; started_at: string }[]>([]);

  const now = new Date();
  const [fromDate, setFromDate] = useState(
    new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  );
  const [toDate, setToDate] = useState(now.toISOString().slice(0, 10));

  const isAdmin = user?.role === "admin";

  const applyPeriod = (p: "day" | "week" | "month" | "year") => {
    const n = new Date();
    const to = n.toISOString().slice(0, 10);
    let from: Date;
    if (p === "day") {
      from = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    } else if (p === "week") {
      from = new Date(n);
      const day = from.getDay();
      from.setDate(from.getDate() - (day === 0 ? 6 : day - 1));
      from.setHours(0, 0, 0, 0);
    } else if (p === "month") {
      from = new Date(n.getFullYear(), n.getMonth(), 1);
    } else {
      from = new Date(n.getFullYear(), 0, 1);
    }
    setPeriod(p);
    setFromDate(from.toISOString().slice(0, 10));
    setToDate(to);
  };

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
    const loadFrom = new Date(from);
    loadFrom.setDate(loadFrom.getDate() - 1);

    const to = new Date(toDate);
    to.setHours(23, 59, 59, 999);

    const { data } = await supabase
      .from("work_sessions")
      .select(`
        id, employee_id, started_at, ended_at, status, custom_note, is_paid, is_disputed,
        employees ( name ),
        session_activities ( custom_text, activity_types ( name ) ),
        session_pauses ( paused_at, resumed_at )
      `)
      .eq("status", "completed")
      .gte("started_at", loadFrom.toISOString())
      .lte("started_at", to.toISOString())
      .order("started_at", { ascending: true });

    if (data) setSessions(data as any);

    // Currently working: running + fresh heartbeat (≤2 min) + no open pause
    const hbCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: runData } = await supabase
      .from("work_sessions")
      .select(`id, employee_id, started_at, last_heartbeat_at, employees ( name )`)
      .eq("status", "running")
      .gte("last_heartbeat_at", hbCutoff)
      .order("started_at", { ascending: false });

    if (runData && runData.length > 0) {
      const ids = runData.map((r: any) => r.id);
      const { data: pauses } = await supabase
        .from("session_pauses")
        .select("session_id")
        .in("session_id", ids)
        .is("resumed_at", null);
      const pausedIds = new Set((pauses || []).map((p: any) => p.session_id));
      const seen = new Set<string>();
      const active: { employee_id: string; name: string; started_at: string }[] = [];
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

    setLastUpdate(new Date());
    setLoading(false);
  }, [user, fromDate, toDate]);

  useEffect(() => {
    if (!user) return;
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load, user]);

  const formatTime = (d: Date) => {
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, "0");
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${m} ${ampm}`;
  };

  const dayKeyLocal = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const dayLabel = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString(undefined, {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const getActivities = (s: Session) => {
    if (!s.session_activities?.length) {
      return s.custom_note && s.custom_note !== "__skipped__" ? s.custom_note : "—";
    }
    const names = s.session_activities
      .map((a) => a.activity_types?.name || a.custom_text || "")
      .filter(Boolean);
    return [...new Set(names)].join(", ") || "—";
  };

  const getWorkSegments = (s: Session): { from: Date; to: Date }[] => {
    if (!s.ended_at) return [];
    const endMs = new Date(s.ended_at).getTime();
    const startMs = new Date(s.started_at).getTime();

    const raw = [...(s.session_pauses || [])]
      .filter((p) => p.paused_at)
      .map((p) => ({
        start: Math.max(startMs, new Date(p.paused_at).getTime()),
        end: Math.min(endMs, new Date(p.resumed_at || s.ended_at!).getTime()),
      }))
      .filter((p) => p.end > p.start)
      .sort((a, b) => a.start - b.start);

    const merged: { start: number; end: number }[] = [];
    for (const p of raw) {
      if (merged.length && p.start <= merged[merged.length - 1].end) {
        merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, p.end);
      } else {
        merged.push({ ...p });
      }
    }

    const work: { from: Date; to: Date }[] = [];
    let cursor = startMs;
    for (const p of merged) {
      if (p.start > cursor) work.push({ from: new Date(cursor), to: new Date(p.start) });
      cursor = Math.max(cursor, p.end);
    }
    if (endMs > cursor) work.push({ from: new Date(cursor), to: new Date(endMs) });
    if (work.length === 0 && endMs > startMs) {
      work.push({ from: new Date(startMs), to: new Date(endMs) });
    }
    return work;
  };

  const splitAtMidnight = (from: Date, to: Date): { from: Date; to: Date }[] => {
    const parts: { from: Date; to: Date }[] = [];
    let cur = new Date(from);
    while (cur < to) {
      const nextMidnight = new Date(cur);
      nextMidnight.setHours(24, 0, 0, 0);
      if (to > nextMidnight) {
        const endOfDay = new Date(cur);
        endOfDay.setHours(23, 59, 59, 999);
        parts.push({ from: new Date(cur), to: endOfDay });
        cur = new Date(nextMidnight);
      } else {
        parts.push({ from: new Date(cur), to: new Date(to) });
        break;
      }
    }
    return parts;
  };

  const buildDayGroups = (): DayGroup[] => {
    const rangeStart = new Date(fromDate);
    rangeStart.setHours(0, 0, 0, 0);
    const rangeEnd = new Date(toDate);
    rangeEnd.setHours(23, 59, 59, 999);

    const map = new Map<string, Map<string, DayEmployee>>();

    for (const s of sessions) {
      if (!s.ended_at) continue;
      const activities = getActivities(s);
      const workSegs = getWorkSegments(s);

      for (const w of workSegs) {
        for (const part of splitAtMidnight(w.from, w.to)) {
          if (part.to < rangeStart || part.from > rangeEnd) continue;

          const key = dayKeyLocal(part.from);
          if (!map.has(key)) map.set(key, new Map());
          const empMap = map.get(key)!;
          const empId = s.employee_id;
          const empName = s.employees?.name || "Unknown";

          if (!empMap.has(empId)) {
            empMap.set(empId, {
              employeeId: empId,
              name: empName,
              blocks: [],
              totalHours: 0,
              paidHours: 0,
              sessionIds: [],
              allPaid: true,
              anyDisputed: false,
            });
          }
          const emp = empMap.get(empId)!;
          const hours = (part.to.getTime() - part.from.getTime()) / 3600000;
          emp.blocks.push({
            from: part.from,
            to: part.to,
            activities,
            sessionId: s.id,
          });
          emp.totalHours += hours;
          if (s.is_paid) emp.paidHours += hours;
          if (!emp.sessionIds.includes(s.id)) emp.sessionIds.push(s.id);
          if (!s.is_paid) emp.allPaid = false;
          if (s.is_disputed) emp.anyDisputed = true;
        }
      }
    }

    const days = [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
    return days.map(([dayKey, empMap]) => ({
      dayKey,
      label: dayLabel(dayKey),
      employees: [...empMap.values()]
        .map((e) => ({
          ...e,
          blocks: e.blocks.sort((a, b) => a.from.getTime() - b.from.getTime()),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }));
  };

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleDayPaid = async (emp: DayEmployee, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAdmin || emp.sessionIds.length === 0) return;
    const newVal = !emp.allPaid;
    await supabase
      .from("work_sessions")
      .update({ is_paid: newVal })
      .in("id", emp.sessionIds);
    setSessions((prev) =>
      prev.map((s) =>
        emp.sessionIds.includes(s.id) ? { ...s, is_paid: newVal } : s
      )
    );
  };

  const allDayGroups = buildDayGroups();

  // Unique employees for filter dropdown
  const employeeOptions = (() => {
    const map = new Map<string, string>();
    for (const d of allDayGroups) {
      for (const e of d.employees) map.set(e.employeeId, e.name);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  })();

  const dayGroups = allDayGroups
    .map((day) => ({
      ...day,
      employees: day.employees.filter((e) => {
        if (filterEmployee !== "all" && e.employeeId !== filterEmployee) return false;
        if (filterPaid === "paid" && !e.allPaid) return false;
        if (filterPaid === "unpaid" && e.allPaid) return false;
        return true;
      }),
    }))
    .filter((day) => day.employees.length > 0);

  const grandTotal = dayGroups.reduce(
    (sum, d) => sum + d.employees.reduce((s, e) => s + e.totalHours, 0),
    0
  );
  const paidTotal = dayGroups.reduce(
    (sum, d) => sum + d.employees.reduce((s, e) => s + e.paidHours, 0),
    0
  );

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

  return (
    <div className="min-h-screen w-full min-w-full bg-black text-white p-3 sm:p-5 md:p-6 lg:px-10 lg:py-8 font-sans box-border">
      <div className="w-full max-w-none">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h1 className="text-xl font-bold">MANIAC</h1>
            <p className="text-white/30 text-[10px] sm:text-xs tracking-[0.2em] uppercase">
              Board · {user.name} · AM/PM
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right text-[10px] text-white/30">
              <p>Live · 30s</p>
              <p>{lastUpdate.toLocaleTimeString()}</p>
            </div>
            <button
              onClick={handleLogout}
              className="text-xs px-3 py-1.5 rounded-lg text-white/40 border border-white/10"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Quick period */}
        <div className="flex flex-wrap gap-2 mb-3">
          {([
            ["day", "Day"],
            ["week", "Week"],
            ["month", "Month"],
            ["year", "Year"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => applyPeriod(key)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{
                background: period === key ? "rgba(124,58,237,0.35)" : "rgba(255,255,255,0.05)",
                border: period === key ? "1px solid rgba(124,58,237,0.5)" : "1px solid rgba(255,255,255,0.08)",
                color: period === key ? "#fff" : "rgba(255,255,255,0.5)",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-4">
          <input
            type="date"
            value={fromDate}
            onChange={(e) => { setFromDate(e.target.value); setPeriod("custom"); }}
            className="px-3 py-2 rounded-lg text-sm bg-[#111] border border-white/10 text-white outline-none"
          />
          <input
            type="date"
            value={toDate}
            onChange={(e) => { setToDate(e.target.value); setPeriod("custom"); }}
            className="px-3 py-2 rounded-lg text-sm bg-[#111] border border-white/10 text-white outline-none"
          />
          <select
            value={filterEmployee}
            onChange={(e) => setFilterEmployee(e.target.value)}
            className="px-3 py-2 rounded-lg text-sm outline-none"
            style={{ background: "#111", color: "#fff", border: "1px solid rgba(255,255,255,0.1)" }}
          >
            <option value="all" style={{ background: "#111" }}>All employees</option>
            {employeeOptions.map(([id, name]) => (
              <option key={id} value={id} style={{ background: "#111" }}>{name}</option>
            ))}
          </select>
          <select
            value={filterPaid}
            onChange={(e) => setFilterPaid(e.target.value as "all" | "paid" | "unpaid")}
            className="px-3 py-2 rounded-lg text-sm outline-none"
            style={{ background: "#111", color: "#fff", border: "1px solid rgba(255,255,255,0.1)" }}
          >
            <option value="all" style={{ background: "#111" }}>All status</option>
            <option value="paid" style={{ background: "#111" }}>Paid</option>
            <option value="unpaid" style={{ background: "#111" }}>Unpaid</option>
          </select>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
          <div className="p-3 rounded-xl bg-[#111] border border-white/5">
            <p className="text-[10px] text-white/30 uppercase">Total worked</p>
            <p className="text-lg font-medium">{grandTotal.toFixed(2)}h</p>
          </div>
          <div className="p-3 rounded-xl bg-[#111] border border-emerald-500/20">
            <p className="text-[10px] text-emerald-500/50 uppercase">Paid</p>
            <p className="text-lg font-medium text-emerald-400">{paidTotal.toFixed(2)}h</p>
          </div>
          <div className="p-3 rounded-xl bg-[#111] border border-white/5">
            <p className="text-[10px] text-white/30 uppercase">Unpaid</p>
            <p className="text-lg font-medium text-white/60">{(grandTotal - paidTotal).toFixed(2)}h</p>
          </div>
        </div>

        {/* Currently working */}
        {running.length > 0 && (
          <div className="mb-5 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5">
            <p className="text-[10px] uppercase tracking-wider text-emerald-400/70 mb-2">Currently Working</p>
            <div className="flex flex-wrap gap-2">
              {running.map((r) => (
                <div
                  key={r.employee_id}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-sm text-emerald-300">{r.name}</span>
                  <span className="text-xs text-emerald-500/60">
                    since {formatTime(new Date(r.started_at))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-white/30 text-center py-12">Loading...</p>
        ) : dayGroups.length === 0 ? (
          <p className="text-white/30 text-center py-12">No work sessions in this range</p>
        ) : (
          <div className="space-y-6">
            {dayGroups.map((day) => (
              <div key={day.dayKey}>
                <div className="flex items-center gap-3 mb-2">
                  <h2 className="text-sm font-medium text-white/70 whitespace-nowrap">{day.label}</h2>
                  <div className="flex-1 h-px bg-white/8" />
                  <span className="text-xs text-white/30 whitespace-nowrap">
                    {day.employees.reduce((s, e) => s + e.totalHours, 0).toFixed(2)}h
                  </span>
                </div>

                <div className="space-y-2">
                  {day.employees.map((emp) => {
                    const cardKey = `${day.dayKey}-${emp.employeeId}`;
                    const isOpen = expanded.has(cardKey);

                    return (
                      <div
                        key={cardKey}
                        className="rounded-xl overflow-hidden"
                        style={{
                          background: "rgba(255,255,255,0.03)",
                          border: "1px solid rgba(255,255,255,0.08)",
                        }}
                      >
                        {/* Collapsed header — always visible */}
                        <button
                          type="button"
                          onClick={() => toggleExpand(cardKey)}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
                        >
                          <span className="text-white/30 text-xs w-4 shrink-0">
                            {isOpen ? "▼" : "▶"}
                          </span>
                          <span className="font-medium text-sm flex-1 truncate">{emp.name}</span>
                          <span className="text-emerald-400/80 text-sm whitespace-nowrap">
                            {emp.totalHours.toFixed(2)}h
                          </span>

                          {/* Paid — per day per person */}
                          {isAdmin ? (
                            <span
                              role="button"
                              onClick={(e) => toggleDayPaid(emp, e)}
                              className="text-[10px] px-2 py-0.5 rounded font-medium uppercase whitespace-nowrap cursor-pointer"
                              style={{
                                background: emp.allPaid
                                  ? "rgba(34,197,94,0.2)"
                                  : "rgba(255,255,255,0.06)",
                                border: emp.allPaid
                                  ? "1px solid rgba(34,197,94,0.4)"
                                  : "1px solid rgba(255,255,255,0.1)",
                                color: emp.allPaid ? "#86efac" : "rgba(255,255,255,0.4)",
                              }}
                            >
                              {emp.allPaid ? "Paid" : "Unpaid"}
                            </span>
                          ) : (
                            <span
                              className="text-[10px] px-2 py-0.5 rounded font-medium uppercase whitespace-nowrap"
                              style={{
                                background: emp.allPaid
                                  ? "rgba(34,197,94,0.15)"
                                  : "rgba(255,255,255,0.04)",
                                color: emp.allPaid ? "#86efac" : "rgba(255,255,255,0.3)",
                              }}
                            >
                              {emp.allPaid ? "Paid" : "Unpaid"}
                            </span>
                          )}

                          {emp.anyDisputed && (
                            <span
                              className="text-[10px] px-2 py-0.5 rounded font-medium uppercase"
                              style={{ background: "rgba(245,158,11,0.15)", color: "#fbbf24" }}
                            >
                              Disputed
                            </span>
                          )}
                        </button>

                        {/* Expanded details */}
                        {isOpen && (
                          <div className="px-4 pb-3 pt-0 space-y-2 border-t border-white/5">
                            {emp.blocks.map((b, i) => (
                              <div
                                key={`${b.sessionId}-${i}`}
                                className="pl-3 border-l-2 border-emerald-500/30 py-1.5"
                              >
                                <p className="text-sm text-white/80">
                                  {formatTime(b.from)} – {formatTime(b.to)}
                                </p>
                                <p className="text-xs text-white/40 mt-0.5">{b.activities}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
