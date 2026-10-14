'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { useExerciseHistory } from '@/hooks/use-exercise-history';
import { useExerciseHistory as useHistory } from '@/hooks/use-exercise-history';
import { setPerformanceLabel } from '@/lib/workouts/history';
import { APP_ROUTES } from '@/lib/routes';

export function ExerciseHistory({
  history,
  initiallyOpen = false,
}: {
  history: ReturnType<typeof useExerciseHistory>;
  initiallyOpen?: boolean;
}) {
  return (
    <details
      open={initiallyOpen || undefined}
      className="rounded-2xl border bg-card p-3"
    >
      <summary className="cursor-pointer text-sm font-bold">
        過去のセット・メモを振り返る
      </summary>
      <div className="mt-3 space-y-3">
        {history.status === 'loading' ? (
          <p className="text-sm text-muted-foreground">
            過去の記録を読み込み中…
          </p>
        ) : history.status === 'error' ? (
          <div>
            <p role="alert" className="text-sm">
              過去の記録を取得できませんでした。入力は続けられます。
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={history.retry}
            >
              再試行
            </Button>
          </div>
        ) : history.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            この種目の過去の記録はありません。
          </p>
        ) : (
          history.items.map((entry, index) => (
            <details
              key={entry.workoutExerciseId}
              open={index < 2}
              className="rounded-xl bg-muted/40 p-3"
            >
              <summary className="cursor-pointer text-sm font-bold">
                {entry.localDate}{' '}
                <span className="text-xs text-muted-foreground">
                  {index === 0
                    ? '前回'
                    : index === 1
                      ? '前々回'
                      : `${index + 1}回前`}
                </span>
              </summary>
              <div className="mt-3 space-y-2">
                {entry.sets.map((set) => (
                  <div key={set.id} className="rounded-lg bg-card p-3">
                    <div className="flex flex-wrap justify-between gap-2 text-sm">
                      <span className="font-bold">SET {set.position + 1}</span>
                      <span className="font-black tabular-nums">
                        {setPerformanceLabel(set)}
                      </span>
                    </div>
                    {set.status !== 'completed' && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {set.status === 'skipped' ? 'スキップ' : '未完了'}
                      </p>
                    )}
                    {set.memo && (
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                        セットメモ：{set.memo}
                      </p>
                    )}
                  </div>
                ))}
                {entry.note && (
                  <p className="whitespace-pre-wrap break-words text-sm">
                    種目メモ：{entry.note}
                  </p>
                )}
                {entry.overallNote && (
                  <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                    当日のメモ：{entry.overallNote}
                  </p>
                )}
                <a
                  href={APP_ROUTES.workoutDetail(entry.workoutId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-xs font-bold text-primary"
                >
                  この日のトレーニング全体を見る（別タブ）
                </a>
              </div>
            </details>
          ))
        )}
        {history.moreError && (
          <p role="alert" className="text-xs text-destructive">
            古い記録を取得できませんでした。もう一度お試しください。
          </p>
        )}
        {history.hasMore && history.status === 'success' && (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={history.loadingMore}
            onClick={() => void history.loadMore()}
          >
            {history.loadingMore ? '読み込み中…' : 'さらに以前の記録を見る'}
          </Button>
        )}
      </div>
    </details>
  );
}

export function PastExerciseHistory({
  exerciseId,
  localDate,
  workoutId,
  startedAt,
}: {
  exerciseId: string;
  localDate: string;
  workoutId: string;
  startedAt: string;
}) {
  const [opened, setOpened] = useState(false);
  const history = useHistory(
    exerciseId,
    localDate,
    workoutId,
    opened,
    startedAt,
  );
  return opened ? (
    <ExerciseHistory history={history} initiallyOpen />
  ) : (
    <Button
      type="button"
      variant="outline"
      className="mt-4 w-full"
      onClick={() => setOpened(true)}
    >
      この種目の以前のセット・メモを見る
    </Button>
  );
}
