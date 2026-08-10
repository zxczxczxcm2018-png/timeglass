"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type User = {
  id: string;
  name: string;
  access_code: string;
  role: string;
};

type Session = {
  id: string;
  employee_id: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  custom_note: string | null;
  employees?: { name: string };
  session_activities?: {
    custom_text: string | null;
    activity_types?: { name: string } | null;
  }[];
};

export default function CalendarPage() {
  const router = useRouter();
  const supabase = createClient();

  const [user, setUser] = useState<User | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"day" | "week" | "month" | "custom">("week");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("timeglass_user");
    if (!saved) {
      router.push("/");
      return;
    }
    setUser(JSON.parse(saved));
  }, [router]);

  useEffect(() => {
    if (user) loadSessions();
  }, [user, filter, customFrom, customTo]);

  const getDateRange = () => {
    const now = new Date();
    let from: Date;
    let to: Date = new Date(now);
    to.setHours(23, 59, 59, 999);

    if (filter === "day") {
      from = new Date(now);
      from.setHours(0, 0, 0, 0);
    } else if (filter === "week") {
      from = new Date(now);
      const day = from.getDay();
      const diff = day === 0 ? 6 : day - 1; // Monday start
      from.setDate(from.getDate() - diff);
      from.setHours(0, 0, 0, 0);
    } else if (filter === "month") {
      from = new Date(now.getFullYear(), now.getMonth(), 1);
    } else {
      // custom
      from = customFrom ? new Date(customFrom) : new Date(now.setDate(now.getDate() - 7));
      to = customTo ? new Date(customTo) : new Date();
      to.setHours(23, 59, 59, 999);
    }

    return { from, to };
  };

  const loadSessions = async () => {
    setLoading(true);
    const { from, to } = getDateRange();

    const { data, error } = await supabase
      .from("work_sessions")
      .select(`
        id,
        employee_id,
        started_at,
        ended_at,
        status,
        custom_note,
        employees ( name ),
        session_activities (
          custom_text,
          activity_types ( name )
        )
      `)
      .eq("status", "completed")
      .gte("started_at", from.toISOString())
      .lte("started_at", to.toISOString())
      .order("started_at", { ascending: false });

    if (data) setSessions(data as any);
    setLoading(false);
  };

  const calcHours = (start: string, end: string | null) => {
    if (!end) return "—";
    const ms = new Date(end).getTime() - new Date(start).getTime();
    const hours = ms / (1000 * 60 * 60);
    return hours.toFixed(2) + "h";
  };

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getActivities = (session: Session) => {
    if (!session.session_activities || session.session_activities.length === 0) {
      return session.custom_note || "—";
    }
    return session.session_activities
      .map((a) => a.activity_types?.name || a.custom_text || "")
      .filter(Boolean)
      .join(", ");
  };

  // Group by employee for summary
  const summaryByEmployee: Record<string, { name: string; hours: number; count: number }> = {};
  sessions.forEach((s) => {
    if (!s.ended_at) return;
    const name = s.employees?.name || "Unknown";
    const hours = (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / (1000 * 60 * 60);
    if (!summaryByEmployee[s.employee_id]) {
      summaryByEmployee[s.employee_id] = { name, hours: 0, count: 0 };
    }
    summaryByEmployee[s.employee_id].hours += hours;
    summaryByEmployee[s.employee_id].count += 1;
  });

  if (!user) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-white/40">Loading...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col px-4 py-5 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <p className="text-white/30 text-[11px] uppercase tracking-widest">Reports</p>
          <p className="font-medium text-[15px]">Calendar</p>
        </div>
        <button
          onClick={() => router.push("/timer")}
          className="text-sm px-3 py-1.5 rounded-xl"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          Back
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-3 overflow-x-auto shrink-0 pb-1">
        {(["day", "week", "month", "custom"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="px-3 py-1.5 rounded-lg text-xs capitalize shrink-0"
            style={{
              background: filter === f ? "rgba(124,58,237,0.3)" : "rgba(255,255,255,0.05)",
              border: filter === f ? "1px solid rgba(124,58,237,0.5)" : "1px solid rgba(255,255,255,0.08)",
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {filter === "custom" && (
        <div className="flex gap-2 mb-3 shrink-0">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="flex-1 px-3 py-2 rounded-xl text-sm outline-none"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
          />
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="flex-1 px-3 py-2 rounded-xl text-sm outline-none"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
          />
        </div>
      )}

      {/* Summary */}
      {Object.keys(summaryByEmployee).length > 0 && (
        <div 
          className="rounded-2xl p-3 mb-3 shrink-0"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <p className="text-white/40 text-[10px] uppercase tracking-wider mb-2">Summary</p>
          <div className="space-y-1.5">
            {Object.values(summaryByEmployee).map((s) => (
              <div key={s.name} className="flex justify-between text-sm">
                <span className="text-white/80">{s.name}</span>
                <span className="text-white/50">{s.hours.toFixed(1)}h · {s.count} sessions</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1" style={{ overscrollBehavior: "contain" }}>
        {loading ? (
          <p className="text-white/30 text-sm text-center py-8">Loading...</p>
        ) : sessions.length === 0 ? (
          <p className="text-white/30 text-sm text-center py-8">No sessions found</p>
        ) : (
          sessions.map((s) => (
            <div
              key={s.id}
              className="rounded-xl p-3"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="flex justify-between items-start mb-1">
                <p className="font-medium text-sm">{s.employees?.name || "Unknown"}</p>
                <p className="text-white/50 text-xs">{calcHours(s.started_at, s.ended_at)}</p>
              </div>
              <p className="text-white/40 text-xs">
                {formatDate(s.started_at)} · {formatTime(s.started_at)}
                {s.ended_at && ` — ${formatTime(s.ended_at)}`}
              </p>
              <p className="text-white/60 text-xs mt-1.5 leading-relaxed">
                {getActivities(s)}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
