'use client';

import { useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function SwipeDeleteRow({
  children,
  label,
  busy,
  onDelete,
}: {
  children: ReactNode;
  label: string;
  busy: boolean;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const gesture = useRef<{ x: number; y: number; horizontal: boolean } | null>(
    null,
  );
  const dragged = useRef(false);
  const trashButton = useRef<HTMLButtonElement>(null);
  // A revealed touch action commits only on a tap, never on a scroll or cancellation.
  // Ignore the subsequent compatibility click so one tap queues only one deletion.
  const trashTouch = useRef<{ x: number; y: number; id: number } | null>(null);
  const touchHandled = useRef(false);
  return (
    <div
      className="relative overflow-hidden rounded-2xl border bg-card"
      data-swipe-open={open}
    >
      <button
        ref={trashButton}
        type="button"
        aria-label={`${label}を削除`}
        disabled={busy || !open}
        tabIndex={open ? 0 : -1}
        aria-hidden={!open}
        onPointerDown={(event) => {
          touchHandled.current = false;
          if (event.isPrimary && event.pointerType === 'touch')
            trashTouch.current = {
              x: event.clientX,
              y: event.clientY,
              id: event.pointerId,
            };
        }}
        onPointerCancel={() => {
          trashTouch.current = null;
        }}
        onPointerUp={(event) => {
          const start = trashTouch.current;
          trashTouch.current = null;
          if (
            !busy &&
            open &&
            start?.id === event.pointerId &&
            Math.hypot(event.clientX - start.x, event.clientY - start.y) < 10
          ) {
            touchHandled.current = true;
            event.preventDefault();
            onDelete();
          }
        }}
        onKeyDown={() => {
          touchHandled.current = false;
        }}
        onClick={() => {
          if (!touchHandled.current) onDelete();
        }}
        className="absolute inset-y-0 right-0 flex w-20 flex-col items-center justify-center gap-1 bg-destructive text-xs font-bold text-white disabled:opacity-60"
      >
        <Trash2 className="size-5" />
        削除
      </button>
      <div
        className="relative bg-card transition-transform motion-reduce:transition-none"
        style={{
          transform: open ? 'translateX(-80px)' : undefined,
          touchAction: 'pan-y',
        }}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          dragged.current = false;
          gesture.current = {
            x: event.clientX,
            y: event.clientY,
            horizontal: false,
          };
        }}
        onPointerMove={(event) => {
          const start = gesture.current;
          if (!start) return;
          const dx = event.clientX - start.x,
            dy = event.clientY - start.y;
          if (
            Math.abs(dy) > 12 &&
            !start.horizontal &&
            Math.abs(dy) > Math.abs(dx)
          ) {
            gesture.current = null;
            return;
          }
          if (Math.abs(dx) > 24 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            start.horizontal = true;
            dragged.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            setOpen(dx < 0);
          }
        }}
        onPointerUp={() => {
          gesture.current = null;
        }}
        onPointerCancel={() => {
          gesture.current = null;
        }}
        onClickCapture={(event) => {
          if (dragged.current) {
            event.preventDefault();
            event.stopPropagation();
            dragged.current = false;
          }
        }}
      >
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">{children}</div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mr-2 size-11"
            disabled={busy}
            aria-label={
              open ? `${label}の削除操作を閉じる` : `${label}の削除操作を表示`
            }
            aria-expanded={open}
            onClick={() => {
              setOpen((value) => !value);
              if (!open)
                requestAnimationFrame(() => trashButton.current?.focus());
            }}
          >
            <MoreHorizontal />
          </Button>
        </div>
      </div>
    </div>
  );
}
