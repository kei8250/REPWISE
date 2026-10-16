'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { APP_ROUTES } from '@/lib/routes';
import { readLocalWorkoutSources } from '@/lib/workouts/local-drafts';
import { summarizeSyncQueue } from '@/lib/workouts/sync-overview';
import { syncPendingWorkoutMutations } from '@/lib/workouts/sync-queue';

export function DeletionSyncNotices({
  lastDeletedId,
  disabled,
  onUndo,
}: {
  lastDeletedId?: string;
  disabled: boolean;
  onUndo: (id: string) => void;
}) {
  const [local, setLocal] = useState<Awaited<
    ReturnType<typeof readLocalWorkoutSources>
  > | null>(null);
  const [observedIds, setObservedIds] = useState<string[]>([]);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let generation = 0;
    const update = () => {
      const current = ++generation;
      void readLocalWorkoutSources().then(
        (data) => {
          if (alive && generation === current) {
            setLocal(data);
            setObservedIds((previous) => [
              ...new Set([
                ...previous,
                ...summarizeSyncQueue(data.drafts, data.mutations)
                  .filter((entry) =>
                    entry.queue.some((item) =>
                      ['delete', 'restore'].includes(item.operation),
                    ),
                  )
                  .map((entry) => entry.id),
              ]),
            ]);
          }
        },
        () => {
          if (alive)
            setError(
              '削除の同期状態を確認できません。設定から再確認してください。',
            );
        },
      );
    };
    update();
    window.addEventListener('repwise-sync-queue-change', update);
    return () => {
      alive = false;
      window.removeEventListener('repwise-sync-queue-change', update);
    };
  }, [lastDeletedId]);
  const queue = summarizeSyncQueue(local?.drafts ?? [], local?.mutations ?? []);
  const items =
    local?.drafts.filter(
      (draft) =>
        draft.workoutId === lastDeletedId ||
        observedIds.includes(draft.workoutId) ||
        (draft.draftStatus === 'deleted' && !draft.deletionConfirmedAt) ||
        queue.some(
          (entry) =>
            entry.id === draft.workoutId &&
            entry.queue.some((item) =>
              ['delete', 'restore'].includes(item.operation),
            ),
        ),
    ) ?? [];
  const retry = async (id: string) => {
    setRetrying(id);
    setError(null);
    try {
      await syncPendingWorkoutMutations(id, { manual: true });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : '削除を同期できませんでした',
      );
    } finally {
      try {
        setLocal(await readLocalWorkoutSources());
      } catch {
        setError('同期状態を確認できません。設定から再確認してください。');
      } finally {
        setRetrying(null);
      }
    }
  };
  return (
    <div className="space-y-2" aria-live="polite">
      {error && (
        <p
          role="alert"
          className="rounded-xl border p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {items.map((draft) => {
        const head = queue.find((entry) => entry.id === draft.workoutId)?.head;
        const failed =
          head && ['failed', 'blocked', 'conflict'].includes(head.syncStatus);
        const isDeleted =
          draft.draftStatus === 'deleted' || Boolean(draft.workout.deletedAt);
        const label = !head
          ? draft.deletionConfirmedAt ? '削除を同期済み' : '端末では削除済み・サーバーの削除状態は未確認'
          : failed
            ? '削除の同期に失敗・端末では削除済み'
            : head.syncStatus === 'syncing' || retrying === draft.workoutId
              ? '削除を同期中'
              : '削除の同期待ち・端末では削除済み';
        return (
          <div key={draft.workoutId} className="rounded-xl border bg-card p-3">
            <p className="break-words text-sm font-bold">
              「{draft.workout.name}」
              {isDeleted ? 'を削除しました' : 'の削除を取り消しました'}
            </p>
            <details className="mt-1 text-xs"><summary className="min-h-11 cursor-pointer py-3 text-muted-foreground">削除の詳細</summary>
            <p className="mt-1 text-xs font-bold">
              {isDeleted
                ? label
                : !head
                  ? '削除の取り消しを同期済み'
                  : failed
                    ? '削除の取り消しの同期に失敗'
                    : '削除の取り消しを同期中／同期待ち'}
            </p>
            {head?.lastError && (
              <p className="mt-1 whitespace-pre-wrap break-words text-xs text-destructive">
                {head.lastError}
              </p>
            )}
            </details>
            <div className="mt-2 flex flex-wrap gap-2">
              {isDeleted && !head && !draft.deletionConfirmedAt && <a href={APP_ROUTES.settings} className="min-h-11 py-3 text-sm font-bold text-primary">設定で削除状態を確認</a>}
              {head?.syncStatus === 'conflict' ? (
                <a
                  href={APP_ROUTES.settings}
                  className="min-h-11 py-3 text-sm font-bold text-primary"
                >
                  設定で競合を確認
                </a>
              ) : (
                head && failed &&
                head.syncStatus !== 'syncing' && (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={disabled || retrying !== null}
                    onClick={() => void retry(draft.workoutId)}
                  >
                    {isDeleted
                      ? '削除の同期を再試行'
                      : '取り消しの同期を再試行'}
                  </Button>
                )
              )}
              {isDeleted && (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={
                    disabled ||
                    retrying !== null ||
                    head?.syncStatus === 'syncing'
                  }
                  onClick={() => onUndo(draft.workoutId)}
                >
                  削除を取り消す
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
