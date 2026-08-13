"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type User = {
  id: string;
  name: string;
  access_code: string;
  role: string;
};

type ActivityType = { id: string; name: string };
type AmPmTime = { hour: number; minute: number; ampm: "AM" | "PM" };

const CATEGORIES = [
  { id: "ticket-review", name: "Ticket Review", children: ["Ticket Review — New", "Ticket Review — Approved", "Ticket Review — Finished"] },
  { id: "ticket-work", name: "Ticket Work", children: ["Ticket Work — Voting", "Ticket Work — Status Change", "Ticket Work — Writing Contract", "Ticket Work — Distribution", "Ticket Work — Artist Communication"] },
  { id: "artist-support", name: "Artist Support", children: null },
  { id: "marketing", name: "Marketing", children: null },
  { id: "development", name: "Development", children: null },
  { id: "double-check", name: "Double Check", children: null },
  { id: "other", name: "Other", children: null },
];

const TIMER_KEY = "timeglass_active_timer";

type SavedTimer = {
  sessionId: string;
  startedAt: number;       // Date.now() when started (or last resumed)
  totalPausedMs: number;   // accumulated pause time
  pausedAt: number | null; // Date.now() when paused, null if running
  isPaused: boolean;
  pauseReason: "manual" | "internet" | null;
};

function playSound(type: "start" | "stop" | "notify" | "pause") {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.value = 0.08;
    const freqs = { start: 523, stop: 392, notify: 440, pause: 330 };
    osc.frequency.value = freqs[type];
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.stop(ctx.currentTime + 0.3);
  } catch {}
}

function sendNotify(title: string, body: string) {
  try {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
      new Notification(title, { body, silent: false });
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then((p) => {
        if (p === "granted") new Notification(title, { body, silent: false });
      });
    }
  } catch {}
}

