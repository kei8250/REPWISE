import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acknowledgeWorkoutMutation, claimNextWorkoutMutation, closeLocalDraftDatabase,
  exportWorkoutRecoveryData, getLocalWorkoutDraft, listWorkoutMutations,
  LOCAL_DATABASE_VERSION, LOCAL_DRAFT_DATABASE_NAME, LOCAL_DRAFT_STORE_NAME,
  recoverLegacyWorkoutQueue, reconcileDeletedWorkout, saveActiveWorkoutDraft,
  saveWorkoutDraftAndEnqueueMutation, updateWorkoutMutation, WORKOUT_MUTATION_STORE_NAME,
  markLocalWorkoutDraftCompleted, pruneCompletedWorkoutDrafts,
} from '@/lib/workouts/local-drafts';
import { syncPendingWorkoutMutations } from '@/lib/workouts/sync-queue';
import { loadVisibleWorkouts, mergeVisibleWorkouts } from '@/lib/workouts/visible-workouts';
import { getAnalytics } from '@/lib/workouts/api-client';
import { syncAutomatically } from '@/lib/workouts/sync-timing';
import { recoverPendingDeletion } from '@/lib/workouts/deletion-recovery';
import { deleteWorkoutRecord } from '@/lib/workouts/draft-deletion';
import type { Workout, WorkoutMutation } from '@/lib/workouts/types';

const time = '2026-10-15T12:00:00.000Z';
function workout(id = 'legacy'): Workout {
  return { id, name: '旧記録・実データなし', status: 'active', localDate: '2026-10-15', timezone: 'Asia/Tokyo', startedAt: time, endedAt: null,
    overallNote: '未同期のメモを保護', rating: null, version: 1, createdAt: time, updatedAt: time, deletedAt: null, sourceWorkoutId: null, exercises: [] };
}
async function rawPut(store: string, value: unknown) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(LOCAL_DRAFT_DATABASE_NAME, LOCAL_DATABASE_VERSION); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  await new Promise<void>((resolve, reject) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(value); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  db.close();
}
async function oldDelete() {
  const local = workout();
  await saveActiveWorkoutDraft(local, { serverUpdatedAt: time });
  const { mutation } = await saveWorkoutDraftAndEnqueueMutation({ ...local, deletedAt: time }, 'delete');
  const legacy: WorkoutMutation = { ...mutation, syncStatus: 'blocked', retryCount: 2, lastAttemptAt: time,
    lastError: 'HTTP 400\npayload.workout.status: 完了状態が必要です' };
  await rawPut(WORKOUT_MUTATION_STORE_NAME, legacy);
  await closeLocalDraftDatabase();
  return legacy;
}
async function snapshot(id = 'legacy') {
  const draft = await getLocalWorkoutDraft(id);
  if (!draft) throw new Error('fixture missing');
  return { draft, mutations: await listWorkoutMutations(id) };
}
beforeEach(async () => {
  vi.restoreAllMocks();
  await closeLocalDraftDatabase();
  await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(LOCAL_DRAFT_DATABASE_NAME); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
});

