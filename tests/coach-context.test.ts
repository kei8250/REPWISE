import { describe, expect, it } from 'vitest';
import {
  buildAnalytics,
  type BuildAnalyticsInput,
  type AnalyticsExerciseHistoryInput,
  type AnalyticsAcceptedTargetInput,
} from '@/lib/analytics/engine';
import { buildCoachContext } from '@/lib/coach/context';
import {
  COACH_CONTEXT_LIMITS as limits,
  type ProposedAction,
} from '@/lib/coach/model';
import type { Workout } from '@/lib/workouts/types';

function history(
  id: string,
  date: string,
  reps = 10,
  exerciseId = 'bench',
): AnalyticsExerciseHistoryInput {
  return {
    exerciseName: 'ベンチプレス',
    bodyPart: '胸',
    profile: {
      exerciseId,
      repMin: 8,
      repMax: 10,
      workingSets: 1,
      incrementGrams: 2500,
      progressionType: 'double_progression',
    },
    performance: {
      workoutId: id,
      workoutVersion: 1,
      workoutLocalDate: date,
      workoutUpdatedAt: `${date}T00:00:00Z`,
      workoutStatus: 'completed',
      workoutDeletedAt: null,
      workoutExerciseId: `${id}-${exerciseId}`,
      exerciseId,
      exerciseStatus: 'completed',
      sets: [
        {
          id: `${id}-set`,
          position: 0,
          status: 'completed',
          setType: 'working',
          actualLoadGrams: 100000,
          actualReps: reps,
          deletedAt: null,
        },
      ],
    },
  };
}
function input(
  histories = [
    history('a', '2026-09-01', 8),
    history('b', '2026-09-02', 9),
    history('c', '2026-09-03', 10),
  ],
): BuildAnalyticsInput {
  return {
    range: '30d',
    today: '2026-09-15',
    generatedAt: '2026-09-15T00:00:00Z',
    workouts: [
      ...new Map(
        histories.map((h) => [
          h.performance.workoutId,
          {
            id: h.performance.workoutId,
            localDate: h.performance.workoutLocalDate,
          },
        ]),
      ).values(),
    ],
    exerciseHistory: histories,
    acceptedTargets: [],
  };
}
function target(
  overrides: Partial<AnalyticsAcceptedTargetInput> = {},
): AnalyticsAcceptedTargetInput {
  return {
    id: 't',
    exerciseId: 'bench',
    sourceWorkoutId: 'c',
    sourceWorkoutVersion: 1,
    sourceCurrentVersion: 1,
    sourceWorkoutStatus: 'completed',
    sourceLocalDate: '2026-09-03',
    acceptedAt: '2026-09-04T00:00:00Z',
    updatedAt: '2026-09-04T00:00:00Z',
    sourceDeletedAt: null,
    status: 'accepted',
    appliedWorkoutId: null,
    appliedWorkoutStatus: null,
    appliedWorkoutDeletedAt: null,
    targetLoadGrams: 102500,
    targetRepMin: 8,
    targetRepMax: 10,
    targetWorkingSets: 1,
    ...overrides,
  };
}
function context(data = input()) {
  return buildCoachContext(data, buildAnalytics(data));
}

