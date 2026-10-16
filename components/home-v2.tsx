'use client';

import { HomeGoalProgress } from '@/components/goals/goal-progress-summary';
import { loadVisibleWorkouts } from '@/lib/workouts/visible-workouts';

import { useEffect, useState } from 'react';
import { WorkoutCalendar } from '@/components/workouts/workout-calendar';
import { ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { getWorkout } from '@/lib/workouts/api-client';
import { loadHomeActiveWorkout } from '@/lib/workouts/home-loader';
import {
  getLatestActiveWorkoutDraft,
  listWorkoutMutations,
  markLocalWorkoutDraftCompleted,
  pruneCompletedWorkoutDrafts,
} from '@/lib/workouts/local-drafts';
import type { WorkoutSummary } from '@/lib/workouts/types';
import { APP_ROUTES, workoutRoute } from '@/lib/routes';
import {
  HomeAnalyticsSection,
  type HomeAnalyticsState,
} from '@/components/home-analytics-summary';
import { loadHomeAnalyticsSummary } from '@/lib/analytics/home-cache';

export function HomeV2() {
  const [active, setActive] = useState<WorkoutSummary | null>(null);
  const [activeStatus, setActiveStatus] = useState<
    'loading' | 'success' | 'error'
  >('loading');
  const [completedAttempt, setCompletedAttempt] = useState(0);
  const [analyticsState, setAnalyticsState] = useState<HomeAnalyticsState>({
    status: 'loading',
    data: null,
  });
  const [analyticsAttempt, setAnalyticsAttempt] = useState(0);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const result = await loadHomeActiveWorkout({
        getLocalDraft: getLatestActiveWorkoutDraft,
        listServerActive: async () =>
          (await loadVisibleWorkouts('active', 1)).items,
        getServerWorkout: getWorkout,
        listMutations: listWorkoutMutations,
        onLocalReady: (workout) => {
          if (!mounted) return;
          setActive(workout);
          setActiveStatus('success');
        },
        onServerCompleted: async (workout) => {
          await markLocalWorkoutDraftCompleted(workout).catch(() => undefined);
        },
      });
      if (!mounted) return;
      setActive(result.workout);
      setActiveStatus(
        result.serverAvailable || result.workout ? 'success' : 'error',
      );
    })().catch(() => {
      if (mounted) setActiveStatus('error');
    });
    return () => {
      mounted = false;
    };
  }, [completedAttempt]);

  useEffect(() => {
    void pruneCompletedWorkoutDrafts().catch(() => undefined);
  }, []);

  useEffect(() => {
    let mounted = true;
    void loadHomeAnalyticsSummary(analyticsAttempt > 0).then(
      (data) => {
        if (mounted) setAnalyticsState({ status: 'success', data });
      },
      () => {
        if (mounted) setAnalyticsState({ status: 'error', data: null });
      },
    );
    return () => {
      mounted = false;
    };
  }, [analyticsAttempt]);

  useEffect(() => {
    const refresh = () => {
      setCompletedAttempt((value) => value + 1);
      setAnalyticsAttempt((value) => value + 1);
    };
    window.addEventListener('repwise-sync-queue-change', refresh);
    return () =>
      window.removeEventListener('repwise-sync-queue-change', refresh);
  }, []);
  return (
    <div className="space-y-5 p-4 sm:p-7 lg:p-10">
      <section className="overflow-hidden rounded-[28px] bg-[#173f2c] text-white shadow-[0_18px_50px_rgba(18,62,43,.16)]">
        <div className="grid items-center gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_auto]">
          <div>
            <Badge className="mb-3 bg-white/12 text-[#bff7d5]">
              {active ? 'IN PROGRESS' : 'READY'}
            </Badge>
            <h2 className="text-3xl font-black tracking-tight sm:text-4xl">
              {active ? '入力途中の記録があります' : '今日のワークアウトを記録'}
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/65">
              {active
                ? `${active.exerciseCount}種目・${active.completedSetCount}セット完了。続きから再開できます。`
                : '複数の種目とセットを、1回のワークアウトとして保存します。'}
            </p>
            {activeStatus === 'error' && (
              <p className="mt-2 text-xs text-white/65">
                進行中の記録を確認できませんでした。新しい記録は開始できます。
              </p>
            )}
          </div>
          <a
            href={
              active
                ? workoutRoute(active.id, active.status)
                : APP_ROUTES.newWorkout
            }
            className={buttonVariants({
              size: 'lg',
              className:
                'h-12 rounded-xl bg-[#d6ff57] px-6 text-[#153523] hover:bg-[#c8f04e]',
            })}
          >
            {active ? '記録を再開' : 'ワークアウトを開始'} <ArrowRight />
          </a>
        </div>
      </section>
      <a
        href={APP_ROUTES.activeHistory}
        className="flex min-h-11 items-center justify-between rounded-xl border bg-card px-4 text-sm font-bold text-primary"
      >
        入力途中の記録を一覧で整理 <ArrowRight className="size-4" />
      </a>
      <WorkoutCalendar />
      <HomeGoalProgress />
      <HomeAnalyticsSection
        showPeriodMetrics={false}
        state={analyticsState}
        onRetry={() => {
          setAnalyticsState({ status: 'loading', data: null });
          setAnalyticsAttempt((attempt) => attempt + 1);
        }}
      />
    </div>
  );
}
