/* Cute kawaii panda SVGs in different poses + bamboo decorations */

function PandaHead({ cx, cy, s = 1 }: { cx: number; cy: number; s?: number }) {
  const t = (x: number, y: number) => ({ cx: cx + x * s, cy: cy + y * s })
  const r = (v: number) => v * s
  return (
    <>
      {/* ears */}
      <circle {...t(-32, -34)} r={r(16)} fill="#1a1a1a" />
      <circle {...t(32, -34)} r={r(16)} fill="#1a1a1a" />
      <circle {...t(-32, -34)} r={r(8)} fill="#444" />
      <circle {...t(32, -34)} r={r(8)} fill="#444" />
      {/* head */}
      <circle {...t(0, 0)} r={r(42)} fill="#fff" stroke="#1a1a1a" strokeWidth={r(1.8)} />
      {/* eye patches */}
      <ellipse {...t(-16, -2)} rx={r(13)} ry={r(14)} fill="#1a1a1a" transform={`rotate(-6 ${cx - 16 * s} ${cy - 2 * s})`} />
      <ellipse {...t(16, -2)} rx={r(13)} ry={r(14)} fill="#1a1a1a" transform={`rotate(6 ${cx + 16 * s} ${cy - 2 * s})`} />
      {/* eyes */}
      <circle {...t(-16, -4)} r={r(7)} fill="#fff" />
      <circle {...t(16, -4)} r={r(7)} fill="#fff" />
      <circle {...t(-14, -5)} r={r(4)} fill="#1a1a1a" />
      <circle {...t(14, -5)} r={r(4)} fill="#1a1a1a" />
      <circle {...t(-12.5, -6.5)} r={r(1.8)} fill="#fff" />
      <circle {...t(12.5, -6.5)} r={r(1.8)} fill="#fff" />
      {/* nose */}
      <ellipse {...t(0, 8)} rx={r(4.5)} ry={r(3)} fill="#1a1a1a" />
      {/* mouth */}
      <path d={`M${cx - 5 * s} ${cy + 12 * s} Q${cx} ${cy + 17 * s} ${cx + 5 * s} ${cy + 12 * s}`} stroke="#1a1a1a" strokeWidth={r(1.4)} fill="none" strokeLinecap="round" />
      {/* cheeks */}
      <circle {...t(-28, 8)} r={r(7)} fill="#f9a8c9" opacity={0.45} />
      <circle {...t(28, 8)} r={r(7)} fill="#f9a8c9" opacity={0.45} />
    </>
  )
}

export function PandaSitting({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 180 220" fill="none">
      {/* body */}
      <ellipse cx="90" cy="158" rx="38" ry="36" fill="#fff" stroke="#1a1a1a" strokeWidth="1.8" />
      {/* belly spot */}
      <ellipse cx="90" cy="155" rx="22" ry="20" fill="#f5f5f5" />
      {/* arms */}
      <ellipse cx="54" cy="145" rx="13" ry="20" fill="#1a1a1a" transform="rotate(-10 54 145)" />
      <ellipse cx="126" cy="145" rx="13" ry="20" fill="#1a1a1a" transform="rotate(10 126 145)" />
      {/* feet */}
      <ellipse cx="70" cy="192" rx="16" ry="10" fill="#1a1a1a" />
      <ellipse cx="110" cy="192" rx="16" ry="10" fill="#1a1a1a" />
      <ellipse cx="70" cy="190" rx="7" ry="4" fill="#f9a8c9" opacity="0.4" />
      <ellipse cx="110" cy="190" rx="7" ry="4" fill="#f9a8c9" opacity="0.4" />
      {/* bamboo leaf in hand */}
      <path d="M130 135 Q148 118 155 128 Q142 140 130 135Z" fill="#4ade80" />
      <path d="M130 135 Q145 128 140 115 Q132 128 130 135Z" fill="#22c55e" />
      <line x1="130" y1="135" x2="142" y2="122" stroke="#15803d" strokeWidth="0.8" />
      <PandaHead cx={90} cy={80} />
    </svg>
  )
}

export function PandaPeeking({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 160 90" fill="none">
      <PandaHead cx={80} cy={35} s={0.85} />
      {/* paws peeking at bottom */}
      <ellipse cx="60" cy="82" rx="14" ry="8" fill="#1a1a1a" />
      <ellipse cx="100" cy="82" rx="14" ry="8" fill="#1a1a1a" />
      <ellipse cx="60" cy="80" rx="6" ry="3" fill="#f9a8c9" opacity="0.4" />
      <ellipse cx="100" cy="80" rx="6" ry="3" fill="#f9a8c9" opacity="0.4" />
    </svg>
  )
}

