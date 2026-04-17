type Props = { className?: string }

export function SproutLogo({ className }: Props) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 28V16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M16 16C16 10 22 6 28 6C28 12 22 16 16 16Z" fill="currentColor" opacity="0.8" />
      <path d="M16 20C16 14 10 10 4 10C4 16 10 20 16 20Z" fill="currentColor" opacity="0.55" />
    </svg>
  )
}

export function SproutHero({ className }: Props) {
  return (
    <svg className={className} viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Stem */}
      <path d="M100 180V90" stroke="url(#sh1)" strokeWidth="3" strokeLinecap="round" />
      <path d="M100 150C80 150 70 140 68 130" stroke="url(#sh1)" strokeWidth="2" strokeLinecap="round" opacity="0.4" />

      {/* Right large leaf */}
      <path d="M100 90C100 55 135 30 170 30C170 65 135 90 100 90Z" fill="url(#sh2)" opacity="0.7" />
      <path d="M135 60C125 70 115 78 100 90" stroke="#fff" strokeWidth="1" opacity="0.3" />

      {/* Left medium leaf */}
      <path d="M100 120C100 90 65 70 30 70C30 100 65 120 100 120Z" fill="url(#sh3)" opacity="0.55" />
      <path d="M65 95C75 100 88 108 100 120" stroke="#fff" strokeWidth="1" opacity="0.25" />

      {/* Small sprout at top */}
      <path d="M100 90C98 80 92 74 85 72" stroke="url(#sh1)" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
      <ellipse cx="83" cy="71" rx="4" ry="3" fill="url(#sh2)" opacity="0.4" transform="rotate(-20 83 71)" />

      {/* Ground dots */}
      <circle cx="88" cy="182" r="3" fill="#16a34a" opacity="0.1" />
      <circle cx="100" cy="185" r="4" fill="#16a34a" opacity="0.08" />
      <circle cx="112" cy="183" r="3" fill="#16a34a" opacity="0.1" />

      {/* Tiny floating leaves */}
      <ellipse cx="150" cy="50" rx="6" ry="3" fill="#16a34a" opacity="0.12" transform="rotate(30 150 50)" />
      <ellipse cx="50" cy="110" rx="5" ry="2.5" fill="#059669" opacity="0.1" transform="rotate(-20 50 110)" />
      <ellipse cx="160" cy="130" rx="4" ry="2" fill="#ec4899" opacity="0.08" transform="rotate(15 160 130)" />

      <defs>
        <linearGradient id="sh1" x1="100" y1="180" x2="100" y2="30">
          <stop offset="0%" stopColor="#16a34a" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
        <linearGradient id="sh2" x1="100" y1="90" x2="170" y2="30">
          <stop offset="0%" stopColor="#16a34a" />
          <stop offset="100%" stopColor="#4ade80" />
        </linearGradient>
        <linearGradient id="sh3" x1="100" y1="120" x2="30" y2="70">
          <stop offset="0%" stopColor="#059669" />
          <stop offset="100%" stopColor="#34d399" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export function SproutDecor({ className }: Props) {
  return (
    <svg className={className} viewBox="0 0 100 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M50 75V40" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" opacity="0.25" />
      <path d="M50 40C50 22 70 10 90 10C90 28 70 40 50 40Z" fill="#16a34a" opacity="0.12" />
      <path d="M50 55C50 40 30 30 10 30C10 45 30 55 50 55Z" fill="#059669" opacity="0.08" />
      <ellipse cx="75" cy="25" rx="3" ry="1.5" fill="#16a34a" opacity="0.08" transform="rotate(25 75 25)" />
      <ellipse cx="25" cy="50" rx="2.5" ry="1.2" fill="#059669" opacity="0.06" transform="rotate(-15 25 50)" />
    </svg>
  )
}

export function SproutSmall({ className }: Props) {
  return (
    <svg className={className} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 36V20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      <path d="M20 20C20 12 28 7 36 7C36 15 28 20 20 20Z" fill="currentColor" opacity="0.5" />
      <path d="M20 26C20 20 12 16 4 16C4 22 12 26 20 26Z" fill="currentColor" opacity="0.3" />
    </svg>
  )
}
