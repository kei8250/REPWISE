'use client';

import { useEffect, useRef, useState } from 'react';
import {
  defaultRmMethod,
  estimateRm,
  equivalentRmLoad,
  RM_METHODS,
  type RmMethod,
} from '@/lib/goals/rm';
import { effectiveLoadGrams, effectiveReps } from '@/lib/workouts/reps';
import type { WorkoutExercise } from '@/lib/workouts/types';
import { formatKilograms } from '@/lib/analytics/detail-view';

export function RmConversionButton({
  exercise,
  initialMethod,
}: {
  exercise: WorkoutExercise;
  initialMethod?: RmMethod;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="min-h-11 w-full rounded-xl border bg-card px-4 text-sm font-bold text-primary"
        onClick={() => setOpen(true)}
      >
        RM換算表を見る
      </button>
      {open && (
        <RmConversionDialog
          initialMethod={initialMethod}
          exercise={exercise}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
function RmConversionDialog({
  exercise,
  onClose,
  initialMethod,
}: {
  exercise: WorkoutExercise;
  initialMethod?: RmMethod;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const initial = exercise.sets.find(
    (s) => (effectiveLoadGrams(s) ?? 0) > 0 && (effectiveReps(s) ?? 0) > 0,
  );
  const [method, setMethod] = useState<RmMethod>(
    initialMethod ?? defaultRmMethod(exercise.exerciseNameSnapshot),
  );
  const [load, setLoad] = useState(
    String(initial ? effectiveLoadGrams(initial)! / 1000 : 60),
  );
  const [reps, setReps] = useState(
    String(initial ? effectiveReps(initial) : 8),
  );
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  const estimate =
    load.trim() && reps.trim() && Number(load) <= 2000
      ? estimateRm(Number(load) * 1000, Number(reps), method)
      : null;
  const kg = (v: number) => formatKilograms(v, 2);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="rm-table-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-3xl bg-background p-5 text-foreground shadow-xl backdrop:bg-black/40"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-background py-2">
        <h2 id="rm-table-title" className="text-lg font-black">
          RM換算表・試算
        </h2>
        <button
          type="button"
          className="min-h-11 rounded-xl border px-4 text-sm font-bold"
          onClick={onClose}
        >
          閉じる
        </button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        閲覧・試算専用です。入力中の記録や保存済み目標は変更しません。
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2" aria-label="RM換算表の種類">
        {(Object.keys(RM_METHODS) as RmMethod[]).map((key) => (
          <button
            type="button"
            key={key}
            aria-pressed={method === key}
            onClick={() => setMethod(key)}
            className="min-h-11 rounded-xl border px-3 py-2 text-sm font-bold aria-pressed:bg-primary aria-pressed:text-primary-foreground"
          >
            {RM_METHODS[key].label}
          </button>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="text-sm font-bold">
          試算重量（kg）
          <input
            type="number"
            min="0.001"
            max="2000"
            step="0.001"
            className="mt-1 min-h-11 w-full rounded-xl border bg-background px-3"
            value={load}
            onChange={(e) => setLoad(e.target.value)}
          />
        </label>
        <label className="text-sm font-bold">
          試算回数
          <input
            type="number"
            min="1"
            max="12"
            step="1"
            className="mt-1 min-h-11 w-full rounded-xl border bg-background px-3"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
          />
        </label>
      </div>
      <output className="mt-4 block rounded-xl bg-primary/5 p-4 font-black">
        {estimate
          ? `推定1RM ${kg(estimate)}`
          : '0より大きい重量と1〜12回を入力してください'}
      </output>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        採用式：推定1RM ＝ 重量 ×（1 ＋ 回数 ÷ {RM_METHODS[method].coefficient}
        ）。1回のときは実測重量をそのまま使用します。逆算は推定1RM ÷（1 ＋ 回数
        ÷
        係数）。種目別の簡易換算式で、実測値とは異なります。左右別の重量は片側1回分です。
      </p>
      <table className="mt-4 w-full table-fixed text-sm">
        <caption className="mb-2 text-left font-bold">
          {RM_METHODS[method].label}：同じ推定1RMでの重量一覧
        </caption>
        <thead>
          <tr className="border-b text-left">
            <th className="py-2" scope="col">
              回数
            </th>
            <th className="py-2" scope="col">
              1RM比
            </th>
            <th className="py-2" scope="col">
              換算重量
            </th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((r) => (
            <tr key={r} className="border-b">
              <th className="py-3 text-left" scope="row">
                {r}回
              </th>
              <td>{equivalentRmLoad(100, r, method)!.toFixed(1)}%</td>
              <td>
                {estimate ? kg(equivalentRmLoad(estimate, r, method)!) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-muted-foreground">
        RM換算には複数の方式があります。この表は係数40（ベンチ）、33.3（スクワット・デッドリフト）の方式です。他種目への適用や高回数での精度は保証されないため、1〜12回に限定しています。表の切り替えは目標の換算方式を変更しません。
      </p>
    </dialog>
  );
}
