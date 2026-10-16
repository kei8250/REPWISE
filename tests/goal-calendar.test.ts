import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WorkoutCalendar,
  goalsOnDate,
} from '@/components/workouts/workout-calendar';
import { useSavedGoals } from '@/hooks/use-goal-progress';
import type { TrainingGoal } from '@/lib/goals/model';
vi.mock('@/hooks/use-goal-progress', () => ({ useSavedGoals: vi.fn() }));
vi.mock('@/hooks/use-local-today', () => ({
  useLocalToday: () => '2026-10-16',
}));
const goal: TrainingGoal = {
  id: 'squat',
  exerciseId: 'squat',
  exerciseName: 'バックスクワット',
  bodyPart: '脚',
  startDate: '2026-10-01',
  deadline: '2026-10-20',
  startLoadGrams: 160000,
  targetLoadGrams: 180000,
  targetReps: 1,
  incrementGrams: 2500,
  status: 'active',
  note: '',
  updatedAt: 'v1',
};
beforeEach(() =>
  vi.mocked(useSavedGoals).mockReturnValue({ goals: [goal], error: false }),
);
describe('goal dates in the training calendar', () => {
  it('shows target-only days as enabled and labels the goal without requiring training records', () => {
    const html = renderToStaticMarkup(createElement(WorkoutCalendar));
    expect(html).toContain('バックスクワットの目標日');
    expect(html).toContain('黄色い点は目標日');
    expect(html).toContain('次の目標日へ（2026-10-20）');
    expect(html).toContain('表示月の目標日');
    const day = html.match(
      /<button[^>]*aria-label="[^"]*バックスクワットの目標日[^"]*"[^>]*>/,
    )?.[0];
    expect(day).toBeDefined();
    expect(day).not.toMatch(/\sdisabled(?:=|[\s>])/);
  });
  it('retains multiple goals on the same day and paused goals, excluding archived goals', () => {
    expect(
      goalsOnDate(
        [
          goal,
          { ...goal, id: 'paused', status: 'paused' },
          { ...goal, id: 'archived', status: 'archived' },
          { ...goal, id: 'other', deadline: '2026-11-01' },
        ],
        '2026-10-20',
      ).map((g) => g.id),
    ).toEqual(['squat', 'paused']);
  });
  it('reports unreadable storage and still renders the training calendar', () => {
    vi.mocked(useSavedGoals).mockReturnValue({ goals: [], error: true });
    const html = renderToStaticMarkup(createElement(WorkoutCalendar));
    expect(html).toContain('目標日を読み込めません');
    expect(html).toContain('トレーニングカレンダー');
  });
});
