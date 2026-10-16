'use client';

import { HomeGoalProgress } from '@/components/goals/goal-progress-summary';
import { useEffect, useState } from 'react';
import { WorkoutCalendar } from '@/components/workouts/workout-calendar';
import { ArrowRight } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { pruneCompletedWorkoutDrafts } from '@/lib/workouts/local-drafts';
import { APP_ROUTES } from '@/lib/routes';
import {
  HomeAnalyticsSection,
  type HomeAnalyticsState,
} from '@/components/home-analytics-summary';
import { loadHomeAnalyticsSummary } from '@/lib/analytics/home-cache';

export function HomeV2() {
  const [analyticsState, setAnalyticsState] = useState<HomeAnalyticsState>({
    status: 'loading',
    data: null,
  });
  const [analyticsAttempt, setAnalyticsAttempt] = useState(0);

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
            <h2 className="text-3xl font-black tracking-tight sm:text-4xl">
              今日のトレーニングを記録
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/75">
              重量と回数を入力すると自動で保存されます。あとから編集・削除できます。
            </p>
          </div>
          <a
            href={APP_ROUTES.newWorkout}
            className={buttonVariants({
              size: 'lg',
              className:
                'h-12 rounded-xl bg-[#d6ff57] px-6 text-[#153523] hover:bg-[#c8f04e]',
            })}
          >
            トレーニングを記録 <ArrowRight />
          </a>
        </div>
      </section>
      <HomeGoalProgress />
      <WorkoutCalendar />
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
