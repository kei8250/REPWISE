'use client';

import { useEffect, useState, useRef, type SubmitEvent } from 'react';
import { listExerciseMasters, getAnalytics } from '@/lib/workouts/api-client';
import type { ExerciseMaster } from '@/lib/workouts/types';
import type { AnalyticsSnapshot } from '@/lib/analytics/model';
import { formatKilograms } from '@/lib/analytics/detail-view';
import {
  addMonths,
  bestGoalPerformance,
  goalProgress,
  goalPerformancePoints,
  localToday,
  type TrainingGoal,
  validateGoal,
} from '@/lib/goals/model';
import {
  GOALS_KEY,
  parseGoals,
  saveGoal,
  serializeGoals,
  mergeGoals,
} from '@/lib/goals/storage';
import { RmProgressEvidence } from './rm-progress-evidence';
import { defaultRmMethod, RM_METHODS, type RmMethod } from '@/lib/goals/rm';
import { Card, CardContent } from '@/components/ui/card';

const field =
  'mt-1 min-h-11 w-full rounded-xl border bg-background px-3 py-2 text-base';
const button =
  'min-h-11 rounded-xl border px-4 py-2 text-sm font-bold disabled:opacity-50 aria-pressed:bg-primary aria-pressed:text-primary-foreground';
const kg = (g: number) => formatKilograms(g, 2);

