"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    // Load last used code
    const savedCode = localStorage.getItem("timeglass_last_code");
    if (savedCode) setCode(savedCode);

    const handleMouse = (e: MouseEvent) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 24;
      const y = (e.clientY / window.innerHeight - 0.5) * 24;
      setMouse({ x, y });
    };
    window.addEventListener("mousemove", handleMouse);
    return () => window.removeEventListener("mousemove", handleMouse);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const cleanCode = code.trim().toUpperCase();

    const { data, error: fetchError } = await supabase
      .from("employees")
      .select("*")
      .eq("access_code", cleanCode)
      .single();

    if (fetchError || !data) {
      setError("Invalid access code");
      setLoading(false);
      return;
    }

    // Remember code for next time
    localStorage.setItem("timeglass_last_code", cleanCode);
    localStorage.setItem("timeglass_user", JSON.stringify(data));
    localStorage.setItem("timeglass_last_activity", Date.now().toString());
    router.push("/timer");
  };

  return (
    <div className="h-full flex flex-col items-center justify-center px-6 relative overflow-hidden">
      {/* Floating glows */}
      <div 
        className="absolute w-56 h-56 rounded-full pointer-events-none"
        style={{
          top: "8%", left: "5%",
          background: "radial-gradient(circle, rgba(124,58,237,0.4) 0%, transparent 70%)",
          filter: "blur(40px)",
          transform: `translate(${mouse.x * 0.7}px, ${mouse.y * 0.7}px)`,
          transition: "transform 0.12s ease-out"
        }}
      />
      <div 
        className="absolute w-64 h-64 rounded-full pointer-events-none"
        style={{
          bottom: "10%", right: "0%",
          background: "radial-gradient(circle, rgba(6,182,212,0.35) 0%, transparent 70%)",
          filter: "blur(50px)",
          transform: `translate(${mouse.x * -0.5}px, ${mouse.y * -0.5}px)`,
          transition: "transform 0.12s ease-out"
        }}
      />

      <div className="w-full max-w-sm space-y-8 relative z-10">
        {/* Branding */}
        <div className="text-center space-y-1">
          <h1 
            className="text-4xl font-bold tracking-tight"
            style={{
              background: "linear-gradient(135deg, #e0e0e0 0%, #a0a0a0 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              transform: `translate(${mouse.x * 0.1}px, ${mouse.y * 0.1}px)`,
              transition: "transform 0.15s ease-out"
            }}
          >
            MANIAC
          </h1>
          <p className="text-white/40 text-sm tracking-[0.3em] uppercase">TimeGlass</p>
        </div>

        {/* Glass card */}
        <div 
          className="rounded-3xl p-6 space-y-5"
          style={{
            background: "rgba(255,255,255,0.06)",
            backdropFilter: "blur(24px)",
            border: "1px solid rgba(255,255,255,0.1)",
            boxShadow: "0 25px 50px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)",
            transform: `perspective(800px) rotateY(${mouse.x * 0.08}deg) rotateX(${-mouse.y * 0.08}deg) translate(${mouse.x * 0.05}px, ${mouse.y * 0.05}px)`,
            transition: "transform 0.15s ease-out"
          }}
        >
          <p className="text-center text-white/50 text-sm">Enter your access code</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <input
              type="password"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ACCESS CODE"
              className="w-full bg-transparent text-center text-lg tracking-[0.3em] font-medium py-4 px-4 outline-none placeholder:text-white/20 rounded-2xl"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                letterSpacing: "0.3em"
              }}
              autoFocus
              autoComplete="current-password"
            />

            {error && (
              <p className="text-red-400 text-sm text-center">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || code.length < 3}
              className="w-full py-4 rounded-2xl font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
              style={{
                background: "linear-gradient(135deg, #7c3aed 0%, #06b6d4 100%)",
                boxShadow: "0 8px 24px rgba(124, 58, 237, 0.35)"
              }}
            >
              {loading ? "Checking..." : "Sign In"}
            </button>
          </form>
        </div>

        <p className="text-center text-white/20 text-xs">
          Contact admin if you don't have a code
        </p>
      </div>
    </div>
  );
}
