'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { createExerciseMaster, listExerciseMasters } from '@/lib/workouts/api-client';
import type { ExerciseMaster } from '@/lib/workouts/types';

const bodyParts = ['胸', '背中', '脚', '肩', '腕', '体幹', 'その他'];

export function ExercisePicker({ open, onOpenChange, excludedIds, onSelect }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  excludedIds: string[];
  onSelect: (exercise: ExerciseMaster) => void;
}) {
  const [items, setItems] = useState<ExerciseMaster[]>([]);
  const [query, setQuery] = useState('');
  const [bodyPart, setBodyPart] = useState('すべて');
  const [newName, setNewName] = useState('');
  const [newBodyPart, setNewBodyPart] = useState('その他');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void listExerciseMasters().then((loaded) => { if (alive) setItems(loaded); }).catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : '種目を読み込めませんでした'); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open]);

  const filtered = useMemo(() => items.filter((item) => {
    const matchesPart = bodyPart === 'すべて' || item.bodyPart === bodyPart;
    const matchesQuery = !query || item.name.toLocaleLowerCase('ja-JP').includes(query.toLocaleLowerCase('ja-JP'));
    return matchesPart && matchesQuery;
  }), [bodyPart, items, query]);

  async function addCustomExercise() {
    if (!newName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const created = await createExerciseMaster({ name: newName.trim(), bodyPart: newBodyPart });
      setItems((current) => [...current, created]);
      setNewName('');
      onSelect(created);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '種目を追加できませんでした');
    } finally { setLoading(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] max-w-2xl overflow-hidden p-0">
        <DialogHeader className="border-b px-5 pb-4 pt-5">
          <DialogTitle className="text-lg font-black">種目を追加</DialogTitle>
          <DialogDescription>部位で絞り込み、今日行う種目を選択します。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 overflow-y-auto px-5 pb-5">
          <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="種目名を検索" className="pl-9" /></div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {['すべて', ...bodyParts].map((part) => <Button key={part} type="button" size="sm" variant={bodyPart === part ? 'default' : 'outline'} className="shrink-0 rounded-full" onClick={() => setBodyPart(part)}>{part}</Button>)}
          </div>
          {error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            {filtered.map((item) => {
              const selected = excludedIds.includes(item.id);
              return <Button key={item.id} type="button" variant="outline" disabled={selected} className="h-auto justify-between rounded-xl px-4 py-3 text-left" onClick={() => { onSelect(item); onOpenChange(false); }}><span><span className="block font-bold">{item.name}</span><span className="block text-xs font-normal text-muted-foreground">{item.bodyPart}</span></span>{selected ? <Check className="size-4" /> : <Plus className="size-4" />}</Button>;
            })}
          </div>
          {!loading && !filtered.length && <p className="py-4 text-center text-sm text-muted-foreground">該当する種目がありません</p>}
          <div className="rounded-2xl bg-muted p-4">
            <p className="mb-3 text-sm font-bold">新しい種目を作成</p>
            <div className="grid gap-2 sm:grid-cols-[1fr_130px_auto]">
              <Input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="種目名" maxLength={80} />
              <select value={newBodyPart} onChange={(event) => setNewBodyPart(event.target.value)} className="h-9 rounded-lg border bg-background px-3 text-sm">{bodyParts.map((part) => <option key={part}>{part}</option>)}</select>
              <Button type="button" disabled={loading || !newName.trim()} onClick={() => void addCustomExercise()}>作成して追加</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
