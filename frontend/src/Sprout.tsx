type Props = { className?: string }

/* Abstract StudyCanvas brand mark — stacked canvas sheets */
export function SproutLogo({ className }: Props) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sc-logo" x1="4" y1="4" x2="28" y2="28">
          <stop offset="0%" stopColor="#fb5b3c" />
          <stop offset="100%" stopColor="#fbbf24" />
        </linearGradient>
      </defs>
      <rect x="5" y="10" width="15" height="15" rx="4" fill="url(#sc-logo)" opacity="0.35" />
      <rect x="11" y="6" width="16" height="16" rx="4.5" stroke="url(#sc-logo)" strokeWidth="2" />
    </svg>
  )
}

export function SproutSmall({ className }: Props) {
  return (
    <svg className={className} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sc-sm" x1="6" y1="6" x2="34" y2="34">
          <stop offset="0%" stopColor="#a855f7" />
          <stop offset="50%" stopColor="#fb5b3c" />
          <stop offset="100%" stopColor="#fbbf24" />
        </linearGradient>
      </defs>
      <rect x="7" y="13" width="18" height="18" rx="5" fill="url(#sc-sm)" opacity="0.25" />
      <rect x="15" y="8" width="18" height="18" rx="5" stroke="url(#sc-sm)" strokeWidth="2.2" />
    </svg>
  )
}

/* Hero art — flowing gradient waves (reference-inspired) */
export function SproutHero({ className }: Props) {
  return (
    <svg className={className} viewBox="0 0 400 400" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sc-wave1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#a855f7" />
          <stop offset="45%" stopColor="#fb5b3c" />
          <stop offset="100%" stopColor="#fbbf24" />
        </linearGradient>
        <linearGradient id="sc-wave2" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#fb5b3c" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#a855f7" stopOpacity="0.3" />
        </linearGradient>
        <filter id="sc-glow">
          <feGaussianBlur stdDeviation="8" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Glow orb */}
      <circle cx="280" cy="120" r="70" fill="url(#sc-wave1)" opacity="0.18" filter="url(#sc-glow)" />

      {/* Flowing wave lines */}
      <path d="M40 280 C120 180, 200 340, 320 220 S 380 80, 360 40" stroke="url(#sc-wave1)" strokeWidth="2.5" fill="none" opacity="0.85" />
      <path d="M60 300 C140 200, 220 360, 340 240 S 400 100, 380 60" stroke="url(#sc-wave2)" strokeWidth="1.5" fill="none" opacity="0.5" />
      <path d="M20 260 C100 160, 180 320, 300 200 S 360 60, 340 20" stroke="url(#sc-wave1)" strokeWidth="1" fill="none" opacity="0.25" />

      {/* Abstract scribble / study path */}
      <path
        d="M180 60 Q220 40 250 80 T310 70 T280 130 T220 110 T190 160 T240 180 T200 230"
        stroke="url(#sc-wave1)" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.9"
      />

      {/* Floating dots */}
      <circle cx="320" cy="90" r="5" fill="#fbbf24" opacity="0.9" />
      <circle cx="150" cy="50" r="3" fill="#a855f7" opacity="0.7" />
      <circle cx="350" cy="200" r="4" fill="#fb5b3c" opacity="0.8" />

      {/* Sparkle crosses */}
      <path d="M100 100h8M104 96v8" stroke="#fff" strokeWidth="1.2" opacity="0.4" strokeLinecap="round" />
      <path d="M330 160h6M333 157v6" stroke="#fff" strokeWidth="1" opacity="0.3" strokeLinecap="round" />
    </svg>
  )
}

export function SproutDecor({ className }: Props) {
  return (
    <svg className={className} viewBox="0 0 120 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sc-dec" x1="0" y1="0" x2="120" y2="100">
          <stop offset="0%" stopColor="#a855f7" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#fb5b3c" stopOpacity="0.3" />
        </linearGradient>
      </defs>
      <path d="M10 80 C40 30, 70 90, 110 20" stroke="url(#sc-dec)" strokeWidth="1.5" fill="none" />
      <circle cx="110" cy="20" r="4" fill="#fb5b3c" opacity="0.6" />
    </svg>
  )
}
