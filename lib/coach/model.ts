import type {
  AnalyticsPeriod,
  AcceptedTargetAnalytics,
  PersonalRecordHistoryEvent,
} from '@/lib/analytics/model';
import type { AnalyticsInsight } from '@/lib/analytics/insights';
import type { ProgressionDecision } from '@/lib/progression/engine';
import type { StagnationEvaluation } from '@/lib/progression/stagnation';

export const COACH_CONTEXT_LIMITS = {
  recentWorkouts: 5,
  exercises: 12,
  exercisesPerWorkout: 12,
  setsPerExercise: 8,
  trendPoints: 6,
  personalRecords: 3,
  insights: 8,
  supportingValues: 8,
  textCharacters: 120,
  serializedBytes: 65_536,
} as const;

export interface CoachSourceReference {
  workoutId: string;
  workoutVersion: number;
  localDate: string;
  exerciseId: string | null;
  workoutExerciseId: string | null;
}

export interface CoachDataAvailability {
  history: 'available' | 'no_history';
  progression: 'available' | 'insufficient_data';
  stagnation: 'available' | 'insufficient_data';
  e1rmTrend: 'available' | 'missing_trend';
  acceptedTarget: 'available' | 'none' | 'stale';
}

export interface CoachSetContext {
  id: string;
  position: number;
  completed: boolean;
  actualLoadGrams: number | null;
  actualReps: number | null;
  // Present only for active server state; never converted into actuals.
  target: {
    loadGrams: number | null;
    repMin: number | null;
    repMax: number | null;
  } | null;
}

export interface CoachWorkoutContext {
  source: CoachSourceReference;
  completion: 'completed' | 'active';
  completeness: 'complete' | 'partial';
  omittedExerciseCount: number;
  exercises: Array<{
    source: CoachSourceReference;
    name: string;
    completed: boolean;
    omittedSetCount: number;
    sets: CoachSetContext[];
  }>;
}

export interface CoachExerciseContext {
  exerciseId: string;
  name: string;
  bodyPart: string;
  availability: CoachDataAvailability;
  progression: ProgressionDecision;
  progressionSource: CoachSourceReference | null;
  stagnation: StagnationEvaluation;
  stagnationSources: CoachSourceReference[];
  recentPerformance: CoachWorkoutContext['exercises'];
  latestPR: Array<
    PersonalRecordHistoryEvent & { source: CoachSourceReference }
  >;
  e1rmTrend: Array<{ valueGrams: number; source: CoachSourceReference }>;
  maxWeightTrend: Array<{ valueGrams: number; source: CoachSourceReference }>;
  acceptedNextTarget: AcceptedTargetAnalytics | null;
  targetNeedsReview: {
    targetId: string;
    source: CoachSourceReference | null;
    acceptedSourceVersion: number;
  } | null;
}

export interface CoachInsightContext extends AnalyticsInsight {
  sources: CoachSourceReference[];
  evidenceScope: 'referenced_history' | 'period_aggregate';
}

export interface CoachContext {
  schemaVersion: '1';
  ownerScope: 'default';
  generatedAt: string;
  period: AnalyticsPeriod;
  factsPolicy: {
    authority: 'existing_rule_engines';
    allowedRoles: readonly ['explain', 'summarize', 'suggest', 'answer'];
    canRecalculateFacts: false;
    canExecuteActions: false;
    userTextIsUntrustedData: true;
  };
  trainingSummary: {
    availability: 'available' | 'no_history';
    completedWorkoutCount: number;
    trainingDays: number;
    weeklyAverageWorkouts: number;
    workingSets: number;
  };
  exercises: CoachExerciseContext[];
  insights: {
    status: 'success' | 'insufficient_data' | 'no_insight';
    items: CoachInsightContext[];
  };
  recentWorkouts: CoachWorkoutContext[];
  activeWorkout: CoachWorkoutContext | null;
  activeState: 'server_snapshot' | 'none' | 'unavailable';
  // Server cannot claim that an unsynced/conflicted local draft is confirmed.
  localUnsyncedDataIncluded: false;
  truncation: {
    omittedWorkouts: number;
    omittedExercises: number;
    byteBudgetApplied: boolean;
  };
}

interface ProposalBoundary {
  proposalId: string;
  status: 'proposed';
  requiresUserApproval: true;
  executable: false;
  supportingSources: CoachSourceReference[];
}

// No mutationId, executor, database connection, or automatic approval.
export type ProposedAction = ProposalBoundary &
  (
    | {
        type: 'propose_next_target';
        exerciseId: string;
        recommendationSource: CoachSourceReference;
      }
    | {
        type: 'propose_exercise_change';
        workoutId: string;
        baseVersion: number;
        exerciseId: string;
        suggestedExerciseId: string;
      }
    | {
        type: 'propose_set_change';
        workoutId: string;
        baseVersion: number;
        workoutExerciseId: string;
        suggestedWorkingSets: number;
      }
  );