describe('Phase 5A bounded coach context', () => {
  it('A: recent workouts retain actuals and completion in newest-first order', () => {
    const result = context();
    expect(result.recentWorkouts.map((w) => w.source.workoutId)).toEqual([
      'c',
      'b',
      'a',
    ]);
    expect(result.recentWorkouts[0].exercises[0].sets[0]).toMatchObject({
      actualLoadGrams: 100000,
      actualReps: 10,
      completed: true,
      target: null,
    });
    expect(result.trainingSummary).toMatchObject({
      completedWorkoutCount: 3,
      trainingDays: 3,
      workingSets: 3,
    });
  });
  it('B: progression and stagnation are existing results, not new judgments', () => {
    const data = input();
    const snapshot = buildAnalytics(data);
    const result = buildCoachContext(data, snapshot);
    expect(result.exercises[0].progression).toEqual(
      snapshot.exercises[0].progression,
    );
    expect(result.exercises[0].stagnation).toEqual(
      snapshot.exercises[0].stagnation,
    );
    expect(result.exercises[0].stagnationSources).toHaveLength(3);
    result.exercises[0].progression.status = 'keep_load';
    expect(snapshot.exercises[0].progression.status).toBe('increase_load');
  });
  it('C: PR/e1RM use Analytics values and initial record is not a PR', () => {
    const data = input();
    const snapshot = buildAnalytics(data);
    const result = buildCoachContext(data, snapshot);
    expect(
      result.exercises[0].latestPR.map(({ source: _source, ...pr }) => pr),
    ).toEqual(
      [...snapshot.exercises[0].personalRecordHistory]
        .sort((a, b) => b.localDate.localeCompare(a.localDate))
        .slice(0, 3),
    );
    expect(result.exercises[0].e1rmTrend.map((p) => p.valueGrams)).toEqual(
      snapshot.exercises[0].e1rmTrend.map((p) => p.value),
    );
    expect(
      context(input([history('first', '2026-09-01')])).exercises[0].latestPR,
    ).toEqual([]);
  });
  it('D/E: only valid unused accepted target is exposed; stale is review-only', () => {
    const data = input();
    data.acceptedTargets = [target()];
    expect(context(data).exercises[0].acceptedNextTarget?.targetLoadGrams).toBe(
      102500,
    );
    data.exerciseHistory[2].performance.workoutVersion = 2;
    data.acceptedTargets[0].sourceCurrentVersion = 2;
    expect(context(data).exercises[0]).toMatchObject({
      acceptedNextTarget: null,
      availability: { acceptedTarget: 'stale' },
      targetNeedsReview: {
        acceptedSourceVersion: 1,
        source: { workoutVersion: 2 },
      },
    });
    for (const t of [
      target({ status: 'superseded' }),
      target({ status: 'applied', appliedWorkoutId: 'c' }),
      target({ sourceDeletedAt: '2026-09-05' }),
      target({ sourceWorkoutStatus: 'active' }),
    ]) {
      data.acceptedTargets = [t];
      expect(
        context(data).exercises.every((e) => e.acceptedNextTarget === null),
      ).toBe(true);
    }
  });
  it('F: no history and missing trends are explicit, not false stagnation', () => {
    expect(context(input([]))).toMatchObject({
      trainingSummary: { availability: 'no_history' },
      exercises: [],
      insights: { status: 'insufficient_data' },
    });
    const result = context(input([history('a', '2026-09-01', 15)]));
    expect(result.exercises[0].availability).toMatchObject({
      e1rmTrend: 'missing_trend',
      stagnation: 'insufficient_data',
    });
    expect(result.exercises[0].stagnation.status).toBe('insufficient_data');
  });
  it('G: deleted, incomplete, warmup, invalid actuals do not enter recent performance', () => {
    const data = input();
    data.exerciseHistory[0].performance.workoutDeletedAt = '2026-09-05';
    data.exerciseHistory[1].performance.sets[0].setType = 'warmup';
    data.exerciseHistory[2].performance.sets[0].status = 'planned';
    expect(context(data).recentWorkouts).toEqual([]);
    for (const change of [
      'incomplete_workout',
      'incomplete_exercise',
      'deleted_set',
      'invalid_actual',
    ]) {
      const data2 = input([history('a', '2026-09-01')]);
      const p = data2.exerciseHistory[0].performance;
      if (change === 'incomplete_workout') p.workoutStatus = 'active';
      if (change === 'incomplete_exercise') p.exerciseStatus = 'in_progress';
      if (change === 'deleted_set') p.sets[0].deletedAt = '2026-09-05';
      if (change === 'invalid_actual') p.sets[0].actualReps = null;
      expect(context(data2).recentWorkouts).toEqual([]);
    }
  });
  it('H: regenerated context reflects edits, delete and restore without a cache', () => {
    const data = input();
    expect(context(data).exercises[0].progression.status).toBe('increase_load');
    data.exerciseHistory[2].performance.sets[0].actualReps = 8;
    data.exerciseHistory[2].performance.workoutVersion = 2;
    expect(context(data).exercises[0].progression.status).toBe('keep_load');
    data.exerciseHistory[2].performance.workoutDeletedAt = '2026-09-05';
    expect(context(data).recentWorkouts[0].source.workoutId).toBe('b');
    data.exerciseHistory[2].performance.workoutDeletedAt = null;
    expect(context(data).recentWorkouts[0].source.workoutVersion).toBe(2);
  });
  it('I: performance, PR, trends and progression retain source references', () => {
    const result = context();
    const ref = {
      workoutId: 'c',
      workoutVersion: 1,
      localDate: '2026-09-03',
      exerciseId: 'bench',
      workoutExerciseId: 'c-bench',
    };
    expect(result.exercises[0].progressionSource).toEqual(ref);
    expect(result.exercises[0].e1rmTrend.at(-1)?.source).toEqual(ref);
    expect(result.exercises[0].latestPR[0].source).toEqual(ref);
    expect(
      result.insights.items.every(
        (i) => i.sources.length > 0 || i.evidenceScope === 'period_aggregate',
      ),
    ).toBe(true);
  });
  it('J: count/text/UTF-8 byte budgets are bounded and input is not mutated', () => {
    const histories = Array.from({ length: 15 }, (_, w) =>
      Array.from({ length: 15 }, (_, e) => {
        const h = history(
          `w${w}`,
          `2026-09-${String(w + 1).padStart(2, '0')}`,
          10,
          `e${e}`,
        );
        h.exerciseName = '名'.repeat(1000);
        h.performance.sets = Array.from({ length: 12 }, (_, s) => ({
          ...h.performance.sets[0],
          id: `w${w}-e${e}-s${s}`,
          position: s,
        }));
        return h;
      }),
    ).flat();
    const result = context(input(histories));
    expect(result.recentWorkouts.length).toBeLessThanOrEqual(
      limits.recentWorkouts,
    );
    expect(result.exercises.length).toBeLessThanOrEqual(limits.exercises);
    for (const w of result.recentWorkouts) {
      expect(w.exercises.length).toBeLessThanOrEqual(
        limits.exercisesPerWorkout,
      );
      for (const e of w.exercises)
        expect(e.sets.length).toBeLessThanOrEqual(limits.setsPerExercise);
    }
    for (const e of result.exercises) {
      expect(e.e1rmTrend.length).toBeLessThanOrEqual(limits.trendPoints);
      expect(e.latestPR.length).toBeLessThanOrEqual(limits.personalRecords);
      expect(e.name.length).toBeLessThanOrEqual(limits.textCharacters);
    }
    expect(
      new TextEncoder().encode(JSON.stringify(result)).length,
    ).toBeLessThanOrEqual(limits.serializedBytes);
    expect(result.truncation.byteBudgetApplied).toBe(true);
    expect(histories[0].exerciseName.length).toBe(1000);
  });
  it('K: ProposedAction is a proposal only and context grants no execution/recalculation', () => {
    const proposal: ProposedAction = {
      proposalId: 'p',
      type: 'propose_next_target',
      status: 'proposed',
      requiresUserApproval: true,
      executable: false,
      exerciseId: 'bench',
      recommendationSource: context().exercises[0].progressionSource!,
      supportingSources: [],
    };
    expect(proposal.executable).toBe(false);
    expect(proposal).not.toHaveProperty('mutationId');
    expect(context().factsPolicy).toMatchObject({
      canRecalculateFacts: false,
      canExecuteActions: false,
      userTextIsUntrustedData: true,
    });
  });
  it('active server data is explicitly partial and separates target from actual', () => {
    const active = {
      id: 'active',
      version: 2,
      status: 'active',
      localDate: '2026-09-15',
      deletedAt: null,
      exercises: [
        {
          id: 'ae',
          exerciseId: 'bench',
          exerciseNameSnapshot: 'ベンチ',
          status: 'in_progress',
          sets: [
            {
              id: 'as',
              position: 0,
              status: 'planned',
              actualLoadGrams: null,
              actualReps: null,
              targetLoadGrams: 102500,
              targetRepMin: 8,
              targetRepMax: 10,
            },
          ],
        },
      ],
    } as unknown as Workout;
    const data = input();
    const result = buildCoachContext(data, buildAnalytics(data), active);
    expect(result).toMatchObject({
      activeState: 'server_snapshot',
      localUnsyncedDataIncluded: false,
    });
    expect(result.activeWorkout?.exercises[0].sets[0]).toMatchObject({
      actualLoadGrams: null,
      actualReps: null,
      target: { loadGrams: 102500 },
      completed: false,
    });
    expect(
      buildCoachContext(data, buildAnalytics(data), null, true).activeState,
    ).toBe('unavailable');
    active.deletedAt = '2026-09-15';
    expect(
      buildCoachContext(data, buildAnalytics(data), active).activeWorkout,
    ).toBeNull();
  });
});
