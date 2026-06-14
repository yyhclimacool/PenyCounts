import { useEffect, useRef, useState } from 'react';
import { cn } from '@/utils/cn';

interface ProgressRingProps {
  /** 0–1 (values above 1 are clamped for the arc but `overflow` reflects the excess). */
  progress: number;
  size?: number;
  stroke?: number;
  /** Stroke color; defaults to the primary token. Overdrawn rings turn red via `over`. */
  color?: string;
  trackColor?: string;
  className?: string;
  children?: React.ReactNode;
}

/**
 * Animated circular progress indicator. The arc animates from its previous
 * value via a CSS transition on stroke-dashoffset (GPU-friendly), respecting
 * prefers-reduced-motion by snapping instantly.
 */
export function ProgressRing({
  progress,
  size = 96,
  stroke = 8,
  color,
  trackColor = 'var(--muted)',
  className,
  children,
}: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(1, progress));
  const [shown, setShown] = useState(0);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const id = requestAnimationFrame(() => setShown(clamped));
    return () => cancelAnimationFrame(id);
  }, [clamped]);

  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - shown);
  const strokeColor = color ?? 'var(--primary)';

  return (
    <div className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={stroke}
          opacity={0.35}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            transition: reduced.current ? 'none' : 'stroke-dashoffset 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
      </svg>
      {children ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          {children}
        </div>
      ) : null}
    </div>
  );
}
