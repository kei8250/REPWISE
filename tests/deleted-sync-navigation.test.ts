import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createLocalWorkout } from '@/lib/workouts/draft';
import type { LocalWorkoutDraft } from '@/lib/workouts/local-drafts';
import { workoutToSummary } from '@/lib/workouts/local-drafts';
import { summarizeSyncQueue } from '@/lib/workouts/sync-overview';
import type { WorkoutMutation } from '@/lib/workouts/types';
import { WorkoutSyncList } from '@/components/settings/workout-sync-list';
import { workoutsOnDate } from '@/components/workouts/workout-calendar';

const workout = createLocalWorkout({
  name: '同期確認用',
  localDate: '2026-10-15',
  timezone: 'Asia/Tokyo',
});
function draft(deleted: boolean): LocalWorkoutDraft {
  return {
    workoutId: workout.id,
    schemaVersion: 1,
    draftStatus: deleted ? 'deleted' : 'active',
    workout: { ...workout, deletedAt: deleted ? '2026-10-15T12:00:00Z' : null },
    localUpdatedAt: workout.updatedAt,
    serverUpdatedAt: null,
    serverVersion: null,
    completedAt: null,
  };
}
function mutation(
  sequence: number,
  operation: WorkoutMutation['operation'],
  syncStatus: WorkoutMutation['syncStatus'] = 'pending',
): WorkoutMutation {
  return {
    sequence,
    operation,
    syncStatus,
    mutationId: `mutation-${sequence}`,
    entityType: 'workout',
    entityId: workout.id,
    workoutId: workout.id,
    baseVersion: sequence - 1,
    payload: {
      workout: {
        ...workout,
        deletedAt: operation === 'delete' ? '2026-10-15T12:00:00Z' : null,
      },
    },
    createdAt: workout.createdAt,
    retryCount: 0,
    lastAttemptAt: null,
    lastError: syncStatus === 'failed' ? '通信できません' : null,
  };
}

describe('削除済み記録の同期表示', () => {
  it('先頭の保存が失敗していても、最新の削除状態で分類し、キューを変更しない', () => {
    const queue = [mutation(2, 'delete'), mutation(1, 'replace', 'failed')];
    const before = structuredClone(queue);
    const entries = summarizeSyncQueue([draft(true)], queue);
    expect(entries[0].deleted).toBe(true);
    expect(entries[0].head.syncStatus).toBe('failed');
    expect(entries[0].queue.map((item) => item.operation)).toEqual([
      'replace',
      'delete',
    ]);
    expect(queue).toEqual(before);
    const markup = renderToStaticMarkup(
      createElement(WorkoutSyncList, {
        entries,
        busy: null,
        onRetry: () => {},
      }),
    );
    expect(markup).toContain('削除の反映を再試行');
    expect(markup).toContain('通信できません');
    expect(markup).not.toContain('記録を確認');
    expect(markup).not.toContain('href=');
    expect(markup).not.toContain('同期失敗・記録は端末に保存済み');
  });

  it('削除を取り消した記録は通常の同期表示と開くリンクに戻す', () => {
    const entries = summarizeSyncQueue(
      [draft(false)],
      [
        mutation(1, 'replace', 'failed'),
        mutation(2, 'delete'),
        mutation(3, 'restore'),
      ],
    );
    expect(entries[0].deleted).toBe(false);
    const markup = renderToStaticMarkup(
      createElement(WorkoutSyncList, {
        entries,
        busy: null,
        onRetry: () => {},
      }),
    );
    expect(markup).toContain('記録を確認');
    expect(markup).toContain(`/workouts/active/${workout.id}`);
    expect(markup).toContain('同期を再試行');
  });

  it('下書きがない場合も最新の削除と復元を区別する', () => {
    expect(
      summarizeSyncQueue([], [mutation(2, 'delete'), mutation(1, 'replace')])[0]
        .deleted,
    ).toBe(true);
    expect(
      summarizeSyncQueue([], [mutation(2, 'delete'), mutation(3, 'restore')])[0]
        .deleted,
    ).toBe(false);
    expect(summarizeSyncQueue([draft(true)], [])).toEqual([]);
  });

  it('削除の競合時も開けない記録へのリンクを出さず、競合を明示する', () => {
    const entries = summarizeSyncQueue(
      [draft(true)],
      [mutation(1, 'delete', 'conflict')],
    );
    const markup = renderToStaticMarkup(
      createElement(WorkoutSyncList, {
        entries,
        busy: null,
        onRetry: () => {},
      }),
    );
    expect(markup).toContain('削除の反映が競合');
    expect(markup).not.toContain('記録を確認');
    expect(markup).not.toContain('再試行');
  });
});

describe('カレンダーから直接開く記録', () => {
  it('選択日だけを開始時刻順に選び、別の日の記録を混ぜない', () => {
    const first = workoutToSummary({
      ...workout,
      id: 'morning',
      startedAt: '2026-10-15T02:00:00Z',
    });
    const second = {
      ...first,
      id: 'evening',
      startedAt: '2026-10-15T10:00:00Z',
    };
    const otherDay = { ...first, id: 'yesterday', localDate: '2026-10-14' };
    const items = [first, otherDay, second];
    expect(workoutsOnDate(items, '2026-10-15').map((item) => item.id)).toEqual([
      'evening',
      'morning',
    ]);
    expect(workoutsOnDate(items, '2026-10-14')).toEqual([otherDay]);
    expect(workoutsOnDate(items, '2026-10-16')).toEqual([]);
    expect(items).toEqual([first, otherDay, second]);
  });
});
