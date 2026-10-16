import { comparePeriodProgress } from './period-progress';
import { totalReps, effectiveLoadGrams } from '@/lib/workouts/reps';
import {
  evaluateProgression,
  type ProgressionExercisePerformance,
  type ProgressionPerformanceSet,
  type ProgressionProfile,
} from '@/lib/progression/engine';
import { buildAnalyticsInsights, buildFrequencyComparison } from './insights';
import {
  calculateE1rmGrams,
  E1RM_MAX_REPS,
  evaluatePersonalRecords,
  type PersonalRecordPerformance,
} from '@/lib/progression/personal-records';
import {
  evaluateAcceptedTargetAttempt,
  evaluateStagnation,
  type AppliedAcceptedTargetAttempt,
  type StagnationHistoryEntry,
} from '@/lib/progression/stagnation';
import type {
  AcceptedTargetAnalytics,
  AnalyticsPeriod,
  AnalyticsRange,
  AnalyticsSnapshot,
  BodyPartAnalytics,
  ExerciseAnalytics,
  PersonalRecordHistoryEvent,
  WorkoutAnalytics,
} from './model';

export interface AnalyticsWorkoutInput {
  id: string;
  localDate: string;
}

export interface AnalyticsExerciseHistoryInput {
  exerciseName: string;
  bodyPart: string | null;
  profile: ProgressionProfile | null;
  performance: ProgressionExercisePerformance;
}

export interface AnalyticsAcceptedTargetInput extends AppliedAcceptedTargetAttempt {
  id: string;
  exerciseId: string;
  sourceWorkoutId: string;
  sourceWorkoutVersion: number;
  sourceCurrentVersion: number;
  sourceWorkoutStatus: string;
  sourceLocalDate: string;
  acceptedAt: string;
  updatedAt: string;
  sourceDeletedAt: string | null;
  status: 'accepted' | 'applied' | 'superseded';
  appliedWorkoutId: string | null;
  appliedWorkoutStatus: string | null;
  appliedWorkoutDeletedAt: string | null;
}

export interface BuildAnalyticsInput {
  range: AnalyticsRange;
  today: string;
  generatedAt: string;
  workouts: AnalyticsWorkoutInput[];
  exerciseHistory: AnalyticsExerciseHistoryInput[];
  acceptedTargets: AnalyticsAcceptedTargetInput[];
}

