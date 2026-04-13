import { useEffect, useRef } from "react";

export function NeuralBrainHero({ income, spending, net }: { income: number; spending: number; net: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let t = 0;
    const W = 900;
    const H = 260;
    const cx = W / 2;
    const cy = H / 2;

    canvas.width = W;
    canvas.height = H;

    const nodes: { x: number; y: number; r: number; phase: number; color: string }[] = [];
    const edges: [number, number][] = [];

    const brainNodes = [
      [0.22, 0.28], [0.14, 0.42], [0.19, 0.58], [0.29, 0.68], [0.34, 0.45],
      [0.27, 0.35], [0.18, 0.30], [0.10, 0.52], [0.25, 0.72], [0.36, 0.62],
      [0.30, 0.22], [0.12, 0.63], [0.38, 0.30],
      [0.78, 0.28], [0.86, 0.42], [0.81, 0.58], [0.71, 0.68], [0.66, 0.45],
      [0.73, 0.35], [0.82, 0.30], [0.90, 0.52], [0.75, 0.72], [0.64, 0.62],
      [0.70, 0.22], [0.88, 0.63], [0.62, 0.30],
      [0.46, 0.38], [0.50, 0.45], [0.54, 0.38], [0.48, 0.55], [0.52, 0.55],
      [0.50, 0.28], [0.50, 0.65],
    ];

    brainNodes.forEach(([fx, fy], i) => {
      const x = fx * W;
      const y = fy * H;
      const isCenter = fx >= 0.44 && fx <= 0.56;
      let color: string;
      if (isCenter) color = "#a78bfa";
      else if (fx < 0.5) color = "#38bdf8";
      else color = "#f472b6";
      nodes.push({ x, y, r: 2.5 + Math.random() * 2, phase: (i / brainNodes.length) * Math.PI * 2, color });
    });

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        if (Math.sqrt(dx * dx + dy * dy) < W * 0.22) edges.push([i, j]);
      }
    }

    function drawFrame() {
      ctx!.clearRect(0, 0, W, H);

      const glowL = ctx!.createRadialGradient(W * 0.3, cy, 0, W * 0.3, cy, W * 0.28);
      glowL.addColorStop(0, "rgba(56,189,248,0.22)");
      glowL.addColorStop(1, "rgba(56,189,248,0)");
      ctx!.fillStyle = glowL;
      ctx!.fillRect(0, 0, W, H);

      const glowR = ctx!.createRadialGradient(W * 0.7, cy, 0, W * 0.7, cy, W * 0.28);
      glowR.addColorStop(0, "rgba(244,114,182,0.22)");
      glowR.addColorStop(1, "rgba(244,114,182,0)");
      ctx!.fillStyle = glowR;
      ctx!.fillRect(0, 0, W, H);

      const glowC = ctx!.createRadialGradient(cx, cy, 0, cx, cy, W * 0.14);
      glowC.addColorStop(0, "rgba(167,139,250,0.18)");
      glowC.addColorStop(1, "rgba(167,139,250,0)");
      ctx!.fillStyle = glowC;
      ctx!.fillRect(0, 0, W, H);

      edges.forEach(([i, j]) => {
        const a = nodes[i];
        const b = nodes[j];
        const pulse = (Math.sin(t * 1.2 + a.phase + b.phase) + 1) / 2;
        const alpha = 0.06 + pulse * 0.18;
        const isCross = (a.x < cx && b.x > cx) || (a.x > cx && b.x < cx);
        ctx!.beginPath();
        ctx!.moveTo(a.x, a.y);
        ctx!.quadraticCurveTo((a.x + b.x) / 2, cy - 20, b.x, b.y);
        ctx!.strokeStyle = isCross ? `rgba(167,139,250,${alpha})` : a.x < cx ? `rgba(56,189,248,${alpha})` : `rgba(244,114,182,${alpha})`;
        ctx!.lineWidth = 0.8 + pulse * 0.6;
        ctx!.stroke();
      });

      nodes.forEach((n) => {
        const pulse = (Math.sin(t * 1.8 + n.phase) + 1) / 2;
        const r = n.r + pulse * 1.5;
        const grad = ctx!.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 3);
        grad.addColorStop(0, n.color + "ff");
        grad.addColorStop(0.4, n.color + "80");
        grad.addColorStop(1, n.color + "00");
        ctx!.fillStyle = grad;
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, r * 3, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.fillStyle = n.color;
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx!.fill();
      });

      edges.forEach(([i, j], idx) => {
        const speed = 0.4 + (idx % 5) * 0.1;
        const progress = ((t * speed + idx * 0.37) % (Math.PI * 2)) / (Math.PI * 2);
        if (progress > 0.95) return;
        const a = nodes[i];
        const b = nodes[j];
        const isCross = (a.x < cx && b.x > cx) || (a.x > cx && b.x < cx);
        ctx!.fillStyle = isCross ? "#c4b5fd" : a.x < cx ? "#7dd3fc" : "#f9a8d4";
        ctx!.beginPath();
        ctx!.arc(a.x + (b.x - a.x) * progress, a.y + (b.y - a.y) * progress, 1.8, 0, Math.PI * 2);
        ctx!.fill();
      });

      t += 0.018;
      animRef.current = requestAnimationFrame(drawFrame);
    }

    drawFrame();
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl mb-6"
      style={{
        height: "220px",
        background: "linear-gradient(180deg, rgba(12,20,40,0.98) 0%, rgba(8,14,32,0.95) 100%)",
        border: "1px solid rgba(56,189,248,0.15)",
        boxShadow: "0 0 60px rgba(56,189,248,0.08), 0 8px 32px rgba(0,0,0,0.6)",
      }}
    >
      {/* Scanlines */}
      <div className="absolute inset-0 pointer-events-none" style={{ background: "repeating-linear-gradient(0deg, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 3px, rgba(0,0,0,0.04) 4px)", zIndex: 2 }} />

      {/* Neural canvas — fills container as background */}
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
      />

      {/* Content overlay — title at top, stats at bottom */}
      <div className="absolute inset-0 flex flex-col items-center justify-between py-5 px-4" style={{ zIndex: 3 }}>
        {/* Logo */}
        <div className="text-center select-none">
          <h1
            className="font-display font-black uppercase"
            style={{
              fontSize: "clamp(1.5rem, 6vw, 2.8rem)",
              letterSpacing: "0.25em",
              color: "#ffffff",
              textShadow: "0 0 40px rgba(56,189,248,0.9), 0 0 80px rgba(56,189,248,0.4)",
              lineHeight: 1,
            }}
          >
            LEDGER<span style={{ color: "#f97316", textShadow: "0 0 30px rgba(249,115,22,1)" }}>.</span>AI
          </h1>
          <p className="font-mono uppercase mt-1" style={{ fontSize: "clamp(0.45rem, 1.8vw, 0.6rem)", letterSpacing: "0.4em", color: "rgba(148,163,184,0.65)" }}>
            Neural Financial Intelligence
          </p>
        </div>

        {/* Stats row — always at bottom, full width */}
        <div className="w-full flex items-end justify-center gap-0">
          <div className="flex-1 text-center">
            <p className="font-mono uppercase text-emerald-400/70 mb-1" style={{ fontSize: "clamp(0.5rem, 1.5vw, 0.6rem)", letterSpacing: "0.15em" }}>Income</p>
            <p className="font-mono font-bold text-emerald-400" style={{ fontSize: "clamp(1rem, 3.5vw, 1.25rem)", textShadow: "0 0 16px rgba(52,211,153,0.6)", lineHeight: 1 }}>
              ${income.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </p>
          </div>
          <div className="w-px self-stretch bg-white/10 mx-2" style={{ minHeight: "36px" }} />
          <div className="flex-1 text-center">
            <p className="font-mono uppercase text-red-400/70 mb-1" style={{ fontSize: "clamp(0.5rem, 1.5vw, 0.6rem)", letterSpacing: "0.15em" }}>Spending</p>
            <p className="font-mono font-bold text-red-400" style={{ fontSize: "clamp(1rem, 3.5vw, 1.25rem)", textShadow: "0 0 16px rgba(239,68,68,0.6)", lineHeight: 1 }}>
              ${spending.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </p>
          </div>
          <div className="w-px self-stretch bg-white/10 mx-2" style={{ minHeight: "36px" }} />
          <div className="flex-1 text-center">
            <p className="font-mono uppercase mb-1" style={{ fontSize: "clamp(0.5rem, 1.5vw, 0.6rem)", letterSpacing: "0.15em", color: net >= 0 ? "rgba(52,211,153,0.7)" : "rgba(239,68,68,0.7)" }}>Net</p>
            <p
              className="font-mono font-bold"
              style={{
                fontSize: "clamp(1rem, 3.5vw, 1.25rem)",
                color: net >= 0 ? "#34d399" : "#f87171",
                textShadow: net >= 0 ? "0 0 16px rgba(52,211,153,0.6)" : "0 0 16px rgba(239,68,68,0.6)",
                lineHeight: 1,
              }}
            >
              {net >= 0 ? "+" : ""}${Math.abs(net).toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </p>
          </div>
        </div>
      </div>

      {/* Corner accents */}
      <div className="absolute top-3 left-3 pointer-events-none" style={{ zIndex: 4 }}>
        <div style={{ width: 20, height: 1, background: "rgba(56,189,248,0.6)", position: "absolute" }} />
        <div style={{ width: 1, height: 20, background: "rgba(56,189,248,0.6)", position: "absolute" }} />
      </div>
      <div className="absolute top-3 right-3 pointer-events-none" style={{ zIndex: 4 }}>
        <div style={{ width: 20, height: 1, background: "rgba(244,114,182,0.6)", position: "absolute", right: 0 }} />
        <div style={{ width: 1, height: 20, background: "rgba(244,114,182,0.6)", position: "absolute", right: 0 }} />
      </div>
      <div className="absolute bottom-3 left-3 pointer-events-none" style={{ zIndex: 4 }}>
        <div style={{ width: 20, height: 1, background: "rgba(56,189,248,0.35)", position: "absolute", bottom: 0 }} />
        <div style={{ width: 1, height: 20, background: "rgba(56,189,248,0.35)", position: "absolute", bottom: 0 }} />
      </div>
      <div className="absolute bottom-3 right-3 pointer-events-none" style={{ zIndex: 4 }}>
        <div style={{ width: 20, height: 1, background: "rgba(244,114,182,0.35)", position: "absolute", bottom: 0, right: 0 }} />
        <div style={{ width: 1, height: 20, background: "rgba(244,114,182,0.35)", position: "absolute", bottom: 0, right: 0 }} />
      </div>
    </div>
  );
}
