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
  isPaid: boolean;
  isDisputed: boolean;
};

type DayEmployee = {
  employeeId: string;
  name: string;
  blocks: WorkBlock[];
  totalHours: number;
};

type DayGroup = {
  dayKey: string; // YYYY-MM-DD local
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

  const now = new Date();
  const [fromDate, setFromDate] = useState(
    new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  );
  const [toDate, setToDate] = useState(now.toISOString().slice(0, 10));

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
    // Load a bit extra before range for overnight sessions
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
    if (s.custom_note && s.custom_note !== "__skipped__") {
      // still prefer activities
    }
    if (!s.session_activities?.length) {
      return s.custom_note && s.custom_note !== "__skipped__" ? s.custom_note : "—";
    }
    const names = s.session_activities
      .map((a) => a.activity_types?.name || a.custom_text || "")
      .filter(Boolean);
    return [...new Set(names)].join(", ") || "—";
  };

  // Work-only segments (merge overlapping pauses)
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
      if (p.start > cursor) {
        work.push({ from: new Date(cursor), to: new Date(p.start) });
      }
      cursor = Math.max(cursor, p.end);
    }
    if (endMs > cursor) {
      work.push({ from: new Date(cursor), to: new Date(endMs) });
    }
    if (work.length === 0 && endMs > startMs) {
      work.push({ from: new Date(startMs), to: new Date(endMs) });
    }
    return work;
  };

  // Split a work segment at local midnight boundaries
  const splitAtMidnight = (from: Date, to: Date): { from: Date; to: Date }[] => {
    const parts: { from: Date; to: Date }[] = [];
    let cur = new Date(from);
    while (cur < to) {
      const nextMidnight = new Date(cur);
      nextMidnight.setHours(24, 0, 0, 0); // next local midnight
      const end = to < nextMidnight ? to : new Date(nextMidnight.getTime() - 1); // 11:59:59.999
      // Use exact next midnight as exclusive end for cleaner display
      const segmentEnd = to <= nextMidnight ? to : nextMidnight;
      // For display: if split, first part ends 11:59 PM, second starts 12:00 AM
      if (to > nextMidnight) {
        const endOfDay = new Date(cur);
        endOfDay.setHours(23, 59, 59, 999);
        parts.push({ from: new Date(cur), to: endOfDay });
        cur = new Date(nextMidnight); // 00:00 next day
      } else {
        parts.push({ from: new Date(cur), to: new Date(to) });
        break;
      }
    }
    return parts;
  };

  // Build day → employee → work blocks
  const buildDayGroups = (): DayGroup[] => {
    const rangeStart = new Date(fromDate);
    rangeStart.setHours(0, 0, 0, 0);
    const rangeEnd = new Date(toDate);
    rangeEnd.setHours(23, 59, 59, 999);

    // Map: dayKey → employeeId → DayEmployee
    const map = new Map<string, Map<string, DayEmployee>>();

    for (const s of sessions) {
      if (!s.ended_at) continue;
      const activities = getActivities(s);
      const workSegs = getWorkSegments(s);

      for (const w of workSegs) {
        const parts = splitAtMidnight(w.from, w.to);
        for (const part of parts) {
          // Skip if outside selected range
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
            });
          }
          const emp = empMap.get(empId)!;
          const hours = (part.to.getTime() - part.from.getTime()) / 3600000;
          emp.blocks.push({
            from: part.from,
            to: part.to,
            activities,
            sessionId: s.id,
            isPaid: s.is_paid,
            isDisputed: s.is_disputed,
          });
          emp.totalHours += hours;
        }
      }
    }

    // Sort days descending, employees by name, blocks by time
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

  const dayGroups = buildDayGroups();
  const grandTotal = dayGroups.reduce(
    (sum, d) => sum + d.employees.reduce((s, e) => s + e.totalHours, 0),
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
    <div className="min-h-screen bg-black text-white p-4 md:p-8 font-sans">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-xl font-bold">MANIAC</h1>
            <p className="text-white/30 text-xs tracking-[0.2em] uppercase">
              Board · {user.name} · local timezone · AM/PM
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right text-xs text-white/30">
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

        {/* Date range */}
        <div className="flex flex-wrap gap-2 mb-4">
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="px-3 py-2 rounded-lg text-sm bg-[#111] border border-white/10 text-white outline-none"
          />
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="px-3 py-2 rounded-lg text-sm bg-[#111] border border-white/10 text-white outline-none"
          />
          <div className="px-3 py-2 rounded-lg text-sm bg-[#111] border border-white/10 text-white/60">
            Total worked: <span className="text-white font-medium">{grandTotal.toFixed(2)}h</span>
          </div>
        </div>

        {loading ? (
          <p className="text-white/30 text-center py-12">Loading...</p>
        ) : dayGroups.length === 0 ? (
          <p className="text-white/30 text-center py-12">No work sessions in this range</p>
        ) : (
          <div className="space-y-8">
            {dayGroups.map((day) => (
              <div key={day.dayKey}>
                {/* Day header */}
                <div className="flex items-center gap-3 mb-3">
                  <h2 className="text-sm font-medium text-white/80 tracking-wide">{day.label}</h2>
                  <div className="flex-1 h-px bg-white/10" />
                  <span className="text-xs text-white/30">
                    {day.employees.reduce((s, e) => s + e.totalHours, 0).toFixed(2)}h
                  </span>
                </div>

                {/* Employee blocks */}
                <div className="space-y-3">
                  {day.employees.map((emp) => (
                    <div
                      key={emp.employeeId}
                      className="rounded-2xl p-4"
                      style={{
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.08)",
                      }}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <p className="font-medium text-[15px]">{emp.name}</p>
                        <p className="text-sm text-emerald-400/80">{emp.totalHours.toFixed(2)}h worked</p>
                      </div>

                      <div className="space-y-2.5">
                        {emp.blocks.map((b, i) => (
                          <div
                            key={`${b.sessionId}-${i}`}
                            className="pl-3 border-l-2 border-emerald-500/40"
                          >
                            <p className="text-sm text-white/80">
                              {formatTime(b.from)} – {formatTime(b.to)}
                            </p>
                            <p className="text-xs text-white/40 mt-0.5">{b.activities}</p>
                            <div className="flex gap-1.5 mt-1">
                              <span
                                className="text-[10px] px-1.5 py-0.5 rounded font-medium uppercase"
                                style={{
                                  background: b.isPaid
                                    ? "rgba(34,197,94,0.15)"
                                    : "rgba(255,255,255,0.05)",
                                  color: b.isPaid ? "#4ade80" : "rgba(255,255,255,0.3)",
                                }}
                              >
                                {b.isPaid ? "Paid" : "Unpaid"}
                              </span>
                              {b.isDisputed && (
                                <span
                                  className="text-[10px] px-1.5 py-0.5 rounded font-medium uppercase"
                                  style={{
                                    background: "rgba(245,158,11,0.15)",
                                    color: "#fbbf24",
                                  }}
                                >
                                  Disputed
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
