'use client';

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  LoaderCircle,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { loadVisibleWorkouts } from '@/lib/workouts/visible-workouts';
import type { WorkoutSummary } from '@/lib/workouts/types';
import { workoutRoute } from '@/lib/routes';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date(`${value}T00:00:00`));
}

export function WorkoutSummaryList({
  status,
  emptyMessage,
  localDate,
}: {
  status?: 'active' | 'completed';
  emptyMessage: string;
  localDate?: string;
}) {
  const [items, setItems] = useState<WorkoutSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [serverOffset, setServerOffset] = useState(0);
  const [serverAvailable, setServerAvailable] = useState(true);
  const pageSize = 30;
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    setLoading(true);
    setError(null);
    void loadVisibleWorkouts(status, pageSize, { from: localDate, to: localDate })
      .then((loaded) => { setItems(loaded.items); setHasMore(loaded.hasMore); setServerOffset(loaded.serverCount); setServerAvailable(loaded.serverAvailable); })
      .catch((cause) =>
        setError(
          cause instanceof Error ? cause.message : '履歴を読み込めませんでした',
        ),
      )
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    let alive = true;
    void loadVisibleWorkouts(status, pageSize, { from: localDate, to: localDate })
      .then((loaded) => {
        if (alive) { setItems(loaded.items); setHasMore(loaded.hasMore); setServerOffset(loaded.serverCount); setServerAvailable(loaded.serverAvailable); }
      })
      .catch((cause) => {
        if (alive)
          setError(
            cause instanceof Error
              ? cause.message
              : '履歴を読み込めませんでした',
          );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [status, localDate]);
  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const loaded = await loadVisibleWorkouts(status, pageSize, { from: localDate, to: localDate, offset: serverOffset });
      setItems((previous) => [...new Map([...previous, ...loaded.items].map((item) => [item.id, item])).values()]);
      setServerOffset((offset) => offset + loaded.serverCount);
      setHasMore(loaded.hasMore);
    } catch { setMoreError(true); }
    finally { setLoadingMore(false); }
  };
  if (loading)
    return (
      <div className="grid min-h-44 place-items-center">
        <LoaderCircle className="size-6 animate-spin text-primary" />
      </div>
    );
  if (error)
    return (
      <div className="rounded-2xl border bg-card p-6 text-center">
        <AlertCircle className="mx-auto text-destructive" />
        <p className="mt-2 text-sm font-semibold">{error}</p>
        <Button type="button" variant="outline" className="mt-4" onClick={load}>
          再試行
        </Button>
      </div>
    );
  if (!items.length)
    return (
      <div className="rounded-2xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  return (
    <div className="space-y-3">
      {!serverAvailable && <p className="text-xs text-muted-foreground">サーバーに接続できないため、端末の保存済み記録を表示しています。</p>}
      {items.map((item) => {
        const active = item.status === 'active';
        const href = workoutRoute(item.id, item.status);
        return (
          <Card key={item.id} className="rounded-2xl py-0 shadow-none">
            <CardContent className="flex items-center gap-4 p-4">
              <span
                className={`grid size-10 shrink-0 place-items-center rounded-xl ${active ? 'bg-accent text-accent-foreground' : 'bg-primary/10 text-primary'}`}
              >
                {active ? (
                  <Clock3 className="size-5" />
                ) : (
                  <CheckCircle2 className="size-5" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <a href={href} className="block truncate font-black hover:text-primary">{item.name}</a>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDate(item.localDate)} · {item.exerciseCount}種目 ·{' '}
                  {item.completedSetCount}/{item.setCount}セット完了
                </p>
                {item.localOnly && <p className="mt-1 text-xs font-bold text-amber-700">{item.pendingSync ? '端末に保存済み・未同期' : '端末の保存済み記録'}</p>}
              </div>
              <a
                href={href}
                aria-label={`${item.name}を開く`}
                className={buttonVariants({
                  variant: 'ghost',
                  size: 'icon-sm',
                })}
              >
                <ChevronRight />
              </a>
            </CardContent>
          </Card>
        );
      })}
      {moreError && <p role="alert" className="text-sm text-destructive">古い履歴を取得できませんでした。再度お試しください。</p>}
      {hasMore && <Button type="button" variant="outline" className="w-full" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? '読み込み中…' : 'さらに以前の履歴を見る'}</Button>}
    </div>
  );
}
