import type {
  AcceptedTargetAnalytics,
  AnalyticsSnapshot,
  PersonalRecordType,
} from './model';
import { stagnationReasonLabel } from '@/lib/progression/stagnation';

export interface HomePersonalRecordItem {
  workoutId: string;
  exerciseId: string;
  exerciseName: string;
  type: PersonalRecordType;
  localDate: string;
  value: number;
  loadGrams: number | null;
}

export interface HomeStagnationItem {
  exerciseId: string;
  exerciseName: string;
  reason: string;
}

export interface HomeAcceptedTargetItem {
  exerciseId: string;
  exerciseName: string;
  targetLoadGrams: number;
  targetRepMin: number;
  targetRepMax: number;
  targetWorkingSets: number;
}

export interface HomeAnalyticsSummary {
  hasTrainingData: boolean;
  workoutCount30d: number;
  trainingDayCount30d: number;
  weeklyAverageWorkoutCount: number;
  workingSetCount7d: number;
  recentPersonalRecords: HomePersonalRecordItem[];
  stagnatingExercises: HomeStagnationItem[];
  acceptedTargets: HomeAcceptedTargetItem[];
}

function dateDaysAgo(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function currentTargetItem(
  exerciseId: string,
  exerciseName: string,
  target: AcceptedTargetAnalytics | null,
): HomeAcceptedTargetItem | null {
  if (
    !target ||
    target.status !== 'accepted' ||
    target.appliedWorkoutId ||
    target.validity !== 'valid'
  ) {
    return null;
  }
  return {
    exerciseId,
    exerciseName,
    targetLoadGrams: target.targetLoadGrams,
    targetRepMin: target.targetRepMin,
    targetRepMax: target.targetRepMax,
    targetWorkingSets: target.targetWorkingSets,
  };
}

export function buildHomeAnalyticsSummary(
  analytics: AnalyticsSnapshot,
): HomeAnalyticsSummary {
  const sevenDayStart = dateDaysAgo(analytics.period.endDate, 6);
  const recentPersonalRecords = analytics.exercises
    .flatMap((exercise) =>
      exercise.personalRecordHistory.map((record) => ({
        workoutId: record.workoutId,
        exerciseId: exercise.exerciseId,
        exerciseName: exercise.exerciseName,
        type: record.type,
        localDate: record.localDate,
        value: record.value,
        loadGrams: record.loadGrams,
      })),
    )
    .sort((left, right) =>
      `${right.localDate}\u0000${right.exerciseName}\u0000${right.type}`.localeCompare(
        `${left.localDate}\u0000${left.exerciseName}\u0000${left.type}`,
        'ja',
      ),
    )
    .slice(0, 3);
  const stagnatingExercises = analytics.exercises
    .filter((exercise) => exercise.stagnation.status === 'stagnating')
    .map((exercise) => ({
      exerciseId: exercise.exerciseId,
      exerciseName: exercise.exerciseName,
      reason: stagnationReasonLabel(exercise.stagnation),
    }))
    .slice(0, 3);
  const acceptedTargets = analytics.exercises
    .map((exercise) =>
      currentTargetItem(
        exercise.exerciseId,
        exercise.exerciseName,
        exercise.currentAcceptedTarget,
      ),
    )
    .filter((target): target is HomeAcceptedTargetItem => target !== null)
    .slice(0, 3);

  return {
    hasTrainingData: analytics.workouts.completedWorkoutCount > 0,
    workoutCount30d: analytics.workouts.completedWorkoutCount,
    trainingDayCount30d: analytics.workouts.trainingDayCount,
    weeklyAverageWorkoutCount: analytics.workouts.weeklyAverageWorkoutCount,
    workingSetCount7d: analytics.workouts.volumeByWorkout
      .filter((workout) => workout.localDate >= sevenDayStart)
      .reduce((total, workout) => total + workout.workingSetCount, 0),
    recentPersonalRecords,
    stagnatingExercises,
    acceptedTargets,
  };
}
