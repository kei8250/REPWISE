'use client';

import { useEffect, useRef, useState } from 'react';

// View preferences only. Workout inputs remain in the existing durable draft.
export function useWorkoutView(workoutId: string, ready: boolean) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const savedSelection = useRef<string | null>(null);
  const restored = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    let frame = 0;
    let frame2 = 0;
    const key = `repwise:view:${workoutId}`;
    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    if (restored.current !== key) {
      void Promise.resolve().then(() => {
        if (!alive) return;
        restored.current = key;
        try {
          const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null') as {
            selectedId?: unknown;
            scrollY?: unknown;
          } | null;
          if (typeof saved?.selectedId === 'string') {
            savedSelection.current = saved.selectedId;
            setSelectedId(saved.selectedId);
          }
          if (
            typeof saved?.scrollY === 'number' &&
            Number.isFinite(saved.scrollY)
          ) {
            const y = Math.max(0, saved.scrollY);
            frame = requestAnimationFrame(() => {
              frame2 = requestAnimationFrame(() => {
                if (alive) window.scrollTo(0, y);
              });
            });
          }
        } catch {
          /* Unavailable storage must not block recording. */
        }
      });
    }
    const persist = () => {
      try {
        sessionStorage.setItem(
          key,
          JSON.stringify({
            selectedId: savedSelection.current,
            scrollY: window.scrollY,
          }),
        );
      } catch {
        /* View state is optional. */
      }
    };
    window.addEventListener('scroll', persist, { passive: true });
    window.addEventListener('pagehide', persist);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(frame2);
      window.removeEventListener('scroll', persist);
      window.removeEventListener('pagehide', persist);
      window.history.scrollRestoration = previousRestoration;
    };
  }, [workoutId, ready]);
  const select = (id: string | null) => {
    savedSelection.current = id;
    setSelectedId(id);
    try {
      sessionStorage.setItem(
        `repwise:view:${workoutId}`,
        JSON.stringify({ selectedId: id, scrollY: window.scrollY }),
      );
    } catch {
      /* Optional view state. */
    }
  };
  return [selectedId, select] as const;
}
