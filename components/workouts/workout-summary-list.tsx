'use client';

import { DeletionSyncNotices } from './deletion-sync-notices';
import { SwipeDeleteRow } from './swipe-delete-row';
import { deleteActiveWorkout, restoreDeletedWorkout } from '@/lib/workouts/draft-deletion';
import { syncPendingWorkoutMutations } from '@/lib/workouts/sync-queue';
import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  LoaderCircle,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { loadVisibleWorkoutPage as loadVisibleWorkouts } from '@/lib/workouts/visible-workouts';
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
  from,
  to,
  exerciseName,
  bodyPart,
}: {
  status?: 'active' | 'completed';
  emptyMessage: string;
  localDate?: string;
  from?: string;
  to?: string;
  exerciseName?: string;
  bodyPart?: string;
}) {
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<{ id: string; name: string } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [items, setItems] = useState<WorkoutSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [serverOffset, setServerOffset] = useState(0);
  const [serverAvailable, setServerAvailable] = useState(true);
  const pageSize = 8;
  const [page, setPage] = useState(0);
  const requestGeneration = useRef(0);
  const pageHeading = useRef<HTMLParagraphElement>(null);
  const switchPage = (next: number) => {
    setPage(next);
    window.requestAnimationFrame(() => {
      pageHeading.current?.focus({ preventScroll: true });
      pageHeading.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };
  const [error, setError] = useState<string | null>(null);
  const load = (desiredPage = 0) => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    setError(null);
    void loadVisibleWorkouts(status, (desiredPage + 1) * pageSize, {
      from: localDate ?? from,
      to: localDate ?? to,
      exerciseName, bodyPart,
    })
      .then((loaded) => {
        if (requestGeneration.current !== generation) return;
        setItems(loaded.items);
        setPage(Math.min(desiredPage, Math.max(0, Math.ceil(loaded.items.length / pageSize) - 1)));
        setHasMore(loaded.hasMore);
        setServerOffset(loaded.serverCount);
        setServerAvailable(loaded.serverAvailable);
      })
      .catch((cause) => {
        if (requestGeneration.current !== generation) return;
        setError(
          cause instanceof Error ? cause.message : '履歴を読み込めませんでした',
        );
      })
      .finally(() => { if (requestGeneration.current === generation) setLoading(false); });
  };
  useEffect(() => {
    let alive = true;
    const generation = ++requestGeneration.current;
    void loadVisibleWorkouts(status, pageSize, {
      from: localDate ?? from,
      to: localDate ?? to,
      exerciseName, bodyPart,
    })
      .then((loaded) => {
        if (alive && requestGeneration.current === generation) {
          setItems(loaded.items);
          setHasMore(loaded.hasMore);
          setServerOffset(loaded.serverCount);
          setServerAvailable(loaded.serverAvailable);
        }
      })
      .catch((cause) => {
        if (alive && requestGeneration.current === generation)
          setError(
            cause instanceof Error
              ? cause.message
              : '履歴を読み込めませんでした',
          );
      })
      .finally(() => {
        if (alive && requestGeneration.current === generation) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [status, localDate, from, to, exerciseName, bodyPart]);
  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    setMoreError(false);
    try {
      let combined = items;
      let offset = serverOffset;
      let more = hasMore;
      const next = page + 1;
      while (combined.length < (next + 1) * pageSize && more) {
        const loaded = await loadVisibleWorkouts(status, pageSize, {
          from: localDate ?? from,
          to: localDate ?? to,
      exerciseName, bodyPart,
          offset,
        });
        combined = [
          ...new Map(
            [...combined, ...loaded.items].map((item) => [item.id, item]),
          ).values(),
        ];
        offset += loaded.serverCount;
        more = loaded.hasMore;
      }
      setItems(combined);
      setServerOffset(offset);
      setHasMore(more);
      switchPage(
        Math.min(next, Math.max(0, Math.ceil(combined.length / pageSize) - 1)),
      );
    } catch {
      setMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  };
  const remove = async (item: WorkoutSummary) => {
    if (deleting || loadingMore) return;
    setDeleting(item.id); setDeleteError(null);
    try {
      await deleteActiveWorkout(item.id);
      setItems(previous => previous.filter(row => row.id !== item.id));
      if (page > 0 && items.length - 1 <= page * pageSize) setPage(page - 1);
      setDeleted({ id: item.id, name: item.name });
      const result = await syncPendingWorkoutMutations(item.id, { manual: true }).catch(() => null);
      if (result && result.remaining === 0) load(page);
      else { setServerOffset(0); setHasMore(true); }

    } catch (cause) { setDeleteError(cause instanceof Error ? cause.message : '削除を保存できませんでした'); }
    finally { setDeleting(null); }
  };
  const undo = async (id: string) => {
    if (deleting) return;
    setDeleting(id); setDeleteError(null);
    try {
      await restoreDeletedWorkout(id);
      setDeleted(null);
      await syncPendingWorkoutMutations(id, { manual: true }).catch(() => undefined);
      load(page);
    } catch (cause) { setDeleteError(cause instanceof Error ? cause.message : '削除を取り消せませんでした'); }
    finally { setDeleting(null); }
  };
  const deletionNotice = <>
    {deleteError && <p role="alert" className="rounded-xl border border-destructive p-3 text-sm text-destructive">{deleteError}</p>}
    <DeletionSyncNotices lastDeletedId={deleted?.id} disabled={deleting !== null || loadingMore} onUndo={id => void undo(id)} />
  </>;
  if (loading)
    return (
      <div>{deletionNotice}<div className="grid min-h-44 place-items-center">
        <LoaderCircle className="size-6 animate-spin text-primary" />
      </div></div>
    );
  if (error)
    return (
      <div className="rounded-2xl border bg-card p-6 text-center">
        {deletionNotice}
        <AlertCircle className="mx-auto text-destructive" />
        <p className="mt-2 text-sm font-semibold">{error}</p>
        <Button type="button" variant="outline" className="mt-4" onClick={() => load()}>
          再試行
        </Button>
      </div>
    );
  if (!items.length)
    return (
      <div>{deletionNotice}<div className="rounded-2xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
        {emptyMessage}
        {hasMore && <Button type="button" variant="outline" className="mt-3 min-h-11" onClick={() => { setPage(0); load(); }}>残りの記録を読み込む</Button>}
      </div></div>
    );
  return (
    <div className="space-y-3">
      {deletionNotice}
      {status === 'active' && <p className="text-xs text-muted-foreground">左へスワイプすると削除ボタンが出ます。「…」からも操作できます。</p>}
      {!serverAvailable && (
        <p className="text-xs text-muted-foreground">
          サーバーに接続できないため、端末の保存済み記録を表示しています。
        </p>
      )}
      <p ref={pageHeading} tabIndex={-1} className="scroll-mt-4 text-xs text-muted-foreground" aria-live="polite">
        {page * pageSize + 1}〜{Math.min((page + 1) * pageSize, items.length)}
        件目
      </p>
      {items.slice(page * pageSize, (page + 1) * pageSize).map((item) => {
        const active = item.status === 'active';
        const href = workoutRoute(item.id, item.status);
        const content = (
          <Card className={active ? "rounded-none border-0 py-0 shadow-none" : "rounded-2xl py-0 shadow-none"}>
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
                <a
                  href={href}
                  className="block truncate font-black hover:text-primary"
                >
                  {item.name}
                </a>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDate(item.localDate)} · {item.exerciseCount}種目 ·{' '}
                  {active ? `${item.completedSetCount}/${item.setCount}セット完了` : `${item.completedSetCount}セット記録`}
                </p>
                {item.localOnly && (
                  <p className="mt-1 text-xs font-bold text-amber-700">
                    {item.pendingSync
                      ? '端末に保存済み・未同期'
                      : '端末の保存済み記録'}
                  </p>
                )}
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
        return active ? <SwipeDeleteRow key={item.id} label={item.name} busy={deleting !== null || loadingMore} onDelete={() => void remove(item)}>{content}</SwipeDeleteRow> : <div key={item.id}>{content}</div>;
      })}
      {moreError && (
        <p role="alert" className="text-sm text-destructive">
          古い履歴を取得できませんでした。再度お試しください。
        </p>
      )}
      <nav
        aria-label="履歴のページ切替"
        className="flex items-center justify-between gap-3"
      >
        <Button
          type="button"
          variant="outline"
          disabled={page === 0 || loadingMore || deleting !== null}
          onClick={() => switchPage(page - 1)}
        >
          前の8件
        </Button>
        <span className="text-xs text-muted-foreground">{page + 1}ページ</span>
        <Button
          type="button"
          variant="outline"
          disabled={
            deleting !== null || loadingMore || (!hasMore && (page + 1) * pageSize >= items.length)
          }
          onClick={() => {
            if (!hasMore || (page + 2) * pageSize <= items.length)
              switchPage(page + 1);
            else void loadMore();
          }}
        >
          {loadingMore ? '読み込み中…' : '次の8件'}
        </Button>
      </nav>
    </div>
  );
}