function dateDaysAgo(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

export function resolveAnalyticsPeriod(
  range: AnalyticsRange,
  today: string,
): AnalyticsPeriod {
  const days =
    range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : null;
  return {
    range,
    startDate: days === null ? null : dateDaysAgo(today, days - 1),
    endDate: today,
    dayCount: days,
  };
}

function inPeriod(localDate: string, period: AnalyticsPeriod) {
  return (
    localDate <= period.endDate &&
    (period.startDate === null || localDate >= period.startDate)
  );
}

export function validSets(performance: ProgressionExercisePerformance) {
  if (
    performance.workoutStatus !== 'completed' ||
    performance.workoutDeletedAt ||
    performance.exerciseStatus !== 'completed'
  ) {
    return [];
  }
  return performance.sets.filter(
    (set) =>
      !set.deletedAt &&
      set.setType === 'working' &&
      set.status === 'completed' &&
      Number.isInteger(set.actualLoadGrams) &&
      (set.actualLoadGrams ?? 0) > 0 &&
      Number.isInteger(set.actualReps) &&
      (set.actualReps ?? 0) > 0,
  );
}

function chronology(
  left: AnalyticsExerciseHistoryInput,
  right: AnalyticsExerciseHistoryInput,
) {
  const leftKey = `${left.performance.workoutLocalDate}\u0000${left.performance.workoutUpdatedAt}\u0000${left.performance.workoutId}`;
  const rightKey = `${right.performance.workoutLocalDate}\u0000${right.performance.workoutUpdatedAt}\u0000${right.performance.workoutId}`;
  return leftKey.localeCompare(rightKey);
}

function maxOrNull(values: number[]) {
  return values.length > 0 ? Math.max(...values) : null;
}

function personalRecordHistory(
  history: AnalyticsExerciseHistoryInput[],
  period: AnalyticsPeriod,
) {
  const prior: PersonalRecordPerformance[] = [];
  const events: PersonalRecordHistoryEvent[] = [];
  for (const item of history) {
    const current: PersonalRecordPerformance = {
      workoutId: item.performance.workoutId,
      exerciseId: item.performance.exerciseId,
      sets: item.performance.sets,
    };
    const evaluation = evaluatePersonalRecords(current, prior);
    if (inPeriod(item.performance.workoutLocalDate, period)) {
      if (
        evaluation.achieved.weight &&
        evaluation.current.maxLoadGrams !== null
      ) {
        events.push({
          workoutId: current.workoutId,
          localDate: item.performance.workoutLocalDate,
          type: 'weight',
          value: evaluation.current.maxLoadGrams,
          loadGrams: evaluation.current.maxLoadGrams,
          previousValue: evaluation.previousBest.maxLoadGrams,
        });
      }
      for (const record of evaluation.repRecords) {
        events.push({
          workoutId: current.workoutId,
          localDate: item.performance.workoutLocalDate,
          type: 'reps',
          value: record.reps,
          loadGrams: record.loadGrams,
          previousValue: record.previousBestReps,
        });
      }
      if (
        evaluation.achieved.e1rm &&
        evaluation.current.maxE1rmGrams !== null
      ) {
        events.push({
          workoutId: current.workoutId,
          localDate: item.performance.workoutLocalDate,
          type: 'e1rm',
          value: evaluation.current.maxE1rmGrams,
          loadGrams: null,
          previousValue: evaluation.previousBest.maxE1rmGrams,
        });
      }
      if (
        evaluation.achieved.volume &&
        evaluation.current.totalVolumeGramReps !== null
      ) {
        events.push({
          workoutId: current.workoutId,
          localDate: item.performance.workoutLocalDate,
          type: 'volume',
          value: evaluation.current.totalVolumeGramReps,
          loadGrams: null,
          previousValue: evaluation.previousBest.maxVolumeGramReps,
        });
      }
    }
    prior.push(current);
  }
  return events;
}

function acceptedTargetHistory(
  exerciseId: string,
  targets: AnalyticsAcceptedTargetInput[],
  historyByWorkout: Map<string, ProgressionExercisePerformance>,
  period: AnalyticsPeriod,
): AcceptedTargetAnalytics[] {
  return targets
    .filter(
      (target) =>
        target.exerciseId === exerciseId &&
        !target.sourceDeletedAt &&
        inPeriod(target.acceptedAt.slice(0, 10), period),
    )
    .map((target) => {
      let outcome: AcceptedTargetAnalytics['outcome'] = 'not_applied';
      if (target.appliedWorkoutId) {
        if (
          target.appliedWorkoutDeletedAt ||
          target.appliedWorkoutStatus !== 'completed'
        ) {
          outcome = 'excluded';
        } else {
          const performance = historyByWorkout.get(target.appliedWorkoutId);
          outcome = performance
            ? evaluateAcceptedTargetAttempt(performance, target)
            : 'insufficient_data';
        }
      }
      return {
        id: target.id,
        acceptedAt: target.acceptedAt,
        updatedAt: target.updatedAt,
        sourceWorkoutId: target.sourceWorkoutId,
        sourceWorkoutVersion: target.sourceWorkoutVersion,
        sourceLocalDate: target.sourceLocalDate,
        status: target.status,
        appliedWorkoutId: target.appliedWorkoutId,
        targetLoadGrams: target.targetLoadGrams,
        targetRepMin: target.targetRepMin,
        targetRepMax: target.targetRepMax,
        targetWorkingSets: target.targetWorkingSets,
        validity:
          target.sourceWorkoutStatus !== 'completed'
            ? 'invalid_source'
            : target.sourceCurrentVersion === target.sourceWorkoutVersion
              ? 'valid'
              : 'stale_source_version',
        outcome,
      };
    });
}

function buildWorkoutAnalytics(
  workouts: AnalyticsWorkoutInput[],
  periodHistory: AnalyticsExerciseHistoryInput[],
  period: AnalyticsPeriod,
): WorkoutAnalytics {
  const periodWorkouts = workouts
    .filter((workout) => inPeriod(workout.localDate, period))
    .sort((left, right) =>
      `${left.localDate}\u0000${left.id}`.localeCompare(
        `${right.localDate}\u0000${right.id}`,
      ),
    );
  const setsByWorkout = new Map<string, ProgressionPerformanceSet[]>();
  for (const item of periodHistory) {
    const sets = setsByWorkout.get(item.performance.workoutId) ?? [];
    sets.push(...validSets(item.performance));
    setsByWorkout.set(item.performance.workoutId, sets);
  }
  const volumeByWorkout = periodWorkouts.map((workout) => {
    const sets = setsByWorkout.get(workout.id) ?? [];
    return {
      workoutId: workout.id,
      localDate: workout.localDate,
      workingSetCount: sets.length,
      volumeGramReps: sets.reduce(
        (total, set) =>
          total + (set.actualLoadGrams as number) * totalReps(set),
        0,
      ),
    };
  });
  const trainingDayCount = new Set(
    periodWorkouts.map((workout) => workout.localDate),
  ).size;
  const dayCount =
    period.dayCount ??
    (periodWorkouts.length > 0
      ? Math.floor(
          (Date.parse(`${period.endDate}T00:00:00.000Z`) -
            Date.parse(`${periodWorkouts[0].localDate}T00:00:00.000Z`)) /
            86_400_000,
        ) + 1
      : 0);
  return {
    completedWorkoutCount: periodWorkouts.length,
    trainingDayCount,
    weeklyAverageWorkoutCount:
      dayCount > 0
        ? Number((periodWorkouts.length / (dayCount / 7)).toFixed(2))
        : 0,
    workingSetCount: volumeByWorkout.reduce(
      (total, workout) => total + workout.workingSetCount,
      0,
    ),
    totalVolumeGramReps: volumeByWorkout.reduce(
      (total, workout) => total + workout.volumeGramReps,
      0,
    ),
    volumeByWorkout,
  };
}

export function buildAnalytics(input: BuildAnalyticsInput): AnalyticsSnapshot {
  const period = resolveAnalyticsPeriod(input.range, input.today);
  const allHistory = input.exerciseHistory
    .filter((item) => validSets(item.performance).length > 0)
    .sort(chronology);
  const periodHistory = allHistory.filter((item) =>
    inPeriod(item.performance.workoutLocalDate, period),
  );
  const historyByExercise = new Map<string, AnalyticsExerciseHistoryInput[]>();
  for (const item of allHistory) {
    const history = historyByExercise.get(item.performance.exerciseId) ?? [];
    history.push(item);
    historyByExercise.set(item.performance.exerciseId, history);
  }

  const periodExerciseIds = new Set(
    periodHistory.map((item) => item.performance.exerciseId),
  );
  for (const target of input.acceptedTargets) {
    if (
      target.status === 'accepted' &&
      !target.appliedWorkoutId &&
      !target.sourceDeletedAt &&
      target.sourceWorkoutStatus === 'completed' &&
      historyByExercise.has(target.exerciseId)
    ) {
      periodExerciseIds.add(target.exerciseId);
    }
  }
  const exercises: ExerciseAnalytics[] = [...periodExerciseIds]
    .map((exerciseId) => {
      const history = historyByExercise.get(exerciseId) ?? [];
      const inRange = history.filter((item) =>
        inPeriod(item.performance.workoutLocalDate, period),
      );
      const latest = history.at(-1) as AnalyticsExerciseHistoryInput;
      const sets = inRange.flatMap((item) => validSets(item.performance));
      const historyByWorkout = new Map(
        history.map((item) => [item.performance.workoutId, item.performance]),
      );
      const e1rmTrend = inRange.flatMap((item) => {
        const best = maxOrNull(
          validSets(item.performance)
            .filter((set) => (set.actualReps as number) <= E1RM_MAX_REPS)
            .map((set) =>
              calculateE1rmGrams(
                effectiveLoadGrams(set) as number,
                set.actualReps as number,
              ),
            ),
        );
        return best === null
          ? []
          : [
              {
                workoutId: item.performance.workoutId,
                localDate: item.performance.workoutLocalDate,
                value: best,
              },
            ];
      });
      const maxWeightTrend = inRange.map((item) => ({
        workoutId: item.performance.workoutId,
        localDate: item.performance.workoutLocalDate,
        value: Math.max(
          ...validSets(item.performance).map(
            (set) => effectiveLoadGrams(set) as number,
          ),
        ),
      }));
      const volumeTrend = inRange.map((item) => ({
        workoutId: item.performance.workoutId,
        localDate: item.performance.workoutLocalDate,
        value: validSets(item.performance).reduce(
          (total, set) =>
            total + (set.actualLoadGrams as number) * totalReps(set),
          0,
        ),
      }));
      const repTrend = inRange.flatMap((item) => {
        const bestByLoad = new Map<number, number>();
        for (const set of validSets(item.performance)) {
          const load = effectiveLoadGrams(set) as number;
          bestByLoad.set(
            load,
            Math.max(bestByLoad.get(load) ?? 0, set.actualReps as number),
          );
        }
        return [...bestByLoad].map(([loadGrams, bestReps]) => ({
          workoutId: item.performance.workoutId,
          localDate: item.performance.workoutLocalDate,
          loadGrams,
          bestReps,
        }));
      });
      const acceptedByWorkout = new Map(
        input.acceptedTargets
          .filter(
            (target) =>
              target.exerciseId === exerciseId && target.appliedWorkoutId,
          )
          .map((target) => [target.appliedWorkoutId as string, target]),
      );
      const stagnationHistory: StagnationHistoryEntry[] = history.map(
        (item) => ({
          performance: item.performance,
          acceptedTarget: acceptedByWorkout.get(item.performance.workoutId),
        }),
      );
      const allAcceptedTargets = acceptedTargetHistory(
        exerciseId,
        input.acceptedTargets,
        historyByWorkout,
        resolveAnalyticsPeriod('all', period.endDate),
      );
      const currentAcceptedTarget =
        allAcceptedTargets
          .filter(
            (target) =>
              target.status === 'accepted' &&
              !target.appliedWorkoutId &&
              target.validity === 'valid',
          )
          .sort((left, right) =>
            `${right.updatedAt}\u0000${right.id}`.localeCompare(
              `${left.updatedAt}\u0000${left.id}`,
            ),
          )[0] ?? null;
      return {
        exerciseId,
        exerciseName: latest.exerciseName,
        bodyPart: latest.bodyPart?.trim() || 'unknown',
        workoutCount: new Set(inRange.map((item) => item.performance.workoutId))
          .size,
        trainingDayCount: new Set(
          inRange.map((item) => item.performance.workoutLocalDate),
        ).size,
        workingSetCount: sets.length,
        totalVolumeGramReps: sets.reduce(
          (total, set) =>
            total + (set.actualLoadGrams as number) * totalReps(set),
          0,
        ),
        profile: latest.profile,
        progression: evaluateProgression(latest.performance, latest.profile),
        stagnation: evaluateStagnation(stagnationHistory, latest.profile),
        e1rmTrend,
        maxWeightTrend,
        volumeTrend,
        repTrend,
        // Retain eligible sets even when a higher-rep set at the same load is outside the RM range.
        rmRepTrend: inRange.flatMap((item) =>
          validSets(item.performance)
            .filter((set) => (set.actualReps as number) <= E1RM_MAX_REPS)
            .map((set) => ({
              workoutId: item.performance.workoutId,
              localDate: item.performance.workoutLocalDate,
              loadGrams: effectiveLoadGrams(set) as number,
              bestReps: set.actualReps as number,
            })),
        ),
        periodProgress: comparePeriodProgress(
          history.flatMap((item) =>
            validSets(item.performance).map((set) => ({
              workoutId: item.performance.workoutId,
              localDate: item.performance.workoutLocalDate,
              loadGrams: effectiveLoadGrams(set) as number,
              bestReps: set.actualReps as number,
            })),
          ),
          period,
        ),
        personalRecordHistory: personalRecordHistory(history, period),
        acceptedTargetHistory: acceptedTargetHistory(
          exerciseId,
          input.acceptedTargets,
          historyByWorkout,
          period,
        ),
        currentAcceptedTarget,
        currentTargetForReview:
          allAcceptedTargets
            .filter(
              (target) =>
                target.status === 'accepted' &&
                !target.appliedWorkoutId &&
                target.validity === 'stale_source_version',
            )
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null,
      };
    })
    .sort((left, right) =>
      left.exerciseName.localeCompare(right.exerciseName, 'ja'),
    );

  const bodyPartMap = new Map<
    string,
    {
      exerciseIds: Set<string>;
      trainingDays: Set<string>;
      workingSetCount: number;
      totalVolumeGramReps: number;
    }
  >();
  for (const item of periodHistory) {
    const bodyPart = item.bodyPart?.trim() || 'unknown';
    const aggregate = bodyPartMap.get(bodyPart) ?? {
      exerciseIds: new Set<string>(),
      trainingDays: new Set<string>(),
      workingSetCount: 0,
      totalVolumeGramReps: 0,
    };
    const sets = validSets(item.performance);
    aggregate.exerciseIds.add(item.performance.exerciseId);
    aggregate.trainingDays.add(item.performance.workoutLocalDate);
    aggregate.workingSetCount += sets.length;
    aggregate.totalVolumeGramReps += sets.reduce(
      (total, set) => total + (set.actualLoadGrams as number) * totalReps(set),
      0,
    );
    bodyPartMap.set(bodyPart, aggregate);
  }
  const bodyParts: BodyPartAnalytics[] = [...bodyPartMap]
    .map(([bodyPart, aggregate]) => ({
      bodyPart,
      exerciseCount: aggregate.exerciseIds.size,
      trainingDayCount: aggregate.trainingDays.size,
      workingSetCount: aggregate.workingSetCount,
      totalVolumeGramReps: aggregate.totalVolumeGramReps,
    }))
    .sort((left, right) => left.bodyPart.localeCompare(right.bodyPart, 'ja'));

  const snapshot: AnalyticsSnapshot = {
    generatedAt: input.generatedAt,
    period,
    workouts: buildWorkoutAnalytics(input.workouts, periodHistory, period),
    exercises,
    bodyParts,
  };
  return {
    ...snapshot,
    insights: buildAnalyticsInsights(
      snapshot,
      buildFrequencyComparison(input.workouts, period),
    ),
  };
}
