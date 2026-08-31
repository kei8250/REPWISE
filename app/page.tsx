'use client';

import { FormEvent, useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import {
  Activity, ArrowLeft, BarChart3, CalendarDays, Check, ChevronRight, CircleAlert,
  Clock3, Dumbbell, History, Home, ListPlus, MessageCircle, MoreHorizontal,
  Plus, Send, Sparkles, Target, Trash2, TrendingUp, Trophy, X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';

type View = 'home' | 'log' | 'history' | 'analysis' | 'coach';
type SetRow = { id: number; weight: number; reps: number; memo: string };
type Exercise = { name: string; group: string };
type ChatMessage = { role: 'coach' | 'user'; text: string };

const navItems: { id: View; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'ホーム', icon: Home },
  { id: 'log', label: '記録する', icon: Dumbbell },
  { id: 'history', label: '履歴', icon: History },
  { id: 'analysis', label: '分析', icon: BarChart3 },
  { id: 'coach', label: 'コーチ', icon: MessageCircle },
];

const groupColors: Record<string, string> = {
  胸: '#8b72cf', 背中: '#3d8b65', 脚: '#da913b', 肩: '#4e83ba', 腕: '#d46878', 体幹: '#6d776f', その他: '#77726d',
};

const initialExercises: Exercise[] = [
  { name: 'ベンチプレス', group: '胸' }, { name: 'インクラインDBプレス', group: '胸' }, { name: 'ケーブルフライ', group: '胸' },
  { name: 'ラットプルダウン', group: '背中' }, { name: 'デッドリフト', group: '背中' }, { name: 'シーテッドロー', group: '背中' },
  { name: 'バックスクワット', group: '脚' }, { name: 'レッグプレス', group: '脚' }, { name: 'ルーマニアンデッドリフト', group: '脚' },
  { name: 'ショルダープレス', group: '肩' }, { name: 'サイドレイズ', group: '肩' },
  { name: 'バーベルカール', group: '腕' }, { name: 'トライセプスプレスダウン', group: '腕' },
  { name: 'プランク', group: '体幹' },
];

const progressData = [
  { date: '7/06', max: 72.5, volume: 2180 }, { date: '7/18', max: 75, volume: 2310 },
  { date: '8/02', max: 77.5, volume: 2380 }, { date: '8/16', max: 80, volume: 2460 },
  { date: '8/30', max: 80, volume: 2520 },
];

const weeklyData = [
  { week: '7/28', volume: 10400 }, { week: '8/04', volume: 11900 }, { week: '8/11', volume: 9800 }, { week: '8/18', volume: 12800 }, { week: '8/25', volume: 13900 },
];

const historyItems = [
  { date: '8月30日', day: '日', title: '胸・三頭筋', duration: 68, volume: '5,840 kg', rating: 4, exercises: ['ベンチプレス', 'インクラインDBプレス', 'ケーブルフライ', 'プレスダウン'], groups: ['胸', '腕'] },
  { date: '8月28日', day: '金', title: '背中・二頭筋', duration: 72, volume: '6,420 kg', rating: 5, exercises: ['デッドリフト', 'ラットプルダウン', 'シーテッドロー', 'バーベルカール'], groups: ['背中', '腕'] },
  { date: '8月25日', day: '火', title: '脚', duration: 76, volume: '9,120 kg', rating: 4, exercises: ['バックスクワット', 'レッグプレス', 'レッグカール'], groups: ['脚'] },
  { date: '8月23日', day: '日', title: '肩・体幹', duration: 55, volume: '3,260 kg', rating: 3, exercises: ['ショルダープレス', 'サイドレイズ', 'プランク'], groups: ['肩', '体幹'] },
];

const chartConfig = { max: { label: '最大重量', color: '#3d8b65' }, volume: { label: '総ボリューム', color: '#8b72cf' } } satisfies ChartConfig;

function CoachBubble({ message }: { message: ChatMessage }) {
  const coach = message.role === 'coach';
  return (
    <div className={`flex gap-3 ${coach ? '' : 'justify-end'}`}>
      {coach && <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground"><Sparkles className="size-4" /></div>}
      <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${coach ? 'rounded-tl-sm bg-muted text-foreground' : 'rounded-tr-sm bg-primary text-primary-foreground'}`}>{message.text}</div>
    </div>
  );
}

export default function HomePage() {
  const [view, setView] = useState<View>('home');
  const [group, setGroup] = useState('胸');
  const [exercise, setExercise] = useState('ベンチプレス');
  const [exercises, setExercises] = useState(initialExercises);
  const [sets, setSets] = useState<SetRow[]>([
    { id: 1, weight: 80, reps: 10, memo: '' }, { id: 2, weight: 80, reps: 10, memo: '' }, { id: 3, weight: 80, reps: 8, memo: '' },
  ]);
  const [exerciseDialog, setExerciseDialog] = useState(false);
  const [newExerciseName, setNewExerciseName] = useState('');
  const [newExerciseGroup, setNewExerciseGroup] = useState('胸');
  const [saved, setSaved] = useState(false);
  const [analysisExercise, setAnalysisExercise] = useState('ベンチプレス');
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'coach', text: '今週の記録を確認しました。胸と背中は順調に伸びています。メニュー構成や痛み、次回の重量について、何でも相談してください。' },
  ]);

  const filteredExercises = useMemo(() => exercises.filter((item) => item.group === group), [exercises, group]);
  const volume = sets.reduce((sum, item) => sum + item.weight * item.reps, 0);

  function navigate(next: View) {
    setView(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateSet(id: number, key: keyof Omit<SetRow, 'id'>, value: string) {
    setSets((current) => current.map((row) => row.id === id ? { ...row, [key]: key === 'memo' ? value : Number(value) } : row));
  }

  function addSet() {
    const last = sets.at(-1);
    setSets((current) => [...current, { id: Date.now(), weight: last?.weight ?? 0, reps: last?.reps ?? 10, memo: '' }]);
  }

  async function saveWorkout() {
    setSaved(true);
    try {
      await fetch('/api/workouts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: '2026-08-31', title: `${group}トレーニング`, bodyPart: group, exercise, sets }) });
    } catch { /* The in-memory entry still keeps the interaction responsive. */ }
    window.setTimeout(() => setSaved(false), 2600);
  }

  function addExercise(event: FormEvent) {
    event.preventDefault();
    if (!newExerciseName.trim()) return;
    const item = { name: newExerciseName.trim(), group: newExerciseGroup };
    setExercises((current) => [...current, item]);
    setGroup(newExerciseGroup);
    setExercise(item.name);
    setNewExerciseName('');
    setExerciseDialog(false);
    fetch('/api/exercises', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) }).catch(() => undefined);
  }

  function askCoach(event: FormEvent) {
    event.preventDefault();
    const text = chatInput.trim();
    if (!text) return;
    const lower = text.toLowerCase();
    let reply = '直近4週間では週3〜4回のペースが安定しています。大きく変えず、各種目のRPEとフォームのメモを残しながら2週間単位で調整するのがおすすめです。';
    if (lower.includes('肩') || lower.includes('痛')) reply = '痛みがある日は重量を追わず、中止も選択肢にしてください。ベンチプレスでは肩甲骨を寄せて下げ、肘を開きすぎないことを確認しましょう。痛みが続く場合は医療専門家に相談してください。';
    else if (lower.includes('重量') || lower.includes('kg') || lower.includes('次回')) reply = 'ベンチプレスは前回80kgで10・10・8回です。次回は82.5kgで8回を1セット目の目標にし、7回未満なら80kgに戻して残りを行いましょう。';
    else if (lower.includes('メニュー') || lower.includes('追加') || lower.includes('減ら')) reply = '今週は胸12セットに対して背中8セットです。姿勢と肩の安定も考え、胸を2セット減らしてフェイスプルを3セット追加すると、押す・引くのバランスが整います。';
    else if (lower.includes('脚') || lower.includes('スクワット')) reply = '脚は週1回でボリュームは十分ですが、ハムストリングの刺激が少なめです。ルーマニアンデッドリフトを軽めに3セット追加し、翌日の疲労を確認しましょう。';
    setMessages((current) => [...current, { role: 'user', text }, { role: 'coach', text: reply }]);
    setChatInput('');
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-[1500px]">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border/70 bg-card px-5 py-6 lg:flex">
          <button type="button" onClick={() => navigate('home')} className="flex items-center gap-3 px-2 text-left">
            <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm"><Activity className="size-5" /></div>
            <div><p className="text-lg font-black tracking-tight">REPWISE</p><p className="text-[10px] font-bold tracking-[0.18em] text-muted-foreground">TRAIN SMARTER</p></div>
          </button>
          <nav className="mt-10 space-y-1" aria-label="メインナビゲーション">
            {navItems.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" onClick={() => navigate(id)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition ${view === id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
                <Icon className="size-[18px]" />{label}
              </button>
            ))}
          </nav>
          <div className="mt-auto rounded-2xl bg-[#effcf4] p-4 text-[#133c25] ring-1 ring-[#bdebcf]">
            <div className="mb-2 flex items-center gap-2 text-xs font-bold tracking-wider text-[#247a49]"><Sparkles className="size-4" /> 今週の調子</div>
            <p className="text-2xl font-bold">順調です</p><p className="mt-1 text-xs leading-relaxed text-[#4d725d]">先週より総ボリュームが8%アップ。休息も取れています。</p>
          </div>
        </aside>

        <section className="min-w-0 flex-1 pb-24 lg:pb-8">
          <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border/60 bg-background/90 px-4 py-4 backdrop-blur sm:px-7 lg:px-10">
            <div>
              <p className="text-xs font-semibold text-primary">2026年8月31日（月）</p>
              <h1 className="mt-1 text-xl font-bold tracking-tight sm:text-2xl">{view === 'home' ? 'おかえりなさい、圭さん' : navItems.find((item) => item.id === view)?.label}</h1>
            </div>
            <div className="flex items-center gap-2"><Button variant="outline" size="icon" aria-label="カレンダーを開く" className="rounded-xl"><CalendarDays /></Button><div className="grid size-9 place-items-center rounded-full bg-[#1f5338] text-xs font-bold text-white">K</div></div>
          </header>

          {view === 'home' && <HomeView navigate={navigate} />}
          {view === 'log' && (
            <LogView group={group} setGroup={(next) => { setGroup(next); const first = exercises.find((item) => item.group === next); if (first) setExercise(first.name); }} exercise={exercise} setExercise={setExercise} exercises={filteredExercises} sets={sets} updateSet={updateSet} addSet={addSet} removeSet={(id) => setSets((current) => current.filter((row) => row.id !== id))} volume={volume} saveWorkout={saveWorkout} saved={saved} openExerciseDialog={() => setExerciseDialog(true)} navigate={navigate} />
          )}
          {view === 'history' && <HistoryView navigate={navigate} />}
          {view === 'analysis' && <AnalysisView analysisExercise={analysisExercise} setAnalysisExercise={setAnalysisExercise} exercises={exercises} navigate={navigate} />}
          {view === 'coach' && <CoachView messages={messages} input={chatInput} setInput={setChatInput} onSubmit={askCoach} />}
        </section>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-card/95 px-2 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden" aria-label="モバイルナビゲーション">
        {navItems.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => navigate(id)} className={`flex min-h-12 flex-col items-center justify-center gap-1 text-[10px] font-semibold ${view === id ? 'text-primary' : 'text-muted-foreground'}`}><Icon className={`size-5 ${view === id ? 'fill-primary/12' : ''}`} />{label}</button>)}
      </nav>

      <Dialog open={exerciseDialog} onOpenChange={setExerciseDialog}>
        <DialogContent className="rounded-3xl p-6 sm:max-w-md">
          <form onSubmit={addExercise}>
            <DialogHeader><DialogTitle className="text-xl font-bold">新しい種目を追加</DialogTitle><DialogDescription>部位ごとに整理されるので、次回からすぐ選べます。</DialogDescription></DialogHeader>
            <div className="mt-6 space-y-4">
              <label className="block space-y-2 text-sm font-semibold">種目名<Input value={newExerciseName} onChange={(e) => setNewExerciseName(e.target.value)} placeholder="例：ブルガリアンスクワット" className="h-11" autoFocus /></label>
              <label className="block space-y-2 text-sm font-semibold">部位<NativeSelect className="w-full" value={newExerciseGroup} onChange={(e) => setNewExerciseGroup(e.target.value)}>{['胸','背中','脚','肩','腕','体幹','その他'].map((part) => <NativeSelectOption key={part} value={part}>{part}</NativeSelectOption>)}</NativeSelect></label>
            </div>
            <DialogFooter className="mt-6 -mx-6 -mb-6 px-6"><Button type="button" variant="outline" onClick={() => setExerciseDialog(false)}>キャンセル</Button><Button type="submit"><Plus /> 追加する</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function HomeView({ navigate }: { navigate: (view: View) => void }) {
  return (
    <div className="space-y-5 p-4 sm:p-7 lg:p-10">
      <section className="overflow-hidden rounded-[28px] bg-[#173f2c] text-white shadow-[0_18px_50px_rgba(18,62,43,.16)]">
        <div className="grid items-center gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_auto]">
          <div><Badge className="mb-3 bg-white/12 text-[#bff7d5]">今日のワークアウト</Badge><h2 className="text-3xl font-black tracking-tight sm:text-4xl">胸・三頭筋の日</h2><p className="mt-3 max-w-xl text-sm leading-relaxed text-white/65">前回から48時間以上空いています。肩の状態を確認しながら、ベンチプレス82.5kg × 8回を狙いましょう。</p></div>
          <Button onClick={() => navigate('log')} className="h-12 rounded-xl bg-[#d6ff57] px-6 text-[#153523] hover:bg-[#c8f04e]">記録をはじめる <ChevronRight /></Button>
        </div>
        <div className="grid grid-cols-3 border-t border-white/10 bg-black/10 px-3 py-4 sm:px-8">
          {[['週の回数','3 / 4回'],['総ボリューム','13,900kg'],['連続記録','6週']].map(([label, value]) => <div key={label} className="border-r border-white/10 px-3 last:border-0 sm:px-6"><p className="text-[10px] font-semibold text-white/50 sm:text-xs">{label}</p><p className="mt-1 text-base font-bold sm:text-xl">{value}</p></div>)}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]">
        <Card className="rounded-3xl py-5 shadow-none ring-border/80">
          <CardHeader className="px-5 sm:px-6"><CardTitle className="flex items-center gap-2 text-lg font-bold"><TrendingUp className="size-5 text-primary" /> 直近5週間のボリューム</CardTitle><CardDescription>全種目の合計負荷</CardDescription><CardAction><Button variant="ghost" size="sm" onClick={() => navigate('analysis')}>詳しく見る <ChevronRight /></Button></CardAction></CardHeader>
          <CardContent className="px-2 sm:px-5"><ChartContainer config={chartConfig} className="h-[240px] w-full aspect-auto"><AreaChart data={weeklyData} margin={{ left: 0, right: 10, top: 15, bottom: 0 }}><defs><linearGradient id="homeVolume" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3d8b65" stopOpacity={0.35}/><stop offset="100%" stopColor="#3d8b65" stopOpacity={0}/></linearGradient></defs><CartesianGrid vertical={false} strokeDasharray="4 4" /><XAxis dataKey="week" tickLine={false} axisLine={false}/><YAxis hide domain={['dataMin - 1000', 'dataMax + 1000']} /><ChartTooltip content={<ChartTooltipContent formatter={(value) => <span className="font-bold">{Number(value).toLocaleString()} kg</span>} />} /><Area type="monotone" dataKey="volume" stroke="#3d8b65" strokeWidth={3} fill="url(#homeVolume)" /></AreaChart></ChartContainer></CardContent>
        </Card>

        <div className="space-y-5">
          <Card className="rounded-3xl bg-[#f4f0ff] py-5 shadow-none ring-[#ded3ff]"><CardHeader className="px-5"><CardTitle className="flex items-center gap-2 font-bold text-[#402b73]"><Target className="size-5" /> 次回の目標</CardTitle><CardDescription className="text-[#6a5b8b]">ベンチプレス</CardDescription></CardHeader><CardContent className="px-5"><div className="flex items-baseline gap-2 text-[#2d1d54]"><span className="text-4xl font-black">82.5</span><span className="font-bold">kg</span><span className="text-sm text-[#6a5b8b]">× 8 reps</span></div></CardContent></Card>
          <Card className="rounded-3xl py-5 shadow-none ring-border/80"><CardHeader className="px-5"><CardTitle className="flex items-center gap-2 font-bold"><CircleAlert className="size-5 text-[#d68125]" /> 今日の注意点</CardTitle></CardHeader><CardContent className="px-5"><p className="rounded-2xl bg-[#fff7e9] p-4 text-sm leading-relaxed text-[#68471e]">前回のメモ：「右肩が浮く」。肩甲骨を寄せ、胸を張った状態をセット前に確認しましょう。</p></CardContent></Card>
        </div>
      </div>

      <Card className="rounded-3xl border-0 bg-[#22302a] py-5 text-white shadow-none ring-0"><CardContent className="flex flex-col items-start justify-between gap-4 px-5 sm:flex-row sm:items-center sm:px-6"><div><p className="flex items-center gap-2 font-bold"><Sparkles className="size-5 text-[#d6ff57]" /> REPWISEコーチからの提案</p><p className="mt-1 text-sm text-white/60">押す種目が多めです。背中の補助種目を追加するか相談してみませんか？</p></div><Button onClick={() => navigate('coach')} className="bg-white text-[#203429] hover:bg-white/90">コーチに相談</Button></CardContent></Card>
    </div>
  );
}

type LogProps = { group: string; setGroup: (value: string) => void; exercise: string; setExercise: (value: string) => void; exercises: Exercise[]; sets: SetRow[]; updateSet: (id: number, key: keyof Omit<SetRow,'id'>, value: string) => void; addSet: () => void; removeSet: (id: number) => void; volume: number; saveWorkout: () => void; saved: boolean; openExerciseDialog: () => void; navigate: (view: View) => void };

function LogView(props: LogProps) {
  return (
    <div className="grid gap-5 p-4 sm:p-7 lg:grid-cols-[minmax(0,1.4fr)_minmax(290px,.6fr)] lg:p-10">
      <div className="space-y-5">
        <section className="rounded-3xl bg-[#173f2c] p-5 text-white sm:p-7">
          <div className="flex items-start justify-between gap-3"><div><Badge className="mb-3 bg-white/12 text-[#bff7d5]">2026.08.31</Badge><h2 className="text-2xl font-bold sm:text-3xl">今日の記録</h2><p className="mt-2 text-sm text-white/60">部位を選ぶと種目を絞り込めます。</p></div><Button onClick={props.openExerciseDialog} className="bg-white/10 text-white hover:bg-white/20"><ListPlus /> <span className="hidden sm:inline">種目を追加</span></Button></div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <label className="space-y-2 text-xs font-semibold text-white/70">部位<NativeSelect className="w-full text-foreground" value={props.group} onChange={(e) => props.setGroup(e.target.value)}>{['胸','背中','脚','肩','腕','体幹','その他'].map((part) => <NativeSelectOption key={part} value={part}>{part}</NativeSelectOption>)}</NativeSelect></label>
            <label className="space-y-2 text-xs font-semibold text-white/70">種目<NativeSelect className="w-full text-foreground" value={props.exercise} onChange={(e) => props.setExercise(e.target.value)}>{props.exercises.map((item) => <NativeSelectOption key={item.name} value={item.name}>{item.name}</NativeSelectOption>)}</NativeSelect></label>
          </div>
        </section>

        <Card className="rounded-3xl py-5 shadow-none ring-border/80">
          <CardHeader className="px-4 sm:px-6"><CardTitle className="flex items-center gap-2 text-lg font-bold">{props.exercise} <Badge variant="secondary" className="bg-[#eef7f1] text-[#26714a]">{props.group}</Badge></CardTitle><CardDescription>前回：80kg × 10, 10, 8 reps</CardDescription><CardAction><Button variant="ghost" size="sm" onClick={() => props.navigate('analysis')}><BarChart3 /> 記録</Button></CardAction></CardHeader>
          <CardContent className="px-4 sm:px-6">
            <div className="grid grid-cols-[32px_1fr_1fr_32px] items-center gap-2 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground sm:grid-cols-[44px_1fr_1fr_1.6fr_34px]"><span>Set</span><span>kg</span><span>reps</span><span className="hidden sm:block">セットごとのメモ</span><span /></div>
            <div className="mt-2 space-y-3">{props.sets.map((item, index) => <div key={item.id} className="grid grid-cols-[32px_1fr_1fr_32px] items-start gap-2 sm:grid-cols-[44px_1fr_1fr_1.6fr_34px]"><span className="mt-1.5 grid size-8 place-items-center rounded-full bg-muted text-xs font-bold">{index + 1}</span><Input type="number" value={item.weight} onChange={(e) => props.updateSet(item.id,'weight',e.target.value)} aria-label={`${index + 1}セット目の重量`} className="h-11 text-center font-bold"/><Input type="number" value={item.reps} onChange={(e) => props.updateSet(item.id,'reps',e.target.value)} aria-label={`${index + 1}セット目の回数`} className="h-11 text-center font-bold"/><Textarea value={item.memo} onChange={(e) => props.updateSet(item.id,'memo',e.target.value)} placeholder="フォーム、痛み、RPEなど" aria-label={`${index + 1}セット目のメモ`} className="col-span-4 min-h-11 resize-none sm:col-span-1"/><button type="button" onClick={() => props.removeSet(item.id)} className="mt-1.5 hidden size-8 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive sm:grid" aria-label={`${index + 1}セット目を削除`}><Trash2 className="size-4" /></button></div>)}</div>
            <Button variant="outline" onClick={props.addSet} className="mt-4 h-10 w-full rounded-xl border-dashed"><Plus /> セットを追加</Button>
          </CardContent>
        </Card>
      </div>

      <aside className="space-y-5">
        <Card className="rounded-3xl bg-[#f4f0ff] py-5 shadow-none ring-[#ded3ff]"><CardHeader className="px-5"><CardTitle className="flex items-center gap-2 font-bold text-[#402b73]"><Target className="size-5" /> 今日の目標</CardTitle></CardHeader><CardContent className="px-5"><div className="flex items-baseline gap-2 text-[#2d1d54]"><span className="text-4xl font-black">82.5</span><span className="font-bold">kg</span><span className="text-sm text-[#6a5b8b]">× 8 reps</span></div><p className="mt-3 text-xs leading-relaxed text-[#6a5b8b]">前回より2.5kgアップ。フォームが崩れたら80kgへ戻しましょう。</p></CardContent></Card>
        <Card className="rounded-3xl py-5 shadow-none ring-border/80"><CardHeader className="px-5"><CardTitle className="text-base font-bold">この種目の合計</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-3 px-5"><div className="rounded-2xl bg-muted p-4"><p className="text-xs text-muted-foreground">ボリューム</p><p className="mt-1 text-xl font-bold">{props.volume.toLocaleString()}<span className="ml-1 text-xs">kg</span></p></div><div className="rounded-2xl bg-muted p-4"><p className="text-xs text-muted-foreground">セット数</p><p className="mt-1 text-xl font-bold">{props.sets.length}<span className="ml-1 text-xs">sets</span></p></div></CardContent></Card>
        <Card className="rounded-3xl py-5 shadow-none ring-border/80"><CardHeader className="px-5"><CardTitle className="flex items-center gap-2 font-bold"><CircleAlert className="size-5 text-[#d68125]" /> メモからの注意</CardTitle></CardHeader><CardContent className="px-5"><p className="rounded-2xl bg-[#fff7e9] p-4 text-sm leading-relaxed text-[#68471e]">右肩が浮きやすい傾向です。1セット目の前に肩甲骨の位置を確認してください。</p></CardContent></Card>
        <Button onClick={props.saveWorkout} className="h-12 w-full rounded-xl bg-[#173f2c] text-white hover:bg-[#23563d]">{props.saved ? <><Check /> 保存しました</> : <>今日の記録を保存 <ChevronRight /></>}</Button>
      </aside>
    </div>
  );
}

function HistoryView({ navigate }: { navigate: (view: View) => void }) {
  return (
    <div className="p-4 sm:p-7 lg:p-10">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><Badge variant="secondary">2026年8月</Badge><h2 className="mt-3 text-2xl font-black">トレーニング履歴</h2><p className="mt-1 text-sm text-muted-foreground">12回のワークアウト・合計14時間28分</p></div><Button onClick={() => navigate('log')}><Plus /> 新しい記録</Button></div>
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="space-y-3">{historyItems.map((item) => <Card key={item.date} className="rounded-3xl py-0 shadow-none ring-border/80"><CardContent className="grid gap-4 p-5 sm:grid-cols-[90px_1fr_auto] sm:items-center sm:p-6"><div><p className="text-xl font-black">{item.date}</p><p className="text-xs text-muted-foreground">{item.day}曜日</p></div><div><div className="flex flex-wrap items-center gap-2"><p className="text-base font-bold">{item.title}</p>{item.groups.map((part) => <span key={part} className="size-2.5 rounded-full" style={{ backgroundColor: groupColors[part] }} />)}</div><p className="mt-2 text-sm text-muted-foreground">{item.exercises.join('・')}</p><div className="mt-3 flex gap-4 text-xs font-semibold text-muted-foreground"><span className="flex items-center gap-1"><Clock3 className="size-3.5" />{item.duration}分</span><span className="flex items-center gap-1"><Dumbbell className="size-3.5" />{item.volume}</span></div></div><div className="flex items-center gap-1 text-[#d89130]">{Array.from({ length: 5 }, (_, index) => <span key={index} className={index < item.rating ? '' : 'opacity-20'}>★</span>)}</div></CardContent></Card>)}</div>
        <aside className="space-y-5"><Card className="rounded-3xl py-5 shadow-none ring-border/80"><CardHeader className="px-5"><CardTitle className="font-bold">今月の部位バランス</CardTitle></CardHeader><CardContent className="space-y-4 px-5">{[['胸',12],['背中',11],['脚',9],['肩',8],['腕',7],['体幹',4]].map(([part,count]) => <div key={part}><div className="mb-1 flex justify-between text-xs font-semibold"><span>{part}</span><span>{count} sets</span></div><div className="h-2 rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${Number(count)*7}%`, backgroundColor: groupColors[String(part)] }} /></div></div>)}</CardContent></Card><Card className="rounded-3xl bg-[#effcf4] py-5 shadow-none ring-[#bdebcf]"><CardContent className="px-5"><Trophy className="size-6 text-[#247a49]"/><p className="mt-3 font-bold text-[#173f2c]">6週間連続で達成中</p><p className="mt-1 text-xs leading-relaxed text-[#4d725d]">週3回以上のペースをキープしています。</p></CardContent></Card></aside>
      </div>
    </div>
  );
}