export function PandaWaving({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 230" fill="none">
      {/* body */}
      <ellipse cx="100" cy="165" rx="38" ry="36" fill="#fff" stroke="#1a1a1a" strokeWidth="1.8" />
      <ellipse cx="100" cy="162" rx="22" ry="20" fill="#f5f5f5" />
      {/* left arm down */}
      <ellipse cx="64" cy="152" rx="13" ry="20" fill="#1a1a1a" transform="rotate(-10 64 152)" />
      {/* right arm UP waving */}
      <ellipse cx="148" cy="100" rx="13" ry="20" fill="#1a1a1a" transform="rotate(30 148 100)" />
      {/* feet */}
      <ellipse cx="80" cy="200" rx="16" ry="10" fill="#1a1a1a" />
      <ellipse cx="120" cy="200" rx="16" ry="10" fill="#1a1a1a" />
      <ellipse cx="80" cy="198" rx="7" ry="4" fill="#f9a8c9" opacity="0.4" />
      <ellipse cx="120" cy="198" rx="7" ry="4" fill="#f9a8c9" opacity="0.4" />
      <PandaHead cx={100} cy={88} />
    </svg>
  )
}

export function PandaReading({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 230" fill="none">
      {/* body */}
      <ellipse cx="100" cy="168" rx="38" ry="36" fill="#fff" stroke="#1a1a1a" strokeWidth="1.8" />
      <ellipse cx="100" cy="165" rx="22" ry="20" fill="#f5f5f5" />
      {/* arms holding book */}
      <ellipse cx="68" cy="148" rx="12" ry="18" fill="#1a1a1a" transform="rotate(15 68 148)" />
      <ellipse cx="132" cy="148" rx="12" ry="18" fill="#1a1a1a" transform="rotate(-15 132 148)" />
      {/* book */}
      <rect x="72" y="138" width="56" height="38" rx="3" fill="#f9a8c9" stroke="#ec4899" strokeWidth="1" />
      <line x1="100" y1="138" x2="100" y2="176" stroke="#ec4899" strokeWidth="0.8" />
      <line x1="80" y1="148" x2="96" y2="148" stroke="#fff" strokeWidth="1" opacity="0.5" />
      <line x1="80" y1="154" x2="94" y2="154" stroke="#fff" strokeWidth="1" opacity="0.4" />
      <line x1="104" y1="148" x2="120" y2="148" stroke="#fff" strokeWidth="1" opacity="0.5" />
      <line x1="104" y1="154" x2="118" y2="154" stroke="#fff" strokeWidth="1" opacity="0.4" />
      {/* feet */}
      <ellipse cx="78" cy="202" rx="16" ry="10" fill="#1a1a1a" />
      <ellipse cx="122" cy="202" rx="16" ry="10" fill="#1a1a1a" />
      <ellipse cx="78" cy="200" rx="7" ry="4" fill="#f9a8c9" opacity="0.4" />
      <ellipse cx="122" cy="200" rx="7" ry="4" fill="#f9a8c9" opacity="0.4" />
      {/* glasses */}
      <circle cx="76" cy="78" r="12" fill="none" stroke="#ec4899" strokeWidth="1.5" opacity="0.6" />
      <circle cx="108" cy="78" r="12" fill="none" stroke="#ec4899" strokeWidth="1.5" opacity="0.6" />
      <line x1="88" y1="78" x2="96" y2="78" stroke="#ec4899" strokeWidth="1.2" opacity="0.6" />
      <PandaHead cx={92} cy={82} />
    </svg>
  )
}

