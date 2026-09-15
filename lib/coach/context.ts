import { validSets, type BuildAnalyticsInput } from '@/lib/analytics/engine';
import type {
  AnalyticsSnapshot,
  ExerciseAnalytics,
} from '@/lib/analytics/model';
import type { Workout } from '@/lib/workouts/types';
import type { ProgressionExercisePerformance } from '@/lib/progression/engine';
import { STAGNATION_HISTORY_WINDOW } from '@/lib/progression/stagnation';
import {
  COACH_CONTEXT_LIMITS as limits,
  type CoachContext,
  type CoachSourceReference,
  type CoachWorkoutContext,
} from './model';

function text(value: string) {
  return value.slice(0, limits.textCharacters);
}
function source(p: ProgressionExercisePerformance): CoachSourceReference {
  return {
    workoutId: p.workoutId,
    workoutVersion: p.workoutVersion,
    localDate: p.workoutLocalDate,
    exerciseId: p.exerciseId,
    workoutExerciseId: p.workoutExerciseId,
  };
}

function activeContext(workout: Workout | null): CoachWorkoutContext | null {
  if (!workout || workout.deletedAt || workout.status !== 'active') return null;
  const base = {
    workoutId: workout.id,
    workoutVersion: workout.version,
    localDate: workout.localDate,
  };
  return {
    source: { ...base, exerciseId: null, workoutExerciseId: null },
    completion: 'active',
    completeness: 'partial',
    omittedExerciseCount: Math.max(
      0,
      workout.exercises.length - limits.exercisesPerWorkout,
    ),
    exercises: workout.exercises
      .slice(0, limits.exercisesPerWorkout)
      .map((e) => ({
        source: { ...base, exerciseId: e.exerciseId, workoutExerciseId: e.id },
        name: text(e.exerciseNameSnapshot),
        completed: e.status === 'completed',
        omittedSetCount: Math.max(0, e.sets.length - limits.setsPerExercise),
        sets: [...e.sets]
          .sort((a, b) => a.position - b.position)
          .slice(0, limits.setsPerExercise)
          .map((s) => ({
            id: s.id,
            position: s.position,
            completed: s.status === 'completed',
            actualLoadGrams: s.actualLoadGrams,
            actualReps: s.actualReps,
            target: {
              loadGrams: s.targetLoadGrams,
              repMin: s.targetRepMin,
              repMax: s.targetRepMax,
            },
          })),
      })),
  };
}

