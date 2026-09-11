import { describe, expect, it } from 'vitest';
import {
  calculateE1rmGrams,
  E1RM_MAX_REPS,
  evaluatePersonalRecords,
  type PersonalRecordPerformance,
} from '@/lib/progression/personal-records';
import type { ProgressionPerformanceSet } from '@/lib/progression/engine';

function set(
  id: string,
  loadGrams: number,
  reps: number,
  overrides: Partial<ProgressionPerformanceSet> = {},
): ProgressionPerformanceSet {
  return {
    id,
    position: Number(id.replace(/\D/g, '')) || 0,
    status: 'completed',
    setType: 'working',
    actualLoadGrams: loadGrams,
    actualReps: reps,
    deletedAt: null,
    ...overrides,
  };
}

function performance(
  workoutId: string,
  sets: ProgressionPerformanceSet[],
): PersonalRecordPerformance {
  return { workoutId, exerciseId: 'ex-bench-press', sets };
}

describe('Phase 3C-2 personal record evaluation', () => {
  it('A: 過去100kgに対する今回102.5kgをWeight PRにする', () => {
    const result = evaluatePersonalRecords(
      performance('current', [set('c1', 102_500, 5)]),
      [performance('previous', [set('p1', 100_000, 10)])],
    );
    expect(result.achieved.weight).toBe(true);
  });

  it('B: 過去102.5kgに対する今回100kgはWeight PRにしない', () => {
    const result = evaluatePersonalRecords(
      performance('current', [set('c1', 100_000, 10)]),
      [performance('previous', [set('p1', 102_500, 5)])],
    );
    expect(result.achieved.weight).toBe(false);
  });

  it('C: 同じ100kgで9repから10repならRep PRにする', () => {
    const result = evaluatePersonalRecords(
      performance('current', [set('c1', 100_000, 10)]),
      [performance('previous', [set('p1', 100_000, 9)])],
    );
    expect(result.achieved.reps).toBe(true);
  });

  it('D: 異なる重量同士のrepを単純比較しない', () => {
    const result = evaluatePersonalRecords(
      performance('current', [set('c1', 100_000, 10)]),
      [performance('previous', [set('p1', 90_000, 15)])],
    );
    expect(result.achieved.reps).toBe(false);
  });

  it('E: Epley式で100kg×8より100kg×10をe1RM PRにする', () => {
    const result = evaluatePersonalRecords(
      performance('current', [set('c1', 100_000, 10)]),
      [performance('previous', [set('p1', 100_000, 8)])],
    );
    expect(calculateE1rmGrams(100_000, 10)).toBeCloseTo(133_333.3333);
    expect(result.achieved.e1rm).toBe(true);
  });

  it(`F: ${E1RM_MAX_REPS}rep超はe1RM計算・PRから除外する`, () => {
    const result = evaluatePersonalRecords(
      performance('current', [set('c1', 100_000, 13)]),
      [performance('previous', [set('p1', 100_000, 12)])],
    );
    expect(result.current.maxE1rmGrams).toBeNull();
    expect(result.e1rmExcludedHighRepSetCount).toBe(1);
    expect(result.achieved.e1rm).toBe(false);
  });

  it('G: 1 workout内exercise合計2700kgから3000kgをVolume PRにする', () => {
    const result = evaluatePersonalRecords(
      performance('current', [
        set('c1', 100_000, 10),
        set('c2', 100_000, 10),
        set('c3', 100_000, 10),
      ]),
      [
        performance('previous', [
          set('p1', 100_000, 10),
          set('p2', 100_000, 9),
          set('p3', 100_000, 8),
        ]),
      ],
    );
    expect(result.current.totalVolumeGramReps).toBe(3_000_000);
    expect(result.previousBest.maxVolumeGramReps).toBe(2_700_000);
    expect(result.achieved.volume).toBe(true);
  });

  it('H: 過去履歴なしは初回記録として全PRをfalseにする', () => {
    const result = evaluatePersonalRecords(
      performance('current', [set('c1', 100_000, 10)]),
      [],
    );
    expect(result).toMatchObject({
      status: 'first_record',
      achieved: { weight: false, reps: false, e1rm: false, volume: false },
    });
  });

  it('L: warmupは全PR指標から除外する', () => {
    const result = evaluatePersonalRecords(
      performance('current', [
        set('warmup', 200_000, 10, { setType: 'warmup' }),
        set('c1', 100_000, 8),
      ]),
      [performance('previous', [set('p1', 100_000, 8)])],
    );
    expect(result.current.maxLoadGrams).toBe(100_000);
    expect(result.achieved.weight).toBe(false);
  });

  it('M: 未完了setは全PR指標から除外する', () => {
    const result = evaluatePersonalRecords(
      performance('current', [
        set('planned', 200_000, 10, { status: 'planned' }),
        set('c1', 100_000, 8),
      ]),
      [performance('previous', [set('p1', 100_000, 8)])],
    );
    expect(result.current.maxLoadGrams).toBe(100_000);
    expect(result.achieved.weight).toBe(false);
  });
});