export function PandaClimbing({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 260" fill="none">
      {/* bamboo stalk */}
      <rect x="8" y="0" width="14" height="260" rx="7" fill="#2d7a4f" />
      <rect x="6" y="50" width="18" height="5" rx="2.5" fill="#22c55e" />
      <rect x="6" y="130" width="18" height="5" rx="2.5" fill="#22c55e" />
      <rect x="6" y="210" width="18" height="5" rx="2.5" fill="#22c55e" />
      {/* leaves */}
      <path d="M22 48 Q44 30 38 12 Q28 30 22 48Z" fill="#4ade80" opacity="0.8" />
      <path d="M8 128 Q-14 110 -8 92 Q2 110 8 128Z" fill="#4ade80" opacity="0.7" />
      <path d="M22 208 Q48 190 40 170 Q28 188 22 208Z" fill="#4ade80" opacity="0.8" />
      {/* panda hugging the stalk */}
      {/* body */}
      <ellipse cx="58" cy="160" rx="30" ry="28" fill="#fff" stroke="#1a1a1a" strokeWidth="1.5" />
      <ellipse cx="58" cy="157" rx="16" ry="14" fill="#f5f5f5" />
      {/* arms wrapped around bamboo */}
      <ellipse cx="28" cy="140" rx="10" ry="16" fill="#1a1a1a" transform="rotate(20 28 140)" />
      <ellipse cx="28" cy="165" rx="10" ry="14" fill="#1a1a1a" transform="rotate(-10 28 165)" />
      {/* feet */}
      <ellipse cx="50" cy="188" rx="14" ry="9" fill="#1a1a1a" />
      <ellipse cx="72" cy="186" rx="12" ry="8" fill="#1a1a1a" />
      <PandaHead cx={58} cy={108} s={0.78} />
    </svg>
  )
}

function SleepyHead({ cx, cy, s = 1 }: { cx: number; cy: number; s?: number }) {
  const r = (v: number) => v * s
  return (
    <>
      <circle cx={cx - 32 * s} cy={cy - 34 * s} r={r(16)} fill="#1a1a1a" />
      <circle cx={cx + 32 * s} cy={cy - 34 * s} r={r(16)} fill="#1a1a1a" />
      <circle cx={cx - 32 * s} cy={cy - 34 * s} r={r(8)} fill="#444" />
      <circle cx={cx + 32 * s} cy={cy - 34 * s} r={r(8)} fill="#444" />
      <circle cx={cx} cy={cy} r={r(42)} fill="#fff" stroke="#1a1a1a" strokeWidth={r(1.8)} />
      <ellipse cx={cx - 16 * s} cy={cy - 2 * s} rx={r(13)} ry={r(14)} fill="#1a1a1a" transform={`rotate(-6 ${cx - 16 * s} ${cy - 2 * s})`} />
      <ellipse cx={cx + 16 * s} cy={cy - 2 * s} rx={r(13)} ry={r(14)} fill="#1a1a1a" transform={`rotate(6 ${cx + 16 * s} ${cy - 2 * s})`} />
      {/* closed eyes - curved lines */}
      <path d={`M${cx - 22 * s} ${cy - 4 * s} Q${cx - 16 * s} ${cy + 2 * s} ${cx - 10 * s} ${cy - 4 * s}`} stroke="#fff" strokeWidth={r(2)} fill="none" strokeLinecap="round" />
      <path d={`M${cx + 10 * s} ${cy - 4 * s} Q${cx + 16 * s} ${cy + 2 * s} ${cx + 22 * s} ${cy - 4 * s}`} stroke="#fff" strokeWidth={r(2)} fill="none" strokeLinecap="round" />
      <ellipse cx={cx} cy={cy + 8 * s} rx={r(4.5)} ry={r(3)} fill="#1a1a1a" />
      <path d={`M${cx - 5 * s} ${cy + 12 * s} Q${cx} ${cy + 17 * s} ${cx + 5 * s} ${cy + 12 * s}`} stroke="#1a1a1a" strokeWidth={r(1.4)} fill="none" strokeLinecap="round" />
      <circle cx={cx - 28 * s} cy={cy + 8 * s} r={r(7)} fill="#f9a8c9" opacity={0.5} />
      <circle cx={cx + 28 * s} cy={cy + 8 * s} r={r(7)} fill="#f9a8c9" opacity={0.5} />
    </>
  )
}

