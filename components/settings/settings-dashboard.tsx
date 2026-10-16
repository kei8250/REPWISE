'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { listExerciseMasters } from '@/lib/workouts/api-client';
import { updateCachedExerciseMaster } from '@/lib/workouts/exercise-master-cache';
import type {
  ExerciseMaster,
  UpdateExerciseMasterInput,
} from '@/lib/workouts/types';
import { LoadBasisSelect } from '@/components/workouts/load-basis-select';

export function SettingsDashboard() {
  const [items, setItems] = useState<ExerciseMaster[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [masterError, setMasterError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
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
  const exercise = items.find((item) => item.id === selected);
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-7">
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