export function GoalsDashboard() {
  const [goals, setGoals] = useState<TrainingGoal[]>([]);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<AnalyticsSnapshot | null>(null);
  const [exercises, setExercises] = useState<ExerciseMaster[]>([]);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState<TrainingGoal | 'new' | null>(null);
  const [archived, setArchived] = useState(false);
  const [part, setPart] = useState('all');
  const [today, setToday] = useState('');

  useEffect(() => {
    const refresh = () => {
      setToday(localToday());
      try {
        setGoals(parseGoals(window.localStorage.getItem(GOALS_KEY)));
        setReady(true);
      } catch {
        setReady(false);
        setError(
          '保存済みの目標を読み込めません。既存データを保護するため保存を停止しています。ブラウザの保存設定を確認してください。',
        );
      }
    };
    refresh();
    const onStorage = (event: StorageEvent) => {
      if (event.key === GOALS_KEY || event.key === null) refresh();
    };
    const refreshRecords = () => setAttempt((a) => a + 1);
    const onFocus = () => {
      refresh();
      refreshRecords();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocus);
    window.addEventListener('repwise-sync-queue-change', refreshRecords);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('repwise-sync-queue-change', refreshRecords);
    };
  }, []);
  useEffect(() => {
    let active = true;
    Promise.all([getAnalytics('all'), listExerciseMasters()])
      .then(([analytics, masters]) => {
        if (active) {
          setLoadError(false);
          setData(analytics);
          setExercises(masters);
        }
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  const persist = (goal: TrainingGoal, previous?: string) => {
    try {
      setGoals(
        saveGoal({ ...goal, updatedAt: new Date().toISOString() }, previous),
      );
      setEditing(null);
      setError('');
      return null;
    } catch (e) {
      const message = e instanceof Error ? e.message : '保存できませんでした';
      setError(message);
      return message;
    }
  };
  const parts = [...new Set(goals.map((g) => g.bodyPart || 'その他'))];
  const visible = goals.filter(
    (g) =>
      (g.status === 'archived') === archived &&
      (part === 'all' || g.bodyPart === part),
  );
  const backup = () => {
    const blob = new Blob([serializeGoals(goals)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `repwise-goals-${today}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-7 lg:p-10">
      <Card className="rounded-3xl shadow-none">
        <CardContent className="space-y-4 pt-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-black">未来の自分を目標にする</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                3か月・半年・1年先の重量と回数を決めて、今月の一歩を確認しましょう。
              </p>
            </div>
            <button
              className={`${button} bg-primary text-primary-foreground`}
              disabled={!ready || !data || !!editing}
              onClick={() => setEditing('new')}
            >
              目標を追加
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            目標はこのブラウザ・端末に保存されます。端末間では同期されません。バックアップを保存し、別端末では読み込んで引き継げます。トレーニング記録は変更しません。
          </p>
          <details>
            <summary className="cursor-pointer py-2 text-sm font-bold">
              バックアップ・引き継ぎ
            </summary>
            <div className="mt-2 flex flex-wrap gap-3">
              <button className={button} disabled={!ready} onClick={backup}>
                JSONを書き出す
              </button>
              <label className={`${button} cursor-pointer`}>
                JSONを読み込む
                <input
                  className="sr-only"
                  type="file"
                  accept="application/json,.json"
                  disabled={!ready}
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (!file) return;
                    try {
                      if (file.size > 2000000)
                        throw new Error('2MB以下のファイルを選んでください');
                      setGoals(mergeGoals(parseGoals(await file.text())));
                      setError('');
                    } catch (e) {
                      setError(
                        e instanceof Error
                          ? e.message
                          : '読み込みに失敗しました',
                      );
                    }
                  }}
                />
              </label>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              既存の同じIDの目標は上書きしません。同じ種目の管理中の目標がある場合は読み込みを停止します。
            </p>
          </details>
        </CardContent>
      </Card>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive p-4 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {loadError ? (
        <div role="alert" className="rounded-xl border p-4">
          <p>記録の取得に失敗しました。保存済みの目標は保持しています。</p>
          <button
            className={`${button} mt-3`}
            onClick={() => {
              setLoadError(false);
              setData(null);
              setAttempt((a) => a + 1);
            }}
          >
            記録を再取得
          </button>
        </div>
      ) : (
        !data && <output>目標に対する実績を読み込み中…</output>
      )}
      {editing && data && (
        <GoalForm
          key={editing === 'new' ? 'new' : editing.id}
          goal={editing === 'new' ? null : editing}
          exercises={exercises}
          analytics={data}
          today={today}
          onSave={persist}
          onCancel={() => setEditing(null)}
        />
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          className={button}
          aria-pressed={!archived}
          onClick={() => setArchived(false)}
        >
          管理中
        </button>
        <button
          className={button}
          aria-pressed={archived}
          onClick={() => setArchived(true)}
        >
          終了した目標
        </button>
        <label className="ml-auto text-sm">
          部位
          <select
            className={field}
            value={part}
            onChange={(e) => setPart(e.target.value)}
          >
            <option value="all">すべて</option>
            {parts.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
      </div>
      {ready && !visible.length && (
        <p className="rounded-3xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {archived
            ? '終了した目標はありません。'
            : 'まだ目標がありません。「目標を追加」から、目指したい重量と回数を決めましょう。'}
        </p>
      )}
      {visible
        .sort((a, b) => a.deadline.localeCompare(b.deadline))
        .map((goal) => {
          const points = goalPerformancePoints(
            data?.exercises.find((e) => e.exerciseId === goal.exerciseId),
          );
          const progress =
            data && !loadError ? goalProgress(goal, points, today) : null;
          const state =
            goal.status === 'archived'
              ? '終了'
              : goal.status === 'paused'
                ? '一時停止中'
                : progress?.achieved
                  ? '目標達成！'
                  : progress?.overdue
                    ? '期限を迎えました'
                    : '挑戦中';
          return (
            <Card
              id={`goal-${goal.id}`}
              key={goal.id}
              className="scroll-mt-5 rounded-3xl shadow-none"
            >
              <CardContent className="space-y-4 pt-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {goal.bodyPart} · {goal.deadline}まで
                    </p>
                    <h3 className="mt-1 text-lg font-black">
                      {goal.exerciseName}
                    </h3>
                  </div>
                  <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-bold text-primary">
                    {state}
                  </span>
                </div>
                <p className="text-2xl font-black">
                  {kg(goal.targetLoadGrams)} × {goal.targetReps}回
                </p>
                {progress && (
                  <>
                    <div>
                      <div className="flex justify-between gap-2 text-sm">
                        <span>目標達成度（RM換算）</span>
                        <strong>
                          {progress.percent === null
                            ? '換算データなし'
                            : `${progress.percent}%`}
                        </strong>
                      </div>
                      <progress
                        aria-label={`${goal.exerciseName}の目標進捗`}
                        aria-valuetext={
                          progress.percent === null
                            ? '換算データなし'
                            : `${progress.percent}%（RM換算）`
                        }
                        value={progress.barPercent}
                        max={100}
                        className="mt-2 h-3 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary"
                      />
                    </div>
                    <RmProgressEvidence progress={progress} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl bg-muted/50 p-4">
                        <p className="text-xs text-muted-foreground">
                          開始値 → 目標{goal.targetReps}回への換算重量（推定）
                        </p>
                        <p className="mt-1 font-black">
                          {kg(goal.startLoadGrams)} →{' '}
                          {progress.percent === null
                            ? '換算なし'
                            : kg(progress.currentLoadGrams)}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {progress.actual
                            ? `${progress.actual.localDate}：${kg(progress.actual.loadGrams)} × ${progress.actual.bestReps}回`
                            : '換算できる過去の実績がまだありません。開始値は計画のみに使用します。'}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-primary/5 p-4">
                        <p className="text-xs text-muted-foreground">
                          {progress.achieved
                            ? '達成おめでとうございます！'
                            : progress.percent === null
                              ? 'RM換算実績なし'
                              : `目標回数への換算であと${kg(progress.remainingGrams)}（推定）`}
                        </p>
                        <p className="mt-1 font-black">
                          {progress.achieved
                            ? `${kg(goal.targetLoadGrams)}で${goal.targetReps}回以上を実測で達成`
                            : `残り${progress.daysLeft}日`}
                        </p>
                      </div>
                    </div>
                    {goal.status === 'active' && !progress.achieved && (
                      <div className="rounded-2xl border p-4">
                        <h4 className="font-black">
                          {progress.overdue
                            ? '目標を見直して、次の一歩へ'
                            : `${progress.milestone.date}までの目安`}
                        </h4>
                        <p className="mt-2 text-lg font-black">
                          {kg(progress.milestone.loadGrams)} × {goal.targetReps}
                          回
                        </p>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {progress.overdue
                            ? '期限を延ばす・重量を調整するなど、無理のない計画に編集できます。'
                            : progress.percent === null
                              ? '換算実績がないため、開始値からの計画です。'
                              : progress.monthlyIncreaseGrams > 0
                                ? `目標回数への換算重量からあと${kg(progress.monthlyIncreaseGrams)}（推定）が今月の計画上の目安です。`
                                : '今月の重量目安に届いています。この調子で積み重ねましょう。'}
                        </p>
                      </div>
                    )}
                    <details>
                      <summary className="cursor-pointer py-2 text-sm font-bold">
                        月ごとの到達目安を見る
                      </summary>
                      <div className="mt-2 divide-y">
                        {progress.checkpoints.map((p) => (
                          <div
                            key={p.date}
                            className="flex flex-wrap justify-between gap-2 py-3 text-sm"
                          >
                            <time>{p.date}</time>
                            <strong>
                              {kg(p.loadGrams)} × {goal.targetReps}回
                            </strong>
                          </div>
                        ))}
                      </div>
                      <p className="mt-3 text-xs text-muted-foreground">
                        開始重量から期限までを均等に分け、設定した増量幅で切り上げた計画です。成長予測や毎月の増量指示ではありません。調子に合わせて調整してください。
                      </p>
                    </details>
                  </>
                )}
                {goal.note && (
                  <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                    {goal.note}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    className={button}
                    disabled={!ready || !data || !!editing}
                    onClick={() => setEditing(goal)}
                  >
                    編集
                  </button>
                  {goal.status !== 'archived' ? (
                    <>
                      <button
                        className={button}
                        disabled={!ready}
                        onClick={() =>
                          persist(
                            {
                              ...goal,
                              status:
                                goal.status === 'paused' ? 'active' : 'paused',
                            },
                            goal.updatedAt,
                          )
                        }
                      >
                        {goal.status === 'paused' ? '再開する' : '一時停止'}
                      </button>
                      <button
                        className={button}
                        disabled={!ready}
                        onClick={() =>
                          persist(
                            { ...goal, status: 'archived' },
                            goal.updatedAt,
                          )
                        }
                      >
                        {progress?.achieved
                          ? '達成した目標を保管'
                          : 'この目標を終了'}
                      </button>
                    </>
                  ) : (
                    <button
                      className={button}
                      disabled={!ready}
                      onClick={() =>
                        persist({ ...goal, status: 'active' }, goal.updatedAt)
                      }
                    >
                      管理中に戻す
                    </button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      <p className="text-xs leading-relaxed text-muted-foreground">
        RM換算達成率は過去の完了済みセットの推定1RMを、目標重量・目標回数の推定1RMで割って計算します。実測達成は目標重量と目標回数を両方満たした記録で別判定します。削除した記録やウォームアップは含みません。左右別種目は片側の重量・左右の少ない方の回数で比較します。
      </p>
    </div>
  );
}

function GoalForm({
  goal,
  exercises,
  analytics,
  today,
  onSave,
  onCancel,
}: {
  goal: TrainingGoal | null;
  exercises: ExerciseMaster[];
  analytics: AnalyticsSnapshot;
  today: string;
  onSave: (goal: TrainingGoal, previous?: string) => string | null;
  onCancel: () => void;
}) {
  const [exerciseId, setExerciseId] = useState(
    goal?.exerciseId ?? exercises[0]?.id ?? '',
  );
  const [reps, setReps] = useState(String(goal?.targetReps ?? 8));
  const best = (id: string, targetReps: number) =>
    bestGoalPerformance(
      analytics.exercises.find((e) => e.exerciseId === id)?.repTrend ?? [],
      targetReps,
      today,
    );
  const initial = best(exerciseId, Number(reps))?.loadGrams ?? 0;
  const [start, setStart] = useState(
    String((goal?.startLoadGrams ?? initial) / 1000),
  );
  const [weight, setWeight] = useState(
    String((goal?.targetLoadGrams ?? initial + 10000) / 1000),
  );
  const [increment, setIncrement] = useState(
    String((goal?.incrementGrams ?? 2500) / 1000),
  );
  const [deadline, setDeadline] = useState(
    goal?.deadline ?? addMonths(today, 3),
  );
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  const [selectedMonths, setSelectedMonths] = useState<number | null>(() =>
    goal
      ? ([3, 6, 12].find(
          (m) => addMonths(goal.startDate, m) === goal.deadline,
        ) ?? null)
      : 3,
  );
  const [rmMethod, setRmMethod] = useState<RmMethod>(
    goal?.rmMethod ??
      defaultRmMethod(
        goal?.exerciseName ??
          exercises.find((e) => e.id === exerciseId)?.name ??
          '',
      ),
  );
  const [note, setNote] = useState(goal?.note ?? '');
  const [formError, setFormError] = useState('');
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const master = exercises.find((e) => e.id === exerciseId);
    if (!master && !goal) {
      setFormError('種目を選択してください');
      return;
    }
    const grams = (value: string) => Math.round(Number(value) * 1000);
    const next: TrainingGoal = {
      id: goal?.id ?? crypto.randomUUID(),
      exerciseId,
      exerciseName: master?.name ?? goal!.exerciseName,
      bodyPart: master?.bodyPart || goal?.bodyPart || 'その他',
      startDate: goal?.startDate ?? today,
      deadline,
      startLoadGrams: grams(start),
      targetLoadGrams: grams(weight),
      targetReps: Number(reps),
      incrementGrams: grams(increment),
      status: goal?.status ?? 'active',
      rmMethod,
      note,
      updatedAt: new Date().toISOString(),
    };
    try {
      validateGoal(next);
      const error = onSave(next, goal?.updatedAt);
      if (error) setFormError(error);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : '入力を確認してください',
      );
    }
  };
  return (
    <dialog
      ref={dialog}
      aria-labelledby="goal-editor-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-3xl bg-background p-0 text-foreground shadow-xl backdrop:bg-black/40"
    >
      <Card className="rounded-3xl border-primary/40 shadow-none">
        <CardContent className="pt-5">
          <form onSubmit={submit} className="space-y-4">
            <h2 id="goal-editor-title" className="text-lg font-black">
              {goal ? '目標を編集' : '新しい目標'}
            </h2>
            {formError && <p role="alert">{formError}</p>}
            <label className="block text-sm font-bold">
              種目
              <select
                className={field}
                value={exerciseId}
                disabled={!!goal}
                required
                onChange={(e) => {
                  setExerciseId(e.target.value);
                  setRmMethod(
                    defaultRmMethod(
                      exercises.find((master) => master.id === e.target.value)
                        ?.name ?? '',
                    ),
                  );
                  const baseline =
                    best(e.target.value, Number(reps))?.loadGrams ?? 0;
                  setStart(String(baseline / 1000));
                  setWeight(String((baseline + 10000) / 1000));
                }}
              >
                {goal && !exercises.some((e) => e.id === goal.exerciseId) && (
                  <option value={goal.exerciseId}>{goal.exerciseName}</option>
                )}
                {exercises.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-bold">
              RM換算方式
              <select
                className={field}
                value={rmMethod}
                onChange={(e) => setRmMethod(e.target.value as RmMethod)}
              >
                {(Object.keys(RM_METHODS) as RmMethod[]).map((method) => (
                  <option key={method} value={method}>
                    {RM_METHODS[method].label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs font-normal text-muted-foreground">
                ベンチは係数40、スクワット・デッドリフトは33.3の簡易式。目標の重量・回数も同じ式で推定1RMに換算します。換算対象は1〜12回。他種目は参考値です。
              </span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-bold">
                目標重量（kg）
                <input
                  className={field}
                  type="number"
                  min="0.001"
                  max="2000"
                  step="0.001"
                  value={weight}
                  required
                  onChange={(e) => setWeight(e.target.value)}
                />
              </label>
              <label className="block text-sm font-bold">
                その重量での目標回数
                <input
                  className={field}
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  value={reps}
                  required
                  onChange={(e) => {
                    setReps(e.target.value);
                    if (!goal)
                      setStart(
                        String(
                          (best(exerciseId, Number(e.target.value))
                            ?.loadGrams ?? 0) / 1000,
                        ),
                      );
                  }}
                />
              </label>
            </div>
            <div>
              <p className="text-sm font-bold">いつまでに？</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {[3, 6, 12].map((months) => (
                  <button
                    type="button"
                    className={button}
                    key={months}
                    aria-pressed={selectedMonths === months}
                    onClick={() => {
                      setSelectedMonths(months);
                      setDeadline(addMonths(goal?.startDate ?? today, months));
                    }}
                  >
                    {months === 12 ? '1年' : months === 6 ? '半年' : '3か月'}
                  </button>
                ))}
              </div>
              <label className="mt-3 block text-sm">
                期限
                <input
                  className={field}
                  type="date"
                  value={deadline}
                  required
                  min={addMonths(goal?.startDate ?? today, 0)}
                  onChange={(e) => {
                    setDeadline(e.target.value);
                    setSelectedMonths(null);
                  }}
                />
              </label>
            </div>
            <details>
              <summary className="cursor-pointer py-2 text-sm font-bold">
                開始値・増量幅・メモを調整
              </summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  開始重量（{reps || '—'}回できる重量・kg）
                  <input
                    className={field}
                    type="number"
                    min="0"
                    max="2000"
                    step="0.001"
                    value={start}
                    required
                    onChange={(e) => setStart(e.target.value)}
                  />
                </label>
                <label className="text-sm">
                  1段階の増量幅（kg）
                  <input
                    className={field}
                    type="number"
                    min="0.001"
                    max="100"
                    step="0.001"
                    value={increment}
                    required
                    onChange={(e) => setIncrement(e.target.value)}
                  />
                </label>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                開始値には目標回数以上の過去最高重量を仮入力します。該当記録がなければ0kgです。重量は片側1回分で指定してください。開始日は
                {goal?.startDate ?? today}です。
              </p>
              <label className="mt-3 block text-sm">
                目標の理由・メモ
                <textarea
                  className={field}
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
            </details>
            <div className="flex gap-2">
              <button
                className={`${button} bg-primary text-primary-foreground`}
                type="submit"
              >
                目標を保存
              </button>
              <button className={button} type="button" onClick={onCancel}>
                キャンセル
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    </dialog>
  );
}
