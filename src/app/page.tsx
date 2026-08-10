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
    const handleMouse = (e: MouseEvent) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 20;
      const y = (e.clientY / window.innerHeight - 0.5) * 20;
      setMouse({ x, y });
    };
    window.addEventListener("mousemove", handleMouse);
    return () => window.removeEventListener("mousemove", handleMouse);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const { data, error: fetchError } = await supabase
      .from("employees")
      .select("*")
      .eq("access_code", code.trim().toUpperCase())
      .single();

    if (fetchError || !data) {
      setError("Invalid access code");
      setLoading(false);
      return;
    }

    localStorage.setItem("timeglass_user", JSON.stringify(data));
    router.push("/timer");
  };

  return (
    <div className="h-full flex flex-col items-center justify-center px-6 relative overflow-hidden">
      
      {/* Плавающие 3D-элементы */}
      <div 
        className="absolute w-40 h-40 rounded-full pointer-events-none"
        style={{
          top: "12%",
          left: "8%",
          background: "radial-gradient(circle, rgba(124,58,237,0.35) 0%, transparent 70%)",
          filter: "blur(30px)",
          transform: `translate(${mouse.x * 0.6}px, ${mouse.y * 0.6}px)`,
          transition: "transform 0.15s ease-out"
        }}
      />
      <div 
        className="absolute w-52 h-52 rounded-full pointer-events-none"
        style={{
          bottom: "15%",
          right: "5%",
          background: "radial-gradient(circle, rgba(6,182,212,0.3) 0%, transparent 70%)",
          filter: "blur(40px)",
          transform: `translate(${mouse.x * -0.4}px, ${mouse.y * -0.4}px)`,
          transition: "transform 0.15s ease-out"
        }}
      />
      <div 
        className="absolute w-24 h-24 rounded-full pointer-events-none"
        style={{
          top: "40%",
          right: "18%",
          background: "radial-gradient(circle, rgba(167,139,250,0.25) 0%, transparent 70%)",
          filter: "blur(20px)",
          transform: `translate(${mouse.x * 0.8}px, ${mouse.y * 0.5}px)`,
          transition: "transform 0.12s ease-out"
        }}
      />

      <div className="w-full max-w-sm space-y-8 relative z-10">
        {/* Лого */}
        <div className="text-center space-y-3">
          <div 
            className="inline-flex items-center justify-center w-20 h-20 rounded-3xl mb-1"
            style={{
              background: "rgba(255,255,255,0.07)",
              backdropFilter: "blur(20px)",
              border: "1px solid rgba(255,255,255,0.12)",
              boxShadow: "0 12px 40px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)",
              transform: `translate(${mouse.x * 0.15}px, ${mouse.y * 0.15}px) rotateX(${mouse.y * 0.3}deg) rotateY(${mouse.x * 0.3}deg)`,
              transition: "transform 0.15s ease-out"
            }}
          >
            <span 
              className="text-3xl font-bold"
              style={{
                background: "linear-gradient(135deg, #a78bfa 0%, #22d3ee 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent"
              }}
            >
              TG
            </span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">TimeGlass</h1>
          <p className="text-white/40 text-sm">Enter your access code</p>
        </div>

        {/* Форма */}
        <form onSubmit={handleLogin} className="space-y-5">
          <div 
            className="rounded-2xl p-1"
            style={{
              background: "rgba(255,255,255,0.05)",
              backdropFilter: "blur(20px)",
              border: "1px solid rgba(255,255,255,0.08)",
              boxShadow: "0 8px 32px rgba(0,0,0,0.3)"
            }}
          >
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ACCESS CODE"
              className="w-full bg-transparent text-center text-lg tracking-[0.25em] font-medium py-4 px-4 outline-none placeholder:text-white/20 uppercase"
              autoFocus
              autoComplete="off"
            />
          </div>

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

        <p className="text-center text-white/25 text-xs">
          Contact admin if you don't have a code
        </p>
      </div>
    </div>
  );
}
