import { useEffect, useRef, useState } from 'react';

/**
 * Animates a number from its previous value to `target` using requestAnimationFrame.
 * Respects prefers-reduced-motion (jumps straight to the target). The returned
 * value is a float; format it at the call site.
 */
export function useCountUp(target: number, durationMs = 800): number {
  const [value, setValue] = useState(target);
  const valueRef = useRef(target);

  useEffect(() => {
    const from = valueRef.current;
    const to = target;
    if (from === to) return;

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !Number.isFinite(from) || !Number.isFinite(to)) {
      valueRef.current = to;
      setValue(to);
      return;
    }

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const current = from + (to - from) * eased;
      valueRef.current = current;
      setValue(current);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        valueRef.current = to;
        setValue(to);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return value;
}