function loadSavedTimer(): SavedTimer | null {
  try {
    const raw = localStorage.getItem(TIMER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveTimer(t: SavedTimer | null) {
  if (t) localStorage.setItem(TIMER_KEY, JSON.stringify(t));
  else localStorage.removeItem(TIMER_KEY);
}

function calcSeconds(t: SavedTimer): number {
  const now = Date.now();
  let paused = t.totalPausedMs;
  if (t.isPaused && t.pausedAt) {
    paused += now - t.pausedAt;
  }
  const elapsed = now - t.startedAt - paused;
  return Math.max(0, Math.floor(elapsed / 1000));
}

export default function TimerPage() {
  const router = useRouter();
  const supabase = createClient();

  const [user, setUser] = useState<User | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("Ready to start");
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const [isOffline, setIsOffline] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [hoursToday, setHoursToday] = useState(0);
  const [hoursWeek, setHoursWeek] = useState(0);
  const [hoursMonth, setHoursMonth] = useState(0);

  const [showActivityModal, setShowActivityModal] = useState(false);
  const [activities, setActivities] = useState<ActivityType[]>([]);
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [otherText, setOtherText] = useState("");
  const [showTimeModal, setShowTimeModal] = useState(false);
  const [sessionStart, setSessionStart] = useState<Date | null>(null);
  const [sessionEnd, setSessionEnd] = useState<Date | null>(null);
  const [adjustStart, setAdjustStart] = useState<AmPmTime>({ hour: 9, minute: 0, ampm: "AM" });
  const [adjustEnd, setAdjustEnd] = useState<AmPmTime>({ hour: 5, minute: 0, ampm: "PM" });

  // Interrupted session recovery
  const [recoverySession, setRecoverySession] = useState<{
    id: string;
    started_at: string;
    ended_at: string;
  } | null>(null);
  const [showRecovery, setShowRecovery] = useState(false);

  const timerRef = useRef<SavedTimer | null>(null);
  const tickRef = useRef<NodeJS.Timeout | null>(null);
  const offlinePauseRef = useRef<NodeJS.Timeout | null>(null);
  const offlineCompleteRef = useRef<NodeJS.Timeout | null>(null);
  const reminderRef = useRef<NodeJS.Timeout | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4500);
    sendNotify("TimeGlass", msg);
  };

  // Auth + restore timer + notifications
  useEffect(() => {
    const saved = localStorage.getItem("timeglass_user");
    if (!saved) { router.push("/"); return; }
    setUser(JSON.parse(saved));

    // Request notifications
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    // Restore active timer from localStorage
    const t = loadSavedTimer();
    if (t && t.sessionId) {
      timerRef.current = t;
      setSessionId(t.sessionId);
      setIsRunning(true);
      setIsPaused(t.isPaused);
      setSeconds(calcSeconds(t));
      setStatusText(t.isPaused ? (t.pauseReason === "internet" ? "No internet — paused" : "Paused") : "Working...");
    }
  }, [router]);

  // Recovery ONLY for running sessions left behind (not old completed ones)
  const recoveryChecked = useRef(false);
  useEffect(() => {
    if (!user || recoveryChecked.current) return;
    recoveryChecked.current = true;
    if (timerRef.current) return;

    (async () => {
      const { data: running } = await supabase
        .from("work_sessions")
        .select("id, started_at, custom_note")
        .eq("employee_id", user.id)
        .eq("status", "running")
        .order("started_at", { ascending: false });

      if (!running || running.length === 0) return;

      const latest = running[0];
      const startMs = new Date(latest.started_at).getTime();
      const endMs = Math.min(Date.now(), startMs + 8 * 60 * 60 * 1000);
      const endTime = new Date(endMs).toISOString();

      for (const s of running) {
        await supabase.from("work_sessions").update({
          status: "completed",
          ended_at: s.id === latest.id ? endTime : latest.started_at,
          custom_note: s.custom_note === "__skipped__" ? "__skipped__" : s.custom_note,
        }).eq("id", s.id);
      }

      if (latest.custom_note === "__skipped__") return;

      const { data: acts } = await supabase
        .from("session_activities")
        .select("id")
        .eq("session_id", latest.id)
        .limit(1);

      if (!acts || acts.length === 0) {
        setRecoverySession({
          id: latest.id,
          started_at: latest.started_at,
          ended_at: endTime,
        });
        setShowRecovery(true);
      }
    })();
  }, [user]);

  // Tick: recalculate from timestamps every second (works even after minimize)
  useEffect(() => {
    if (isRunning) {
      tickRef.current = setInterval(() => {
        if (timerRef.current) {
          setSeconds(calcSeconds(timerRef.current));
        }
      }, 1000);
    }
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [isRunning]);

  // Load stats + activities
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase.from("activity_types").select("*");
      if (data) setActivities(data);

      const now = new Date();
      const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
      const startOfWeek = new Date(now);
      const day = startOfWeek.getDay();
      startOfWeek.setDate(startOfWeek.getDate() - (day === 0 ? 6 : day - 1));
      startOfWeek.setHours(0, 0, 0, 0);
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const { data: sessions } = await supabase
        .from("work_sessions")
        .select("started_at, ended_at")
        .eq("employee_id", user.id)
        .eq("status", "completed")
        .gte("started_at", startOfMonth.toISOString());

      let t = 0, w = 0, m = 0;
      (sessions || []).forEach((s) => {
        if (!s.ended_at) return;
        const h = (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 3600000;
        m += h;
        if (new Date(s.started_at) >= startOfWeek) w += h;
        if (new Date(s.started_at) >= startOfDay) t += h;
      });
      setHoursToday(t); setHoursWeek(w); setHoursMonth(m);
    })();
  }, [user]);

  // Mouse glow
  useEffect(() => {
    const h = (e: MouseEvent) => setMouse({
      x: (e.clientX / window.innerWidth - 0.5) * 18,
      y: (e.clientY / window.innerHeight - 0.5) * 18,
    });
    window.addEventListener("mousemove", h);
    return () => window.removeEventListener("mousemove", h);
  }, []);

  // REAL offline only (not minimize)
  useEffect(() => {
    const onOffline = () => {
      setIsOffline(true);
      if (offlinePauseRef.current) clearTimeout(offlinePauseRef.current);
      if (offlineCompleteRef.current) clearTimeout(offlineCompleteRef.current);

      // Pause after 2 min without network
      offlinePauseRef.current = setTimeout(() => {
        if (!navigator.onLine && timerRef.current && !timerRef.current.isPaused) {
          const t = timerRef.current;
          t.isPaused = true;
          t.pausedAt = Date.now();
          t.pauseReason = "internet";
          timerRef.current = t;
          saveTimer(t);
          setIsPaused(true);
          setStatusText("No internet — paused");
          showToast("No internet — timer paused");
          playSound("pause");
          if (t.sessionId) {
            supabase.from("session_pauses").insert({
              session_id: t.sessionId,
              paused_at: new Date().toISOString(),
            });
          }
        }
      }, 2 * 60 * 1000);

      // Auto-complete after 1 hour offline
      offlineCompleteRef.current = setTimeout(async () => {
        if (!navigator.onLine && timerRef.current) {
          const t = timerRef.current;
          await supabase.from("work_sessions").update({
            ended_at: new Date().toISOString(),
            status: "completed",
          }).eq("id", t.sessionId);
          timerRef.current = null;
          saveTimer(null);
          setIsRunning(false);
          setIsPaused(false);
          setSessionId(null);
          setSeconds(0);
          setStatusText("Auto-completed (offline 1h)");
          showToast("Session auto-completed after 1h offline");
        }
      }, 60 * 60 * 1000);
    };

    const onOnline = async () => {
      setIsOffline(false);
      if (offlinePauseRef.current) clearTimeout(offlinePauseRef.current);
      if (offlineCompleteRef.current) clearTimeout(offlineCompleteRef.current);

      if (timerRef.current?.isPaused && timerRef.current.pauseReason === "internet") {
        const t = timerRef.current;
        if (t.pausedAt) t.totalPausedMs += Date.now() - t.pausedAt;
        t.pausedAt = null;
        t.isPaused = false;
        t.pauseReason = null;
        timerRef.current = t;
        saveTimer(t);
        setIsPaused(false);
        setStatusText("Working...");
        showToast("Connection restored — timer resumed");
        playSound("start");
        if (t.sessionId) {
          const { data } = await supabase
            .from("session_pauses")
            .select("*")
            .eq("session_id", t.sessionId)
            .is("resumed_at", null)
            .order("paused_at", { ascending: false })
            .limit(1);
          if (data?.[0]) {
            await supabase.from("session_pauses").update({ resumed_at: new Date().toISOString() }).eq("id", data[0].id);
          }
        }
      }
    };

    setIsOffline(!navigator.onLine);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      if (offlinePauseRef.current) clearTimeout(offlinePauseRef.current);
      if (offlineCompleteRef.current) clearTimeout(offlineCompleteRef.current);
    };
  }, []);

  // 30-min reminder
  useEffect(() => {
    if (isRunning && !isPaused) {
      reminderRef.current = setInterval(() => {
        showToast("Timer is still running");
        playSound("notify");
      }, 30 * 60 * 1000);
    }
    return () => { if (reminderRef.current) clearInterval(reminderRef.current); };
  }, [isRunning, isPaused]);

  const formatTime = (total: number) => {
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };
  const dateToAmPm = (d: Date): AmPmTime => {
    let h = d.getHours();
    const m = d.getMinutes();
    const ampm: "AM" | "PM" = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    return { hour: h, minute: m, ampm };
  };

  const amPmToDate = (base: Date, t: AmPmTime): Date => {
    const result = new Date(base);
    let h = t.hour % 12;
    if (t.ampm === "PM") h += 12;
    result.setHours(h, t.minute, 0, 0);
    return result;
  };

  const formatAmPmLabel = (t: AmPmTime) =>
    `${t.hour}:${String(t.minute).padStart(2, "0")} ${t.ampm}`;

  const handleStart = async () => {
    if (!user) return;

    // Close stuck running sessions
    const { data: stuck } = await supabase
      .from("work_sessions")
      .select("id")
      .eq("employee_id", user.id)
      .eq("status", "running");
    if (stuck) {
      for (const s of stuck) {
        await supabase.from("work_sessions").update({
          ended_at: new Date().toISOString(),
          status: "completed",
        }).eq("id", s.id);
      }
    }

    const { data, error } = await supabase.from("work_sessions").insert({
      employee_id: user.id,
      started_at: new Date().toISOString(),
      status: "running",
    }).select().single();
    if (error) { setStatusText("Error starting"); return; }

    const t: SavedTimer = {
      sessionId: data.id,
      startedAt: Date.now(),
      totalPausedMs: 0,
      pausedAt: null,
      isPaused: false,
      pauseReason: null,
    };
    timerRef.current = t;
    saveTimer(t);
    setSessionId(data.id);
    setIsRunning(true);
    setIsPaused(false);
    setSeconds(0);
    setStatusText("Working...");
    playSound("start");
    showToast("Timer started");
  };

  const handlePause = async () => {
    if (!timerRef.current) return;
    const t = timerRef.current;
    t.isPaused = true;
    t.pausedAt = Date.now();
    t.pauseReason = "manual";
    timerRef.current = t;
    saveTimer(t);
    setIsPaused(true);
    setStatusText("Paused");
    playSound("pause");
    showToast("Timer paused");
    await supabase.from("session_pauses").insert({
      session_id: t.sessionId,
      paused_at: new Date().toISOString(),
    });
  };

  const handleResume = async () => {
    if (!timerRef.current) return;
    const t = timerRef.current;
    if (t.pausedAt) t.totalPausedMs += Date.now() - t.pausedAt;
    t.pausedAt = null;
    t.isPaused = false;
    t.pauseReason = null;
    timerRef.current = t;
    saveTimer(t);
    setIsPaused(false);
    setStatusText("Working...");
    playSound("start");
    showToast("Timer resumed");
    const { data } = await supabase
      .from("session_pauses")
      .select("*")
      .eq("session_id", t.sessionId)
      .is("resumed_at", null)
      .order("paused_at", { ascending: false })
      .limit(1);
    if (data?.[0]) {
      await supabase.from("session_pauses").update({ resumed_at: new Date().toISOString() }).eq("id", data[0].id);
    }
  };

  const handleStopClick = () => {
    setShowActivityModal(true);
    setExpandedCategory(null);
    setSelectedNames([]);
    setOtherText("");
  };

  const toggleName = (name: string) => {
    setSelectedNames((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  };

  const handleConfirmActivities = async () => {
    if (!sessionId) return;
    const unique = [...new Set(selectedNames)];
    await supabase.from("session_activities").delete().eq("session_id", sessionId);
    for (const name of unique) {
      if (name === "Other") continue;
      const found = activities.find((a) => a.name === name);
      if (found) {
        await supabase.from("session_activities").insert({
          session_id: sessionId,
          activity_type_id: found.id,
        });
      }
    }
    if (unique.includes("Other") && otherText.trim()) {
      await supabase.from("session_activities").insert({
        session_id: sessionId,
        custom_text: otherText.trim(),
      });
    }

    const { data: session } = await supabase.from("work_sessions").select("*").eq("id", sessionId).single();
    if (session) {
      const start = new Date(session.started_at);
      const end = new Date();
      setSessionStart(start);
      setSessionEnd(end);
      setAdjustStart(dateToAmPm(start));
      setAdjustEnd(dateToAmPm(end));
    }
    setShowActivityModal(false);
    setShowTimeModal(true);
  };

  const handleFinalSave = async () => {
    if (!sessionId || !sessionStart || !sessionEnd || !user) return;
    const newStart = amPmToDate(sessionStart, adjustStart);
    const newEnd = amPmToDate(sessionEnd, adjustEnd);

    const TOL = 5 * 60 * 1000;
    if (newStart < new Date(sessionStart.getTime() - TOL) ||
        newEnd > new Date(sessionEnd.getTime() + TOL) ||
        newStart >= newEnd) {
      alert("Time must be within ±5 minutes of the real session");
      return;
    }

    // Auto-merge overlapping sessions instead of error
    const dayStart = new Date(newStart); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(newStart); dayEnd.setHours(23, 59, 59, 999);
    const { data: existing } = await supabase
      .from("work_sessions")
      .select("id, started_at, ended_at")
      .eq("employee_id", user.id)
      .eq("status", "completed")
      .neq("id", sessionId)
      .gte("started_at", dayStart.toISOString())
      .lte("started_at", dayEnd.toISOString());

    let finalStart = newStart;
    let finalEnd = newEnd;
    const mergeIds: string[] = [];

    if (existing) {
      for (const s of existing) {
        if (!s.ended_at) continue;
        const sStart = new Date(s.started_at).getTime();
        const sEnd = new Date(s.ended_at).getTime();
        if (finalStart.getTime() < sEnd && finalEnd.getTime() > sStart) {
          // Overlap → merge
          mergeIds.push(s.id);
          if (sStart < finalStart.getTime()) finalStart = new Date(s.started_at);
          if (sEnd > finalEnd.getTime()) finalEnd = new Date(s.ended_at);
        }
      }
    }

    // Move unique activities from merged sessions into current
    for (const mid of mergeIds) {
      const { data: oldActs } = await supabase
        .from("session_activities")
        .select("activity_type_id, custom_text")
        .eq("session_id", mid);
      if (oldActs) {
        for (const a of oldActs) {
          // Check if already exists on current session
          let q = supabase.from("session_activities").select("id").eq("session_id", sessionId);
          if (a.activity_type_id) {
            const { data: dup } = await q.eq("activity_type_id", a.activity_type_id).limit(1);
            if (!dup || dup.length === 0) {
              await supabase.from("session_activities").insert({
                session_id: sessionId,
                activity_type_id: a.activity_type_id,
                custom_text: a.custom_text,
              });
            }
          } else if (a.custom_text) {
            const { data: dup } = await supabase
              .from("session_activities")
              .select("id")
              .eq("session_id", sessionId)
              .eq("custom_text", a.custom_text)
              .limit(1);
            if (!dup || dup.length === 0) {
              await supabase.from("session_activities").insert({
                session_id: sessionId,
                custom_text: a.custom_text,
              });
            }
          }
        }
      }
      // Delete old session
      await supabase.from("session_activities").delete().eq("session_id", mid);
      await supabase.from("session_pauses").delete().eq("session_id", mid);
      await supabase.from("work_sessions").delete().eq("id", mid);
    }

    await supabase.from("work_sessions").update({
      started_at: finalStart.toISOString(),
      ended_at: finalEnd.toISOString(),
      status: "completed",
      custom_note: selectedNames.includes("Other") ? otherText.trim() : null,
    }).eq("id", sessionId);

    timerRef.current = null;
    saveTimer(null);
    setIsRunning(false);
    setIsPaused(false);
    setSessionId(null);
    setSeconds(0);
    setShowTimeModal(false);
    setStatusText(mergeIds.length > 0 ? "Session saved (merged)" : "Session finished");
    playSound("stop");
    showToast(mergeIds.length > 0 ? "Session saved & merged with overlap" : "Session saved");
  };

  const handleRecoveryYes = () => {
    if (!recoverySession) return;
    setSessionId(recoverySession.id);
    setSessionStart(new Date(recoverySession.started_at));
    setSessionEnd(new Date(recoverySession.ended_at));
    setAdjustStart(dateToAmPm(new Date(recoverySession.started_at)));
    setAdjustEnd(dateToAmPm(new Date(recoverySession.ended_at)));
    setShowRecovery(false);
    setShowActivityModal(true);
  };

  const handleRecoverySkip = async () => {
    if (recoverySession) {
      await supabase
        .from("work_sessions")
        .update({ custom_note: "__skipped__" })
        .eq("id", recoverySession.id);
    }
    // Also mark any other empty completed sessions for this user so they never pop again
    if (user) {
      const { data: empty } = await supabase
        .from("work_sessions")
        .select("id, session_activities(id)")
        .eq("employee_id", user.id)
        .eq("status", "completed");
      if (empty) {
        for (const s of empty as any[]) {
          if (!s.session_activities || s.session_activities.length === 0) {
            await supabase.from("work_sessions").update({ custom_note: "__skipped__" }).eq("id", s.id);
          }
        }
      }
    }
    setShowRecovery(false);
    setRecoverySession(null);
  };

  const handleLogout = () => {
    // Don't clear timer — just logout UI session
    localStorage.removeItem("timeglass_user");
    router.push("/");
  };

  if (!user) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-white/40">Loading...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col px-4 relative overflow-hidden">
      {isOffline && (
        <div className="absolute top-0 left-0 right-0 z-50 py-2.5 text-center text-sm font-medium"
          style={{ background: "rgba(239,68,68,0.9)" }}>
          No internet connection
        </div>
      )}

      {toast && (
        <div className="absolute bottom-6 right-4 z-50 px-4 py-3 rounded-xl text-sm max-w-[240px]"
          style={{ background: "rgba(20,20,30,0.95)", border: "1px solid rgba(255,255,255,0.12)", backdropFilter: "blur(12px)" }}>
          {toast}
        </div>
      )}

      <div className="absolute w-48 h-48 rounded-full pointer-events-none" style={{
        top: "5%", left: "-12%",
        background: "radial-gradient(circle, rgba(124,58,237,0.3) 0%, transparent 70%)",
        filter: "blur(35px)",
        transform: `translate(${mouse.x * 0.5}px,${mouse.y * 0.5}px)`,
        transition: "transform 0.12s ease-out",
      }} />
      <div className="absolute w-56 h-56 rounded-full pointer-events-none" style={{
        bottom: "8%", right: "-15%",
        background: "radial-gradient(circle, rgba(6,182,212,0.25) 0%, transparent 70%)",
        filter: "blur(45px)",
        transform: `translate(${mouse.x * -0.4}px,${mouse.y * -0.4}px)`,
        transition: "transform 0.12s ease-out",
      }} />

      {/* Header */}
      <div className="flex items-center justify-between pt-5 pb-3 relative z-10">
        <div>
          <p className="text-white/30 text-[10px] uppercase tracking-widest">Welcome</p>
          <p className="font-medium text-[15px]">{user.name}</p>
        </div>
        <div className="flex gap-1.5 flex-wrap justify-end">
          <button onClick={() => router.push("/calendar")} className="text-xs px-2.5 py-1.5 rounded-lg"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>Calendar</button>
          <button onClick={() => window.open("/board", "_blank")} className="text-xs px-2.5 py-1.5 rounded-lg"
            style={{ background: "rgba(6,182,212,0.15)", border: "1px solid rgba(6,182,212,0.3)" }}>Board</button>
          {user.role === "admin" && (
            <button onClick={() => router.push("/admin")} className="text-xs px-2.5 py-1.5 rounded-lg"
              style={{ background: "rgba(124,58,237,0.2)", border: "1px solid rgba(124,58,237,0.35)" }}>Admin</button>
          )}
          <button onClick={handleLogout} className="text-xs px-2.5 py-1.5 rounded-lg text-white/50"
            style={{ background: "rgba(255,255,255,0.04)" }}>Logout</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mb-4 relative z-10">
        {[
          { label: "Today", value: hoursToday },
          { label: "Week", value: hoursWeek },
          { label: "Month", value: hoursMonth },
        ].map((s) => (
          <div key={s.label} className="rounded-xl py-2.5 text-center"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <p className="text-white/30 text-[10px] uppercase tracking-wider">{s.label}</p>
            <p className="text-sm font-medium mt-0.5">{s.value.toFixed(1)}h</p>
          </div>
        ))}
      </div>

      {/* Timer */}
      <div className="flex-1 flex flex-col items-center justify-center relative z-10">
        <div className="w-full max-w-sm rounded-3xl p-7 text-center space-y-7" style={{
          background: "rgba(255,255,255,0.055)",
          backdropFilter: "blur(24px)",
          border: "1px solid rgba(255,255,255,0.1)",
          boxShadow: "0 25px 50px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)",
          transform: `perspective(900px) rotateY(${mouse.x * 0.06}deg) rotateX(${-mouse.y * 0.06}deg)`,
          transition: "transform 0.15s ease-out",
        }}>
          <p className="text-white/40 text-xs uppercase tracking-[0.2em]">{statusText}</p>
          <div className="text-5xl font-light tabular-nums" style={{ letterSpacing: "-0.04em" }}>
            {formatTime(seconds)}
          </div>
          <div className="flex gap-3 justify-center">
            {!isRunning ? (
              <button onClick={handleStart}
                className="px-10 py-3.5 rounded-2xl font-medium text-[15px] active:scale-95 transition-transform"
                style={{ background: "linear-gradient(135deg, #7c3aed 0%, #06b6d4 100%)", boxShadow: "0 8px 24px rgba(124,58,237,0.35)" }}>
                Start
              </button>
            ) : (
              <>
                <button onClick={isPaused ? handleResume : handlePause}
                  className="px-7 py-3.5 rounded-2xl font-medium text-[15px] active:scale-95"
                  style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                  {isPaused ? "Resume" : "Pause"}
                </button>
                <button onClick={handleStopClick}
                  className="px-7 py-3.5 rounded-2xl font-medium text-[15px] active:scale-95"
                  style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5" }}>
                  Stop
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="text-center text-white/20 text-xs pb-5 relative z-10">
        TimeGlass · {user.role === "admin" ? "Admin" : "Employee"}
      </div>

      {/* Interrupted session recovery */}
      {showRecovery && recoverySession && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 px-5"
          style={{ backdropFilter: "blur(8px)" }}>
          <div className="w-full max-w-sm rounded-3xl p-6 space-y-4"
            style={{ background: "rgba(18,18,26,0.98)", border: "1px solid rgba(255,255,255,0.1)" }}>
            <h2 className="text-lg font-medium text-center">Interrupted session</h2>
            <p className="text-white/50 text-sm text-center leading-relaxed">
              Your previous session ran from{" "}
              <span className="text-white/80">
                {new Date(recoverySession.started_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
              </span>
              {" "}to{" "}
              <span className="text-white/80">
                {new Date(recoverySession.ended_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
              </span>
              {" "}and ended unexpectedly.
            </p>
            <p className="text-white/40 text-xs text-center">
              Would you like to specify what you worked on?
            </p>
            <div className="flex gap-3 pt-2">
              <button onClick={handleRecoverySkip} className="flex-1 py-3 rounded-xl text-sm"
                style={{ background: "rgba(255,255,255,0.07)" }}>Skip</button>
              <button onClick={handleRecoveryYes} className="flex-1 py-3 rounded-xl text-sm font-medium"
                style={{ background: "linear-gradient(135deg, #7c3aed 0%, #06b6d4 100%)" }}>
                Yes, add activity
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Activity Modal */}
      {showActivityModal && (
        <div className="absolute inset-0 z-50 flex items-end justify-center bg-black/70"
          style={{ backdropFilter: "blur(8px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowActivityModal(false); }}>
          <div className="w-full max-w-md rounded-t-3xl p-6 flex flex-col"
            style={{ background: "rgba(18,18,26,0.98)", border: "1px solid rgba(255,255,255,0.1)", maxHeight: "85vh" }}
            onClick={(e) => e.stopPropagation()}>
            <div className="text-center mb-4"><h2 className="text-lg font-medium">What did you work on?</h2></div>
            <div className="space-y-2 overflow-y-auto" style={{ maxHeight: "50vh", overscrollBehavior: "contain" }}>
              {CATEGORIES.map((cat) => (
                <div key={cat.id}>
                  <button
                    onClick={() => cat.children
                      ? setExpandedCategory(expandedCategory === cat.id ? null : cat.id)
                      : toggleName(cat.name)}
                    className="w-full text-left px-4 py-3.5 rounded-xl flex justify-between"
                    style={{
                      background: selectedNames.includes(cat.name) || (cat.children && cat.children.some((c) => selectedNames.includes(c)))
                        ? "rgba(124,58,237,0.28)" : "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}>
                    <span>{cat.name}</span>
                    {cat.children && <span className="text-white/40">{expandedCategory === cat.id ? "▲" : "▼"}</span>}
                  </button>
                  {cat.children && expandedCategory === cat.id && (
                    <div className="ml-3 mt-1.5 space-y-1.5 border-l border-white/10 pl-3">
                      {cat.children.map((c) => (
                        <button key={c} onClick={() => toggleName(c)}
                          className="w-full text-left px-3 py-2.5 rounded-lg text-sm"
                          style={{ background: selectedNames.includes(c) ? "rgba(124,58,237,0.25)" : "rgba(255,255,255,0.04)" }}>
                          {c.replace(/^Ticket (Review|Work) — /, "")}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {selectedNames.includes("Other") && (
              <input value={otherText} onChange={(e) => setOtherText(e.target.value)}
                placeholder="Describe..." className="w-full mt-3 px-4 py-3 rounded-xl outline-none text-sm"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }} />
            )}
            <div className="flex gap-3 pt-5">
              <button onClick={() => setShowActivityModal(false)} className="flex-1 py-3.5 rounded-xl text-sm"
                style={{ background: "rgba(255,255,255,0.07)" }}>Cancel</button>
              <button onClick={handleConfirmActivities} disabled={selectedNames.length === 0}
                className="flex-1 py-3.5 rounded-xl text-sm font-medium disabled:opacity-40"
                style={{ background: "linear-gradient(135deg, #7c3aed 0%, #06b6d4 100%)" }}>Next</button>
            </div>
          </div>
        </div>
      )}

      {/* Time adjust modal — always AM/PM */}
      {showTimeModal && sessionStart && sessionEnd && (
        <div className="absolute inset-0 z-50 flex items-end justify-center bg-black/70" style={{ backdropFilter: "blur(8px)" }}>
          <div className="w-full max-w-md rounded-t-3xl p-6"
            style={{ background: "rgba(18,18,26,0.98)", border: "1px solid rgba(255,255,255,0.1)" }}>
            <div className="text-center mb-5">
              <h2 className="text-lg font-medium">Adjust work time</h2>
              <p className="text-white/40 text-sm mt-1">
                {formatAmPmLabel(dateToAmPm(sessionStart))} — {formatAmPmLabel(dateToAmPm(sessionEnd))} (±5 min)
              </p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-white/50 text-xs uppercase">From</label>
                <div className="flex gap-2 mt-1.5">
                  <select
                    value={adjustStart.hour}
                    onChange={(e) => setAdjustStart({ ...adjustStart, hour: Number(e.target.value) })}
                    className="flex-1 px-3 py-3 rounded-xl text-center text-lg outline-none"
                    style={{ background: "#1a1a24", color: "#fff", border: "1px solid rgba(255,255,255,0.15)" }}
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                      <option key={h} value={h} style={{ background: "#1a1a24" }}>{h}</option>
                    ))}
                  </select>
                  <span className="flex items-center text-white/40 text-lg">:</span>
                  <select
                    value={adjustStart.minute}
                    onChange={(e) => setAdjustStart({ ...adjustStart, minute: Number(e.target.value) })}
                    className="flex-1 px-3 py-3 rounded-xl text-center text-lg outline-none"
                    style={{ background: "#1a1a24", color: "#fff", border: "1px solid rgba(255,255,255,0.15)" }}
                  >
                    {Array.from({ length: 60 }, (_, i) => i).map((m) => (
                      <option key={m} value={m} style={{ background: "#1a1a24" }}>{String(m).padStart(2, "0")}</option>
                    ))}
                  </select>
                  <select
                    value={adjustStart.ampm}
                    onChange={(e) => setAdjustStart({ ...adjustStart, ampm: e.target.value as "AM" | "PM" })}
                    className="px-3 py-3 rounded-xl text-center text-lg outline-none"
                    style={{ background: "#1a1a24", color: "#fff", border: "1px solid rgba(255,255,255,0.15)" }}
                  >
                    <option value="AM" style={{ background: "#1a1a24" }}>AM</option>
                    <option value="PM" style={{ background: "#1a1a24" }}>PM</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-white/50 text-xs uppercase">To</label>
                <div className="flex gap-2 mt-1.5">
                  <select
                    value={adjustEnd.hour}
                    onChange={(e) => setAdjustEnd({ ...adjustEnd, hour: Number(e.target.value) })}
                    className="flex-1 px-3 py-3 rounded-xl text-center text-lg outline-none"
                    style={{ background: "#1a1a24", color: "#fff", border: "1px solid rgba(255,255,255,0.15)" }}
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                      <option key={h} value={h} style={{ background: "#1a1a24" }}>{h}</option>
                    ))}
                  </select>
                  <span className="flex items-center text-white/40 text-lg">:</span>
                  <select
                    value={adjustEnd.minute}
                    onChange={(e) => setAdjustEnd({ ...adjustEnd, minute: Number(e.target.value) })}
                    className="flex-1 px-3 py-3 rounded-xl text-center text-lg outline-none"
                    style={{ background: "#1a1a24", color: "#fff", border: "1px solid rgba(255,255,255,0.15)" }}
                  >
                    {Array.from({ length: 60 }, (_, i) => i).map((m) => (
                      <option key={m} value={m} style={{ background: "#1a1a24" }}>{String(m).padStart(2, "0")}</option>
                    ))}
                  </select>
                  <select
                    value={adjustEnd.ampm}
                    onChange={(e) => setAdjustEnd({ ...adjustEnd, ampm: e.target.value as "AM" | "PM" })}
                    className="px-3 py-3 rounded-xl text-center text-lg outline-none"
                    style={{ background: "#1a1a24", color: "#fff", border: "1px solid rgba(255,255,255,0.15)" }}
                  >
                    <option value="AM" style={{ background: "#1a1a24" }}>AM</option>
                    <option value="PM" style={{ background: "#1a1a24" }}>PM</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex gap-3 pt-5">
              <button onClick={() => { setShowTimeModal(false); setShowActivityModal(true); }}
                className="flex-1 py-3.5 rounded-xl text-sm" style={{ background: "rgba(255,255,255,0.07)" }}>Back</button>
              <button onClick={handleFinalSave}
                className="flex-1 py-3.5 rounded-xl text-sm font-medium"
                style={{ background: "linear-gradient(135deg, #7c3aed 0%, #06b6d4 100%)" }}>Save Session</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
