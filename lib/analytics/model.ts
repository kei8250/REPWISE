import type {
  ProgressionDecision,
  ProgressionProfile,
} from '@/lib/progression/engine';
import type {
  AcceptedTargetAttemptOutcome,
  StagnationEvaluation,
} from '@/lib/progression/stagnation';
import type { AnalyticsInsightSummary } from './insights';

export const ANALYTICS_RANGES = ['7d', '30d', '90d', 'all'] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export interface AnalyticsPeriod {
  range: AnalyticsRange;
  startDate: string | null;
  endDate: string;
  dayCount: number | null;
}

export interface WorkoutVolumePoint {
  workoutId: string;
  localDate: string;
  workingSetCount: number;
  volumeGramReps: number;
}

export interface WorkoutAnalytics {
  completedWorkoutCount: number;
  trainingDayCount: number;
  weeklyAverageWorkoutCount: number;
  workingSetCount: number;
  totalVolumeGramReps: number;
  volumeByWorkout: WorkoutVolumePoint[];
}

export interface ExerciseTrendPoint {
  workoutId: string;
  localDate: string;
  value: number;
}

export interface RepTrendPoint {
  workoutId: string;
  localDate: string;
  loadGrams: number;
  bestReps: number;
}

export type PersonalRecordType = 'weight' | 'reps' | 'e1rm' | 'volume';

export interface PersonalRecordHistoryEvent {
  workoutId: string;
  localDate: string;
  type: PersonalRecordType;
  value: number;
  loadGrams: number | null;
  previousValue: number | null;
}

export type AcceptedTargetAnalyticsOutcome =
  | AcceptedTargetAttemptOutcome
  | 'not_applied'
  | 'excluded';

export interface AcceptedTargetAnalytics {
  id: string;
  acceptedAt: string;
  updatedAt: string;
  sourceWorkoutId: string;
  sourceWorkoutVersion: number;
  sourceLocalDate: string;
  status: 'accepted' | 'applied' | 'superseded';
  appliedWorkoutId: string | null;
  targetLoadGrams: number;
  targetRepMin: number;
  targetRepMax: number;
  targetWorkingSets: number;
  validity: 'valid' | 'stale_source_version' | 'invalid_source';
  outcome: AcceptedTargetAnalyticsOutcome;
}

export interface ExerciseAnalytics {
  exerciseId: string;
  exerciseName: string;
  bodyPart: string;
  workoutCount: number;
  trainingDayCount: number;
  workingSetCount: number;
  totalVolumeGramReps: number;
  profile: ProgressionProfile | null;
  progression: ProgressionDecision;
  stagnation: StagnationEvaluation;
  e1rmTrend: ExerciseTrendPoint[];
  maxWeightTrend: ExerciseTrendPoint[];
  volumeTrend: ExerciseTrendPoint[];
  repTrend: RepTrendPoint[];
  periodProgress?: PeriodProgress | null;
  personalRecordHistory: PersonalRecordHistoryEvent[];
  acceptedTargetHistory: AcceptedTargetAnalytics[];
  currentAcceptedTarget: AcceptedTargetAnalytics | null;
  currentTargetForReview?: AcceptedTargetAnalytics | null;
}

export interface BodyPartAnalytics {
  bodyPart: string;
  exerciseCount: number;
  trainingDayCount: number;
  workingSetCount: number;
  totalVolumeGramReps: number;
}

export interface AnalyticsSnapshot {
  insights?: AnalyticsInsightSummary;
  generatedAt: string;
  period: AnalyticsPeriod;
  workouts: WorkoutAnalytics;
  exercises: ExerciseAnalytics[];
  bodyParts: BodyPartAnalytics[];
}

export interface PeriodProgress {
  before: RepTrendPoint;
  after: RepTrendPoint;
  baseline: 'before_period' | 'first_in_period';
}