describe('persisted legacy queue recovery without clearing user data', () => {
  it('旧400キューを再起動後一度だけ原本保護して再試行し、payload/id/baseVersionを変えない', async () => {
    const legacy = await oldDelete();
    await saveWorkoutDraftAndEnqueueMutation(workout('healthy'), 'create');
    const healthy = await snapshot('healthy');
    expect(await recoverLegacyWorkoutQueue()).toBe(1);
    const [recovered] = await listWorkoutMutations('legacy');
    expect(recovered).toEqual({ ...legacy, syncStatus: 'pending', lastError: null });
    await updateWorkoutMutation(legacy.mutationId, { syncStatus: 'blocked', lastError: legacy.lastError });
    expect(await recoverLegacyWorkoutQueue()).toBe(0);
    expect(await snapshot('healthy')).toEqual(healthy);
    const exported = await exportWorkoutRecoveryData();
    expect(exported.recoveryArchive).toContainEqual(expect.objectContaining({ mutation: legacy }));
  });
  it('旧失敗→再起動→再試行成功で待ち件数・エラーが消え、削除情報は残る', async () => {
    const legacy = await oldDelete();
    await recoverLegacyWorkoutQueue();
    const fetcher = vi.fn(async () => Response.json({ mutationId: legacy.mutationId, duplicate: false, workout: { ...legacy.payload.workout, version: 2 } }));
    expect(await syncPendingWorkoutMutations('legacy', { fetcher })).toMatchObject({ processed: 1, remaining: 0, failed: null });
    await closeLocalDraftDatabase();
    expect(await listWorkoutMutations('legacy')).toEqual([]);
    expect(await getLocalWorkoutDraft('legacy')).toMatchObject({ draftStatus: 'deleted', workout: { deletedAt: time } });
  });
  it('failed形式の旧400とdeletedAtなしの削除要求も、送信原本を変えずに復旧する', async () => {
    const original = await oldDelete();
    const legacy = { ...original, syncStatus: 'failed', payload: { workout: { ...original.payload.workout, deletedAt: null } } };
    await rawPut(WORKOUT_MUTATION_STORE_NAME, legacy);
    const { draft } = await snapshot();
    await rawPut(LOCAL_DRAFT_STORE_NAME, { ...draft, draftStatus: 'active', workout: workout(), localUpdatedAt: original.createdAt });
    await recoverLegacyWorkoutQueue();
    expect((await listWorkoutMutations('legacy'))[0]).toMatchObject({ mutationId: original.mutationId, syncStatus: 'pending', payload: { workout: { deletedAt: null } } });
    expect(await getLocalWorkoutDraft('legacy')).toMatchObject({ draftStatus: 'deleted', workout: { deletedAt: original.createdAt } });
  });
  it('1件の不正操作が残っても無関係な正常記録は同期できる', async () => {
    await oldDelete();
    const { mutation } = await saveWorkoutDraftAndEnqueueMutation(workout('healthy'), 'create');
    const result = await syncPendingWorkoutMutations('healthy', { fetcher: async () => Response.json({ mutationId: mutation.mutationId, duplicate: false, workout: workout('healthy') }) });
    expect(result).toMatchObject({ processed: 1, remaining: 0, failed: null });
    expect(await listWorkoutMutations('legacy')).toHaveLength(1);
    expect((await getLocalWorkoutDraft('healthy'))?.workout.overallNote).toBe('未同期のメモを保護');
  });
  it('別の入力不正400は自動成功・自動再送扱いにしない', async () => {
    const legacy = await oldDelete();
    await updateWorkoutMutation(legacy.mutationId, { lastError: 'payload.workout.exercises: 不正な入力' });
    expect(await recoverLegacyWorkoutQueue()).toBe(0);
    const fetcher = vi.fn();
    await syncPendingWorkoutMutations('legacy', { fetcher });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('古いACKで壊れたキャッシュを最後の削除キューから復旧する', async () => {
    const legacy = await oldDelete();
    const { draft } = await snapshot();
    await rawPut(LOCAL_DRAFT_STORE_NAME, { ...draft, draftStatus: 'active', workout: workout(), localUpdatedAt: legacy.createdAt });
    await recoverLegacyWorkoutQueue();
    expect(await getLocalWorkoutDraft('legacy')).toMatchObject({ draftStatus: 'deleted', workout: { deletedAt: time } });
  });
  it('個別復旧は古い更新・削除を原本として残し、サーバーのversionで削除だけを再作成する', async () => {
    const local = workout();
    await saveActiveWorkoutDraft(local, { serverUpdatedAt: time });
    const { mutation: update } = await saveWorkoutDraftAndEnqueueMutation({ ...local, overallNote: '絶対に失わないメモ' }, 'replace');
    await updateWorkoutMutation(update.mutationId, { syncStatus: 'blocked', retryCount: 1, lastError: '入力不正' });
    await saveWorkoutDraftAndEnqueueMutation({ ...local, deletedAt: time }, 'delete');
    await saveWorkoutDraftAndEnqueueMutation(workout('healthy'), 'create');
    const healthy = await snapshot('healthy');
    const before = await snapshot();
    await reconcileDeletedWorkout('legacy', { ...local, version: 7 }, before);
    const [mutation] = await listWorkoutMutations('legacy');
    expect(mutation).toMatchObject({ operation: 'delete', baseVersion: 7, retryCount: 0 });
    expect(mutation.mutationId).not.toBe(update.mutationId);
    expect(await snapshot('healthy')).toEqual(healthy);
    const exported = await exportWorkoutRecoveryData();
    expect(exported.recoveryArchive).toContainEqual(expect.objectContaining({ mutations: before.mutations }));
    // An old tab finishing the archived request cannot restore the record.
    await acknowledgeWorkoutMutation(update, { ...local, version: 8 });
    expect(await getLocalWorkoutDraft('legacy')).toMatchObject({ draftStatus: 'deleted' });
    expect(await listWorkoutMutations('legacy')).toEqual([mutation]);
  });
  it('サーバー削除確認済みならキューを退避し、件数0・再読み込み後も非表示', async () => {
    await oldDelete();
    const before = await snapshot();
    await reconcileDeletedWorkout('legacy', { ...workout(), deletedAt: time, version: 9 }, before);
    await closeLocalDraftDatabase();
    const draft = await getLocalWorkoutDraft('legacy');
    expect(await listWorkoutMutations('legacy')).toEqual([]);
    expect(mergeVisibleWorkouts([{ id: 'legacy' } as never], draft ? [draft] : [], [])).toEqual([]);
    expect((await exportWorkoutRecoveryData()).recoveryArchive.length).toBe(1);
  });
  it('404でも送信済みの作成が後着する可能性があれば退避・削除しない', async () => {
    await oldDelete();
    const before = await snapshot();
    await expect(reconcileDeletedWorkout('legacy', null, before)).rejects.toThrow('判断できない');
    expect(await snapshot()).toEqual(before);
  });
  it('サーバー不存在だけで未送信の作成を捨てず、通常FIFOによる同期と取り消しを保護する', async () => {
    await saveWorkoutDraftAndEnqueueMutation(workout(), 'create');
    await saveWorkoutDraftAndEnqueueMutation({ ...workout(), deletedAt: time }, 'delete');
    const before = await snapshot();
    await expect(reconcileDeletedWorkout('legacy', null, before)).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });
  it('キューのない旧削除状態も個別照合し、サーバー未削除ならversionを照合して削除要求を作る', async () => {
    const { draft } = await saveWorkoutDraftAndEnqueueMutation({ ...workout(), deletedAt: time }, 'delete');
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open(LOCAL_DRAFT_DATABASE_NAME); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>((resolve) => { const tx = db.transaction(WORKOUT_MUTATION_STORE_NAME, 'readwrite'); tx.objectStore(WORKOUT_MUTATION_STORE_NAME).clear(); tx.oncomplete = () => resolve(); });
    db.close();
    await reconcileDeletedWorkout('legacy', workout(), { draft, mutations: [] });
    expect(await listWorkoutMutations('legacy')).toEqual([expect.objectContaining({ operation: 'delete', baseVersion: 1 })]);
  });
  it('復旧確認中に別タブで取り消されたら原本・新しい操作を変更しない', async () => {
    await oldDelete();
    const before = await snapshot();
    await saveWorkoutDraftAndEnqueueMutation(workout(), 'restore');
    const restored = await snapshot();
    await expect(reconcileDeletedWorkout('legacy', { ...workout(), deletedAt: time, version: 9 }, before)).rejects.toThrow();
    expect(await snapshot()).toEqual(restored);
  });
  it('稼働中のclaimは別タブが奪わず、期限切れのみ同じmutationを再試行する', async () => {
    await saveWorkoutDraftAndEnqueueMutation(workout(), 'create');
    const first = await claimNextWorkoutMutation('legacy', { lastAttemptAt: time });
    const second = await claimNextWorkoutMutation('legacy', { lastAttemptAt: '2026-10-15T12:00:30.000Z' });
    expect(first.status).toBe('claimed');
    expect(second.status).toBe('stopped');
    const expired = await claimNextWorkoutMutation('legacy', { lastAttemptAt: '2026-10-15T12:01:01.000Z' });
    expect(expired.status).toBe('claimed');
    expect(expired.mutation?.mutationId).toBe(first.mutation?.mutationId);
  });
  it('重複ACK・古い完了取得が同期済み削除を上書きしない', async () => {
    const { mutation: create } = await saveWorkoutDraftAndEnqueueMutation(workout(), 'create');
    const { mutation: deletion } = await saveWorkoutDraftAndEnqueueMutation({ ...workout(), deletedAt: time }, 'delete');
    await acknowledgeWorkoutMutation(create, workout());
    await acknowledgeWorkoutMutation(deletion, { ...workout(), deletedAt: time, version: 2 });
    await acknowledgeWorkoutMutation(create, workout());
    await markLocalWorkoutDraftCompleted({ ...workout(), status: 'completed', endedAt: time });
    expect(await getLocalWorkoutDraft('legacy')).toMatchObject({ draftStatus: 'deleted', serverVersion: 2 });
  });
  it('古い不整合キャッシュ・削除情報・同期未確認の記録を保持期限で消さない', async () => {
    const { draft } = await saveWorkoutDraftAndEnqueueMutation(workout(), 'create');
    await rawPut(LOCAL_DRAFT_STORE_NAME, { ...draft, workoutId: 'corrupt', workout: workout('corrupt'), draftStatus: 'completed', completedAt: time });
    await rawPut(LOCAL_DRAFT_STORE_NAME, { ...draft, workoutId: 'tombstone', workout: { ...workout('tombstone'), status: 'completed', deletedAt: time }, draftStatus: 'completed', completedAt: time });
    await rawPut(LOCAL_DRAFT_STORE_NAME, { ...draft, workoutId: 'unverified', workout: { ...workout('unverified'), status: 'completed' }, draftStatus: 'completed', serverUpdatedAt: null, completedAt: time });
    expect(await pruneCompletedWorkoutDrafts(Date.parse(time) + 30 * 86400000)).toBe(0);
    expect((await exportWorkoutRecoveryData()).drafts).toHaveLength(4);
  });
  it('別タブの古い完了編集は削除済みキャッシュやキューを書き換えない', async () => {
    const completed = { ...workout(), status: 'completed' as const, endedAt: time };
    await markLocalWorkoutDraftCompleted(completed);
    await saveWorkoutDraftAndEnqueueMutation({ ...completed, deletedAt: time }, 'delete');
    const before = await snapshot();
    await expect(saveWorkoutDraftAndEnqueueMutation({ ...completed, overallNote: '古い編集' }, 'edit')).rejects.toThrow('削除状態');
    expect(await snapshot()).toEqual(before);
  });
  it('読めない下書きは既知の古い削除より優先して保護し、通常一覧には戻さない', async () => {
    await oldDelete();
    const { draft } = await snapshot();
    const unknown = { ...draft, schemaVersion: 99, localUpdatedAt: '2099-01-01T00:00:00Z', workout: { ...draft.workout, overallNote: '未知形式の新しいメモ' } };
    await rawPut(LOCAL_DRAFT_STORE_NAME, unknown);
    await recoverLegacyWorkoutQueue();
    await expect(claimNextWorkoutMutation('legacy')).rejects.toThrow('旧形式');
    expect((await exportWorkoutRecoveryData()).drafts).toEqual([unknown]);
    expect(mergeVisibleWorkouts([{ id: 'legacy' } as never], [], await listWorkoutMutations('legacy'))).toEqual([]);
  });
  it('読めない旧形式も書き出しに含め、同じ記録の後続同期を止める', async () => {
    const { mutation } = await saveWorkoutDraftAndEnqueueMutation(workout(), 'create');
    const unknown = { ...mutation, baseVersion: undefined };
    await rawPut(WORKOUT_MUTATION_STORE_NAME, unknown);
    await closeLocalDraftDatabase();
    await expect(claimNextWorkoutMutation('legacy')).rejects.toThrow('旧形式');
    expect((await exportWorkoutRecoveryData()).mutations).toEqual([unknown]);
  });
  it('別記録の不正なsequenceが正常な記録の採番や保存を止めない', async () => {
    const { mutation } = await saveWorkoutDraftAndEnqueueMutation(workout(), 'create');
    await rawPut(WORKOUT_MUTATION_STORE_NAME, { ...mutation, sequence: 'unknown-old-sequence' });
    await expect(saveWorkoutDraftAndEnqueueMutation(workout('healthy'), 'create')).resolves.toMatchObject({ mutation: { workoutId: 'healthy', sequence: expect.any(Number) } });
    expect((await exportWorkoutRecoveryData()).mutations).toContainEqual(expect.objectContaining({ sequence: 'unknown-old-sequence' }));
  });
  it('遅れて返る一覧にも最新の削除情報を適用する', async () => {
    await saveActiveWorkoutDraft(workout(), { serverUpdatedAt: time });
    vi.stubGlobal('fetch', vi.fn(async () => {
      await saveWorkoutDraftAndEnqueueMutation({ ...workout(), deletedAt: time }, 'delete');
      return Response.json([{ ...workout(), setCount: 0, exerciseCount: 0 }]);
    }));
    try { expect((await loadVisibleWorkouts('active')).items).toEqual([]); }
    finally { vi.unstubAllGlobals(); }
  });
  it('分析は削除情報を付けて再計算を要求し、応答中に削除されたら再取得する', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => {
      if (fetcher.mock.calls.length === 1) await saveWorkoutDraftAndEnqueueMutation({ ...workout(), deletedAt: time }, 'delete');
      return Response.json({ generatedAt: time });
    });
    await getAnalytics('30d', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[0]).toContain('exclude=legacy');
  });
});


