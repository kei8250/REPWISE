'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createWorkout } from '@/lib/workouts/api-client';

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function StartWorkoutForm() {
  const router = useRouter();
  const [name, setName] = useState('今日のワークアウト');
  const [localDate, setLocalDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function start(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const workout = await createWorkout({ name, localDate, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo' });
      router.push(`/workouts/active/${workout.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '開始できませんでした');
      setLoading(false);
    }
  }
  return <form onSubmit={(event) => void start(event)} className="space-y-5 rounded-[28px] border bg-card p-5 shadow-sm sm:p-7"><div><label htmlFor="workout-name" className="block text-sm font-bold">ワークアウト名</label><Input id="workout-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} className="mt-2 h-11" required /></div><div><label htmlFor="workout-date" className="block text-sm font-bold">日付</label><Input id="workout-date" type="date" value={localDate} onChange={(event) => setLocalDate(event.target.value)} className="mt-2 h-11" required /></div>{error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}<Button type="submit" size="lg" disabled={loading} className="h-12 w-full rounded-xl">{loading ? <LoaderCircle className="animate-spin" /> : <ArrowRight />} 記録を開始</Button><p className="text-center text-xs leading-relaxed text-muted-foreground">開始後は入力内容が自動保存されます。種目は次の画面で追加します。</p></form>;
}
