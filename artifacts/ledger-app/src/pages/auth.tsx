import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Zap } from "lucide-react";

function AuthNeuralBg() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    let t = 0;
    const nodes: { x: number; y: number; vx: number; vy: number; phase: number; color: string }[] = [];
    const COUNT = 38;
    const COLORS = ["#38bdf8", "#818cf8", "#f472b6", "#34d399", "#fb923c"];

    for (let i = 0; i < COUNT; i++) {
      nodes.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        phase: Math.random() * Math.PI * 2,
        color: COLORS[i % COLORS.length],
      });
    }

    function draw() {
      const W = canvas!.width;
      const H = canvas!.height;
      ctx!.clearRect(0, 0, W, H);

      nodes.forEach((n) => {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > W) n.vx *= -1;
        if (n.y < 0 || n.y > H) n.vy *= -1;
      });

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const maxDist = Math.min(W, H) * 0.28;
          if (dist < maxDist) {
            const alpha = (1 - dist / maxDist) * 0.12;
            ctx!.beginPath();
            ctx!.moveTo(nodes[i].x, nodes[i].y);
            ctx!.lineTo(nodes[j].x, nodes[j].y);
            ctx!.strokeStyle = `rgba(56,189,248,${alpha})`;
            ctx!.lineWidth = 0.6;
            ctx!.stroke();
          }
        }
      }

      nodes.forEach((n) => {
        const pulse = (Math.sin(t * 1.5 + n.phase) + 1) / 2;
        const r = 2 + pulse * 2;
        const grd = ctx!.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 3);
        grd.addColorStop(0, n.color + "cc");
        grd.addColorStop(1, n.color + "00");
        ctx!.fillStyle = grd;
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, r * 3, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.fillStyle = n.color;
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, r * 0.6, 0, Math.PI * 2);
        ctx!.fill();
      });

      t += 0.015;
      animRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0, opacity: 0.6 }}
    />
  );
}

export default function AuthPage() {
  const { login, register } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleAuth = async () => {
    try {
      setLoading(true);
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(email, password);
      }
      setLocation("/dashboard");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Authentication Failed",
        description: error.message || "An error occurred",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <AuthNeuralBg />

      {/* Extra ambient glows */}
      <div className="fixed top-1/4 left-1/4 w-[600px] h-[600px] rounded-full pointer-events-none" style={{ background: "radial-gradient(ellipse, rgba(56,189,248,0.07) 0%, transparent 70%)", zIndex: 1 }} />
      <div className="fixed bottom-1/4 right-1/4 w-[500px] h-[500px] rounded-full pointer-events-none" style={{ background: "radial-gradient(ellipse, rgba(244,114,182,0.06) 0%, transparent 70%)", zIndex: 1 }} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full pointer-events-none" style={{ background: "radial-gradient(ellipse, rgba(129,140,248,0.05) 0%, transparent 70%)", zIndex: 1 }} />

      <div
        className="w-full max-w-md relative"
        style={{ zIndex: 10 }}
      >
        {/* Logo section */}
        <div className="text-center mb-8">
          <h1
            className="font-display font-black tracking-[0.28em] uppercase text-white"
            style={{
              fontSize: "2.4rem",
              textShadow: "0 0 40px rgba(56,189,248,0.9), 0 0 80px rgba(56,189,248,0.4), 0 0 120px rgba(56,189,248,0.2)",
            }}
          >
            LEDGER<span style={{ color: "#f97316", textShadow: "0 0 30px rgba(249,115,22,1), 0 0 60px rgba(249,115,22,0.5)" }}>.</span>AI
          </h1>
          <p className="font-mono text-[10px] uppercase tracking-[0.45em] mt-2" style={{ color: "rgba(148,163,184,0.65)" }}>
            Neural Financial Intelligence
          </p>
          {/* Decorative line */}
          <div className="flex items-center justify-center gap-2 mt-4">
            <div className="h-px w-16 bg-gradient-to-r from-transparent to-cyan-500/40" />
            <Zap className="w-3 h-3 text-cyan-400/60" />
            <div className="h-px w-16 bg-gradient-to-l from-transparent to-cyan-500/40" />
          </div>
        </div>

        {/* Auth card */}
        <div
          className="rounded-2xl p-6 relative"
          style={{
            background: "rgba(8,14,30,0.88)",
            border: "1px solid rgba(56,189,248,0.18)",
            boxShadow: "0 0 60px rgba(56,189,248,0.08), 0 0 120px rgba(244,114,182,0.04), inset 0 1px 0 rgba(255,255,255,0.06), 0 24px 48px rgba(0,0,0,0.6)",
            backdropFilter: "blur(24px)",
          }}
        >
          {/* Corner accents */}
          <div className="absolute top-0 left-0 w-12 h-12 pointer-events-none">
            <div className="absolute top-2.5 left-2.5 w-4 h-px bg-cyan-400/60" />
            <div className="absolute top-2.5 left-2.5 w-px h-4 bg-cyan-400/60" />
          </div>
          <div className="absolute top-0 right-0 w-12 h-12 pointer-events-none">
            <div className="absolute top-2.5 right-2.5 w-4 h-px bg-pink-400/60" />
            <div className="absolute top-2.5 right-2.5 w-px h-4 bg-pink-400/60" />
          </div>

          {/* Mode toggle */}
          <div className="flex gap-1 p-1 rounded-lg mb-6" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className="flex-1 py-2 rounded-md font-mono text-xs uppercase tracking-widest transition-all"
                style={
                  mode === m
                    ? {
                        background: "linear-gradient(175deg, #002a2a 0%, #001a1a 50%, #000d10 100%)",
                        color: "#00ffcc",
                        outline: "1px solid rgba(0,255,204,.35)",
                      }
                    : { color: "rgba(148,163,184,0.45)" }
                }
              >
                {m === "login" ? "Login" : "Register"}
              </button>
            ))}
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Email</Label>
              <Input
                type="email"
                placeholder="operator@system.io"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAuth()}
                className="font-mono text-sm h-11"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(56,189,248,0.15)" }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Password</Label>
              <Input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAuth()}
                className="font-mono text-sm h-11"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(56,189,248,0.15)" }}
              />
            </div>

            <Button
              onClick={handleAuth}
              disabled={loading || !email || !password}
              className="w-full h-11 font-mono text-xs uppercase tracking-widest font-bold mt-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              {mode === "login" ? "Authenticate" : "Initialize Account"}
            </Button>
          </div>
        </div>

        <p className="text-center mt-4 font-mono text-[9px] uppercase tracking-widest" style={{ color: "rgba(100,116,139,0.5)" }}>
          Secured · Encrypted · Private
        </p>
      </div>
    </div>
  );
}