describe('delete intent recovers without making users inspect queues', () => {
  it('不要な入力途中を削除すると、古い400更新を原本に残しサーバーsnapshotで削除だけを作る', async () => {
    await saveActiveWorkoutDraft(workout(), { serverUpdatedAt: time });
    const { mutation } = await saveWorkoutDraftAndEnqueueMutation({ ...workout(), overallNote: '古い未送信のメモ' }, 'replace');
    await updateWorkoutMutation(mutation.mutationId, { syncStatus: 'blocked', retryCount: 1, lastError: '入力不正（HTTP 400）' });
    await deleteWorkoutRecord('legacy');
    await saveWorkoutDraftAndEnqueueMutation(workout('healthy'), 'create');
    const healthy = await snapshot('healthy');
    expect(await recoverPendingDeletion('legacy', { fetcher: async () => Response.json({ workout: workout() }) })).toBe(true);
    const queue = await listWorkoutMutations('legacy');
    expect(queue).toEqual([expect.objectContaining({ operation: 'delete', baseVersion: 1, payload: { workout: expect.objectContaining({ overallNote: '未同期のメモを保護' }) } })]);
    expect((await exportWorkoutRecoveryData()).recoveryArchive).toContainEqual(expect.objectContaining({ reason: 'automatic-delete-reconciliation', mutations: expect.arrayContaining([expect.objectContaining({ mutationId: mutation.mutationId, payload: { workout: expect.objectContaining({ overallNote: '古い未送信のメモ' }) } })]) }));
    expect(await snapshot('healthy')).toEqual(healthy);
    await syncPendingWorkoutMutations('legacy', { fetcher: async () => Response.json({ mutationId: queue[0].mutationId, duplicate: false, workout: { ...workout(), version: 2, deletedAt: time } }) });
    expect(await listWorkoutMutations('legacy')).toEqual([]);
  });
  it('通常の自動同期だけで400更新の後ろの削除まで完了する', async () => {
    await saveActiveWorkoutDraft(workout(), { serverUpdatedAt: time });
    await saveWorkoutDraftAndEnqueueMutation(workout(), 'replace');
    await deleteWorkoutRecord('legacy');
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
      if (typeof url !== 'string') throw new Error('Expected fixture URL');
      if (url.endsWith('/sync-state')) return Response.json({ workout: workout() });
      if (typeof init?.body !== 'string') throw new Error('Expected JSON body');
      const mutation = JSON.parse(init.body);
      calls.push(mutation.operation);
      if (mutation.operation === 'replace') return Response.json({ error: '古い入力不正' }, { status: 400 });
      return Response.json({ mutationId: mutation.mutationId, duplicate: false, workout: { ...workout(), version: 2, deletedAt: time } });
    });
    try {
      expect(await syncAutomatically('legacy')).toMatchObject({ remaining: 0, failed: null });
      expect(calls).toEqual(['replace', 'delete']);
      expect(await listWorkoutMutations('legacy')).toEqual([]);
    } finally { vi.unstubAllGlobals(); }
  });
  it('サーバーが別の端末で進んでいれば自動で削除しない', async () => {
    await oldDelete();
    const before = await snapshot();
    expect(await recoverPendingDeletion('legacy', { fetcher: async () => Response.json({ workout: { ...workout(), version: 10 } }) })).toBe(false);
    expect(await snapshot()).toEqual(before);
  });
  it('旧サーバーが削除自体を400にしても、削除要求の作り直しを繰り返さない', async () => {
    await oldDelete();
    const fetcher = vi.fn(async () => Response.json({ workout: workout() }));
    expect(await recoverPendingDeletion('legacy', { fetcher })).toBe(true);
    const [mutation] = await listWorkoutMutations('legacy');
    await updateWorkoutMutation(mutation.mutationId, { syncStatus: 'blocked', retryCount: 1, lastError: '旧API（HTTP 400）' });
    await closeLocalDraftDatabase();
    expect(await recoverPendingDeletion('legacy', { fetcher })).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await exportWorkoutRecoveryData()).recoveryArchive).toHaveLength(1);
  });
  it('不存在・通信失敗では原本を保護して通常再試行に任せる', async () => {
    await oldDelete();
    const before = await snapshot();
    expect(await recoverPendingDeletion('legacy', { fetcher: async () => Response.json({ workout: null }) })).toBe(false);
    expect(await snapshot()).toEqual(before);
    await expect(recoverPendingDeletion('legacy', { fetcher: async () => { throw new Error('offline'); } })).rejects.toThrow('offline');
    expect(await snapshot()).toEqual(before);
  });
  it('照合中に取り消したら削除を復旧せず、最新の取り消しを保持する', async () => {
    await oldDelete();
    await expect(recoverPendingDeletion('legacy', { fetcher: async () => {
      await saveWorkoutDraftAndEnqueueMutation(workout(), 'restore');
      return Response.json({ workout: workout() });
    } })).rejects.toThrow('削除状態');
    expect((await getLocalWorkoutDraft('legacy'))?.draftStatus).toBe('active');
    expect((await listWorkoutMutations('legacy')).at(-1)?.operation).toBe('restore');
  });
  it('正常な未同期記録は自動復旧で破棄せず、完了済みの不要記録も設定から削除できる', async () => {
    await saveWorkoutDraftAndEnqueueMutation(workout(), 'create');
    const fetcher = vi.fn();
    expect(await recoverPendingDeletion('legacy', { fetcher })).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    const completed = { ...workout('completed'), status: 'completed' as const, endedAt: time };
    await markLocalWorkoutDraftCompleted(completed);
    await deleteWorkoutRecord(completed.id);
    expect(await getLocalWorkoutDraft(completed.id)).toMatchObject({ draftStatus: 'deleted', workout: { status: 'completed', endedAt: time } });
  });
});
