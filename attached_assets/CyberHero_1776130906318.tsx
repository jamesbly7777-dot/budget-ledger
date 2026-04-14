/**
 * Hero uses your reference mock (`/ledger-hero-brain.png`, 1024×682) cropped to the neural brain + title area.
 * Tweak `objectPosition` if you swap the asset or want a different crop.
 */
const HERO_BRAIN_SRC = "/ledger-hero-brain.png";
const HERO_OBJECT_POSITION = "55% 14%";

interface CyberHeroProps {
  compact?: boolean;
}

export function CyberHero({ compact = false }: CyberHeroProps) {
  const frame = compact
    ? "h-[148px] sm:h-[168px]"
    : "h-[200px] sm:h-[260px] md:h-[280px]";

  return (
    <div
      className={`relative mb-6 overflow-hidden rounded-2xl border border-cyan-400/40 bg-black/60 shadow-[0_0_70px_-12px_hsl(190_100%_45%_/_.45),inset_0_0_90px_-50px_hsl(300_100%_50%_/_.12)]`}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
        <div className="absolute -left-16 top-1/3 h-52 w-52 rounded-full bg-cyan-500/15 blur-3xl" />
        <div className="absolute -right-12 bottom-0 h-56 w-56 rounded-full bg-fuchsia-500/12 blur-3xl" />
      </div>

      {/* Reference artwork — PNG already includes “LEDGER AI” over the brain */}
      <div className={`relative z-0 w-full overflow-hidden rounded-2xl ${frame}`}>
        <img
          src={HERO_BRAIN_SRC}
          alt=""
          width={1024}
          height={682}
          decoding="async"
          draggable={false}
          className="absolute left-1/2 top-1/2 h-[118%] w-auto min-w-full -translate-x-1/2 -translate-y-1/2 select-none object-cover sm:h-[125%]"
          style={{ objectPosition: HERO_OBJECT_POSITION }}
        />
        <div
          className="absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/55"
          aria-hidden
        />
        <div
          className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/70 to-transparent"
          aria-hidden
        />
      </div>

      {!compact && (
        <p className="relative z-[1] mt-2 px-4 text-center font-mono text-[10px] uppercase tracking-[0.5em] text-cyan-200/75 sm:text-[11px]">
          Neural finance core
        </p>
      )}

      <div className="relative z-[2] mx-auto max-w-xl px-4 pb-3 pt-3">
        <div className="relative h-7 overflow-hidden rounded-full border border-cyan-500/30 bg-black/55 shadow-[inset_0_1px_0_hsl(190_100%_70%_/_.08)]">
          <div className="ledger-hero-scan-fill absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#00d4ff]/90 via-cyan-400/40 to-[#ff8c00]/90 opacity-95 shadow-[0_0_22px_hsl(190_100%_50%_/_.45)]" />
          <div className="relative flex h-full items-center justify-center">
            <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.35em] text-white/95 [text-shadow:0_0_14px_hsl(190_100%_50%_/_.55)] sm:text-[10px]">
              Analyzing data…
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
