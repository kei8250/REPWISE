'use client';

import { SetProgressionProposals } from '@/components/workouts/set-progression-proposals';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  ChevronRight,
  Dumbbell,
  RefreshCw,
  Target,
  Trophy,
  TrendingUp,
} from 'lucide-react';
import { TrendChart } from './trend-chart';
import { InsightsSection } from './insights-section';
import { getInsightsForView } from '@/lib/analytics/insights';
import { Card, CardContent } from '@/components/ui/card';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ANALYTICS_RANGE_LABELS,
  ALL_BODY_PARTS,
  analyticsBodyParts,
  analyticsExerciseIdFromSearch,
  filterAnalyticsExercises,
  formatKilograms,
  formatPersonalRecordValue,
  formatPreviousPersonalRecordValue,
  formatShortAnalyticsDate,
  getAnalyticsTrend,
  personalRecordTypeLabel,
  selectAnalyticsExercise,
  sortExercisesByRecent,
  type AnalyticsTrendKind,
} from '@/lib/analytics/detail-view';
import { loadAnalyticsDetail } from '@/lib/analytics/detail-cache';
import {
  ANALYTICS_RANGES,
  type AnalyticsRange,
  type AnalyticsSnapshot,
  type ExerciseAnalytics,
} from '@/lib/analytics/model';
import {
  progressionReasonLabel,
  progressionStatusLabel,
} from '@/lib/progression/completion-summary';
import {
  stagnationReasonLabel,
  stagnationStatusLabel,
} from '@/lib/progression/stagnation';

export type AnalyticsLoadState =
  | { status: 'loading'; data: null }
  | { status: 'error'; data: null }
  | { status: 'success'; data: AnalyticsSnapshot };

const trendLabels: Record<AnalyticsTrendKind, string> = {
  e1rm: '推定1RM',
  max_weight: '最大重量',
  volume: 'Volume',
};

function metric(value: number, suffix: string) {
  return `${new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 }).format(value)}${suffix}`;
}

function MetricCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Activity;
}) {
  return (
    <Card className="rounded-2xl py-4 shadow-none">
      <CardContent className="px-4">
        <Icon className="size-4 text-primary" />
        <p className="mt-2 text-xs font-bold text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-black">{value}</p>
      </CardContent>
    </Card>
  );
}

export function AnalyticsLoadingPanel() {
  return (
    <div
      className="grid min-h-56 place-items-center rounded-3xl border border-dashed bg-card px-5 text-center"
      aria-live="polite"
    >
      <div>
        <Activity className="mx-auto size-6 animate-pulse text-primary" />
        <p className="mt-3 font-bold">分析データを読み込み中…</p>
        <p className="mt-1 text-sm text-muted-foreground">
          期間や種目はこのまま選択できます。
        </p>
      </div>
    </div>
  );
}

export function AnalyticsErrorPanel({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="grid min-h-56 place-items-center rounded-3xl border border-dashed bg-card px-5 text-center">
      <div>
        <AlertTriangle className="mx-auto size-6 text-amber-600" />
        <p className="mt-3 font-bold">分析データを取得できませんでした</p>
        <p className="mt-1 text-sm text-muted-foreground">
          通信状態を確認して、もう一度お試しください。
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground"
        >
          <RefreshCw className="size-4" /> 再試行
        </button>
      </div>
    </div>
  );
}

function EmptyAnalytics() {
  return (
    <Card className="rounded-3xl border-dashed py-8 shadow-none">
      <CardContent className="px-5 text-center">
        <Dumbbell className="mx-auto size-7 text-primary" />
        <p className="mt-3 font-black">この期間に分析できる記録がありません</p>
        <p className="mt-1 text-sm text-muted-foreground">
          期間を広げるか、ワークアウトを完了すると表示されます。
        </p>
      </CardContent>
    </Card>
  );
}

function acceptedTargetText(exercise: ExerciseAnalytics) {
  const target = exercise.currentAcceptedTarget;
  if (
    !target ||
    target.status !== 'accepted' ||
    target.appliedWorkoutId ||
    target.validity !== 'valid'
  ) {
    return null;
  }
  return `${formatKilograms(target.targetLoadGrams)} / ${target.targetRepMin}〜${target.targetRepMax}回 × ${target.targetWorkingSets}`;
}

