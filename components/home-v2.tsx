'use client';

import { useEffect, useState } from 'react';
import {
  ArrowRight,
  ChevronRight,
  Clock3,
  Dumbbell,
  History,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getWorkout, listWorkouts } from '@/lib/workouts/api-client';
import {
  type HomeCompletedState,
  loadHomeActiveWorkout,
  loadHomeCompletedWorkout,
} from '@/lib/workouts/home-loader';
import {
  getLatestActiveWorkoutDraft,
  listWorkoutMutations,
  markLocalWorkoutDraftCompleted,
  pruneCompletedWorkoutDrafts,
} from '@/lib/workouts/local-drafts';
import type { WorkoutSummary } from '@/lib/workouts/types';
import { APP_ROUTES, workoutRoute } from '@/lib/routes';

export function HomeV2() {
  const [active, setActive] = useState<WorkoutSummary | null>(null);
  const [activeStatus, setActiveStatus] = useState<
    'loading' | 'success' | 'error'
  >('loading');
  const [completedState, setCompletedState] = useState<HomeCompletedState>({
    status: 'loading',
    workout: null,
  });
  const [completedAttempt, setCompletedAttempt] = useState(0);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const result = await loadHomeActiveWorkout({
        getLocalDraft: getLatestActiveWorkoutDraft,
        listServerActive: () => listWorkouts('active', 1),
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
  }, []);

  useEffect(() => {
    void pruneCompletedWorkoutDrafts().catch(() => undefined);
  }, []);

  useEffect(() => {
    let mounted = true;
    void loadHomeCompletedWorkout(() => listWorkouts('completed', 1)).then(
      (state) => {
        if (mounted) setCompletedState(state);
      },
    );
    return () => {
      mounted = false;
    };
  }, [completedAttempt]);

  const recent = completedState.workout;
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="rounded-3xl py-5 shadow-none">
          <CardContent className="px-5">
            <Clock3 className="size-5 text-primary" />
            <p className="mt-4 text-xs font-bold text-muted-foreground">
              前回のトレーニング
            </p>
            {completedState.status === 'success' && recent ? (
              <>
                <p className="mt-1 font-black">{recent.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {recent.localDate} · {recent.exerciseCount}種目 ·{' '}
                  {recent.completedSetCount}セット
                </p>
                <a
                  href={workoutRoute(recent.id, recent.status)}
                  className="mt-4 inline-flex items-center text-sm font-bold text-primary"
                >
                  記録を見る <ChevronRight className="size-4" />
                </a>
              </>
            ) : completedState.status === 'error' ? (
              <div className="mt-2">
                <p className="text-sm text-muted-foreground">
                  履歴を取得できませんでした
                </p>
                <button
                  type="button"
                  className="mt-3 text-sm font-bold text-primary"
                  onClick={() => {
                    setCompletedState({ status: 'loading', workout: null });
                    setCompletedAttempt((attempt) => attempt + 1);
                  }}
                >
                  再試行
                </button>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                {completedState.status === 'empty'
                  ? '完了した記録はまだありません'
                  : '読み込み中…'}
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="rounded-3xl py-5 shadow-none">
          <CardContent className="px-5">
            <History className="size-5 text-primary" />
            <p className="mt-4 font-bold">すべての履歴</p>
            <p className="mt-1 text-sm text-muted-foreground">
              保存した種目順・セット・メモを確認できます。
            </p>
            <a
              href={APP_ROUTES.history}
              className="mt-4 inline-flex items-center text-sm font-bold text-primary"
            >
              履歴を開く <ChevronRight className="size-4" />
            </a>
          </CardContent>
        </Card>
      </div>
      {!active && activeStatus !== 'loading' && (
        <Card className="rounded-3xl border-dashed py-5 shadow-none">
          <CardContent className="flex items-center gap-4 px-5">
            <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
              <Dumbbell />
            </span>
            <div>
              <p className="font-bold">次に何をする？</p>
              <p className="text-sm text-muted-foreground">
                Phase
                1Aでは自由に記録を開始します。自動メニュー提案は後続Phaseです。
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
