"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type User = {
  id: string;
  name: string;
  access_code: string;
  role: string;
};

type ActivityType = { id: string; name: string };
type Pause = { id: string; paused_at: string; resumed_at: string | null };

const CATEGORIES = [
  { id: "ticket-review", name: "Ticket Review", children: ["Ticket Review — New", "Ticket Review — Approved", "Ticket Review — Finished"] },
  { id: "ticket-work", name: "Ticket Work", children: ["Ticket Work — Voting", "Ticket Work — Status Change", "Ticket Work — Writing Contract", "Ticket Work — Distribution", "Ticket Work — Artist Communication"] },
  { id: "artist-support", name: "Artist Support", children: null },
  { id: "marketing", name: "Marketing", children: null },
  { id: "development", name: "Development", children: null },
  { id: "double-check", name: "Double Check", children: null },
  { id: "other", name: "Other", children: null },
];

function playSound(type: "start" | "stop" | "notify") {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.value = 0.07;
    if (type === "start") osc.frequency.value = 523;
    else if (type === "stop") osc.frequency.value = 392;
    else osc.frequency.value = 440;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.stop(ctx.currentTime + 0.25);
  } catch {}
}

async function requestNotificationPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    await Notification.requestPermission();
  }
}

function sendSystemNotification(title: string, body: string) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    try {
      new Notification(title, {
        body,
        silent: false,
        // icon can be added later
      });
    } catch {}
  }
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

  // Stats
  const [hoursToday, setHoursToday] = useState(0);
  const [hoursWeek, setHoursWeek] = useState(0);
  const [hoursMonth, setHoursMonth] = useState(0);

  // Modals
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [activities, setActivities] = useState<ActivityType[]>([]);
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [otherText, setOtherText] = useState("");
  const [showTimeModal, setShowTimeModal] = useState(false);
  const [sessionStart, setSessionStart] = useState<Date | null>(null);
  const [sessionEnd, setSessionEnd] = useState<Date | null>(null);
  const [pauses, setPauses] = useState<Pause[]>([]);
  const [adjustStart, setAdjustStart] = useState("");
  const [adjustEnd, setAdjustEnd] = useState("");

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const offlineTimerRef = useRef<NodeJS.Timeout | null>(null);
  const reminderTimerRef = useRef<NodeJS.Timeout | null>(null);
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pauseReasonRef = useRef<"manual" | "internet" | null>(null);

  const showToast = (msg: string, title = "TimeGlass") => {
    setToast(msg);
    setTimeout(() => setToast(null), 4500);
    // System notification (Windows toast)
    sendSystemNotification(title, msg);
  };

  // Auth + inactivity + notification permission
  useEffect(() => {
    const saved = localStorage.getItem("timeglass_user");
    if (!saved) { router.push("/"); return; }
    setUser(JSON.parse(saved));
    requestNotificationPermission();

    const resetInactivity = () => {
      localStorage.setItem("timeglass_last_activity", Date.now().toString());
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = setTimeout(() => {
        if (!isRunning) {
          localStorage.removeItem("timeglass_user");
          router.push("/");
        }
      }, 60 * 60 * 1000); // 1 hour
    };

    resetInactivity();
    window.addEventListener("mousemove", resetInactivity);
    window.addEventListener("keydown", resetInactivity);
    window.addEventListener("click", resetInactivity);

    return () => {
      window.removeEventListener("mousemove", resetInactivity);
      window.removeEventListener("keydown", resetInactivity);
      window.removeEventListener("click", resetInactivity);
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    };
  }, [router, isRunning]);

  // Load activities + stats
  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data } = await supabase.from("activity_types").select("*");
      if (data) setActivities(data);

      const now = new Date();
      const startOfDay = new Date(now); startOfDay.setHours(0,0,0,0);
      const startOfWeek = new Date(now);
      const day = startOfWeek.getDay();
      startOfWeek.setDate(startOfWeek.getDate() - (day === 0 ? 6 : day - 1));
      startOfWeek.setHours(0,0,0,0);
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
      setHoursToday(t);
      setHoursWeek(w);
      setHoursMonth(m);
    };
    load();
  }, [user]);

  useEffect(() => {
    const handleMouse = (e: MouseEvent) => {
      setMouse({
        x: (e.clientX / window.innerWidth - 0.5) * 18,
        y: (e.clientY / window.innerHeight - 0.5) * 18,
      });
    };
    window.addEventListener("mousemove", handleMouse);
    return () => window.removeEventListener("mousemove", handleMouse);
  }, []);

  useEffect(() => {
    if (isRunning && !isPaused) {
      intervalRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } else if (intervalRef.current) clearInterval(intervalRef.current);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isRunning, isPaused]);

  // Offline
  useEffect(() => {
    const handleOffline = () => {
      setIsOffline(true);
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
      offlineTimerRef.current = setTimeout(async () => {
        if (!navigator.onLine && isRunning && !isPaused) {
          setIsPaused(true);
          pauseReasonRef.current = "internet";
          setStatusText("No internet — timer paused");
          showToast("No internet — timer paused");
          if (sessionId) {
            await supabase.from("session_pauses").insert({ session_id: sessionId, paused_at: new Date().toISOString() });
          }
        }
      }, 2 * 60 * 1000);
    };
    const handleOnline = async () => {
      setIsOffline(false);
      if (offlineTimerRef.current) { clearTimeout(offlineTimerRef.current); offlineTimerRef.current = null; }
      if (isRunning && isPaused && pauseReasonRef.current === "internet") {
        setIsPaused(false);
        pauseReasonRef.current = null;
        setStatusText("Connection restored");
        showToast("Connection restored — timer resumed");
        if (sessionId) {
          const { data } = await supabase.from("session_pauses").select("*").eq("session_id", sessionId).is("resumed_at", null).order("paused_at", { ascending: false }).limit(1);
          if (data?.[0]) await supabase.from("session_pauses").update({ resumed_at: new Date().toISOString() }).eq("id", data[0].id);
        }
      }
    };
    setIsOffline(!navigator.onLine);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
    };
  }, [isRunning, isPaused, sessionId]);

  // 30 min reminder
  useEffect(() => {
    if (isRunning && !isPaused) {
      reminderTimerRef.current = setInterval(() => {
        showToast("Timer is still running");
        playSound("notify");
      }, 30 * 60 * 1000);
    } else if (reminderTimerRef.current) clearInterval(reminderTimerRef.current);
    return () => { if (reminderTimerRef.current) clearInterval(reminderTimerRef.current); };
  }, [isRunning, isPaused]);

  const formatTime = (total: number) => {
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  };
  const formatDateTime = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  const handleStart = async () => {
    if (!user) return;
    const { data, error } = await supabase.from("work_sessions").insert({
      employee_id: user.id, started_at: new Date().toISOString(), status: "running"
    }).select().single();
    if (error) { setStatusText("Error"); return; }
    setSessionId(data.id);
    setIsRunning(true); setIsPaused(false); setSeconds(0);
    setStatusText("Working...");
    pauseReasonRef.current = null;
    playSound("start");
    showToast("Timer started");
  };

  const handlePause = async () => {
    if (!sessionId) return;
    setIsPaused(true); pauseReasonRef.current = "manual"; setStatusText("Paused");
    await supabase.from("session_pauses").insert({ session_id: sessionId, paused_at: new Date().toISOString() });
  };

  const handleResume = async () => {
    if (!sessionId) return;
    setIsPaused(false); pauseReasonRef.current = null; setStatusText("Working...");
    const { data } = await supabase.from("session_pauses").select("*").eq("session_id", sessionId).is("resumed_at", null).order("paused_at", { ascending: false }).limit(1);
    if (data?.[0]) await supabase.from("session_pauses").update({ resumed_at: new Date().toISOString() }).eq("id", data[0].id);
  };

  const handleStopClick = () => {
    setShowActivityModal(true);
    setExpandedCategory(null); setSelectedNames([]); setOtherText("");
  };

  const toggleName = (name: string) => {
    setSelectedNames(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
  };

  const handleConfirmActivities = async () => {
    if (!sessionId) return;
    for (const name of selectedNames) {
      if (name === "Other") continue;
      const found = activities.find(a => a.name === name);
      if (found) await supabase.from("session_activities").insert({ session_id: sessionId, activity_type_id: found.id });
    }
    if (selectedNames.includes("Other") && otherText.trim()) {
      await supabase.from("session_activities").insert({ session_id: sessionId, custom_text: otherText.trim() });
    }
    const { data: session } = await supabase.from("work_sessions").select("*").eq("id", sessionId).single();
    const { data: pausesData } = await supabase.from("session_pauses").select("*").eq("session_id", sessionId).order("paused_at");
    if (session) {
      const start = new Date(session.started_at);
      const end = new Date();
      setSessionStart(start); setSessionEnd(end); setPauses(pausesData || []);
      setAdjustStart(formatDateTime(start)); setAdjustEnd(formatDateTime(end));
    }
    setShowActivityModal(false); setShowTimeModal(true);
  };

  const handleFinalSave = async () => {
    if (!sessionId || !sessionStart || !sessionEnd) return;
    const [sh, sm] = adjustStart.split(":").map(Number);
    const [eh, em] = adjustEnd.split(":").map(Number);
    const newStart = new Date(sessionStart); newStart.setHours(sh, sm, 0, 0);
    const newEnd = new Date(sessionEnd); newEnd.setHours(eh, em, 0, 0);

    // ±5 minutes tolerance
    const TOLERANCE_MS = 5 * 60 * 1000;
    const minStart = new Date(sessionStart.getTime() - TOLERANCE_MS);
    const maxEnd = new Date(sessionEnd.getTime() + TOLERANCE_MS);

    if (newStart < minStart || newEnd > maxEnd || newStart >= newEnd) {
      alert("Time must be within ±5 minutes of the real session");
      return;
    }
    await supabase.from("work_sessions").update({
      started_at: newStart.toISOString(), ended_at: newEnd.toISOString(), status: "completed",
      custom_note: selectedNames.includes("Other") ? otherText.trim() : null
    }).eq("id", sessionId);

    setIsRunning(false); setIsPaused(false); setStatusText("Session finished");
    setShowTimeModal(false); setSessionId(null); setSeconds(0);
    playSound("stop"); showToast("Session saved");
  };

  const handleLogout = () => {
    localStorage.removeItem("timeglass_user");
    router.push("/");
  };

  if (!user) return <div className="h-full flex items-center justify-center"><p className="text-white/40">Loading...</p></div>;

  return (
    <div className="h-full flex flex-col px-4 relative overflow-hidden">
      {/* Offline banner */}
      {isOffline && (
        <div className="absolute top-0 left-0 right-0 z-50 py-2.5 text-center text-sm font-medium" style={{ background: "rgba(239,68,68,0.9)" }}>
          No internet connection
        </div>
      )}

      {/* Toast bottom-right */}
      {toast && (
        <div 
          className="absolute bottom-6 right-4 z-50 px-4 py-3 rounded-xl text-sm max-w-[240px] shadow-lg"
          style={{ background: "rgba(20,20,30,0.95)", border: "1px solid rgba(255,255,255,0.12)", backdropFilter: "blur(12px)" }}
        >
          {toast}
        </div>
      )}

      {/* Glows */}
      <div className="absolute w-48 h-48 rounded-full pointer-events-none" style={{
        top: "5%", left: "-12%", background: "radial-gradient(circle, rgba(124,58,237,0.3) 0%, transparent 70%)",
        filter: "blur(35px)", transform: `translate(${mouse.x*0.5}px,${mouse.y*0.5}px)`, transition: "transform 0.12s ease-out"
      }} />
      <div className="absolute w-56 h-56 rounded-full pointer-events-none" style={{
        bottom: "8%", right: "-15%", background: "radial-gradient(circle, rgba(6,182,212,0.25) 0%, transparent 70%)",
        filter: "blur(45px)", transform: `translate(${mouse.x*-0.4}px,${mouse.y*-0.4}px)`, transition: "transform 0.12s ease-out"
      }} />

      {/* Header */}
      <div className="flex items-center justify-between pt-5 pb-3 relative z-10">
        <div>
          <p className="text-white/30 text-[10px] uppercase tracking-widest">Welcome</p>
          <p className="font-medium text-[15px]">{user.name}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => router.push("/calendar")} className="text-xs px-2.5 py-1.5 rounded-lg" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>Calendar</button>
          {user.role === "admin" && (
            <button onClick={() => router.push("/admin")} className="text-xs px-2.5 py-1.5 rounded-lg" style={{ background: "rgba(124,58,237,0.2)", border: "1px solid rgba(124,58,237,0.35)" }}>Admin</button>
          )}
          <button onClick={handleLogout} className="text-xs px-2.5 py-1.5 rounded-lg text-white/50" style={{ background: "rgba(255,255,255,0.04)" }}>Logout</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mb-4 relative z-10">
        {[
          { label: "Today", value: hoursToday },
          { label: "Week", value: hoursWeek },
          { label: "Month", value: hoursMonth },
        ].map((s) => (
          <div key={s.label} className="rounded-xl py-2.5 text-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <p className="text-white/30 text-[10px] uppercase tracking-wider">{s.label}</p>
            <p className="text-sm font-medium mt-0.5">{s.value.toFixed(1)}h</p>
          </div>
        ))}
      </div>

      {/* Timer card */}
      <div className="flex-1 flex flex-col items-center justify-center relative z-10">
        <div className="w-full max-w-sm rounded-3xl p-7 text-center space-y-7" style={{
          background: "rgba(255,255,255,0.055)", backdropFilter: "blur(24px)",
          border: "1px solid rgba(255,255,255,0.1)",
          boxShadow: "0 25px 50px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)",
          transform: `perspective(900px) rotateY(${mouse.x*0.06}deg) rotateX(${-mouse.y*0.06}deg)`,
          transition: "transform 0.15s ease-out"
        }}>
          <p className="text-white/40 text-xs uppercase tracking-[0.2em]">{statusText}</p>
          <div className="text-5xl font-light tabular-nums" style={{ letterSpacing: "-0.04em" }}>{formatTime(seconds)}</div>
          <div className="flex gap-3 justify-center">
            {!isRunning ? (
              <button onClick={handleStart} className="px-10 py-3.5 rounded-2xl font-medium text-[15px] active:scale-95 transition-transform"
                style={{ background: "linear-gradient(135deg, #7c3aed 0%, #06b6d4 100%)", boxShadow: "0 8px 24px rgba(124,58,237,0.35)" }}>
                Start
              </button>
            ) : (
              <>
                <button onClick={isPaused ? handleResume : handlePause} className="px-7 py-3.5 rounded-2xl font-medium text-[15px] active:scale-95"
                  style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                  {isPaused ? "Resume" : "Pause"}
                </button>
                <button onClick={handleStopClick} className="px-7 py-3.5 rounded-2xl font-medium text-[15px] active:scale-95"
                  style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5" }}>
                  Stop
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="text-center text-white/20 text-xs pb-5 relative z-10">TimeGlass • {user.role === "admin" ? "Admin" : "Employee"}</div>

      {/* Activity Modal + Time Modal - same as before, abbreviated for space */}
      {showActivityModal && (
        <div className="absolute inset-0 z-50 flex items-end justify-center bg-black/70" style={{ backdropFilter: "blur(8px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowActivityModal(false); }}>
          <div className="w-full max-w-md rounded-t-3xl p-6 flex flex-col" style={{ background: "rgba(18,18,26,0.98)", border: "1px solid rgba(255,255,255,0.1)", maxHeight: "85vh" }}
            onClick={(e) => e.stopPropagation()}>
            <div className="text-center mb-4"><h2 className="text-lg font-medium">What did you work on?</h2></div>
            <div className="space-y-2 overflow-y-auto" style={{ maxHeight: "50vh", overscrollBehavior: "contain" }}>
              {CATEGORIES.map((cat) => (
                <div key={cat.id}>
                  <button onClick={() => cat.children ? setExpandedCategory(expandedCategory === cat.id ? null : cat.id) : toggleName(cat.name)}
                    className="w-full text-left px-4 py-3.5 rounded-xl flex justify-between"
                    style={{ background: selectedNames.includes(cat.name) || (cat.children && cat.children.some(c => selectedNames.includes(c))) ? "rgba(124,58,237,0.28)" : "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <span>{cat.name}</span>
                    {cat.children && <span className="text-white/40">{expandedCategory === cat.id ? "▲" : "▼"}</span>}
                  </button>
                  {cat.children && expandedCategory === cat.id && (
                    <div className="ml-3 mt-1.5 space-y-1.5 border-l border-white/10 pl-3">
                      {cat.children.map((c) => (
                        <button key={c} onClick={() => toggleName(c)} className="w-full text-left px-3 py-2.5 rounded-lg text-sm"
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
              <input value={otherText} onChange={(e) => setOtherText(e.target.value)} placeholder="Describe..." className="w-full mt-3 px-4 py-3 rounded-xl outline-none text-sm"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }} />
            )}
            <div className="flex gap-3 pt-5">
              <button onClick={() => setShowActivityModal(false)} className="flex-1 py-3.5 rounded-xl text-sm" style={{ background: "rgba(255,255,255,0.07)" }}>Cancel</button>
              <button onClick={handleConfirmActivities} disabled={selectedNames.length === 0} className="flex-1 py-3.5 rounded-xl text-sm font-medium disabled:opacity-40"
                style={{ background: "linear-gradient(135deg, #7c3aed 0%, #06b6d4 100%)" }}>Next</button>
            </div>
          </div>
        </div>
      )}

      {showTimeModal && sessionStart && sessionEnd && (
        <div className="absolute inset-0 z-50 flex items-end justify-center bg-black/70" style={{ backdropFilter: "blur(8px)" }}>
          <div className="w-full max-w-md rounded-t-3xl p-6" style={{ background: "rgba(18,18,26,0.98)", border: "1px solid rgba(255,255,255,0.1)" }}>
            <div className="text-center mb-5">
              <h2 className="text-lg font-medium">Adjust work time</h2>
              <p className="text-white/40 text-sm mt-1">{formatDateTime(sessionStart)} — {formatDateTime(sessionEnd)}</p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-white/50 text-xs uppercase">From</label>
                <input type="time" value={adjustStart} onChange={(e) => setAdjustStart(e.target.value)} className="w-full mt-1.5 px-4 py-3.5 rounded-xl outline-none text-lg"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }} />
              </div>
              <div>
                <label className="text-white/50 text-xs uppercase">To</label>
                <input type="time" value={adjustEnd} onChange={(e) => setAdjustEnd(e.target.value)} className="w-full mt-1.5 px-4 py-3.5 rounded-xl outline-none text-lg"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }} />
              </div>
            </div>
            <div className="flex gap-3 pt-5">
              <button onClick={() => { setShowTimeModal(false); setShowActivityModal(true); }} className="flex-1 py-3.5 rounded-xl text-sm" style={{ background: "rgba(255,255,255,0.07)" }}>Back</button>
              <button onClick={handleFinalSave} className="flex-1 py-3.5 rounded-xl text-sm font-medium" style={{ background: "linear-gradient(135deg, #7c3aed 0%, #06b6d4 100%)" }}>Save Session</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
