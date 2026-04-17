type Props = { className?: string; size?: number }

export function Sparkle({ className, size = 24 }: Props) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 2 L13.5 9 L20 12 L13.5 15 L12 22 L10.5 15 L4 12 L10.5 9 Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function SparkleGroup({ className }: { className?: string }) {
  return (
    <div className={className} aria-hidden>
      <svg width="120" height="80" viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M30 10 L31.5 17 L38 20 L31.5 23 L30 30 L28.5 23 L22 20 L28.5 17 Z" fill="currentColor" opacity="0.5" />
        <path d="M75 5 L76 9 L80 11 L76 13 L75 17 L74 13 L70 11 L74 9 Z" fill="currentColor" opacity="0.3" />
        <path d="M95 40 L96.5 47 L103 50 L96.5 53 L95 60 L93.5 53 L87 50 L93.5 47 Z" fill="currentColor" opacity="0.4" />
        <path d="M15 50 L16 54 L20 55 L16 56 L15 60 L14 56 L10 55 L14 54 Z" fill="currentColor" opacity="0.25" />
        <path d="M55 55 L56 59 L60 61 L56 63 L55 67 L54 63 L50 61 L54 59 Z" fill="currentColor" opacity="0.2" />
      </svg>
    </div>
  )
}
