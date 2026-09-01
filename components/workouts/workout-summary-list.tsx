'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, ChevronRight, Clock3, LoaderCircle } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { listWorkouts } from '@/lib/workouts/api-client';
import type { WorkoutSummary } from '@/lib/workouts/types';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ja-JP', { month: 'short', day: 'numeric', weekday: 'short' }).format(new Date(`${value}T00:00:00`));
}

export function WorkoutSummaryList({ status, emptyMessage }: { status?: 'active' | 'completed'; emptyMessage: string }) {
  const [items, setItems] = useState<WorkoutSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    setLoading(true);
    setError(null);
    void listWorkouts(status).then(setItems).catch((cause) => setError(cause instanceof Error ? cause.message : '履歴を読み込めませんでした')).finally(() => setLoading(false));
  };
  useEffect(() => {
    let alive = true;
    void listWorkouts(status).then((loaded) => { if (alive) setItems(loaded); }).catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : '履歴を読み込めませんでした'); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [status]);
  if (loading) return <div className="grid min-h-44 place-items-center"><LoaderCircle className="size-6 animate-spin text-primary" /></div>;
  if (error) return <div className="rounded-2xl border bg-card p-6 text-center"><AlertCircle className="mx-auto text-destructive" /><p className="mt-2 text-sm font-semibold">{error}</p><Button type="button" variant="outline" className="mt-4" onClick={load}>再試行</Button></div>;
  if (!items.length) return <div className="rounded-2xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">{emptyMessage}</div>;
  return <div className="space-y-3">{items.map((item) => {
    const active = item.status === 'active';
    const href = active ? `/workouts/active/${item.id}` : `/workouts/${item.id}`;
    return <Card key={item.id} className="rounded-2xl py-0 shadow-none"><CardContent className="flex items-center gap-4 p-4"><span className={`grid size-10 shrink-0 place-items-center rounded-xl ${active ? 'bg-accent text-accent-foreground' : 'bg-primary/10 text-primary'}`}>{active ? <Clock3 className="size-5" /> : <CheckCircle2 className="size-5" />}</span><div className="min-w-0 flex-1"><p className="truncate font-black">{item.name}</p><p className="mt-1 text-xs text-muted-foreground">{formatDate(item.localDate)} · {item.exerciseCount}種目 · {item.completedSetCount}/{item.setCount}セット完了</p></div><Link href={href} aria-label={`${item.name}を開く`} className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}><ChevronRight /></Link></CardContent></Card>;
  })}</div>;
}