function AnalysisView({ analysisExercise, setAnalysisExercise, exercises, navigate }: { analysisExercise: string; setAnalysisExercise: (value: string) => void; exercises: Exercise[]; navigate: (view: View) => void }) {
  return (
    <div className="space-y-5 p-4 sm:p-7 lg:p-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-2xl font-black">成長レポート</h2><p className="mt-1 text-sm text-muted-foreground">種目ごとの変化とメニュー全体のバランスを確認できます。</p></div><label className="text-xs font-semibold text-muted-foreground">表示する種目<NativeSelect className="mt-2 w-full min-w-56 text-foreground" value={analysisExercise} onChange={(e) => setAnalysisExercise(e.target.value)}>{Object.entries(exercises.reduce<Record<string,Exercise[]>>((acc,item) => { (acc[item.group] ??= []).push(item); return acc; },{})).map(([part,items]) => <NativeSelectOptGroup key={part} label={part}>{items.map((item) => <NativeSelectOption key={item.name} value={item.name}>{item.name}</NativeSelectOption>)}</NativeSelectOptGroup>)}</NativeSelect></label></div>
      <div className="grid gap-4 sm:grid-cols-3">{[['推定1RM','106.7 kg','+6.3%'],['最大重量','80.0 kg','+7.5kg'],['5週間ボリューム','11,850 kg','+18%']].map(([label,value,delta]) => <Card key={label} className="rounded-3xl py-5 shadow-none ring-border/80"><CardContent className="px-5"><p className="text-xs font-semibold text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-black">{value}</p><Badge className="mt-3 bg-[#e6f8ed] text-[#247a49]">↑ {delta}</Badge></CardContent></Card>)}</div>
      <Card className="rounded-3xl py-5 shadow-none ring-border/80"><CardHeader className="px-5 sm:px-6"><CardTitle className="font-bold">{analysisExercise} — 最大重量の推移</CardTitle><CardDescription>重量と総ボリュームの伸び</CardDescription></CardHeader><CardContent className="px-2 sm:px-5"><ChartContainer config={chartConfig} className="h-[310px] w-full aspect-auto"><LineChart data={progressData} margin={{ left: 4, right: 18, top: 16, bottom: 0 }}><CartesianGrid vertical={false} strokeDasharray="4 4"/><XAxis dataKey="date" tickLine={false} axisLine={false}/><YAxis dataKey="max" domain={[65,90]} tickLine={false} axisLine={false} width={28}/><ChartTooltip content={<ChartTooltipContent formatter={(value) => <span className="font-bold">{value} kg</span>} />} /><Line type="monotone" dataKey="max" stroke="#3d8b65" strokeWidth={3} dot={{ fill: '#3d8b65', r: 4 }} activeDot={{ r: 6 }}/></LineChart></ChartContainer></CardContent></Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="rounded-3xl py-5 shadow-none ring-border/80"><CardHeader className="px-5"><CardTitle className="flex items-center gap-2 font-bold"><Sparkles className="size-5 text-primary" /> メニュー評価</CardTitle><CardDescription>直近4週間・全51セットを分析</CardDescription></CardHeader><CardContent className="space-y-3 px-5"><div className="rounded-2xl bg-[#eefaf2] p-4"><p className="font-bold text-[#1e6340]">追加がおすすめ</p><p className="mt-1 text-sm leading-relaxed text-[#48705a]">フェイスプル 3セット／週。胸に対して背中上部のボリュームが少なく、肩の安定を補えます。</p></div><div className="rounded-2xl bg-[#fff7e9] p-4"><p className="font-bold text-[#8a5b1e]">少し減らしてもOK</p><p className="mt-1 text-sm leading-relaxed text-[#795f3d]">ケーブルフライを週6→4セットへ。胸全体は目標範囲を20%上回っています。</p></div></CardContent></Card>
        <Card className="rounded-3xl py-5 shadow-none ring-border/80"><CardHeader className="px-5"><CardTitle className="font-bold">部位別セット数</CardTitle><CardDescription>今週のバランス</CardDescription></CardHeader><CardContent className="px-2 sm:px-5"><ChartContainer config={chartConfig} className="h-[220px] w-full aspect-auto"><BarChart data={[{part:'胸',sets:12},{part:'背中',sets:8},{part:'脚',sets:9},{part:'肩',sets:6},{part:'腕',sets:7}]} margin={{left:0,right:8}}><CartesianGrid vertical={false}/><XAxis dataKey="part" axisLine={false} tickLine={false}/><YAxis hide/><ChartTooltip content={<ChartTooltipContent />} /><Bar dataKey="sets" fill="#8b72cf" radius={[8,8,2,2]}/></BarChart></ChartContainer><Button variant="outline" onClick={() => navigate('coach')} className="mx-3 mt-2 w-[calc(100%-1.5rem)]">この評価について相談する <MessageCircle /></Button></CardContent></Card>
      </div>
    </div>
  );
}

