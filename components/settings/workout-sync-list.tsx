import { Button } from '@/components/ui/button';
import { workoutRoute } from '@/lib/routes';
import { summarizeSyncQueue } from '@/lib/workouts/sync-overview';

export function WorkoutSyncList({
  entries,
  busy,
  onRetry,
}: {
  entries: ReturnType<typeof summarizeSyncQueue>;
  busy: string | null;
  onRetry: (id: string) => void;
}) {
  return entries.map(({ id, draft, queue, head, deleted }) => {
    const label = deleted
      ? head.syncStatus === 'conflict'
        ? '削除の反映が競合しています。端末では削除済みです。'
        : '端末では削除済み・サーバーへの反映待ち'
      : head.syncStatus === 'conflict'
        ? '別の変更と競合しています'
        : head.syncStatus === 'blocked'
          ? '同期を停止中・内容を確認してください'
          : head.syncStatus === 'failed'
            ? '同期失敗・記録は端末に保存済み'
            : head.syncStatus === 'syncing'
              ? '同期中'
              : '端末に保存済み・同期待ち';
    return (
      <div key={id} className="rounded-xl bg-muted/50 p-3">
        <p className="break-words font-bold">
          {draft?.workout.name ?? 'トレーニング記録'}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {label} · {queue.length}件の変更
        </p>
        {head.lastError && (
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-destructive">
            {head.lastError}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-3">
          {draft && !deleted && (
            <a
              className="min-h-11 self-center py-3 text-sm font-bold text-primary"
              href={workoutRoute(id, draft.workout.status)}
            >
              記録を確認
            </a>
          )}
          {head.syncStatus !== 'conflict' && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={busy !== null || head.syncStatus === 'syncing'}
              onClick={() => onRetry(id)}
            >
              {busy === id
                ? '再試行中…'
                : deleted
                  ? '削除の反映を再試行'
                  : '同期を再試行'}
            </Button>
          )}
        </div>
      </div>
    );
  });
}
