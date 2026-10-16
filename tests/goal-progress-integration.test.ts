import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  HomeGoalProgress,
  WorkoutGoalProgress,
} from '@/components/goals/goal-progress-summary';
import { createWorkoutExercise } from '@/lib/workouts/draft';
import { useGoalProgress } from '@/hooks/use-goal-progress';
import type { TrainingGoal } from '@/lib/goals/model';
import type { AnalyticsSnapshot } from '@/lib/analytics/model';
vi.mock('@/hooks/use-goal-progress', () => ({ useGoalProgress: vi.fn() }));
const goal: TrainingGoal = {
  id: 'g',
  exerciseId: 'bench',
  exerciseName: 'ベンチプレス',
  bodyPart: '胸',
  startDate: '2026-10-01',
  deadline: '2027-01-01',
  startLoadGrams: 50000,
  targetLoadGrams: 80000,
  targetReps: 8,
  incrementGrams: 2500,
  status: 'active',
  note: '',
  updatedAt: 'v1',
};
const exercise = () =>
  createWorkoutExercise(
    {
      id: 'bench',
      name: 'ベンチプレス',
      normalizedName: 'bench',
      bodyPart: '胸',
      measurementType: 'weight_reps',
      defaultRepMin: 8,
      defaultRepMax: 10,
      defaultWorkingSets: 1,
      defaultIncrementGrams: 2500,
      defaultRestSeconds: 90,
    },
    0,
  );
const data = {
  exercises: [
    {
      exerciseId: 'bench',
      repTrend: [
        {
          workoutId: 'old',
          localDate: '2026-10-15',
          loadGrams: 60000,
          bestReps: 8,
        },
      ],
    },
  ],
} as AnalyticsSnapshot;
beforeEach(() =>
  vi.mocked(useGoalProgress).mockReturnValue({
    goals: [goal],
    data,
    error: false,
    storageError: false,
    today: '2026-10-16',
    retry: vi.fn(),
  }),
);
describe('goal progress in home and recording', () => {
  it('home shows achieved percentage with a direct goal dashboard link', () => {
    const html = renderToStaticMarkup(createElement(HomeGoalProgress));
    expect(html).toContain('75%');
    expect(html).toContain('href="/goals"');
    expect(html).toContain('現在 72kg ÷ 目標 96kg');
  });
  it('recording separates saved progress from unsaved completed sets', () => {
    const e = exercise();
    e.sets[0] = {
      ...e.sets[0],
      status: 'completed',
      actualLoadGrams: 80000,
      actualReps: 8,
    };
    const html = renderToStaticMarkup(
      createElement(WorkoutGoalProgress, {
        exercise: e,
        localDate: '2026-10-16',
        workoutId: 'now',
      }),
    );
    expect(html).toContain('保存済みの達成度');
    expect(html).toContain('75%');
    expect(html).toContain('今回の完了セットを含む見込み（RM換算）：100%');
    expect(html).toContain('ワークアウト保存前');
    expect(html).toContain('2026-10-31');
  });
  it('uncompleted or insufficient-rep sets cannot satisfy the goal', () => {
    const e = exercise();
    e.sets[0] = { ...e.sets[0], actualLoadGrams: 100000, actualReps: 1 };
    expect(
      renderToStaticMarkup(
        createElement(WorkoutGoalProgress, {
          exercise: e,
          localDate: '2026-10-16',
          workoutId: 'now',
        }),
      ),
    ).not.toContain('見込み');
    e.sets[0].status = 'completed';
    expect(
      renderToStaticMarkup(
        createElement(WorkoutGoalProgress, {
          exercise: e,
          localDate: '2026-10-16',
          workoutId: 'now',
        }),
      ),
    ).not.toContain('目標条件を達成');
  });
  it('does not double paired load or treat the stronger side as both sides', () => {
    const e = exercise();
    e.sets[0] = {
      ...e.sets[0],
      status: 'completed',
      loadBasis: 'paired_total',
      actualLoadGrams: 160000,
      actualReps: 7,
      actualRepsLeft: 8,
      actualRepsRight: 7,
    };
    const html = renderToStaticMarkup(
      createElement(WorkoutGoalProgress, {
        exercise: e,
        localDate: '2026-10-16',
        workoutId: 'now',
      }),
    );
    expect(html).not.toContain('目標条件を達成');
    e.sets[0].actualRepsRight = 8;
    e.sets[0].actualReps = 8;
    expect(
      renderToStaticMarkup(
        createElement(WorkoutGoalProgress, {
          exercise: e,
          localDate: '2026-10-16',
          workoutId: 'now',
        }),
      ),
    ).toContain('目標条件を達成');
  });
  it('does not present failed loads as zero progress', () => {
    vi.mocked(useGoalProgress).mockReturnValue({
      goals: [goal],
      data: null,
      error: true,
      storageError: false,
      today: '2026-10-16',
      retry: vi.fn(),
    });
    const html = renderToStaticMarkup(
      createElement(WorkoutGoalProgress, {
        exercise: exercise(),
        localDate: '2026-10-16',
        workoutId: 'now',
      }),
    );
    expect(html).toContain('進捗を取得できません');
    expect(html).not.toContain('0%');
  });
});
