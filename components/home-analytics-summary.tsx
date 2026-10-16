'use client';

import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  RefreshCw,
  Target,
  Trophy,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type {
  HomeAnalyticsSummary,
  HomePersonalRecordItem,
} from '@/lib/analytics/home-summary';
import { APP_ROUTES } from '@/lib/routes';
import { InsightsSection } from '@/components/analytics/insights-section';

export type HomeAnalyticsState =
  | { status: 'loading'; data: null }
  | { status: 'error'; data: null }
  | { status: 'success'; data: HomeAnalyticsSummary };

function formatKg(grams: number, maximumFractionDigits = 1) {
  return `${new Intl.NumberFormat('ja-JP', { maximumFractionDigits }).format(
    grams / 1000,
  )}kg`;
}

function formatShortDate(localDate: string) {
  const [, month, day] = localDate.split('-').map(Number);
  return `${month}/${day}`;
}

function personalRecordLabel(record: HomePersonalRecordItem) {
  if (record.type === 'weight') return `重量PR ${formatKg(record.value)}`;
  if (record.type === 'reps') {
    return `Rep PR ${formatKg(record.loadGrams ?? 0)} × ${record.value}回`;
  }
  if (record.type === 'e1rm') return `e1RM PR ${formatKg(record.value)}`;
  return `Volume PR ${formatKg(record.value)}`;
}

function AnalyticsSectionHeading({ period = false }: { period?: boolean }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <p className="text-xs font-bold tracking-[0.16em] text-primary">
          RECENT STATUS
        </p>
        <h2 id="home-analytics-title" className="mt-1 text-xl font-black">
          最近の状態
        </h2>
      </div>
      <div className="flex flex-col items-end gap-1">
        {period && <p className="text-xs text-muted-foreground">直近30日</p>}
        <a
          href={APP_ROUTES.analytics}
          className="inline-flex min-h-8 items-center gap-1 text-xs font-bold text-primary"
        >
          詳しい分析を見る <ArrowRight className="size-3.5" />
        </a>
      </div>
    </div>
  );
}

export function HomeAnalyticsSection({
  state,
  onRetry,
  showPeriodMetrics = true,
}: {
  state: HomeAnalyticsState;
  onRetry: () => void;
  showPeriodMetrics?: boolean;
}) {
  if (state.status === 'loading') {
    return (
      <section aria-labelledby="home-analytics-title" aria-live="polite">
        <AnalyticsSectionHeading />
        <Card className="rounded-3xl border-dashed py-5 shadow-none">
          <CardContent className="flex items-center gap-3 px-5 text-sm text-muted-foreground">
            <Activity className="size-5 animate-pulse text-primary" />
            分析を読み込み中…
          </CardContent>
        </Card>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section aria-labelledby="home-analytics-title" aria-live="polite">
        <AnalyticsSectionHeading />
        <Card className="rounded-3xl border-dashed py-5 shadow-none">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 px-5">
            <p className="text-sm text-muted-foreground">
              分析データを取得できませんでした
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex min-h-10 items-center gap-2 text-sm font-bold text-primary"
            >
              <RefreshCw className="size-4" /> 再試行
            </button>
          </CardContent>
        </Card>
      </section>
    );
  }

  const summary = state.data;
  if (!summary.hasTrainingData) {
    return (
      <section aria-labelledby="home-analytics-title">
        <AnalyticsSectionHeading period={showPeriodMetrics} />
        <Card className="rounded-3xl border-dashed py-5 shadow-none">
          <CardContent className="px-5">
            <p className="font-bold">まだ分析できる記録がありません</p>
            <p className="mt-1 text-sm text-muted-foreground">
              完了したワークアウトが増えると、PRや傾向を確認できます。
            </p>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section aria-labelledby="home-analytics-title">
      <AnalyticsSectionHeading period={showPeriodMetrics} />

      {summary.insights && (
        <div className="mb-4">
          <InsightsSection summary={summary.insights} exerciseLinks />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {summary.acceptedTargets.length > 0 && (
          <Card className="rounded-3xl border-primary/20 bg-primary/[0.04] py-5 shadow-none lg:col-span-2">
            <CardContent className="px-5">
              <div className="flex items-center gap-2">
                <Target className="size-5 text-primary" />
                <h3 className="font-black">次回目標</h3>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {summary.acceptedTargets.map((target) => (
                  <a
                    key={target.exerciseId}
                    href={APP_ROUTES.analyticsExercise(target.exerciseId)}
                    className="block min-h-11 rounded-2xl bg-background/80 px-4 py-3 transition hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <p className="text-sm font-bold">{target.exerciseName}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      次回 {formatKg(target.targetLoadGrams)} /{' '}
                      {target.targetRepMin}〜{target.targetRepMax}回 ×{' '}
                      {target.targetWorkingSets}
                    </p>
                  </a>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="rounded-3xl py-5 shadow-none">
          <CardContent className="px-5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-amber-600" />
              <h3 className="font-black">トレーニング傾向</h3>
            </div>
            {summary.stagnatingExercises.length > 0 ? (
              <div className="mt-3 space-y-3">
                {summary.stagnatingExercises.map((exercise) => (
                  <a
                    key={exercise.exerciseId}
                    href={APP_ROUTES.analyticsExercise(exercise.exerciseId)}
                    className="flex min-h-11 items-center justify-between gap-3 rounded-xl px-2 py-2 transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <div>
                      <p className="text-sm font-bold">
                        {exercise.exerciseName}
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {exercise.reason}
                      </p>
                    </div>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                  </a>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                現在、大きな停滞はありません
              </p>
            )}
          </CardContent>
        </Card>

        {summary.recentPersonalRecords.length > 0 && (
          <Card className="rounded-3xl py-5 shadow-none">
            <CardContent className="px-5">
              <div className="flex items-center gap-2">
                <Trophy className="size-5 text-amber-500" />
                <h3 className="font-black">最近のPR</h3>
              </div>
              <div className="mt-3 space-y-3">
                {summary.recentPersonalRecords.map((record) => (
                  <a
                    key={`${record.workoutId ?? ''}-${record.exerciseId}-${record.type}-${record.localDate}`}
                    href={APP_ROUTES.analyticsExercise(record.exerciseId)}
                    className="flex min-h-11 items-center justify-between gap-3 rounded-xl px-2 py-1 transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <div>
                      <p className="text-sm font-bold">{record.exerciseName}</p>
                      <p className="text-xs text-muted-foreground">
                        {personalRecordLabel(record)}
                      </p>
                    </div>
                    <time className="text-xs text-muted-foreground">
                      {formatShortDate(record.localDate)}
                    </time>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                  </a>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {showPeriodMetrics && (
          <div className="grid grid-cols-2 gap-3 lg:col-span-2">
            <Card className="rounded-3xl py-5 shadow-none">
              <CardContent className="px-4 sm:px-5">
                <BarChart3 className="size-5 text-primary" />
                <p className="mt-3 text-xs font-bold text-muted-foreground">
                  直近30日
                </p>
                <p className="mt-1 text-xl font-black">
                  {summary.workoutCount30d}回 / {summary.trainingDayCount30d}日
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  週平均 {summary.weeklyAverageWorkoutCount}回
                </p>
              </CardContent>
            </Card>
            <Card className="rounded-3xl py-5 shadow-none">
              <CardContent className="px-4 sm:px-5">
                <Activity className="size-5 text-primary" />
                <p className="mt-3 text-xs font-bold text-muted-foreground">
                  直近7日
                </p>
                <p className="mt-1 text-xl font-black">
                  {summary.workingSetCount7d} sets
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  完了したworking set
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </section>
  );
}