function progressionTone(status: ExerciseAnalytics['progression']['status']) {
  if (status === 'increase_load') return 'bg-emerald-100 text-emerald-800';
  if (status === 'keep_load' || status === 'set_specific') return 'bg-blue-100 text-blue-800';
  return 'bg-muted text-muted-foreground';
}

function stagnationTone(status: ExerciseAnalytics['stagnation']['status']) {
  if (status === 'progressing') return 'bg-emerald-100 text-emerald-800';
  if (status === 'stagnating') return 'bg-amber-100 text-amber-900';
  return 'bg-muted text-muted-foreground';
}

export function AnalyticsDataView({
  analytics,
  selectedExerciseId,
  onSelectExercise,
  trendKind,
  onTrendKindChange,
}: {
  analytics: AnalyticsSnapshot;
  selectedExerciseId: string | null;
  onSelectExercise: (exerciseId: string) => void;
  trendKind: AnalyticsTrendKind;
  onTrendKindChange: (kind: AnalyticsTrendKind) => void;
}) {
  const [bodyPartFilter, setBodyPartFilter] = useState(ALL_BODY_PARTS);

  if (analytics.workouts.completedWorkoutCount === 0) return <EmptyAnalytics />;

  const exercises = sortExercisesByRecent(analytics.exercises);
  const bodyParts = analyticsBodyParts(exercises);
  const statusExercises = filterAnalyticsExercises(exercises, bodyPartFilter);
  const selectedExercise = selectAnalyticsExercise(
    { ...analytics, exercises: statusExercises },
    selectedExerciseId,
  );
  const bodyPartMax = Math.max(
    1,
    ...analytics.bodyParts.map((part) => part.workingSetCount),
  );

  return (
    <div className="space-y-5">
      <InsightsSection
        summary={getInsightsForView(analytics, 'detail')}
        detailed
      />
      <section aria-labelledby="period-summary-title">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 id="period-summary-title" className="text-lg font-black">
            期間サマリー
          </h2>
          <p className="text-xs text-muted-foreground">
            {analytics.period.startDate
              ? `${formatShortAnalyticsDate(analytics.period.startDate)}〜${formatShortAnalyticsDate(analytics.period.endDate)}`
              : `〜${formatShortAnalyticsDate(analytics.period.endDate)}`}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard
            label="ワークアウト"
            value={metric(analytics.workouts.completedWorkoutCount, '回')}
            icon={Dumbbell}
          />
          <MetricCard
            label="トレーニング日"
            value={metric(analytics.workouts.trainingDayCount, '日')}
            icon={CalendarDays}
          />
          <MetricCard
            label="週平均"
            value={metric(analytics.workouts.weeklyAverageWorkoutCount, '回')}
            icon={TrendingUp}
          />
          <MetricCard
            label="Working sets"
            value={metric(analytics.workouts.workingSetCount, ' sets')}
            icon={Activity}
          />
        </div>
      </section>

      {selectedExercise ? (
        <>
          <section aria-labelledby="exercise-overview-title">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-bold tracking-[0.14em] text-primary">
                  EXERCISE
                </p>
                <h2
                  id="exercise-overview-title"
                  className="mt-1 text-lg font-black"
                >
                  種目分析
                </h2>
              </div>
              <label className="text-sm font-bold">
                <span className="mb-1.5 block text-muted-foreground">
                  分析する種目
                </span>
                <NativeSelect
                  className="w-full min-w-0 [&>select]:h-11 sm:w-72"
                  value={selectedExercise.exerciseId}
                  onChange={(event) => onSelectExercise(event.target.value)}
                  aria-label="分析する種目"
                >
                  {statusExercises.map((exercise) => (
                    <NativeSelectOption
                      key={exercise.exerciseId}
                      value={exercise.exerciseId}
                    >
                      {exercise.exerciseName}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
            </div>

            <Card className="rounded-3xl py-5 shadow-none">
              <CardContent className="px-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-xl font-black">
                      {selectedExercise.exerciseName}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {selectedExercise.bodyPart === 'unknown'
                        ? '部位未設定'
                        : selectedExercise.bodyPart}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold ${progressionTone(selectedExercise.progression.status)}`}
                    >
                      {progressionStatusLabel(
                        selectedExercise.progression.status,
                      )}
                    </span>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold ${stagnationTone(selectedExercise.stagnation.status)}`}
                    >
                      {stagnationStatusLabel(
                        selectedExercise.stagnation.status,
                      )}
                    </span>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-muted/45 p-4">
                    <p className="text-xs font-bold text-muted-foreground">
                      直近最大重量
                    </p>
                    <p className="mt-1 text-lg font-black">
                      {selectedExercise.maxWeightTrend.at(-1)
                        ? formatKilograms(
                            selectedExercise.maxWeightTrend.at(-1)?.value ?? 0,
                          )
                        : '記録なし'}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-muted/45 p-4">
                    <p className="text-xs font-bold text-muted-foreground">
                      Best e1RM
                    </p>
                    <p className="mt-1 text-lg font-black">
                      {selectedExercise.e1rmTrend.length > 0
                        ? formatKilograms(
                            Math.max(
                              ...selectedExercise.e1rmTrend.map(
                                (point) => point.value,
                              ),
                            ),
                          )
                        : '記録なし'}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-2xl border p-4">
                    <p className="text-sm font-black">直近実績の自動判定</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {progressionReasonLabel(
                        selectedExercise.progression.reasonCode,
                      )}
                    </p>
                  </div>
                  <div className="rounded-2xl border p-4">
                    <p className="text-sm font-black">複数回の傾向</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {stagnationReasonLabel(selectedExercise.stagnation)}
                    </p>
                  </div>
                </div>

                <SetProgressionProposals items={selectedExercise.progression.setDecisions} />
                <p className="mt-3 text-xs text-muted-foreground">左右別の最大重量・推定1RMは片側1回の負荷に換算します。ボリュームは保存した重量基準と左右の回数から計算します。</p>
                {acceptedTargetText(selectedExercise) && (
                  <div className="mt-4 flex items-start gap-3 rounded-2xl bg-primary/[0.06] p-4">
                    <Target className="mt-0.5 size-5 shrink-0 text-primary" />
                    <div>
                      <p className="text-sm font-black">未実施の次回目標</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {acceptedTargetText(selectedExercise)}
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          <section aria-labelledby="trend-title">
            <Card className="rounded-3xl py-5 shadow-none">
              <CardContent className="px-4 sm:px-5">
                <div className="mb-4">
                  <p className="text-xs font-bold tracking-[0.14em] text-primary">
                    TREND
                  </p>
                  <h2 id="trend-title" className="mt-1 text-lg font-black">
                    伸びの推移
                  </h2>
                </div>
                <Tabs
                  value={trendKind}
                  onValueChange={(value) =>
                    onTrendKindChange(value as AnalyticsTrendKind)
                  }
                >
                  <TabsList className="grid h-11 w-full grid-cols-3 rounded-xl">
                    <TabsTrigger value="e1rm">e1RM</TabsTrigger>
                    <TabsTrigger value="max_weight">最大重量</TabsTrigger>
                    <TabsTrigger value="volume">Volume</TabsTrigger>
                  </TabsList>
                </Tabs>
                <div className="mt-4">
                  <TrendChart
                    points={getAnalyticsTrend(selectedExercise, trendKind)}
                    label={`${selectedExercise.exerciseName}の${trendLabels[trendKind]}`}
                    formatValue={(value) => formatKilograms(value)}
                  />
                </div>
              </CardContent>
            </Card>
          </section>

          <section aria-labelledby="pr-history-title">
            <Card className="rounded-3xl py-5 shadow-none">
              <CardContent className="px-5">
                <div className="flex items-center gap-2">
                  <Trophy className="size-5 text-amber-500" />
                  <h2 id="pr-history-title" className="text-lg font-black">
                    PR履歴
                  </h2>
                </div>
                {selectedExercise.personalRecordHistory.length > 0 ? (
                  <div className="mt-4 divide-y">
                    {[...selectedExercise.personalRecordHistory]
                      .sort((left, right) =>
                        right.localDate.localeCompare(left.localDate),
                      )
                      .slice(0, 12)
                      .map((record) => (
                        <div
                          key={`${record.workoutId}-${record.type}-${record.value}`}
                          className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
                        >
                          <div>
                            <p className="text-sm font-black">
                              {personalRecordTypeLabel(record.type)}
                            </p>
                            <p className="mt-0.5 text-sm text-muted-foreground">
                              {formatPersonalRecordValue(record)}
                            </p>
                            {formatPreviousPersonalRecordValue(record) && (
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {formatPreviousPersonalRecordValue(record)}
                              </p>
                            )}
                          </div>
                          <time className="text-sm text-muted-foreground">
                            {formatShortAnalyticsDate(record.localDate)}
                          </time>
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    この期間にPRはありません
                  </p>
                )}
              </CardContent>
            </Card>
          </section>
        </>
      ) : (
        <EmptyAnalytics />
      )}

      <section aria-labelledby="body-part-title">
        <Card className="rounded-3xl py-5 shadow-none">
          <CardContent className="px-5">
            <h2 id="body-part-title" className="text-lg font-black">
              部位別バランス
            </h2>
            {analytics.bodyParts.length > 0 ? (
              <div className="mt-4 space-y-4">
                {[...analytics.bodyParts]
                  .sort(
                    (left, right) =>
                      right.workingSetCount - left.workingSetCount,
                  )
                  .map((part) => (
                    <div key={part.bodyPart}>
                      <div className="flex items-end justify-between gap-3">
                        <p className="text-sm font-black">
                          {part.bodyPart === 'unknown'
                            ? '未設定'
                            : part.bodyPart}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {part.workingSetCount} sets · {part.trainingDayCount}
                          日 · {part.exerciseCount}種目
                        </p>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{
                            width: `${Math.max(
                              4,
                              (part.workingSetCount / bodyPartMax) * 100,
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                部位別に集計できる記録がありません
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="status-list-title">
        <Card className="rounded-3xl py-5 shadow-none">
          <CardContent className="px-5">
            <h2 id="status-list-title" className="text-lg font-black">
              種目ごとの現在状態
            </h2>
            <p className="mt-2 text-xs text-muted-foreground">部位選択は上の種目分析とこの一覧に共通です。期間サマリー・部位別バランスは全身を表示します。</p>
            <div
              className="mt-3 flex flex-wrap gap-2"
              aria-label="部位で絞り込む"
            >
              {[ALL_BODY_PARTS, ...bodyParts].map((bodyPart) => (
                <button
                  key={bodyPart}
                  type="button"
                  aria-pressed={bodyPartFilter === bodyPart}
                  onClick={() => {
                    setBodyPartFilter(bodyPart);
                    const candidates = filterAnalyticsExercises(exercises, bodyPart);
                    const next = candidates.find(item => item.exerciseId === selectedExerciseId) ?? candidates[0];
                    if (next) onSelectExercise(next.exerciseId);
                  }}
                  className="min-h-11 shrink-0 rounded-full border px-4 text-sm font-bold text-muted-foreground transition aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                >
                  {bodyPart === ALL_BODY_PARTS ? 'すべて' : bodyPart}
                </button>
              ))}
            </div>
            <div className="mt-4 divide-y">
              {statusExercises.map((exercise) => (
                <button
                  key={exercise.exerciseId}
                  type="button"
                  aria-pressed={
                    selectedExercise?.exerciseId === exercise.exerciseId
                  }
                  aria-label={`${exercise.exerciseName}の分析を表示`}
                  onClick={() => {
                    onSelectExercise(exercise.exerciseId);
                    requestAnimationFrame(() => {
                      document
                        .getElementById('exercise-overview-title')
                        ?.scrollIntoView({
                          behavior: 'smooth',
                          block: 'start',
                        });
                    });
                  }}
                  className="grid min-h-16 w-full gap-2 rounded-xl px-2 py-4 text-left transition first:mt-0 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary aria-pressed:bg-primary/[0.06] sm:grid-cols-[1fr_auto_auto] sm:items-center"
                >
                  <div>
                    <p className="text-sm font-black">
                      {exercise.exerciseName}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {stagnationReasonLabel(exercise.stagnation)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-bold ${progressionTone(exercise.progression.status)}`}
                    >
                      {progressionStatusLabel(exercise.progression.status)}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-bold ${stagnationTone(exercise.stagnation.status)}`}
                    >
                      {stagnationStatusLabel(exercise.stagnation.status)}
                    </span>
                  </div>
                  <ChevronRight className="hidden size-4 text-muted-foreground sm:block" />
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

export function AnalyticsDashboard() {
  const [range, setRange] = useState<AnalyticsRange>('30d');
  const [state, setState] = useState<AnalyticsLoadState>({
    status: 'loading',
    data: null,
  });
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(
    null,
  );
  const [trendKind, setTrendKind] = useState<AnalyticsTrendKind>('e1rm');
  const [retryAttempt, setRetryAttempt] = useState(0);
  const forceNextRequest = useRef(false);
  const requestSequence = useRef(0);
  const initialExerciseHandled = useRef(false);

  useEffect(() => {
    let mounted = true;
    const requestId = ++requestSequence.current;
    const force = forceNextRequest.current;
    forceNextRequest.current = false;
    void loadAnalyticsDetail(range, force).then(
      (data) => {
        if (!mounted || requestSequence.current !== requestId) return;
        setState({ status: 'success', data });
        setSelectedExerciseId((current) => {
          const requestedExerciseId = initialExerciseHandled.current
            ? null
            : analyticsExerciseIdFromSearch(window.location.search);
          initialExerciseHandled.current = true;
          const candidate = requestedExerciseId ?? current;
          return data.exercises.some(
            (exercise) => exercise.exerciseId === candidate,
          )
            ? candidate
            : (sortExercisesByRecent(data.exercises)[0]?.exerciseId ?? null);
        });
      },
      () => {
        if (mounted && requestSequence.current === requestId) {
          setState({ status: 'error', data: null });
        }
      },
    );
    return () => {
      mounted = false;
    };
  }, [range, retryAttempt]);

  useEffect(() => {
    const refresh = () => { forceNextRequest.current = true; setRetryAttempt((value) => value + 1); };
    window.addEventListener('repwise-sync-queue-change', refresh);
    return () => window.removeEventListener('repwise-sync-queue-change', refresh);
  }, []);

  const selectedRangeLabel = useMemo(
    () => ANALYTICS_RANGE_LABELS[range],
    [range],
  );

  const handleSelectExercise = (exerciseId: string) => {
    setSelectedExerciseId(exerciseId);
    const url = new URL(window.location.href);
    url.searchParams.set('exerciseId', exerciseId);
    window.history.replaceState(window.history.state, '', url);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-7 lg:p-10">
      <section aria-labelledby="range-title">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 id="range-title" className="text-sm font-black">
            表示期間
          </h2>
          <p className="text-xs text-muted-foreground">
            {selectedRangeLabel}を表示中
          </p>
        </div>
        <div
          className="grid grid-cols-4 gap-1 rounded-2xl bg-muted p-1"
          aria-label="分析期間"
        >
          {ANALYTICS_RANGES.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={range === item}
              onClick={() => {
                if (item !== range) {
                  setState({ status: 'loading', data: null });
                  setRange(item);
                }
              }}
              className="min-h-11 rounded-xl px-1 text-sm font-bold text-muted-foreground transition aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
            >
              {ANALYTICS_RANGE_LABELS[item]}
            </button>
          ))}
        </div>
      </section>

      {state.status === 'loading' && <AnalyticsLoadingPanel />}
      {state.status === 'error' && (
        <AnalyticsErrorPanel
          onRetry={() => {
            forceNextRequest.current = true;
            setState({ status: 'loading', data: null });
            setRetryAttempt((attempt) => attempt + 1);
          }}
        />
      )}
      {state.status === 'success' && (
        <AnalyticsDataView
          analytics={state.data}
          selectedExerciseId={selectedExerciseId}
          onSelectExercise={handleSelectExercise}
          trendKind={trendKind}
          onTrendKindChange={setTrendKind}
        />
      )}
    </div>
  );
}
