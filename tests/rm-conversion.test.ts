import { describe, expect, it } from 'vitest';
import { estimateRm, equivalentRmLoad, defaultRmMethod } from '@/lib/goals/rm';
import { goalProgress, type TrainingGoal } from '@/lib/goals/model';
import { parseGoals, serializeGoals } from '@/lib/goals/storage';
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
const point = (
  loadGrams: number,
  bestReps: number,
  localDate = '2026-10-16',
) => ({ workoutId: localDate, localDate, loadGrams, bestReps });
describe('shared exercise-specific RM conversion', () => {
  it('uses coefficient 40 for bench and 33.3 for squat/deadlift, preserving measured singles', () => {
    expect(estimateRm(80000, 10, 'bench')).toBe(100000);
    expect(estimateRm(80000, 10, 'squat_deadlift')).toBeCloseTo(
      80000 * (1 + 10 / 33.3),
    );
    expect(estimateRm(80000, 1, 'bench')).toBe(80000);
    expect(estimateRm(80000, 1, 'squat_deadlift')).toBe(80000);
    for (const method of ['bench', 'squat_deadlift'] as const)
      for (let reps = 1; reps <= 12; reps++)
        expect(
          equivalentRmLoad(estimateRm(80000, reps, method)!, reps, method),
        ).toBeCloseTo(80000);
  });
  it('compares the full weight AND reps goal, independent of the manually entered starting value', () => {
    const result = goalProgress(goal, [point(60000, 12)], '2026-10-16');
    expect(result.currentRmGrams).toBe(78000);
    expect(result.targetRmGrams).toBe(96000);
    expect(result.percent).toBe(81.3);
    expect(
      goalProgress(
        { ...goal, startLoadGrams: 10000 },
        [point(60000, 12)],
        '2026-10-16',
      ).percent,
    ).toBe(81.3);
    expect(
      goalProgress({ ...goal, targetReps: 1 }, [point(60000, 12)], '2026-10-16')
        .percent,
    ).toBe(97.5);
  });
  it('distinguishes conversion threshold from actual target achievement', () => {
    const result = goalProgress(goal, [point(75000, 12)], '2026-10-16');
    expect(result.percent).toBe(101.6);
    expect(result.barPercent).toBe(100);
    expect(result.estimatedReached).toBe(true);
    expect(result.achieved).toBe(false);
    expect(goalProgress(goal, [point(80000, 8)], '2026-10-16').achieved).toBe(
      true,
    );
  });
  it('does not extrapolate invalid or high-rep performances or fabricate progress', () => {
    for (const r of [0, -1, 1.5, 13, 100, NaN, Infinity])
      expect(estimateRm(60000, r, 'bench')).toBeNull();
    for (const load of [0, -1, NaN, Infinity])
      expect(estimateRm(load, 8, 'bench')).toBeNull();
    expect(
      goalProgress(goal, [point(80000, 13)], '2026-10-16').percent,
    ).toBeNull();
    const high = goalProgress(
      { ...goal, targetReps: 13 },
      [point(80000, 13)],
      '2026-10-16',
    );
    expect(high.percent).toBeNull();
    expect(high.achieved).toBe(true);
    expect(goalProgress(goal, [], '2026-10-16').percent).toBeNull();
  });
  it('uses one shared method for both sides, and preserves old goals on read', () => {
    const before = serializeGoals([goal]);
    expect(parseGoals(before)[0].rmMethod).toBeUndefined();
    expect(serializeGoals(parseGoals(before))).toBe(before);
    expect(defaultRmMethod('Bench press')).toBe('bench');
    expect(defaultRmMethod('スクワット')).toBe('squat_deadlift');
    const a = goalProgress(
      { ...goal, rmMethod: 'squat_deadlift' },
      [point(60000, 12)],
      '2026-10-16',
    );
    expect(a.percent).toBe(
      Math.round(
        (estimateRm(60000, 12, 'squat_deadlift')! /
          estimateRm(80000, 8, 'squat_deadlift')!) *
          1000,
      ) / 10,
    );
  });
});

it('includes pre-goal squat records and converts them into the target rep count', () => {
  const squat: TrainingGoal = {
    ...goal,
    exerciseName: 'バックスクワット',
    rmMethod: 'squat_deadlift',
    targetLoadGrams: 180000,
    targetReps: 1,
  };
  const records = [
    point(160000, 3, '2026-09-10'),
    point(250000, 3, '2026-11-01'),
  ];
  const single = goalProgress(squat, records, '2026-10-16');
  expect(single.actual?.localDate).toBe('2026-09-10');
  expect(single.currentLoadGrams).toBeCloseTo(174414.4144, 3);
  expect(single.percent).toBe(96.9);
  const five = goalProgress(
    { ...squat, targetLoadGrams: 170000, targetReps: 5 },
    records,
    '2026-10-16',
  );
  expect(five.currentLoadGrams).toBeCloseTo(
    (160000 * (1 + 3 / 33.3)) / (1 + 5 / 33.3),
  );
  expect(five.percent).toBe(89.2);
  expect(five.achieved).toBe(false);
  expect(
    goalProgress(squat, [point(180000, 1, '2026-09-10')], '2026-10-16')
      .achieved,
  ).toBe(true);
});