function CoachView({ messages, input, setInput, onSubmit }: { messages: ChatMessage[]; input: string; setInput: (value: string) => void; onSubmit: (event: FormEvent) => void }) {
  const suggestions = ['次回の重量を相談', 'メニューを見直したい', '右肩の注意点は？'];
  return (
    <div className="grid min-h-[calc(100vh-92px)] gap-5 p-4 sm:p-7 lg:grid-cols-[1fr_310px] lg:p-10">
      <Card className="min-h-[620px] rounded-3xl py-0 shadow-none ring-border/80">
        <CardHeader className="border-b px-5 py-5 sm:px-6"><CardTitle className="flex items-center gap-3 text-lg font-bold"><span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"><Sparkles className="size-5" /></span><span>REPWISEコーチ<span className="mt-0.5 block text-xs font-normal text-muted-foreground">あなたの記録をもとに一緒に考えます</span></span></CardTitle><CardAction><Badge className="bg-[#e6f8ed] text-[#247a49]"><span className="size-1.5 rounded-full bg-[#29a25d]"/>オンライン</Badge></CardAction></CardHeader>
        <CardContent className="flex min-h-[530px] flex-col px-4 py-5 sm:px-6">
          <div className="flex-1 space-y-5">{messages.map((message,index) => <CoachBubble key={index} message={message} />)}</div>
          <div className="my-4 flex flex-wrap gap-2">{suggestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => setInput(suggestion)} className="rounded-full border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-muted">{suggestion}</button>)}</div>
          <form onSubmit={onSubmit} className="flex items-end gap-2 rounded-2xl bg-muted p-2"><Textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="トレーニングについて相談する…" className="min-h-11 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"/><Button type="submit" size="icon" className="size-11 shrink-0 rounded-xl" aria-label="送信"><Send /></Button></form>
        </CardContent>
      </Card>
      <aside className="space-y-5"><Card className="rounded-3xl bg-[#f4f0ff] py-5 shadow-none ring-[#ded3ff]"><CardHeader className="px-5"><CardTitle className="flex items-center gap-2 font-bold text-[#402b73]"><Activity className="size-5"/> コーチが見ている情報</CardTitle></CardHeader><CardContent className="space-y-3 px-5 text-sm text-[#665881]"><p>・直近12回のトレーニング</p><p>・セットごとの重量／rep数</p><p>・あなたが残したメモ</p><p>・部位ごとの週ボリューム</p></CardContent></Card><Card className="rounded-3xl py-5 shadow-none ring-border/80"><CardHeader className="px-5"><CardTitle className="font-bold">今週の要点</CardTitle></CardHeader><CardContent className="space-y-3 px-5"><div className="flex items-center justify-between rounded-xl bg-muted p-3 text-sm"><span>疲労度</span><Badge variant="secondary">適正</Badge></div><div className="flex items-center justify-between rounded-xl bg-muted p-3 text-sm"><span>部位バランス</span><Badge className="bg-[#fff1db] text-[#8a5b1e]">要調整</Badge></div><div className="flex items-center justify-between rounded-xl bg-muted p-3 text-sm"><span>伸び</span><Badge className="bg-[#e6f8ed] text-[#247a49]">+8%</Badge></div></CardContent></Card></aside>
    </div>
  );
}