export function PandaSleepingLaptop({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 240 140" fill="none">
      {/* desk surface */}
      <line x1="20" y1="120" x2="220" y2="120" stroke="#4a7a56" strokeWidth="1.5" opacity="0.5" />
      {/* laptop base */}
      <rect x="90" y="105" width="70" height="6" rx="2" fill="#888" />
      <rect x="92" y="100" width="66" height="5" rx="1" fill="#aaa" />
      {/* laptop screen */}
      <rect x="95" y="62" width="60" height="38" rx="3" fill="#555" stroke="#888" strokeWidth="1" />
      <rect x="99" y="66" width="52" height="30" rx="1" fill="#1a3d28" />
      {/* screen glow */}
      <rect x="99" y="66" width="52" height="30" rx="1" fill="url(#screenGlow)" opacity="0.3" />
      <defs>
        <linearGradient id="screenGlow" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4ade80" />
          <stop offset="100%" stopColor="#22c55e" />
        </linearGradient>
      </defs>
      {/* panda body slouched over */}
      <ellipse cx="65" cy="105" rx="28" ry="22" fill="#fff" stroke="#1a1a1a" strokeWidth="1.5" />
      {/* arm resting on desk */}
      <ellipse cx="88" cy="108" rx="10" ry="14" fill="#1a1a1a" transform="rotate(20 88 108)" />
      <ellipse cx="42" cy="112" rx="10" ry="12" fill="#1a1a1a" transform="rotate(-15 42 112)" />
      {/* head resting */}
      <SleepyHead cx={65} cy={74} s={0.62} />
      {/* zzz */}
      <text x="100" y="50" fill="#a8d5b0" fontSize="14" fontWeight="800" fontFamily="sans-serif" opacity="0.7">z</text>
      <text x="112" y="40" fill="#a8d5b0" fontSize="11" fontWeight="800" fontFamily="sans-serif" opacity="0.5">z</text>
      <text x="120" y="32" fill="#a8d5b0" fontSize="9" fontWeight="800" fontFamily="sans-serif" opacity="0.35">z</text>
    </svg>
  )
}

export function PandaOnBranch({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 220 120" fill="none">
      {/* bamboo branch */}
      <path d="M10 85 Q60 70 110 78 Q160 86 210 75" stroke="#2d7a4f" strokeWidth="12" strokeLinecap="round" fill="none" />
      <path d="M10 85 Q60 70 110 78 Q160 86 210 75" stroke="#3da866" strokeWidth="6" strokeLinecap="round" fill="none" opacity="0.4" />
      {/* branch nodes */}
      <ellipse cx="60" cy="74" rx="8" ry="5" fill="#22c55e" opacity="0.6" />
      <ellipse cx="140" cy="82" rx="8" ry="5" fill="#22c55e" opacity="0.6" />
      {/* leaves off branch */}
      <path d="M55 72 Q40 55 48 42 Q58 56 55 72Z" fill="#4ade80" opacity="0.6" />
      <path d="M145 80 Q165 65 158 50 Q148 64 145 80Z" fill="#4ade80" opacity="0.5" />
      {/* panda body draped over branch */}
      <ellipse cx="110" cy="68" rx="32" ry="18" fill="#fff" stroke="#1a1a1a" strokeWidth="1.5" />
      {/* arms hanging down */}
      <ellipse cx="82" cy="82" rx="9" ry="14" fill="#1a1a1a" transform="rotate(10 82 82)" />
      <ellipse cx="138" cy="84" rx="9" ry="14" fill="#1a1a1a" transform="rotate(-10 138 84)" />
      {/* legs hanging */}
      <ellipse cx="92" cy="88" rx="8" ry="10" fill="#1a1a1a" />
      <ellipse cx="128" cy="90" rx="8" ry="10" fill="#1a1a1a" />
      {/* head */}
      <SleepyHead cx={110} cy={46} s={0.52} />
    </svg>
  )
}

export function PandaOnBooks({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 200" fill="none">
      {/* bottom book - yellow */}
      <rect x="45" y="132" width="110" height="18" rx="3" fill="#fde68a" stroke="#f59e0b" strokeWidth="0.8" />
      {/* middle book - green */}
      <rect x="50" y="116" width="100" height="16" rx="3" fill="#bbf7d0" stroke="#22c55e" strokeWidth="0.8" />
      {/* top book - pink */}
      <rect x="55" y="100" width="90" height="16" rx="3" fill="#fce7f3" stroke="#ec4899" strokeWidth="0.8" />
      {/* small open books around */}
      <path d="M25 170 L35 162 L45 170" stroke="#888" strokeWidth="1" fill="none" />
      <line x1="35" y1="162" x2="35" y2="170" stroke="#888" strokeWidth="0.5" />
      <path d="M155 175 L165 167 L175 175" stroke="#888" strokeWidth="1" fill="none" />
      <line x1="165" y1="167" x2="165" y2="175" stroke="#888" strokeWidth="0.5" />
      {/* pencil */}
      <line x1="125" y1="172" x2="145" y2="158" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" />
      <line x1="145" y1="158" x2="148" y2="155" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" />
      {/* panda lying on books */}
      <ellipse cx="100" cy="92" rx="30" ry="18" fill="#fff" stroke="#1a1a1a" strokeWidth="1.5" />
      {/* arms flopping */}
      <ellipse cx="72" cy="100" rx="9" ry="14" fill="#1a1a1a" transform="rotate(20 72 100)" />
      <ellipse cx="128" cy="100" rx="9" ry="14" fill="#1a1a1a" transform="rotate(-20 128 100)" />
      {/* book on head */}
      <rect x="82" y="42" width="36" height="26" rx="2" fill="#fce7f3" stroke="#ec4899" strokeWidth="0.8" transform="rotate(-12 100 55)" />
      {/* head */}
      <SleepyHead cx={100} cy={64} s={0.55} />
    </svg>
  )
}

