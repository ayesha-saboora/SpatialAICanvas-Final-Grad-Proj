type Props = { className?: string }

export function ConstellationLogo({ className }: Props) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <line x1="8" y1="6" x2="20" y2="10" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      <line x1="20" y1="10" x2="26" y2="22" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      <line x1="20" y1="10" x2="12" y2="18" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      <line x1="12" y1="18" x2="26" y2="22" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      <line x1="12" y1="18" x2="6" y2="26" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      <circle cx="8" cy="6" r="2.5" fill="currentColor" />
      <circle cx="20" cy="10" r="3" fill="currentColor" />
      <circle cx="12" cy="18" r="2.5" fill="currentColor" />
      <circle cx="26" cy="22" r="2" fill="currentColor" />
      <circle cx="6" cy="26" r="2" fill="currentColor" />
    </svg>
  )
}

export function ConstellationHero({ className }: Props) {
  return (
    <svg className={className} viewBox="0 0 200 180" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Lines */}
      <line x1="40" y1="30" x2="100" y2="50" stroke="url(#cg1)" strokeWidth="1.5" opacity="0.3" />
      <line x1="100" y1="50" x2="160" y2="35" stroke="url(#cg1)" strokeWidth="1.5" opacity="0.3" />
      <line x1="100" y1="50" x2="70" y2="100" stroke="url(#cg1)" strokeWidth="1.5" opacity="0.3" />
      <line x1="100" y1="50" x2="140" y2="95" stroke="url(#cg1)" strokeWidth="1.5" opacity="0.3" />
      <line x1="70" y1="100" x2="140" y2="95" stroke="url(#cg1)" strokeWidth="1.5" opacity="0.3" />
      <line x1="70" y1="100" x2="50" y2="150" stroke="url(#cg1)" strokeWidth="1.5" opacity="0.3" />
      <line x1="140" y1="95" x2="165" y2="145" stroke="url(#cg1)" strokeWidth="1.5" opacity="0.3" />
      <line x1="70" y1="100" x2="110" y2="145" stroke="url(#cg1)" strokeWidth="1.5" opacity="0.3" />
      <line x1="140" y1="95" x2="110" y2="145" stroke="url(#cg1)" strokeWidth="1.5" opacity="0.3" />

      {/* Main stars */}
      <circle cx="40" cy="30" r="4" fill="url(#cg2)" />
      <circle cx="100" cy="50" r="6" fill="url(#cg2)" />
      <circle cx="160" cy="35" r="3.5" fill="url(#cg2)" />
      <circle cx="70" cy="100" r="5" fill="url(#cg2)" />
      <circle cx="140" cy="95" r="4.5" fill="url(#cg2)" />
      <circle cx="50" cy="150" r="3.5" fill="url(#cg2)" />
      <circle cx="110" cy="145" r="5" fill="url(#cg2)" />
      <circle cx="165" cy="145" r="3" fill="url(#cg2)" />

      {/* Glow rings on main nodes */}
      <circle cx="100" cy="50" r="12" fill="none" stroke="url(#cg2)" strokeWidth="0.5" opacity="0.2" />
      <circle cx="70" cy="100" r="10" fill="none" stroke="url(#cg2)" strokeWidth="0.5" opacity="0.15" />
      <circle cx="110" cy="145" r="10" fill="none" stroke="url(#cg2)" strokeWidth="0.5" opacity="0.15" />

      {/* Tiny ambient stars */}
      <circle cx="25" cy="60" r="1.2" fill="#16a34a" opacity="0.3" />
      <circle cx="180" cy="70" r="1" fill="#ec4899" opacity="0.25" />
      <circle cx="130" cy="20" r="1.5" fill="#16a34a" opacity="0.2" />
      <circle cx="30" cy="130" r="1" fill="#ec4899" opacity="0.2" />
      <circle cx="175" cy="120" r="1.2" fill="#16a34a" opacity="0.25" />
      <circle cx="85" cy="15" r="1" fill="#16a34a" opacity="0.2" />
      <circle cx="15" cy="90" r="0.8" fill="#ec4899" opacity="0.15" />

      <defs>
        <linearGradient id="cg1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#16a34a" />
          <stop offset="100%" stopColor="#ec4899" />
        </linearGradient>
        <linearGradient id="cg2" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#16a34a" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export function ConstellationDecor({ className }: Props) {
  return (
    <svg className={className} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <line x1="20" y1="30" x2="60" y2="20" stroke="#16a34a" strokeWidth="1" opacity="0.15" />
      <line x1="60" y1="20" x2="90" y2="50" stroke="#16a34a" strokeWidth="1" opacity="0.15" />
      <line x1="90" y1="50" x2="70" y2="90" stroke="#ec4899" strokeWidth="1" opacity="0.12" />
      <line x1="70" y1="90" x2="30" y2="80" stroke="#16a34a" strokeWidth="1" opacity="0.15" />
      <line x1="60" y1="20" x2="70" y2="90" stroke="#16a34a" strokeWidth="0.8" opacity="0.1" />

      <circle cx="20" cy="30" r="3" fill="#16a34a" opacity="0.2" />
      <circle cx="60" cy="20" r="4" fill="#16a34a" opacity="0.25" />
      <circle cx="90" cy="50" r="3" fill="#ec4899" opacity="0.2" />
      <circle cx="70" cy="90" r="3.5" fill="#16a34a" opacity="0.2" />
      <circle cx="30" cy="80" r="2.5" fill="#ec4899" opacity="0.15" />

      <circle cx="45" cy="55" r="1" fill="#16a34a" opacity="0.12" />
      <circle cx="100" cy="30" r="1.2" fill="#ec4899" opacity="0.1" />
      <circle cx="15" cy="100" r="0.8" fill="#16a34a" opacity="0.1" />
    </svg>
  )
}

export function ConstellationSmall({ className }: Props) {
  return (
    <svg className={className} viewBox="0 0 80 60" fill="none" xmlns="http://www.w3.org/2000/svg">
      <line x1="15" y1="15" x2="45" y2="25" stroke="#16a34a" strokeWidth="1" opacity="0.2" />
      <line x1="45" y1="25" x2="65" y2="15" stroke="#16a34a" strokeWidth="1" opacity="0.2" />
      <line x1="45" y1="25" x2="35" y2="48" stroke="#ec4899" strokeWidth="1" opacity="0.15" />

      <circle cx="15" cy="15" r="2.5" fill="#16a34a" opacity="0.3" />
      <circle cx="45" cy="25" r="3" fill="#16a34a" opacity="0.35" />
      <circle cx="65" cy="15" r="2" fill="#ec4899" opacity="0.25" />
      <circle cx="35" cy="48" r="2" fill="#16a34a" opacity="0.25" />
    </svg>
  )
}

export { BambooStalk } from './Panda'
