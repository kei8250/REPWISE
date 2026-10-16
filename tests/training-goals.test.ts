import { describe, expect, it, vi } from 'vitest';
import {
  addMonths,
  goalProgress,
  validateGoal,
  type TrainingGoal,
} from '@/lib/goals/model';
import {
  mergeGoals,
  parseGoals,
  saveGoal,
  serializeGoals,
} from '@/lib/goals/storage';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import GoalsPage from '@/app/goals/page';

vi.mock('next/navigation', () => ({ usePathname: () => '/goals' }));

const goal: TrainingGoal = {
  id: 'goal1',
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
const point = (
  loadGrams: number,
  bestReps: number,
  localDate = '2026-10-16',
) => ({ workoutId: localDate, localDate, loadGrams, bestReps });
const store = () => {
  let value: string | null = null;
  return {
    getItem: (_: string) => value,
    setItem: (_: string, next: string) => {
      value = next;
    },
  };
};

describe('training goals and calendar planning', () => {
  it('supports 3/6/12 month deadlines with month-end clamping and leap years', () => {
    expect(addMonths('2026-10-31', 3)).toBe('2027-01-31');
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2024-02-29', 12)).toBe('2025-02-28');
    expect(addMonths('2027-11-30', 3)).toBe('2028-02-29');
  });
  it('requires BOTH target weight and target reps, ignoring old or future records', () => {
    const progress = goalProgress(
      goal,
      [
        point(80000, 1),
        point(60000, 8),
        point(100000, 10, '2026-09-30'),
        point(100000, 8, '2026-11-01'),
      ],
      '2026-10-16',
    );
    expect(progress.currentLoadGrams).toBe(60000);
    expect(progress.percent).toBe(33);
    expect(progress.achieved).toBe(false);
    expect(progress.remainingGrams).toBe(20000);
    expect(goalProgress(goal, [point(80000, 8)], '2026-10-16').achieved).toBe(
      true,
    );
  });
  it('shows baseline when unrecorded, never declares manual baseline achievement', () => {
    const result = goalProgress(goal, [], '2026-10-16');
    expect(result.actual).toBeNull();
    expect(result.percent).toBe(0);
    expect(result.currentLoadGrams).toBe(50000);
    expect(result.achieved).toBe(false);
  });
  it('calculates monthly weights in configured increments with an exact final goal', () => {
    const result = goalProgress(goal, [point(55000, 8)], '2026-10-16');
    expect(result.milestone).toEqual({ date: '2026-10-31', loadGrams: 60000 });
    expect(result.monthlyIncreaseGrams).toBe(5000);
    expect(result.checkpoints.at(-1)).toEqual({
      date: '2027-01-01',
      loadGrams: 80000,
    });
    expect(result.checkpoints.every((p) => p.loadGrams <= 80000)).toBe(true);
    expect(new Set(result.checkpoints.map((p) => p.date)).size).toBe(
      result.checkpoints.length,
    );
  });
  it('handles overdue goals, caps progress and allows month-end deadlines', () => {
    const late = goalProgress(goal, [], '2027-02-01');
    expect(late.overdue).toBe(true);
    expect(late.daysLeft).toBe(0);
    expect(goalProgress(goal, [point(100000, 8)], '2026-10-16').percent).toBe(
      100,
    );
    const monthEnd = goalProgress(
      { ...goal, startDate: '2026-10-31', deadline: '2027-01-31' },
      [],
      '2026-11-01',
    );
    expect(monthEnd.milestone.date).toBe('2026-11-30');
    expect(monthEnd.checkpoints.at(-1)?.date).toBe('2027-01-31');
  });
  it('rejects invalid dates and impossible goals rather than dividing by zero', () => {
    for (const change of [
      { deadline: goal.startDate },
      { deadline: '2027-02-30' },
      { targetLoadGrams: 50000 },
      { targetReps: 0 },
      { incrementGrams: 0 },
      { targetLoadGrams: Infinity },
    ])
      expect(() => validateGoal({ ...goal, ...change })).toThrow();
  });
});

describe('goal persistence and safe handoff', () => {
  it('roundtrips backups including paused and archived states', () => {
    expect(parseGoals(serializeGoals([goal]))).toEqual([goal]);
    expect(parseGoals(null)).toEqual([]);
    expect(
      parseGoals(serializeGoals([{ ...goal, status: 'archived' }]))[0].status,
    ).toBe('archived');
    expect(() => parseGoals('{"version":2,"goals":[]}')).toThrow();
    expect(() => parseGoals(serializeGoals([goal, goal]))).toThrow();
    expect(() => parseGoals('{"version":1,"goals":[null]}')).toThrow();
  });
  it('preserves other goals and rejects stale writes and duplicate active exercise goals', () => {
    const storage = store();
    saveGoal(goal, undefined, storage);
    saveGoal({ ...goal, id: 'g2', exerciseId: 'row' }, undefined, storage);
    expect(() =>
      saveGoal({ ...goal, updatedAt: 'v2' }, 'wrong', storage),
    ).toThrow('別の画面');
    expect(() => saveGoal({ ...goal, id: 'g3' }, undefined, storage)).toThrow(
      '管理中',
    );
    saveGoal({ ...goal, status: 'paused', updatedAt: 'v2' }, 'v1', storage);
    expect(parseGoals(storage.getItem(''))).toHaveLength(2);
    saveGoal({ ...goal, status: 'archived', updatedAt: 'v3' }, 'v2', storage);
    saveGoal({ ...goal, id: 'g3' }, undefined, storage);
    expect(parseGoals(storage.getItem(''))).toHaveLength(3);
  });
  it('merges backups without overwriting existing IDs and aborts conflicts atomically', () => {
    const storage = store();
    saveGoal(goal, undefined, storage);
    expect(mergeGoals([{ ...goal, note: 'older copy' }], storage)[0].note).toBe(
      '',
    );
    expect(() => mergeGoals([{ ...goal, id: 'different' }], storage)).toThrow();
    expect(parseGoals(storage.getItem(''))).toEqual([goal]);
    expect(
      mergeGoals([{ ...goal, id: 'new', exerciseId: 'row' }], storage),
    ).toHaveLength(2);
  });
  it('does not destroy malformed or unavailable storage', () => {
    const storage = store();
    storage.setItem('', 'broken');
    expect(() => saveGoal(goal, undefined, storage)).toThrow();
    expect(storage.getItem('')).toBe('broken');
    expect(() =>
      saveGoal(goal, undefined, {
        getItem: () => null,
        setItem: () => {
          throw new Error('quota');
        },
      }),
    ).toThrow('quota');
  });
  it('provides the goal page, offline storage disclosure and backup controls', () => {
    const html = renderToStaticMarkup(createElement(GoalsPage));
    expect(html).toContain('目標と進捗');
    expect(html).toContain('目標を追加');
    expect(html).toContain('端末間では同期されません');
    expect(html).toContain('JSONを書き出す');
  });
});
