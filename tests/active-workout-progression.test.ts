import { describe, expect, it, vi } from 'vitest';
import {
  buildActiveProgressionSummary,
  compareWorkingSet,
  createProgressionRequestCache,
  getPreviousWorkingSets,
} from '@/lib/progression/active-workout';
import {
  evaluateProgression,
  type ExerciseProgressionRecommendation,
  type ProgressionExercisePerformance,
  type ProgressionProfile,
} from '@/lib/progression/engine';
import type { WorkoutExercise, WorkoutSet } from '@/lib/workouts/types';

const timestamp = '2026-09-11T09:00:00.000Z';
const profile: ProgressionProfile = {
  exerciseId: 'ex-bench-press',
  repMin: 8,
  repMax: 10,
  workingSets: 3,
  incrementGrams: 2_500,
  progressionType: 'double_progression',
};

function currentSet(
  position: number,
  overrides: Partial<WorkoutSet> = {},
): WorkoutSet {
  return {
    id: `current-set-${position}`,
    position,
    status: 'planned',
    setType: 'working',
    targetLoadGrams: null,
    targetRepMin: null,
    targetRepMax: null,
    actualLoadGrams: null,
    actualReps: null,
    memo: '',
    completedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function exercise(withTarget = false): WorkoutExercise {
  return {
    id: 'current-exercise',
    exerciseId: profile.exerciseId,
    position: 0,
    status: 'in_progress',
    exerciseNameSnapshot: 'ベンチプレス',
    note: '',
    startedAt: timestamp,
    completedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    sets: Array.from({ length: 3 }, (_, position) =>
      currentSet(
        position,
        withTarget
          ? {
              targetLoadGrams: 100_000,
              targetRepMin: 8,
              targetRepMax: 10,
            }
          : {},
      ),
    ),
  };
}

function performance(reps: number[]): ProgressionExercisePerformance {
  return {
    workoutId: 'previous-workout',
    workoutVersion: 3,
    workoutLocalDate: '2026-09-08',
    workoutUpdatedAt: timestamp,
    workoutStatus: 'completed',
    workoutDeletedAt: null,
    workoutExerciseId: 'previous-exercise',
    exerciseId: profile.exerciseId,
    exerciseStatus: 'completed',
    sets: reps.map((actualReps, position) => ({
      id: `previous-set-${position}`,
      position,
      status: 'completed',
      setType: 'working',
      actualLoadGrams: 100_000,
      actualReps,
      deletedAt: null,
    })),
  };
}

function recommendation(reps: number[]): ExerciseProgressionRecommendation {
  const previous = performance(reps);
  return {
    exerciseId: profile.exerciseId,
    profile,
    performance: previous,
    decision: evaluateProgression(previous, profile),
  };
}

describe('Phase 3B Active Workout progression summary', () => {
  it('A: 前回100kg 10/9/8と今日100kg 8〜10回×3を表示用に構成する', () => {
    const summary = buildActiveProgressionSummary(
      exercise(),
      recommendation([10, 9, 8]),
    );

    expect(summary).toMatchObject({
      previous: {
        localDate: '2026-09-08',
        loadLabel: '100kg',
        repsLabel: '10 / 9 / 8',
      },
      displayedTargetSource: 'suggestion',
      suggestion: {
        loadGrams: 100_000,
        repMin: 8,
        repMax: 10,
        workingSets: 3,
      },
    });
  });

  it('B: 前回10/10/10ならPhase 3Aどおり102.5kgをおすすめする', () => {
    expect(
      buildActiveProgressionSummary(exercise(), recommendation([10, 10, 10])),
    ).toMatchObject({
      displayedTargetSource: 'suggestion',
      suggestion: { loadGrams: 102_500 },
    });
  });

  it('C: 初回種目は前回実績・おすすめ目標なしとして扱う', () => {
    const initial: ExerciseProgressionRecommendation = {
      exerciseId: profile.exerciseId,
      profile,
      performance: null,
      decision: evaluateProgression(null, profile),
    };
    expect(buildActiveProgressionSummary(exercise(), initial)).toMatchObject({
      previous: null,
      suggestion: null,
      displayedTargetSource: 'none',
    });
  });

  it('D: 既存targetを優先しprogression suggestionで上書きしない', () => {
    const current = exercise(true);
    const original = structuredClone(current);
    const summary = buildActiveProgressionSummary(
      current,
      recommendation([10, 10, 10]),
    );

    expect(summary).toMatchObject({
      displayedTargetSource: 'stored',
      storedTarget: { kind: 'uniform', loadGrams: 100_000 },
      suggestion: { loadGrams: 102_500 },
      showSeparateSuggestion: true,
    });
    expect(current).toEqual(original);
  });

  it('E: same-menu copyで保存済みのtargetをそのまま維持する', () => {
    const copiedExercise = exercise(true);
    copiedExercise.id = 'copied-workout-exercise';
    const targetsBefore = copiedExercise.sets.map((set) => ({
      load: set.targetLoadGrams,
      min: set.targetRepMin,
      max: set.targetRepMax,
    }));

    buildActiveProgressionSummary(copiedExercise, recommendation([10, 10, 10]));
    expect(
      copiedExercise.sets.map((set) => ({
        load: set.targetLoadGrams,
        min: set.targetRepMin,
        max: set.targetRepMax,
      })),
    ).toEqual(targetsBefore);
  });

  it('warmupを前回working setの対応順へ混ぜない', () => {
    const result = recommendation([10, 9, 8]);
    result.performance?.sets.unshift({
      id: 'previous-warmup',
      position: -1,
      status: 'completed',
      setType: 'warmup',
      actualLoadGrams: 50_000,
      actualReps: 5,
      deletedAt: null,
    });
    expect(getPreviousWorkingSets(result).map((set) => set.id)).toEqual([
      'previous-set-0',
      'previous-set-1',
      'previous-set-2',
    ]);
  });
});

describe('Phase 3B set comparison', () => {
  it('F: 同重量で9repから10repなら+1repと判定する', () => {
    const previous = performance([9]).sets[0];
    expect(
      compareWorkingSet(
        currentSet(0, {
          status: 'completed',
          actualLoadGrams: 100_000,
          actualReps: 10,
        }),
        previous,
      ),
    ).toEqual({ status: 'above', label: '前回 +1rep' });
  });

  it('G: repが少なくても重量増を優先して判定する', () => {
    const previous = performance([10]).sets[0];
    expect(
      compareWorkingSet(
        currentSet(0, {
          status: 'completed',
          actualLoadGrams: 102_500,
          actualReps: 8,
        }),
        previous,
      ),
    ).toEqual({
      status: 'above',
      label: '前回より重量 +2.5kg · 回数 -2回（重量と回数をあわせて確認）',
    });
  });

  it('同値・低下・未完了を区別する', () => {
    const previous = performance([10]).sets[0];
    expect(
      compareWorkingSet(
        currentSet(0, {
          status: 'completed',
          actualLoadGrams: 100_000,
          actualReps: 10,
        }),
        previous,
      ),
    ).toEqual({ status: 'equal', label: '前回同等' });
    expect(
      compareWorkingSet(
        currentSet(0, {
          status: 'completed',
          actualLoadGrams: 100_000,
          actualReps: 8,
        }),
        previous,
      ),
    ).toEqual({ status: 'below', label: '前回 -2rep' });
    expect(compareWorkingSet(currentSet(0), previous)).toEqual({
      status: 'unavailable',
      label: null,
    });
  });
});

describe('Phase 3B non-blocking request cache', () => {
  it('H: 遅いprogression取得を待たず既存入力状態を利用できる', async () => {
    let resolve!: (value: ExerciseProgressionRecommendation) => void;
    const loader = vi.fn(
      () =>
        new Promise<ExerciseProgressionRecommendation>((done) => {
          resolve = done;
        }),
    );
    const cache = createProgressionRequestCache(loader);
    const editableExercise = exercise();
    const request = cache.get(profile.exerciseId);

    editableExercise.sets[0].actualLoadGrams = 100_000;
    editableExercise.sets[0].actualReps = 8;
    expect(editableExercise.sets[0]).toMatchObject({
      actualLoadGrams: 100_000,
      actualReps: 8,
    });
    expect(loader).toHaveBeenCalledOnce();

    resolve(recommendation([10, 9, 8]));
    await expect(request).resolves.toMatchObject({
      exerciseId: profile.exerciseId,
    });
  });

  it('I/J: API失敗・offline相当でも記録データを変更せず再試行可能にする', async () => {
    const offline = vi
      .fn<(exerciseId: string) => Promise<ExerciseProgressionRecommendation>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(recommendation([10, 9, 8]));
    const cache = createProgressionRequestCache(offline);
    const editableExercise = exercise();
    editableExercise.sets[0] = currentSet(0, {
      status: 'completed',
      actualLoadGrams: 100_000,
      actualReps: 8,
      completedAt: timestamp,
    });

    await expect(cache.get(profile.exerciseId)).rejects.toThrow('offline');
    expect(editableExercise.sets[0]).toMatchObject({
      status: 'completed',
      actualLoadGrams: 100_000,
      actualReps: 8,
    });
    cache.invalidate(profile.exerciseId);
    await expect(cache.get(profile.exerciseId)).resolves.toMatchObject({
      exerciseId: profile.exerciseId,
    });
  });

  it('同一workout内の同一exercise取得を共有する', () => {
    const loader = vi.fn(async () => recommendation([10, 9, 8]));
    const cache = createProgressionRequestCache(loader);
    const first = cache.get(profile.exerciseId);
    const second = cache.get(profile.exerciseId);

    expect(first).toBe(second);
    expect(loader).toHaveBeenCalledOnce();
  });
});
