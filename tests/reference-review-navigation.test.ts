import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describeSetReferences, referenceForSet, type ExerciseHistoryEntry } from '@/lib/workouts/history';
import { analyticsRangeFromSearch } from '@/lib/analytics/detail-view';
import { createSet } from '@/lib/workouts/draft';
import { evaluateProgression } from '@/lib/progression/engine';
import { ExerciseProgression } from '@/components/workouts/exercise-progression';
import type { WorkoutExercise } from '@/lib/workouts/types';

function fixtures() {
  const sets = [0, 1, 2].map(position => createSet(position));
  const entry: ExerciseHistoryEntry = { workoutId: 'past', workoutExerciseId: 'past-bench', workoutName: '前回', localDate: '2026-10-10', exerciseName: 'ベンチプレス', note: '胸を張る', overallNote: '', sets: sets.map(set => ({ ...set, status: 'completed', actualLoadGrams: 60000, actualReps: 10 })) };
  return { sets, entry };
}
describe('overview uses the same reference eligibility as set cards', () => {
  it('全体の判定用実績がなくてもセット別に参照できる記録を「なし」と表示しない', () => {
    const { sets, entry } = fixtures();
    const summary = describeSetReferences([entry], sets, 'success');
    expect(sets.every(set => referenceForSet([entry], set, sets))).toBe(true);
    expect(summary.label).toBe('セット別の前回実績を参照中');
    const exercise: WorkoutExercise = { id: 'bench', exerciseId: 'master', exerciseNameSnapshot: 'ベンチプレス', position: 0, status: 'in_progress', note: '', startedAt: '', completedAt: null, createdAt: '', updatedAt: '', sets };
    const html = renderToStaticMarkup(createElement(ExerciseProgression, { exercise, referenceSummary: summary, onRetry: () => {}, state: { status: 'success', error: null, recommendation: { exerciseId: 'master', profile: null, performance: null, decision: evaluateProgression(null, null) } } }));
    expect(html).toContain(summary.label);
    expect(html).not.toContain('参考記録なし');
  });
  it('役割・重量基準が違う記録を参考実績として数えず、不一致を説明する', () => {
    const { sets, entry } = fixtures();
    sets[0].role = 'top';
    sets[1].loadBasis = 'paired_total';
    const summary = describeSetReferences([entry], sets, 'success');
    expect(summary.detail).toContain('1 / 3セット');
    expect(summary.detail).toContain('重量基準');
    sets[2].role = 'backoff';
    expect(describeSetReferences([entry], sets, 'success').label).toBe('比較条件に合う参考実績なし');
  });
  it('未完了実績・読み込み中・取得失敗を記録なしと混同しない', () => {
    const { sets, entry } = fixtures();
    entry.sets = sets;
    expect(describeSetReferences([entry], sets, 'success').label).toBe('比較条件に合う参考実績なし');
    expect(describeSetReferences([], sets, 'loading').label).toContain('確認中');
    expect(describeSetReferences([], sets, 'error').label).toContain('取得できません');
    expect(describeSetReferences([], sets, 'success').label).toBe('参考記録なし');
  });
});
describe('shareable analytics range', () => {
  it('URLの有効期間を復元し、欠落・不正な値は30日に戻す', () => {
    for (const range of ['7d', '30d', '90d', 'all']) expect(analyticsRangeFromSearch(`?exerciseId=bench&range=${range}`)).toBe(range);
    expect(analyticsRangeFromSearch('?range=invalid')).toBe('30d');
    expect(analyticsRangeFromSearch('')).toBe('30d');
  });
});
