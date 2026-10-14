'use client';

import { useEffect, useState } from 'react';
import { loadExerciseMasters } from '@/lib/workouts/exercise-master-cache';
import type { ExerciseMaster } from '@/lib/workouts/types';

export function ExerciseSettingsReference({
  exerciseId,
}: {
  exerciseId: string;
}) {
  const [master, setMaster] = useState<ExerciseMaster | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => {
      void loadExerciseMasters().then(
        (items) => {
          if (alive) {
            setMaster(items.find((item) => item.id === exerciseId) ?? null);
            setFailed(false);
          }
        },
        () => {
          if (alive) setFailed(true);
        },
      );
    };
    load();
    window.addEventListener('focus', load);
    return () => {
      alive = false;
      window.removeEventListener('focus', load);
    };
  }, [exerciseId]);
  return (
    <details className="rounded-xl border p-3">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-bold">
        この種目の設定・判定ルール
      </summary>
      {master ? (
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-muted-foreground">回数範囲</dt>
            <dd>
              {master.defaultRepMin ?? '—'}〜{master.defaultRepMax ?? '—'}回
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">増量幅</dt>
            <dd>
              {master.defaultIncrementGrams === null
                ? '未設定'
                : `${master.defaultIncrementGrams / 1000} kg`}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">初期セット数</dt>
            <dd>{master.defaultWorkingSets ?? '—'}セット</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">休憩目安</dt>
            <dd>{master.defaultRestSeconds ?? '—'}秒</dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm">
          {failed
            ? '設定を取得できません。通信状態を確認してください。'
            : '設定を確認中…'}
        </p>
      )}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        設定変更は新しく追加する種目の初期値と、現在のルールによる提案・過去記録の再判定に反映されます。保存済みの実績・メモ・セット目標は書き換えません。確定済みの次回目標も保持されます。過去の判定は当時のルールを固定保存していません。
      </p>
      <a
        href="/settings"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex min-h-11 items-center text-sm font-bold text-primary"
      >
        設定を開く（別タブ）
      </a>
    </details>
  );
}