// Pure projection only: all evaluations and derived metrics come from Analytics.
export function buildCoachContext(
  input: BuildAnalyticsInput,
  analytics: AnalyticsSnapshot,
  activeWorkout: Workout | null = null,
  activeUnavailable = false,
): CoachContext {
  const history = input.exerciseHistory
    .filter(
      (h) =>
        validSets(h.performance).length > 0 &&
        h.performance.workoutLocalDate <= input.today,
    )
    .sort((a, b) =>
      `${b.performance.workoutLocalDate}\0${b.performance.workoutUpdatedAt}\0${b.performance.workoutId}`.localeCompare(
        `${a.performance.workoutLocalDate}\0${a.performance.workoutUpdatedAt}\0${a.performance.workoutId}`,
      ),
    );
  const sourcesByExercise = new Map<string, CoachSourceReference[]>();
  for (const h of history) {
    const refs = sourcesByExercise.get(h.performance.exerciseId) ?? [];
    refs.push(source(h.performance));
    sourcesByExercise.set(h.performance.exerciseId, refs);
  }
  const references = (exerciseId: string) =>
    sourcesByExercise.get(exerciseId) ?? [];
  const lookup = (workoutId: string, exerciseId: string) =>
    references(exerciseId).find((r) => r.workoutId === workoutId) ?? null;
  const insightSources = (
    exerciseId: string | undefined,
    values: Array<{ label: string; value: number | string }>,
  ) => {
    if (!exerciseId) return [];
    const explicit = values
      .filter((v) => v.label === 'workoutId' || v.label === 'sourceWorkoutId')
      .flatMap((v) =>
        typeof v.value === 'string'
          ? [lookup(v.value, exerciseId)].filter(
              (r): r is CoachSourceReference => r !== null,
            )
          : [],
      );
    return [
      ...new Map(
        [...explicit, ...references(exerciseId)].map((r) => [r.workoutId, r]),
      ).values(),
    ].slice(0, limits.trendPoints);
  };
  const byWorkout = new Map<string, typeof history>();
  for (const h of history) {
    const items = byWorkout.get(h.performance.workoutId) ?? [];
    items.push(h);
    byWorkout.set(h.performance.workoutId, items);
  }
  const recentWorkouts: CoachWorkoutContext[] = [...byWorkout.values()]
    .slice(0, limits.recentWorkouts)
    .map((items) => {
      const p = items[0].performance;
      return {
        source: { ...source(p), exerciseId: null, workoutExerciseId: null },
        completion: 'completed',
        completeness: 'partial',
        omittedExerciseCount: Math.max(
          0,
          items.length - limits.exercisesPerWorkout,
        ),
        exercises: items.slice(0, limits.exercisesPerWorkout).map((h) => {
          const sets = [...validSets(h.performance)].sort(
            (a, b) => a.position - b.position,
          );
          return {
            source: source(h.performance),
            name: text(h.exerciseName),
            completed: true,
            omittedSetCount: Math.max(0, sets.length - limits.setsPerExercise),
            sets: sets.slice(0, limits.setsPerExercise).map((s) => ({
              id: s.id,
              position: s.position,
              completed: true,
              actualLoadGrams: s.actualLoadGrams,
              actualReps: s.actualReps,
              target: null,
            })),
          };
        }),
      };
    });
  const orderedExercises = [...analytics.exercises].sort((a, b) => {
    const left = references(a.exerciseId)[0]?.localDate ?? '';
    const right = references(b.exerciseId)[0]?.localDate ?? '';
    return (
      right.localeCompare(left) || a.exerciseId.localeCompare(b.exerciseId)
    );
  });
  const context: CoachContext = {
    schemaVersion: '1',
    ownerScope: 'default',
    generatedAt: analytics.generatedAt,
    period: { ...analytics.period },
    factsPolicy: {
      authority: 'existing_rule_engines',
      allowedRoles: ['explain', 'summarize', 'suggest', 'answer'],
      canRecalculateFacts: false,
      canExecuteActions: false,
      userTextIsUntrustedData: true,
    },
    trainingSummary: {
      availability: analytics.workouts.completedWorkoutCount
        ? 'available'
        : 'no_history',
      completedWorkoutCount: analytics.workouts.completedWorkoutCount,
      trainingDays: analytics.workouts.trainingDayCount,
      weeklyAverageWorkouts: analytics.workouts.weeklyAverageWorkoutCount,
      workingSets: analytics.workouts.workingSetCount,
    },
    exercises: orderedExercises.slice(0, limits.exercises).map((e) => {
      const refs = references(e.exerciseId);
      const accepted = e.currentAcceptedTarget;
      const validTarget =
        accepted?.validity === 'valid' &&
        accepted.status === 'accepted' &&
        !accepted.appliedWorkoutId &&
        lookup(accepted.sourceWorkoutId, e.exerciseId)?.workoutVersion ===
          accepted.sourceWorkoutVersion
          ? accepted
          : null;
      const review = e.currentTargetForReview;
      const trend = (points: ExerciseAnalytics['e1rmTrend']) =>
        points.slice(-limits.trendPoints).flatMap((p) => {
          const ref = lookup(p.workoutId, e.exerciseId);
          return ref ? [{ valueGrams: p.value, source: ref }] : [];
        });
      return {
        exerciseId: e.exerciseId,
        name: text(e.exerciseName),
        bodyPart: text(e.bodyPart),
        availability: {
          history: refs.length ? 'available' : 'no_history',
          progression:
            e.progression.status === 'insufficient_data'
              ? 'insufficient_data'
              : 'available',
          stagnation:
            e.stagnation.status === 'insufficient_data'
              ? 'insufficient_data'
              : 'available',
          e1rmTrend: e.e1rmTrend.length ? 'available' : 'missing_trend',
          acceptedTarget: validTarget ? 'available' : review ? 'stale' : 'none',
        },
        progression: {
          ...e.progression,
          evaluatedSetIds: e.progression.evaluatedSetIds.slice(
            0,
            limits.setsPerExercise,
          ),
          nextTarget: e.progression.nextTarget
            ? {
                ...e.progression.nextTarget,
                sets: e.progression.nextTarget.sets.slice(
                  0,
                  limits.setsPerExercise,
                ),
              }
            : null,
        },
        progressionSource: e.progression.sourceWorkoutId
          ? lookup(e.progression.sourceWorkoutId, e.exerciseId)
          : null,
        stagnation: { ...e.stagnation },
        stagnationSources: refs.slice(0, STAGNATION_HISTORY_WINDOW),
        recentPerformance: recentWorkouts.flatMap((w) =>
          w.exercises.filter((x) => x.source.exerciseId === e.exerciseId),
        ),
        latestPR: [...e.personalRecordHistory]
          .sort((a, b) => b.localDate.localeCompare(a.localDate))
          .slice(0, limits.personalRecords)
          .flatMap((pr) => {
            const ref = lookup(pr.workoutId, e.exerciseId);
            return ref ? [{ ...pr, source: ref }] : [];
          }),
        e1rmTrend: trend(e.e1rmTrend),
        maxWeightTrend: trend(e.maxWeightTrend),
        acceptedNextTarget: validTarget ? { ...validTarget } : null,
        targetNeedsReview: review
          ? {
              targetId: review.id,
              source: lookup(review.sourceWorkoutId, e.exerciseId),
              acceptedSourceVersion: review.sourceWorkoutVersion,
            }
          : null,
      };
    }),
    insights: {
      status: analytics.insights?.status ?? 'no_insight',
      items: (analytics.insights?.items ?? [])
        .slice(0, limits.insights)
        .map((i) => ({
          ...i,
          title: text(i.title),
          message: text(i.message),
          supportingData: {
            ...i.supportingData,
            values: i.supportingData.values
              .slice(0, limits.supportingValues)
              .map((v) => ({
                ...v,
                label: text(v.label),
                value: typeof v.value === 'string' ? text(v.value) : v.value,
              })),
          },
          sources: insightSources(i.exerciseId, i.supportingData.values),
          evidenceScope: i.exerciseId
            ? 'referenced_history'
            : 'period_aggregate',
        })),
    },
    recentWorkouts,
    activeWorkout: activeContext(activeWorkout),
    activeState: activeUnavailable
      ? 'unavailable'
      : activeContext(activeWorkout)
        ? 'server_snapshot'
        : 'none',
    localUnsyncedDataIncluded: false,
    truncation: {
      omittedWorkouts: Math.max(0, byWorkout.size - recentWorkouts.length),
      omittedExercises: Math.max(0, orderedExercises.length - limits.exercises),
      byteBudgetApplied: false,
    },
  };
  // Detach all nested facts: a downstream consumer must not mutate Analytics.
  const detached: CoachContext = structuredClone(context);
  const size = () => new TextEncoder().encode(JSON.stringify(detached)).length;
  while (
    size() > limits.serializedBytes &&
    (detached.exercises.length ||
      detached.recentWorkouts.length ||
      detached.insights.items.length ||
      detached.activeWorkout)
  ) {
    detached.truncation.byteBudgetApplied = true;
    if (detached.exercises.length) {
      detached.exercises.pop();
      detached.truncation.omittedExercises++;
    } else if (detached.recentWorkouts.length) {
      detached.recentWorkouts.pop();
      detached.truncation.omittedWorkouts++;
    } else if (detached.insights.items.length) detached.insights.items.pop();
    else {
      detached.activeWorkout = null;
      detached.activeState = 'unavailable';
    }
  }
  return detached;
}
