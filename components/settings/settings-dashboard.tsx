'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { listExerciseMasters, getWorkoutSyncState } from '@/lib/workouts/api-client';
import { updateCachedExerciseMaster } from '@/lib/workouts/exercise-master-cache';
import { readLocalWorkoutSources, exportWorkoutRecoveryData, recoverLegacyWorkoutQueue, reconcileDeletedWorkout, repairCompletedWorkoutDraft } from '@/lib/workouts/local-drafts';
import { syncPendingWorkoutMutations } from '@/lib/workouts/sync-queue';
import type {
  ExerciseMaster,
  UpdateExerciseMasterInput,
} from '@/lib/workouts/types';
import { summarizeSyncQueue } from '@/lib/workouts/sync-overview';
import { LoadBasisSelect } from '@/components/workouts/load-basis-select';
import { WorkoutSummaryList } from '@/components/workouts/workout-summary-list';
import { deleteWorkoutRecord } from '@/lib/workouts/draft-deletion';
import { syncAutomatically } from '@/lib/workouts/sync-timing';
import { WorkoutSyncList } from './workout-sync-list';

export function SettingsDashboard() {
  const [items, setItems] = useState<ExerciseMaster[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [masterError, setMasterError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [local, setLocal] = useState<Awaited<
    ReturnType<typeof readLocalWorkoutSources>
  > | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refreshLocal = useCallback(
    () =>
      readLocalWorkoutSources().then(setLocal, (cause: unknown) =>
        setLocalError(
          cause instanceof Error
            ? cause.message
            : '端末の保存状態を取得できませんでした',
        ),
      ),
    [],
  );

  useEffect(() => {
    let alive = true;
    const update = () => {
      void readLocalWorkoutSources().then(
        (data) => {
          if (alive) {
            setLocal(data);
            setLocalError(null);
          }
        },
        (cause: unknown) => {
          if (alive)
            setLocalError(
              cause instanceof Error
                ? cause.message
                : '保存状態を取得できませんでした',
            );
        },
      );
    };
    update();
    window.addEventListener('repwise-sync-queue-change', update);
    void listExerciseMasters()
      .then(
        (data) => {
          if (alive) setItems(data);
        },
        (cause: unknown) => {
          if (alive)
            setMasterError(
              cause instanceof Error
                ? cause.message
                : '種目を取得できませんでした',
            );
        },
      )
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      window.removeEventListener('repwise-sync-queue-change', update);
    };
  }, []);

  const retryCatalog = async () => {
    setLoading(true);
    setMasterError(null);
    try {
      setItems(await listExerciseMasters());
    } catch (cause) {
      setMasterError(
        cause instanceof Error ? cause.message : '種目を取得できませんでした',
      );
    } finally {
      setLoading(false);
    }
  };
  const retrySync = async (id: string) => {
    setBusy(id);
    setNotice(null);
    try {
      const result = await syncPendingWorkoutMutations(id, { manual: true });
      setNotice(
        result.failed
          ? `同期できませんでした：${result.failed.lastError ?? '内容を確認してください'}`
          : result.remaining
            ? '残りの記録は自動同期を待っています。'
            : '同期が完了しました。',
      );
    } catch (cause) {
      setNotice(
        cause instanceof Error ? cause.message : '再試行できませんでした',
      );
    } finally {
      await refreshLocal();
      setBusy(null);
    }
  };
  const removeRecord = async (id: string) => {
    const draft = local?.drafts.find(item => item.workoutId === id);
    if (!window.confirm(`「${draft?.workout.name ?? 'この記録'}」を削除しますか？`)) return;
    setBusy(id);
    try {
      await deleteWorkoutRecord(id);
      setNotice('記録を削除しました。');
      void syncAutomatically(id).catch(() => undefined);
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : '削除できませんでした。'); }
    finally { await refreshLocal(); setBusy(null); }
  };
  const recoverRecord = async (id: string) => {
    setBusy(id);
    setNotice(null);
    try {
      await recoverLegacyWorkoutQueue();
      const data = await readLocalWorkoutSources();
      const draft = data.drafts.find((item) => item.workoutId === id);
      if (!draft) throw new Error('読めない形式の記録です。端末の記録を書き出して個別の確認が必要です。');
      const { workout: server } = await getWorkoutSyncState(id);
      if (draft.draftStatus === 'deleted') {
        if (!server) throw new Error('接続先に記録を確認できませんでした。記録を保護したまま、時間をおいて再確認します。');
        if (!window.confirm(`「${server.name}」の削除を完了しますか？別の端末で更新された内容も含めて削除します。`)) return;
        await reconcileDeletedWorkout(id, server, { draft, mutations: data.mutations.filter((item) => item.workoutId === id) });
        const result = await syncPendingWorkoutMutations(id);
        setNotice(result.failed ? `原本は保護済みです。${result.failed.lastError}` : '削除の復旧が完了しました。原本は書き出しに含まれます。');
      } else if (draft.draftStatus === 'completed' && draft.workout.status !== 'completed') {
        await repairCompletedWorkoutDraft(server ?? draft.workout);
        const repaired = (await readLocalWorkoutSources()).drafts.find((item) => item.workoutId === id);
        setNotice(repaired?.workout.status === 'completed' ? '完了記録の表示を復旧しました。' : '完了状態を確認できません。原本を書き出して確認してください。');
      } else {
        const result = await syncPendingWorkoutMutations(id, { manual: true });
        setNotice(result.failed ? `記録は保持されています。${result.failed.lastError}` : '再試行しました。');
      }
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : '復旧できませんでした。原本は保持されています。');
    } finally { await refreshLocal(); setBusy(null); }
  };
  const exportLocal = async () => {
    try {
      const data = await exportWorkoutRecoveryData();
      const blob = new Blob(
        [
          JSON.stringify(
            { exportedAt: new Date().toISOString(), ...data },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `repwise-records-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('この端末の記録を書き出しました。');
    } catch (cause) {
      setNotice(
        cause instanceof Error ? cause.message : '書き出せませんでした',
      );
    }
  };
  const exercise = items.find((item) => item.id === selected);
  const queueEntries = summarizeSyncQueue(local?.drafts ?? [], local?.mutations ?? []);
  const visibleEntries = queueEntries.filter((entry) => !entry.deleted);
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-7">
      <details className="rounded-3xl border bg-card p-5">
        <summary className="min-h-11 cursor-pointer py-3 text-lg font-black">不要な記録を整理</summary>
        <p className="mt-2 mb-4 text-sm text-muted-foreground">不要な入力途中の記録を削除できます。「…」または左へスワイプで削除を選べます。変更の反映は自動で行います。</p>
        <WorkoutSummaryList status="active" emptyMessage="入力途中の記録はありません" />
        {queueEntries.filter(entry => !entry.deleted && ['blocked', 'conflict'].includes(entry.head.syncStatus)).map(entry => (
          <div key={entry.id} className="mt-3 rounded-xl border p-3">
            <p className="break-words font-bold">{entry.draft?.workout.name ?? '確認が必要な記録'}</p>
            <p className="mt-1 text-sm text-muted-foreground">{entry.deleted ? '記録は一覧から削除されています。自動で処理できない変更があるため、削除を確認してください。' : entry.head.lastError?.includes('HTTP 401') || entry.head.lastError?.includes('HTTP 403') ? 'ログイン状態を確認してください。記録は保護されています。' : entry.head.syncStatus === 'conflict' ? '別の端末で変更されています。必要な記録か確認してください。' : '古い入力内容に問題があります。不要ならそのまま削除できます。'}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {!entry.deleted && <Button variant="destructive" className="min-h-11" disabled={busy !== null} onClick={() => void removeRecord(entry.id)}>この記録を削除</Button>}
              {entry.deleted && <Button variant="outline" className="min-h-11" disabled={busy !== null} onClick={() => void recoverRecord(entry.id)}>削除を完了</Button>}
            </div>
          </div>
        ))}
        {notice && <output className="mt-3 block text-sm">{notice}</output>}
      </details>
      <section className="rounded-3xl border bg-card p-5">
        <h2 className="text-lg font-black">種目の設定</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          種目名・部位・初期セット数・回数の目安を変更できます。過去の記録はその時の名前を残し、新しく追加する種目へ反映します。
        </p>
        {loading ? (
          <p className="mt-4 text-sm">種目を読み込み中…</p>
        ) : masterError ? (
          <div className="mt-4">
            <p role="alert" className="text-sm text-destructive">
              {masterError}
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-3"
              onClick={() => void retryCatalog()}
            >
              再試行
            </Button>
          </div>
        ) : (
          <>
            <Input
              aria-label="設定する種目を検索"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="種目名で検索"
              className="mt-4 h-11 text-base"
            />
            <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
              {items
                .filter((item) =>
                  item.name
                    .toLocaleLowerCase('ja-JP')
                    .includes(query.toLocaleLowerCase('ja-JP')),
                )
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={selected === item.id}
                    className={`flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left text-sm ${selected === item.id ? 'border-primary bg-primary/5' : ''}`}
                    onClick={() => setSelected(item.id)}
                  >
                    <span className="font-bold">{item.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {item.bodyPart}
                    </span>
                  </button>
                ))}
              {!items.length && (
                <p className="text-sm text-muted-foreground">
                  種目は記録画面から追加できます。
                </p>
              )}
            </div>
            {exercise && (
              <ExerciseSettingsEditor
                key={exercise.id}
                exercise={exercise}
                onSaved={(updated) =>
                  setItems((previous) =>
                    previous.map((item) =>
                      item.id === updated.id ? updated : item,
                    ),
                  )
                }
              />
            )}
          </>
        )}
      </section>
      <details className="rounded-3xl border bg-card p-5">
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-bold">詳細・トラブルシューティング</summary>
        <h2 className="text-lg font-black">保存と同期</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          入力内容はすぐにこの端末へ保存し、入力が止まってからまとめて同期します。
        </p>
        {localError ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {localError}
          </p>
        ) : !local ? (
          <p className="mt-3 text-sm">保存状態を確認中…</p>
        ) : (
          <p className="mt-3 text-sm">
            端末の保存済み記録：
            {
              local.drafts.filter((item) => item.draftStatus !== 'deleted' && !item.workout.deletedAt)
                .length
            }
            件 · 確認が必要な記録：{visibleEntries.length}件
          </p>
        )}
        <div className="mt-4 space-y-3">
          <WorkoutSyncList entries={visibleEntries} busy={busy} onRetry={(id) => void retrySync(id)} onRecover={(id) => void recoverRecord(id)} />
        </div>
        {local && (local.unreadableDrafts.length > 0 || local.unreadableMutations.length > 0) && (
          <p role="alert" className="mt-4 text-sm text-destructive">形式を確認できない記録：{local.unreadableDrafts.length}件・変更：{local.unreadableMutations.length}件。削除せず保護しています。書き出した原本を使った個別確認が必要です。</p>
        )}
        {local?.drafts.filter((draft) => draft.draftStatus === 'completed' && draft.workout.status !== 'completed').map((draft) => (
          <div key={draft.workoutId} className="mt-4 rounded-xl border p-3">
            <p>{draft.workout.name}：完了状態の表示を確認してください。</p>
            <Button className="mt-2 min-h-11" disabled={busy !== null} onClick={() => void recoverRecord(draft.workoutId)}>完了状態を復旧</Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          className="mt-4 w-full"
          onClick={() => void exportLocal()}
        >
          この端末の記録を書き出す
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          同期前の記録はこの端末・このサイトに保存されています。書き出したファイルにはトレーニング記録とメモが含まれます。
        </p>
        {notice && (
          <output className="mt-3 block text-sm font-bold">{notice}</output>
        )}
      </details>
    </div>
  );
}

function ExerciseSettingsEditor({
  exercise,
  onSaved,
}: {
  exercise: ExerciseMaster;
  onSaved: (exercise: ExerciseMaster) => void;
}) {
  const [value, setValue] = useState<UpdateExerciseMasterInput>(exercise);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const save = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const updated = await updateCachedExerciseMaster(exercise.id, value);
      setValue(updated);
      onSaved(updated);
      setMessage('種目の設定を保存しました。');
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : '保存できませんでした',
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <form
      className="mt-5 space-y-4 border-t pt-5"
      onSubmit={(event) => void save(event)}
    >
      <div>
        <label htmlFor="exercise-setting-name" className="text-sm font-bold">
          種目名
        </label>
        <Input
          id="exercise-setting-name"
          value={value.name}
          maxLength={80}
          required
          onChange={(event) => setValue({ ...value, name: event.target.value })}
          className="mt-1 h-11 text-base"
        />
      </div>
      <div>
        <label htmlFor="exercise-setting-part" className="text-sm font-bold">
          部位
        </label>
        <select
          id="exercise-setting-part"
          value={value.bodyPart}
          className="mt-1 h-10 w-full rounded-lg border bg-background px-3"
          onChange={(event) =>
            setValue({ ...value, bodyPart: event.target.value })
          }
        >
          {['胸', '背中', '脚', '肩', '腕', '体幹', 'その他'].map((part) => (
            <option key={part}>{part}</option>
          ))}
        </select>
      </div>
      <label className="block text-sm font-bold" htmlFor="setting-rep-mode">回数の記録方式</label>
      <select id="setting-rep-mode" value={value.repMode ?? 'standard'} onChange={event => setValue({ ...value, repMode: event.target.value === 'per_side' ? 'per_side' : 'standard' })} className="h-11 w-full rounded-lg border bg-background px-3">
        <option value="standard">通常</option><option value="per_side">左右別（重量は共通）</option>
      </select>
      <p className="text-xs text-muted-foreground">方式の変更は次に追加する種目から反映します。保存済み記録の入力方式と左右の回数は変わりません。</p>
      {value.repMode === 'per_side' && <LoadBasisSelect id="setting-load-basis" value={value.loadBasis} onChange={loadBasis => setValue({ ...value, loadBasis })} />}
      {value.defaultRepMin !== null && value.defaultRepMax !== null && value.defaultRepMin > value.defaultRepMax && <p role="alert" className="text-sm text-destructive">rep下限が上限を超えています。下の回数を変更すると範囲を調整できます。</p>}
      <div className="grid grid-cols-2 gap-3">
        {(
          [
            {
              key: 'defaultWorkingSets',
              label: '初期セット数',
              min: 1,
              max: 30,
            },
            { key: 'defaultRepMin', label: '目標回数の下限（回）', min: 1, max: 999 },
            { key: 'defaultRepMax', label: '目標回数の上限（回）', min: 1, max: 999 },
            {
              key: 'defaultRestSeconds',
              label: '休憩の目安（秒）',
              min: 0,
              max: 3600,
            },
          ] as const
        ).map((field) => (
          <div key={field.key}>
            <label
              htmlFor={`setting-${field.key}`}
              className="text-sm font-bold"
            >
              {field.label}
            </label>
            <Input
              id={`setting-${field.key}`}
              type="number"
              min={field.min}
              max={field.max}
              value={value[field.key] ?? ''}
              onChange={(event) =>
                setValue(current => {
                  const next = { ...current, [field.key]: event.target.value === '' ? null : Number(event.target.value) };
                  if (next.defaultRepMin !== null && next.defaultRepMax !== null && next.defaultRepMin > next.defaultRepMax) {
                    if (field.key === 'defaultRepMin') next.defaultRepMax = next.defaultRepMin;
                    if (field.key === 'defaultRepMax') next.defaultRepMin = next.defaultRepMax;
                  }
                  return next;
                })
              }
              className="mt-1 h-11 text-base"
            />
          </div>
        ))}
        <div>
          <label htmlFor="setting-increment" className="text-sm font-bold">
            増量の目安（kg）
          </label>
          <Input
            id="setting-increment"
            type="number"
            min="0.001"
            max="100"
            step="0.001"
            value={
              value.defaultIncrementGrams === null
                ? ''
                : value.defaultIncrementGrams / 1000
            }
            onChange={(event) =>
              setValue({
                ...value,
                defaultIncrementGrams:
                  event.target.value === ''
                    ? null
                    : Math.round(Number(event.target.value) * 1000),
              })
            }
            className="mt-1 h-11 text-base"
          />
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={saving}>
        {saving ? '保存中…' : '種目の設定を保存'}
      </Button>
      {message && (
        <output className="block text-sm font-bold">{message}</output>
      )}
    </form>
  );
}
