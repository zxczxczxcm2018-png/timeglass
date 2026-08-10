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

type ActivityType = {
  id: string;
  name: string;
};

type Pause = {
  id: string;
  paused_at: string;
  resumed_at: string | null;
};

const CATEGORIES = [
  {
    id: "ticket-review",
    name: "Ticket Review",
    children: [
      "Ticket Review — New",
      "Ticket Review — Approved",
      "Ticket Review — Finished",
    ],
  },
  {
    id: "ticket-work",
    name: "Ticket Work",
    children: [
      "Ticket Work — Voting",
      "Ticket Work — Status Change",
      "Ticket Work — Writing Contract",
      "Ticket Work — Distribution",
      "Ticket Work — Artist Communication",
    ],
  },
  { id: "artist-support", name: "Artist Support", children: null },
  { id: "marketing", name: "Marketing", children: null },
  { id: "development", name: "Development", children: null },
  { id: "double-check", name: "Double Check", children: null },
  { id: "other", name: "Other", children: null },
];

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

  // Offline banner + 30 min reminder
  const [isOffline, setIsOffline] = useState(false);
  const [showReminder, setShowReminder] = useState(false);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const offlineTimerRef = useRef<NodeJS.Timeout | null>(null);
  const reminderTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pauseReasonRef = useRef<"manual" | "internet" | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("timeglass_user");
    if (!saved) {
      router.push("/");
      return;
    }
    setUser(JSON.parse(saved));
  }, [router]);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("activity_types").select("*");
      if (data) setActivities(data);
    };
    load();
  }, []);

  useEffect(() => {
    const handleMouse = (e: MouseEvent) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 16;
      const y = (e.clientY / window.innerHeight - 0.5) * 16;
      setMouse({ x, y });
    };
    window.addEventListener("mousemove", handleMouse);
    return () => window.removeEventListener("mousemove", handleMouse);
  }, []);

  useEffect(() => {
    if (isRunning && !isPaused) {
      intervalRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isRunning, isPaused]);

  // Offline detection + banner
  useEffect(() => {
    const handleOffline = () => {
      setIsOffline(true);
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
      offlineTimerRef.current = setTimeout(async () => {
        if (!navigator.onLine && isRunning && !isPaused) {
          setIsPaused(true);
          pauseReasonRef.current = "internet";
          setStatusText("No internet — timer paused");
          if (sessionId) {
            await supabase.from("session_pauses").insert({
              session_id: sessionId,
              paused_at: new Date().toISOString(),
            });
          }
        }
      }, 2 * 60 * 1000);
    };

    const handleOnline = async () => {
      setIsOffline(false);
      if (offlineTimerRef.current) {
        clearTimeout(offlineTimerRef.current);
        offlineTimerRef.current = null;
      }
      if (isRunning && isPaused && pauseReasonRef.current === "internet") {
        setIsPaused(false);
        pauseReasonRef.current = null;
        setStatusText("Connection restored — timer resumed");
        if (sessionId) {
          const { data: pausesData } = await supabase
            .from("session_pauses")
            .select("*")
            .eq("session_id", sessionId)
            .is("resumed_at", null)
            .order("paused_at", { ascending: false })
            .limit(1);
          if (pausesData && pausesData.length > 0) {
            await supabase
              .from("session_pauses")
              .update({ resumed_at: new Date().toISOString() })
              .eq("id", pausesData[0].id);
          }
        }
      }
    };

    // Initial check
    setIsOffline(!navigator.onLine);

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
    };
  }, [isRunning, isPaused, sessionId]);

  // 30-minute reminder
  useEffect(() => {
    if (isRunning && !isPaused) {
      reminderTimerRef.current = setInterval(() => {
        setShowReminder(true);
        // Quiet notification sound (very short beep)
        try {
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = 440;
          gain.gain.value = 0.08; // quiet
          osc.start();
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
          osc.stop(ctx.currentTime + 0.3);
        } catch (e) {}
        // Auto hide after 6 seconds
        setTimeout(() => setShowReminder(false), 6000);
      }, 30 * 60 * 1000); // 30 minutes
    } else {
      if (reminderTimerRef.current) {
        clearInterval(reminderTimerRef.current);
        reminderTimerRef.current = null;
      }
    }
    return () => {
      if (reminderTimerRef.current) clearInterval(reminderTimerRef.current);
    };
  }, [isRunning, isPaused]);

  const formatTime = (totalSeconds: number) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const formatDateTime = (d: Date) => {
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  };

  const handleStart = async () => {
    if (!user) return;
    const now = new Date();
    const { data, error } = await supabase
      .from("work_sessions")
      .insert({
        employee_id: user.id,
        started_at: now.toISOString(),
        status: "running",
      })
      .select()
      .single();
    if (error) {
      setStatusText("Error starting session");
      return;
    }
    setSessionId(data.id);
    setIsRunning(true);
    setIsPaused(false);
    setSeconds(0);
    setStatusText("Working...");
    pauseReasonRef.current = null;
  };

  const handlePause = async () => {
    if (!sessionId) return;
    setIsPaused(true);
    pauseReasonRef.current = "manual";
    setStatusText("Paused");
    await supabase.from("session_pauses").insert({
      session_id: sessionId,
      paused_at: new Date().toISOString(),
    });
  };

  const handleResume = async () => {
    if (!sessionId) return;
    setIsPaused(false);
    pauseReasonRef.current = null;
    setStatusText("Working...");
    const { data: pausesData } = await supabase
      .from("session_pauses")
      .select("*")
      .eq("session_id", sessionId)
      .is("resumed_at", null)
      .order("paused_at", { ascending: false })
      .limit(1);
    if (pausesData && pausesData.length > 0) {
      await supabase
        .from("session_pauses")
        .update({ resumed_at: new Date().toISOString() })
        .eq("id", pausesData[0].id);
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

    for (const name of selectedNames) {
      if (name === "Other") continue;
      const found = activities.find((a) => a.name === name);
      if (found) {
        await supabase.from("session_activities").insert({
          session_id: sessionId,
          activity_type_id: found.id,
        });
      }
    }
    if (selectedNames.includes("Other") && otherText.trim()) {
      await supabase.from("session_activities").insert({
        session_id: sessionId,
        custom_text: otherText.trim(),
      });
    }

    const { data: session } = await supabase
      .from("work_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();

    const { data: pausesData } = await supabase
      .from("session_pauses")
      .select("*")
      .eq("session_id", sessionId)
      .order("paused_at");

    if (session) {
      const start = new Date(session.started_at);
      const end = new Date();
      setSessionStart(start);
      setSessionEnd(end);
      setPauses(pausesData || []);
      setAdjustStart(formatDateTime(start));
      setAdjustEnd(formatDateTime(end));
    }

    setShowActivityModal(false);
    setShowTimeModal(true);
  };

  const handleFinalSave = async () => {
    if (!sessionId || !sessionStart || !sessionEnd) return;

    const [startH, startM] = adjustStart.split(":").map(Number);
    const [endH, endM] = adjustEnd.split(":").map(Number);

    const newStart = new Date(sessionStart);
    newStart.setHours(startH, startM, 0, 0);

    const newEnd = new Date(sessionEnd);
    newEnd.setHours(endH, endM, 0, 0);

    if (newStart < sessionStart) {
      alert("Start time cannot be earlier than the real session start");
      return;
    }
    if (newEnd > sessionEnd) {
      alert("End time cannot be later than the real session end");
      return;
    }
    if (newStart >= newEnd) {
      alert("Start time must be before end time");
      return;
    }

    await supabase
      .from("work_sessions")
      .update({
        started_at: newStart.toISOString(),
        ended_at: newEnd.toISOString(),
        status: "completed",
        custom_note: selectedNames.includes("Other") ? otherText.trim() : null,
      })
      .eq("id", sessionId);

    setIsRunning(false);
    setIsPaused(false);
    setStatusText("Session finished");
    setShowTimeModal(false);
    setSelectedNames([]);
    setOtherText("");
    setSessionId(null);
    setSeconds(0);
    pauseReasonRef.current = null;

    alert("Session saved successfully!");
  };

  const handleLogout = () => {
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
    <div className="h-full flex flex-col px-5 relative overflow-hidden">

      {/* Offline banner */}
      {isOffline && (
        <div 
          className="absolute top-0 left-0 right-0 z-50 px-4 py-3 text-center text-sm font-medium"
          style={{
            background: "rgba(239, 68, 68, 0.9)",
            backdropFilter: "blur(8px)",
            color: "white"
          }}
        >
          No internet connection
          {isRunning && isPaused && pauseReasonRef.current === "internet" && " — timer paused"}
        </div>
      )}

      {/* 30-min reminder banner */}
      {showReminder && (
        <div 
          className="absolute top-0 left-0 right-0 z-50 px-4 py-3 text-center text-sm font-medium"
          style={{
            background: "linear-gradient(135deg, rgba(124,58,237,0.95), rgba(6,182,212,0.95))",
            backdropFilter: "blur(8px)",
            color: "white"
          }}
        >
          Timer is still running
        </div>
      )}

      <div 
        className="absolute w-48 h-48 rounded-full pointer-events-none"
        style={{
          top: "8%", left: "-10%",
          background: "radial-gradient(circle, rgba(124,58,237,0.28) 0%, transparent 70%)",
          filter: "blur(35px)",
          transform: `translate(${mouse.x * 0.5}px, ${mouse.y * 0.5}px)`,
          transition: "transform 0.15s ease-out"
        }}
      />
      <div 
        className="absolute w-56 h-56 rounded-full pointer-events-none"
        style={{
          bottom: "10%", right: "-15%",
          background: "radial-gradient(circle, rgba(6,182,212,0.22) 0%, transparent 70%)",
          filter: "blur(45px)",
          transform: `translate(${mouse.x * -0.35}px, ${mouse.y * -0.35}px)`,
          transition: "transform 0.15s ease-out"
        }}
      />

      <div className="flex items-center justify-between pt-6 pb-4 relative z-10">
        <div>
          <p className="text-white/30 text-[11px] uppercase tracking-widest mb-0.5">Welcome</p>
          <p className="font-medium text-[15px]">{user.name}</p>
        </div>
        <button
          onClick={handleLogout}
          className="text-white/35 text-sm hover:text-white/70 transition px-3 py-1.5 rounded-xl"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          Logout
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center relative z-10">
        <div 
          className="w-full max-w-sm rounded-3xl p-8 text-center space-y-8"
          style={{
            background: "rgba(255,255,255,0.055)",
            backdropFilter: "blur(24px)",
            border: "1px solid rgba(255,255,255,0.1)",
            boxShadow: "0 25px 50px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)",
            transform: `translate(${mouse.x * 0.08}px, ${mouse.y * 0.08}px)`,
            transition: "transform 0.2s ease-out"
          }}
        >
          <p className="text-white/40 text-xs uppercase tracking-[0.2em]">{statusText}</p>
          <div className="text-5xl font-light tabular-nums" style={{ letterSpacing: "-0.04em" }}>
            {formatTime(seconds)}
          </div>

          <div className="flex gap-3 justify-center">
            {!isRunning ? (
              <button
                onClick={handleStart}
                className="px-10 py-3.5 rounded-2xl font-medium text-[15px] active:scale-95 transition-transform"
                style={{ 
                  background: "linear-gradient(135deg, #7c3aed 0%, #06b6d4 100%)",
                  boxShadow: "0 8px 24px rgba(124, 58, 237, 0.35)"
                }}
              >
                Start
              </button>
            ) : (
              <>
                {!isPaused ? (
                  <button
                    onClick={handlePause}
                    className="px-7 py-3.5 rounded-2xl font-medium text-[15px] active:scale-95 transition-transform"
                    style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}
                  >
                    Pause
                  </button>
                ) : (
                  <button
                    onClick={handleResume}
                    className="px-7 py-3.5 rounded-2xl font-medium text-[15px] active:scale-95 transition-transform"
                    style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}
                  >
                    Resume
                  </button>
                )}
                <button
                  onClick={handleStopClick}
                  className="px-7 py-3.5 rounded-2xl font-medium text-[15px] active:scale-95 transition-transform"
                  style={{ 
                    background: "rgba(239, 68, 68, 0.15)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    color: "#fca5a5"
                  }}
                >
                  Stop
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="text-center text-white/20 text-xs pb-6 relative z-10">
        TimeGlass • {user.role === "admin" ? "Admin" : "Employee"}
      </div>

      {showActivityModal && (
        <div 
          className="absolute inset-0 z-50 flex items-end justify-center bg-black/70"
          style={{ backdropFilter: "blur(8px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowActivityModal(false); }}
        >
          <div 
            className="w-full max-w-md rounded-t-3xl p-6 flex flex-col"
            style={{
              background: "rgba(18,18,26,0.98)",
              border: "1px solid rgba(255,255,255,0.1)",
              maxHeight: "85vh"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center mb-4 shrink-0">
              <h2 className="text-lg font-medium">What did you work on?</h2>
              <p className="text-white/40 text-sm mt-1">Select one or more</p>
            </div>

            <div className="space-y-2 overflow-y-auto pr-1" style={{ maxHeight: "50vh", overscrollBehavior: "contain" }}>
              {CATEGORIES.map((cat) => (
                <div key={cat.id}>
                  <button
                    onClick={() => {
                      if (cat.children) {
                        setExpandedCategory(expandedCategory === cat.id ? null : cat.id);
                      } else {
                        toggleName(cat.name);
                      }
                    }}
                    className="w-full text-left px-4 py-3.5 rounded-xl transition-all flex items-center justify-between"
                    style={{
                      background: 
                        (!cat.children && selectedNames.includes(cat.name)) ||
                        (cat.children && cat.children.some(c => selectedNames.includes(c)))
                          ? "rgba(124, 58, 237, 0.28)" 
                          : "rgba(255,255,255,0.05)",
                      border: 
                        (!cat.children && selectedNames.includes(cat.name)) ||
                        (cat.children && cat.children.some(c => selectedNames.includes(c)))
                          ? "1px solid rgba(124, 58, 237, 0.55)"
                          : "1px solid rgba(255,255,255,0.08)"
                    }}
                  >
                    <span>{cat.name}</span>
                    {cat.children && (
                      <span className="text-white/40 text-sm">
                        {expandedCategory === cat.id ? "▲" : "▼"}
                      </span>
                    )}
                  </button>

                  {cat.children && expandedCategory === cat.id && (
                    <div className="ml-3 mt-1.5 space-y-1.5 border-l border-white/10 pl-3">
                      {cat.children.map((childName) => (
                        <button
                          key={childName}
                          onClick={() => toggleName(childName)}
                          className="w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all"
                          style={{
                            background: selectedNames.includes(childName)
                              ? "rgba(124, 58, 237, 0.25)"
                              : "rgba(255,255,255,0.04)",
                            border: selectedNames.includes(childName)
                              ? "1px solid rgba(124, 58, 237, 0.45)"
                              : "1px solid transparent"
                          }}
                        >
                          {childName.replace(/^Ticket (Review|Work) — /, "")}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {selectedNames.includes("Other") && (
              <input
                type="text"
                value={otherText}
                onChange={(e) => setOtherText(e.target.value)}
                placeholder="Describe what you did..."
                className="w-full mt-3 px-4 py-3.5 rounded-xl outline-none text-sm shrink-0"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}
                autoFocus
              />
            )}

            <div className="flex gap-3 pt-5 shrink-0">
              <button
                onClick={() => setShowActivityModal(false)}
                className="flex-1 py-3.5 rounded-xl text-sm"
                style={{ background: "rgba(255,255,255,0.07)" }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmActivities}
                disabled={selectedNames.length === 0 || (selectedNames.includes("Other") && !otherText.trim())}
                className="flex-1 py-3.5 rounded-xl text-sm font-medium disabled:opacity-40"
                style={{ background: "linear-gradient(135deg, #7c3aed 0%, #06b6d4 100%)" }}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {showTimeModal && sessionStart && sessionEnd && (
        <div 
          className="absolute inset-0 z-50 flex items-end justify-center bg-black/70"
          style={{ backdropFilter: "blur(8px)" }}
        >
          <div 
            className="w-full max-w-md rounded-t-3xl p-6 flex flex-col"
            style={{
              background: "rgba(18,18,26,0.98)",
              border: "1px solid rgba(255,255,255,0.1)",
              maxHeight: "85vh"
            }}
          >
            <div className="text-center mb-5 shrink-0">
              <h2 className="text-lg font-medium">Adjust work time</h2>
              <p className="text-white/40 text-sm mt-1">
                Real session: {formatDateTime(sessionStart)} — {formatDateTime(sessionEnd)}
              </p>
            </div>

            {pauses.length > 0 && (
              <div className="mb-4 p-3 rounded-xl text-sm" style={{ background: "rgba(255,255,255,0.04)" }}>
                <p className="text-white/50 mb-2 text-xs uppercase tracking-wider">Pauses (kept automatically)</p>
                {pauses.map((p) => (
                  <div key={p.id} className="text-white/70 text-sm">
                    {formatDateTime(new Date(p.paused_at))}
                    {p.resumed_at ? ` — ${formatDateTime(new Date(p.resumed_at))}` : " — now"}
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="text-white/50 text-xs uppercase tracking-wider">From</label>
                <input
                  type="time"
                  value={adjustStart}
                  onChange={(e) => setAdjustStart(e.target.value)}
                  className="w-full mt-1.5 px-4 py-3.5 rounded-xl outline-none text-lg"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}
                />
              </div>
              <div>
                <label className="text-white/50 text-xs uppercase tracking-wider">To</label>
                <input
                  type="time"
                  value={adjustEnd}
                  onChange={(e) => setAdjustEnd(e.target.value)}
                  className="w-full mt-1.5 px-4 py-3.5 rounded-xl outline-none text-lg"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}
                />
              </div>
            </div>

            <p className="text-white/30 text-xs mt-4 text-center">
              You can only select time inside the real session.<br/>
              Pauses will be kept automatically.
            </p>

            <div className="flex gap-3 pt-5 shrink-0">
              <button
                onClick={() => {
                  setShowTimeModal(false);
                  setShowActivityModal(true);
                }}
                className="flex-1 py-3.5 rounded-xl text-sm"
                style={{ background: "rgba(255,255,255,0.07)" }}
              >
                Back
              </button>
              <button
                onClick={handleFinalSave}
                className="flex-1 py-3.5 rounded-xl text-sm font-medium"
                style={{ background: "linear-gradient(135deg, #7c3aed 0%, #06b6d4 100%)" }}
              >
                Save Session
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
