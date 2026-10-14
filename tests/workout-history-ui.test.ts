import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WorkoutSetRow } from '@/components/workouts/workout-set-row';
import { ExerciseHistory } from '@/components/workouts/exercise-history';
import { getExerciseHistory, listWorkouts } from '@/lib/workouts/api-client';
import { createSet } from '@/lib/workouts/draft';

const previous = {
  ...createSet(1),
  status: 'completed' as const,
  actualLoadGrams: 82500,
  actualReps: 9,
  memo: '2セット目\n肩に注意',
};

describe('set history presentation', () => {
  it('2セット目の重量・回数・前々回・メモと入力中の進捗を表示する', () => {
    const html = renderToStaticMarkup(
      createElement(WorkoutSetRow, {
        set: createSet(1),
        number: 2,
        onChange: () => {},
        onDelete: () => {},
        canDelete: true,
        isFirst: false,
        isLast: false,
        onMove: () => {},
        comparison: { status: 'above', label: '前回 +1rep' },
        previousRecords: [
          { localDate: '2026-10-11', label: '前回', set: previous },
          { localDate: '2026-10-07', label: '前々回', set: previous },
        ],
      }),
    );
    expect(html).toContain('82.5 kg × 9 回');
    expect(html).toContain('前々回 2026-10-07');
    expect(html).toContain('2セット目\n肩に注意');
    expect(html).toContain('前回 +1rep');
    expect(html).toContain('aria-live="polite"');
  });

  it('過去のセット・種目・当日メモとさらに古い履歴の導線を表示する', () => {
    const html = renderToStaticMarkup(
      createElement(ExerciseHistory, {
        history: {
          key: 'fixture',
          status: 'success',
          loadingMore: false,
          moreError: false,
          hasMore: true,
          items: [
            {
              workoutId: 'past',
              workoutExerciseId: 'exercise',
              workoutName: '脚の日',
              exerciseName: 'スクワット',
              localDate: '2026-10-11',
              note: 'ゆっくり下ろす',
              overallNote: '睡眠6時間',
              sets: [previous],
            },
          ],
          retry: () => {},
          loadMore: async () => {},
        },
      }),
    );
    expect(html).toContain('セットメモ：2セット目');
    expect(html).toContain('種目メモ：ゆっくり下ろす');
    expect(html).toContain('当日のメモ：睡眠6時間');
    expect(html).toContain('さらに以前の記録を見る');
    expect(html).toContain('target="_blank"');
  });

  it('読み込み失敗を記録なしと混同せず、入力継続と再試行を案内する', () => {
    const html = renderToStaticMarkup(
      createElement(ExerciseHistory, {
        history: {
          key: 'fixture',
          status: 'error',
          items: [],
          hasMore: false,
          loadingMore: false,
          moreError: false,
          retry: () => {},
          loadMore: async () => {},
        },
      }),
    );
    expect(html).toContain('入力は続けられます');
    expect(html).toContain('再試行');
    expect(html).not.toContain('過去の記録はありません');
  });

  it('日付とページの検索条件を既存のGETに付与する', async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json([]),
    );
    await listWorkouts('completed', 31, fetcher, {
      from: '2026-10-14',
      to: '2026-10-14',
      offset: 30,
    });
    const url = new URL(fetcher.mock.calls[0][0] as string, 'http://localhost');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      status: 'completed',
      limit: '31',
      from: '2026-10-14',
      to: '2026-10-14',
      offset: '30',
    });
  });

  it('種目履歴はGETだけを使用し、現在のワークアウトと開始時刻を指定する', async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ items: [], hasMore: false }),
    );
    await getExerciseHistory(
      'bench press',
      {
        beforeDate: '2026-10-14',
        beforeStartedAt: '2026-10-14T08:00:00.000Z',
        excludeWorkoutId: 'current',
        offset: 10,
      },
      fetcher,
    );
    const url = new URL(fetcher.mock.calls[0][0] as string, 'http://localhost');
    expect(url.pathname).toBe('/api/v2/exercises/bench%20press/history');
    expect(url.searchParams.get('beforeStartedAt')).toBe(
      '2026-10-14T08:00:00.000Z',
    );
    expect(url.searchParams.get('excludeWorkoutId')).toBe('current');
    expect(url.searchParams.get('offset')).toBe('10');
  });
});