export function PandaBambooReading({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 180" fill="none">
      {/* curved bamboo branch */}
      <path d="M20 150 Q60 120 100 130 Q140 140 180 120" stroke="#2d7a4f" strokeWidth="10" strokeLinecap="round" fill="none" />
      <path d="M20 150 Q60 120 100 130 Q140 140 180 120" stroke="#3da866" strokeWidth="4" strokeLinecap="round" fill="none" opacity="0.4" />
      {/* nodes */}
      <ellipse cx="60" cy="126" rx="7" ry="4" fill="#22c55e" opacity="0.6" />
      <ellipse cx="140" cy="134" rx="7" ry="4" fill="#22c55e" opacity="0.6" />
      {/* leaves */}
      <path d="M175 118 Q195 100 188 85 Q178 100 175 118Z" fill="#4ade80" opacity="0.6" />
      <path d="M25 148 Q8 132 14 116 Q24 132 25 148Z" fill="#4ade80" opacity="0.5" />
      {/* panda body sitting on branch */}
      <ellipse cx="100" cy="118" rx="26" ry="20" fill="#fff" stroke="#1a1a1a" strokeWidth="1.5" />
      <ellipse cx="100" cy="116" rx="14" ry="11" fill="#f5f5f5" />
      {/* arms holding book */}
      <ellipse cx="78" cy="110" rx="9" ry="14" fill="#1a1a1a" transform="rotate(12 78 110)" />
      <ellipse cx="122" cy="110" rx="9" ry="14" fill="#1a1a1a" transform="rotate(-12 122 110)" />
      {/* book */}
      <rect x="82" y="102" width="36" height="24" rx="2" fill="#fde68a" stroke="#f59e0b" strokeWidth="0.8" />
      <line x1="100" y1="102" x2="100" y2="126" stroke="#f59e0b" strokeWidth="0.6" />
      {/* legs */}
      <ellipse cx="88" cy="138" rx="10" ry="7" fill="#1a1a1a" />
      <ellipse cx="112" cy="140" rx="10" ry="7" fill="#1a1a1a" />
      <ellipse cx="88" cy="136" rx="4" ry="3" fill="#f9a8c9" opacity="0.4" />
      <ellipse cx="112" cy="138" rx="4" ry="3" fill="#f9a8c9" opacity="0.4" />
      {/* head - awake for this one */}
      <PandaHead cx={100} cy={78} s={0.6} />
    </svg>
  )
}

export function PandaIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" fill="none">
      <PandaHead cx={50} cy={50} s={0.9} />
    </svg>
  )
}

export function BambooStalk({ className, height = 400 }: { className?: string; height?: number }) {
  const nodes = Math.floor(height / 80)
  return (
    <svg className={className} viewBox={`0 0 50 ${height}`} fill="none" preserveAspectRatio="none">
      <rect x="18" y="0" width="14" height={height} rx="7" fill="#1a5c3a" />
      {Array.from({ length: nodes }).map((_, i) => {
        const y = 60 + i * 80
        const side = i % 2 === 0
        return (
          <g key={i}>
            <rect x="16" y={y} width="18" height="5" rx="2.5" fill="#22c55e" opacity="0.7" />
            <path
              d={side
                ? `M32 ${y} Q${54} ${y - 20} ${48} ${y - 38} Q${38} ${y - 18} 32 ${y}Z`
                : `M18 ${y} Q${-4} ${y - 20} ${2} ${y - 38} Q${12} ${y - 18} 18 ${y}Z`
              }
              fill="#4ade80" opacity="0.5"
            />
          </g>
        )
      })}
    </svg>
  )
}
