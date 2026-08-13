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

type Employee = {
  id: string;
  name: string;
};

type Session = {
  id: string;
  employee_id: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  custom_note: string | null;
  is_paid: boolean;
  is_disputed?: boolean;
  employees?: { name: string };
  session_activities?: {
    id?: string;
    custom_text: string | null;
    activity_types?: { name: string } | null;
  }[];
  session_pauses?: {
    paused_at: string;
    resumed_at: string | null;
  }[];
};

type ActivityType = {
  id: string;
  name: string;
};

export default function CalendarPage() {
  const router = useRouter();
  const supabase = createClient();

  const [user, setUser] = useState<User | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [activities, setActivities] = useState<ActivityType[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"day" | "week" | "month" | "custom">("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");

  // Add / Edit modal
  const [showModal, setShowModal] = useState(false);
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [formEmployee, setFormEmployee] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formStart, setFormStart] = useState("09:00");
  const [formEnd, setFormEnd] = useState("18:00");
  const [formActivity, setFormActivity] = useState("");
  const [formNote, setFormNote] = useState("");
  const [saving, setSaving] = useState(false);

  const isAdmin = user?.role === "admin";

  useEffect(() => {
    const saved = localStorage.getItem("timeglass_user");
    if (!saved) {
      router.push("/");
      return;
    }
    setUser(JSON.parse(saved));
  }, [router]);

  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user, filter, customFrom, customTo, employeeFilter]);

  const loadData = async () => {
    setLoading(true);

    const { data: emps } = await supabase.from("employees").select("id, name").order("name");
    if (emps) setEmployees(emps);

    const { data: acts } = await supabase.from("activity_types").select("*").order("name");
    if (acts) setActivities(acts);

    const { from, to } = getDateRange();

    let query = supabase
      .from("work_sessions")
      .select(`
        id, employee_id, started_at, ended_at, status, custom_note, is_paid, is_disputed,
        employees ( name ),
        session_activities ( id, custom_text, activity_types ( name ) ),
        session_pauses ( paused_at, resumed_at )
      `)
      .eq("status", "completed")
      .gte("started_at", from.toISOString())
      .lte("started_at", to.toISOString())
      .order("started_at", { ascending: false });

    if (employeeFilter !== "all") {
      query = query.eq("employee_id", employeeFilter);
    }

    const { data } = await query;
    if (data) setSessions(data as any);
    setLoading(false);
  };

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
      from.setDate(from.getDate() - (day === 0 ? 6 : day - 1));
      from.setHours(0, 0, 0, 0);
    } else if (filter === "month") {
      from = new Date(now.getFullYear(), now.getMonth(), 1);
    } else {
      from = customFrom ? new Date(customFrom) : new Date(now.setDate(now.getDate() - 7));
      to = customTo ? new Date(customTo) : new Date();
      to.setHours(23, 59, 59, 999);
    }
    return { from, to };
  };

  const calcHoursNum = (s: Session) => {
    // Count only work segments (handles overlapping pauses correctly)
    const segs = getSegments(s);
    let ms = 0;
    for (const seg of segs) {
      if (seg.type === "work") {
        ms += Math.max(0, new Date(seg.to).getTime() - new Date(seg.from).getTime());
      }
    }
    return ms / 3600000;
  };

  const calcHours = (s: Session) => {
    if (!s.ended_at) return "—";
    return calcHoursNum(s).toFixed(2) + "h";
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  // Always AM/PM for display (all locales)
  const formatTime = (iso: string) => {
    const d = new Date(iso);
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, "0");
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${m} ${ampm}`;
  };

  // 24h for native time inputs in edit form
  const formatTime24 = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  type Segment = { type: "work" | "pause"; from: string; to: string };

  const getSegments = (s: Session): Segment[] => {
    if (!s.ended_at) return [];
    const endMs = new Date(s.ended_at).getTime();
    const startMs = new Date(s.started_at).getTime();

    // Merge overlapping pauses into non-overlapping ranges
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

    const segments: Segment[] = [];
    let cursor = startMs;
    for (const p of merged) {
      if (p.start > cursor) {
        segments.push({
          type: "work",
          from: new Date(cursor).toISOString(),
          to: new Date(p.start).toISOString(),
        });
      }
      segments.push({
        type: "pause",
        from: new Date(p.start).toISOString(),
        to: new Date(p.end).toISOString(),
      });
      cursor = Math.max(cursor, p.end);
    }
    if (endMs > cursor) {
      segments.push({
        type: "work",
        from: new Date(cursor).toISOString(),
        to: new Date(endMs).toISOString(),
      });
    }
    if (segments.length === 0) {
      segments.push({ type: "work", from: s.started_at, to: s.ended_at });
    }
    return segments;
  };

  const getActivities = (s: Session) => {
    if (!s.session_activities?.length) return s.custom_note || "—";
    const names = s.session_activities
      .map((a) => a.activity_types?.name || a.custom_text || "")
      .filter(Boolean);
    return [...new Set(names)].join(", ");
  };

  // Summary (minus pauses)
  const summary: Record<string, { name: string; hours: number; paidHours: number; count: number }> = {};
  sessions.forEach((s) => {
    if (!s.ended_at) return;
    const name = s.employees?.name || "Unknown";
    const h = calcHoursNum(s);
    if (!summary[s.employee_id]) summary[s.employee_id] = { name, hours: 0, paidHours: 0, count: 0 };
    summary[s.employee_id].hours += h;
    summary[s.employee_id].count += 1;
    if (s.is_paid) summary[s.employee_id].paidHours += h;
  });

  const canTogglePaid = (session: Session) => {
    if (!user) return false;
    if (isAdmin) return true;
    return session.employee_id === user.id;
  };

  const togglePaid = async (session: Session) => {
    if (!canTogglePaid(session)) return;
    const newVal = !session.is_paid;
    await supabase.from("work_sessions").update({ is_paid: newVal }).eq("id", session.id);
    setSessions((prev) =>
      prev.map((s) => (s.id === session.id ? { ...s, is_paid: newVal } : s))
    );
  };

  const markAllPaid = async (paid: boolean) => {
    if (!isAdmin && employeeFilter === "all") {
      alert("Select an employee first");
      return;
    }
    if (!confirm(paid ? "Mark all visible sessions as Paid?" : "Mark all visible sessions as Unpaid?")) return;

    const ids = sessions
      .filter((s) => isAdmin || s.employee_id === user?.id)
      .map((s) => s.id);

    if (ids.length === 0) return;

    await supabase.from("work_sessions").update({ is_paid: paid }).in("id", ids);
    loadData();
  };

  const openCreate = () => {
    setEditingSession(null);
    setFormEmployee(employees[0]?.id || "");
    setFormDate(new Date().toISOString().slice(0, 10));
    setFormStart("09:00");
    setFormEnd("18:00");
    setFormActivity(activities[0]?.id || "");
    setFormNote("");
    setShowModal(true);
  };

  const openEdit = (s: Session) => {
    setEditingSession(s);
    setFormEmployee(s.employee_id);
    setFormDate(s.started_at.slice(0, 10));
    setFormStart(formatTime24(s.started_at));
    setFormEnd(s.ended_at ? formatTime24(s.ended_at) : "18:00");
    setFormActivity("");
    setFormNote(s.custom_note || "");
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formEmployee || !formDate || !formStart || !formEnd) return;
    setSaving(true);

    // Parse times in local timezone
    const startLocal = new Date(`${formDate}T${formStart}:00`);
    const endLocal = new Date(`${formDate}T${formEnd}:00`);

    if (startLocal.getTime() >= endLocal.getTime()) {
      alert("End time must be after start time");
      setSaving(false);
      return;
    }

    let finalStart = startLocal;
    let finalEnd = endLocal;
    const mergeIds: string[] = [];

    // Find overlapping sessions on same day for this employee
    const dayStart = new Date(formDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(formDate);
    dayEnd.setHours(23, 59, 59, 999);

    let query = supabase
      .from("work_sessions")
      .select("id, started_at, ended_at")
      .eq("employee_id", formEmployee)
      .eq("status", "completed")
      .gte("started_at", dayStart.toISOString())
      .lte("started_at", dayEnd.toISOString());

    if (editingSession) {
      query = query.neq("id", editingSession.id);
    }

    const { data: existing } = await query;
    if (existing) {
      for (const s of existing) {
        if (!s.ended_at) continue;
        const sStart = new Date(s.started_at).getTime();
        const sEnd = new Date(s.ended_at).getTime();
        if (finalStart.getTime() < sEnd && finalEnd.getTime() > sStart) {
          mergeIds.push(s.id);
          if (sStart < finalStart.getTime()) finalStart = new Date(s.started_at);
          if (sEnd > finalEnd.getTime()) finalEnd = new Date(s.ended_at);
        }
      }
    }

    const startISO = finalStart.toISOString();
    const endISO = finalEnd.toISOString();

    let targetId = editingSession?.id || null;

    if (editingSession) {
      await supabase
        .from("work_sessions")
        .update({
          employee_id: formEmployee,
          started_at: startISO,
          ended_at: endISO,
          custom_note: formNote || null,
        })
        .eq("id", editingSession.id);
      targetId = editingSession.id;
    } else {
      const { data: newSess } = await supabase
        .from("work_sessions")
        .insert({
          employee_id: formEmployee,
          started_at: startISO,
          ended_at: endISO,
          status: "completed",
          custom_note: formNote || null,
          is_paid: false,
        })
        .select()
        .single();
      targetId = newSess?.id || null;
    }

    if (!targetId) {
      setSaving(false);
      return;
    }

    // Collect unique activities from merged sessions + new activity
    const activityIds = new Set<string>();
    const customTexts = new Set<string>();

    if (formActivity) activityIds.add(formActivity);

    for (const mid of mergeIds) {
      const { data: oldActs } = await supabase
        .from("session_activities")
        .select("activity_type_id, custom_text")
        .eq("session_id", mid);
      if (oldActs) {
        for (const a of oldActs) {
          if (a.activity_type_id) activityIds.add(a.activity_type_id);
          if (a.custom_text) customTexts.add(a.custom_text);
        }
      }
    }

    // Also keep existing activities on the target session if editing
    if (editingSession) {
      const { data: curActs } = await supabase
        .from("session_activities")
        .select("activity_type_id, custom_text")
        .eq("session_id", targetId);
      if (curActs) {
        for (const a of curActs) {
          if (a.activity_type_id) activityIds.add(a.activity_type_id);
          if (a.custom_text) customTexts.add(a.custom_text);
        }
      }
    }

    // Rebuild activities on target (unique)
    await supabase.from("session_activities").delete().eq("session_id", targetId);
    for (const aid of activityIds) {
      await supabase.from("session_activities").insert({
        session_id: targetId,
        activity_type_id: aid,
      });
    }
    for (const txt of customTexts) {
      await supabase.from("session_activities").insert({
        session_id: targetId,
        custom_text: txt,
      });
    }

    // Delete merged sessions
    for (const mid of mergeIds) {
      await supabase.from("session_activities").delete().eq("session_id", mid);
      await supabase.from("session_pauses").delete().eq("session_id", mid);
      await supabase.from("work_sessions").delete().eq("id", mid);
    }

    setSaving(false);
    setShowModal(false);
    loadData();
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete session of ${name}?`)) return;
    await supabase.from("session_activities").delete().eq("session_id", id);
    await supabase.from("session_pauses").delete().eq("session_id", id);
    await supabase.from("work_sessions").delete().eq("id", id);
    loadData();
  };

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
        <div className="flex gap-2">
          {isAdmin && (
            <button
              onClick={openCreate}
              className="text-xs px-3 py-1.5 rounded-lg font-medium"
              style={{ background: "linear-gradient(135deg, #7c3aed 0%, #06b6d4 100%)" }}
            >
              + Add
            </button>
          )}
          <button
            onClick={() => router.push("/timer")}
            className="text-sm px-3 py-1.5 rounded-xl"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            Back
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-2 overflow-x-auto shrink-0 pb-1">
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

      {/* Employee filter */}
      <div className="mb-2 shrink-0">
        <select
          value={employeeFilter}
          onChange={(e) => setEmployeeFilter(e.target.value)}
          className="w-full px-3 py-2 rounded-xl text-sm outline-none"
          style={{ background: "#1a1a24", color: "#fff", border: "1px solid rgba(255,255,255,0.15)" }}
        >
          <option value="all" style={{ background: "#1a1a24", color: "#fff" }}>All employees</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id} style={{ background: "#1a1a24", color: "#fff" }}>{e.name}</option>
          ))}
        </select>
      </div>

      {/* Bulk paid buttons */}
      <div className="flex gap-2 mb-3 shrink-0">
        <button
          onClick={() => markAllPaid(true)}
          className="flex-1 py-2 rounded-xl text-xs font-medium"
          style={{ background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)", color: "#86efac" }}
        >
          Mark all Paid
        </button>
        <button
          onClick={() => markAllPaid(false)}
          className="flex-1 py-2 rounded-xl text-xs font-medium"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          Mark all Unpaid
        </button>
      </div>

      {filter === "custom" && (
        <div className="flex gap-2 mb-3 shrink-0">
          <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
            className="flex-1 px-3 py-2 rounded-xl text-sm outline-none"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }} />
          <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
            className="flex-1 px-3 py-2 rounded-xl text-sm outline-none"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }} />
        </div>
      )}

      {/* Summary */}
      {Object.keys(summary).length > 0 && (
        <div className="rounded-2xl p-3 mb-3 shrink-0"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <p className="text-white/40 text-[10px] uppercase tracking-wider mb-2">Summary</p>
          <div className="space-y-1.5">
            {Object.values(summary).map((s) => (
              <div key={s.name} className="flex justify-between text-sm">
                <span className="text-white/80">{s.name}</span>
                <span className="text-white/50">
                  {s.hours.toFixed(1)}h · <span style={{ color: s.paidHours > 0 ? "#86efac" : undefined }}>
                    {s.paidHours.toFixed(1)}h paid
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sessions */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1" style={{ overscrollBehavior: "contain" }}>
        {loading ? (
          <p className="text-white/30 text-sm text-center py-8">Loading...</p>
        ) : sessions.length === 0 ? (
          <p className="text-white/30 text-sm text-center py-8">No sessions found</p>
        ) : (
          sessions.map((s) => (
            <div key={s.id} className="rounded-xl p-3"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="flex justify-between items-start mb-1">
                <p className="font-medium text-sm">{s.employees?.name || "Unknown"}</p>
                <div className="flex items-center gap-2">
                  <p className="text-white/50 text-xs">{calcHours(s)}</p>
                  {/* Paid toggle */}
                  {canTogglePaid(s) ? (
                    <button
                      onClick={() => togglePaid(s)}
                      className="text-[10px] px-2 py-0.5 rounded-md font-medium uppercase tracking-wide"
                      style={{
                        background: s.is_paid ? "rgba(34,197,94,0.2)" : "rgba(255,255,255,0.06)",
                        border: s.is_paid ? "1px solid rgba(34,197,94,0.4)" : "1px solid rgba(255,255,255,0.1)",
                        color: s.is_paid ? "#86efac" : "rgba(255,255,255,0.4)"
                      }}
                    >
                      {s.is_paid ? "Paid" : "Unpaid"}
                    </button>
                  ) : (
                    <span
                      className="text-[10px] px-2 py-0.5 rounded-md font-medium uppercase tracking-wide"
                      style={{
                        background: s.is_paid ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.04)",
                        color: s.is_paid ? "#86efac" : "rgba(255,255,255,0.3)"
                      }}
                    >
                      {s.is_paid ? "Paid" : "Unpaid"}
                    </span>
                  )}
                  {/* Disputed toggle - admin only */}
                  {isAdmin && (
                    <button
                      onClick={async () => {
                        const newVal = !s.is_disputed;
                        await supabase.from("work_sessions").update({ is_disputed: newVal }).eq("id", s.id);
                        setSessions((prev) => prev.map((x) => x.id === s.id ? { ...x, is_disputed: newVal } : x));
                      }}
                      className="text-[10px] px-2 py-0.5 rounded-md font-medium uppercase tracking-wide"
                      style={{
                        background: s.is_disputed ? "rgba(245,158,11,0.2)" : "rgba(255,255,255,0.04)",
                        border: s.is_disputed ? "1px solid rgba(245,158,11,0.4)" : "1px solid rgba(255,255,255,0.08)",
                        color: s.is_disputed ? "#fbbf24" : "rgba(255,255,255,0.3)"
                      }}
                    >
                      {s.is_disputed ? "Disputed" : "OK"}
                    </button>
                  )}
                </div>
              </div>
              <p className="text-white/30 text-[10px] mt-0.5">{formatDate(s.started_at)}</p>

              {/* Work / Pause breakdown */}
              <div className="mt-2 space-y-1">
                {getSegments(s).map((seg, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: seg.type === "work" ? "#4ade80" : "#fbbf24" }}
                    />
                    <span className="text-white/50">
                      {formatTime(seg.from)} – {formatTime(seg.to)}
                    </span>
                    <span style={{ color: seg.type === "work" ? "#86efac" : "#fbbf24" }}>
                      {seg.type === "work" ? "worked" : "pause"}
                    </span>
                  </div>
                ))}
              </div>

              <p className="text-white/60 text-xs mt-2 leading-relaxed">
                <span className="text-white/30">Activity: </span>
                {getActivities(s)}
              </p>
              <p className="text-white/40 text-[10px] mt-1">
                Paid hours: <span className="text-white/70">{calcHours(s)}</span>
              </p>

              {isAdmin && (
                <div className="flex gap-2 mt-2.5">
                  <button onClick={() => openEdit(s)} className="text-[11px] px-2.5 py-1 rounded-lg"
                    style={{ background: "rgba(255,255,255,0.08)" }}>Edit</button>
                  <button onClick={() => handleDelete(s.id, s.employees?.name || "")}
                    className="text-[11px] px-2.5 py-1 rounded-lg text-red-300"
                    style={{ background: "rgba(239,68,68,0.15)" }}>Delete</button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="absolute inset-0 z-50 flex items-end justify-center bg-black/70"
          style={{ backdropFilter: "blur(8px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div className="w-full max-w-md rounded-t-3xl p-6 space-y-4"
            style={{ background: "rgba(18,18,26,0.98)", border: "1px solid rgba(255,255,255,0.1)" }}
            onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-medium text-center">
              {editingSession ? "Edit Session" : "Add Session"}
            </h2>

            <div>
              <label className="text-white/40 text-xs uppercase">Employee</label>
              <select value={formEmployee} onChange={(e) => setFormEmployee(e.target.value)}
                className="w-full mt-1 px-3 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: "#1a1a24", color: "#fff", border: "1px solid rgba(255,255,255,0.15)" }}>
                {employees.map((e) => (
                  <option key={e.id} value={e.id} style={{ background: "#1a1a24", color: "#fff" }}>{e.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-white/40 text-xs uppercase">Date</label>
              <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)}
                className="w-full mt-1 px-3 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }} />
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-white/40 text-xs uppercase">From</label>
                <input type="time" value={formStart} onChange={(e) => setFormStart(e.target.value)}
                  className="w-full mt-1 px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }} />
              </div>
              <div className="flex-1">
                <label className="text-white/40 text-xs uppercase">To</label>
                <input type="time" value={formEnd} onChange={(e) => setFormEnd(e.target.value)}
                  className="w-full mt-1 px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }} />
              </div>
            </div>

            <div>
              <label className="text-white/40 text-xs uppercase">Activity</label>
              <select value={formActivity} onChange={(e) => setFormActivity(e.target.value)}
                className="w-full mt-1 px-3 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: "#1a1a24", color: "#fff", border: "1px solid rgba(255,255,255,0.15)" }}>
                <option value="" style={{ background: "#1a1a24", color: "#fff" }}>— keep current —</option>
                {activities.map((a) => (
                  <option key={a.id} value={a.id} style={{ background: "#1a1a24", color: "#fff" }}>{a.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-white/40 text-xs uppercase">Note</label>
              <input type="text" value={formNote} onChange={(e) => setFormNote(e.target.value)}
                placeholder="Optional note..."
                className="w-full mt-1 px-3 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }} />
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowModal(false)} className="flex-1 py-3 rounded-xl text-sm"
                style={{ background: "rgba(255,255,255,0.07)" }}>Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-3 rounded-xl text-sm font-medium disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #7c3aed 0%, #06b6d4 100%)" }}>
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
