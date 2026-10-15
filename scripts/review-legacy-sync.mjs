// Synthetic localhost IndexedDB fixtures; reloads preserve the old queue and raw records.
export async function reviewLegacySync({ send, registerTarget, markClosing, type, pause, evalJs, go, reload, until, clickText, shot, setViewport, overflow, check, server, fixtureWorkout, fixturesDir, setOnline }) {
  const read = () => evalJs(`new Promise((resolve,reject)=>{const r=indexedDB.open('repwise-local');r.onsuccess=()=>{const db=r.result;const names=['workoutDrafts','workoutMutationQueue','syncRecoveryArchive'];const tx=db.transaction(names,'readonly');const out={};for(const name of names){const q=tx.objectStore(name).getAll();q.onsuccess=()=>out[name]=q.result;}tx.oncomplete=()=>{db.close();resolve(out)};tx.onerror=()=>reject(tx.error)}})`);
  const now = new Date().toISOString();
  async function seed(id, operations) {
    const active = { ...structuredClone(fixtureWorkout), id, name: `旧データ復旧テスト_${id}`, status: 'active', endedAt: null, exercises: [], overallNote: '原本に残す未同期メモ', localDate: '2026-10-15', deletedAt: null, version: 1 };
    server.set(id, structuredClone(active));
    const deleted = { ...active, deletedAt: now };
    const draft = { schemaVersion: 1, workoutId: id, draftStatus: 'deleted', workout: deleted, localUpdatedAt: now, serverVersion: 1, serverUpdatedAt: now, completedAt: null };
    const queue = operations.map((op, index) => ({ mutationId: `${id}-${index}`, entityType: 'workout', entityId: id, workoutId: id, operation: op, baseVersion: index + 1, payload: { workout: op === 'delete' ? deleted : active }, sequence: Date.now() * 1000 + index, createdAt: now, syncStatus: index === 0 ? 'blocked' : 'pending', retryCount: index === 0 ? 2 : 0, lastAttemptAt: index === 0 ? now : null, lastError: index === 0 ? (op === 'delete' ? 'HTTP 400\npayload.workout.status: 完了状態が必要です' : 'HTTP 400\npayload.workout.exercises: 古い入力不正') : null }));
    await evalJs(`new Promise((resolve,reject)=>{const r=indexedDB.open('repwise-local');r.onsuccess=()=>{const db=r.result;const tx=db.transaction(['workoutDrafts','workoutMutationQueue'],'readwrite');tx.objectStore('workoutDrafts').put(${JSON.stringify(draft)});for(const q of ${JSON.stringify(queue)})tx.objectStore('workoutMutationQueue').put(q);tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)}})`);
    return { draft, queue };
  }
  await setViewport(375);
  setOnline(true);
  await go('/settings', `document.body.innerText.includes('端末の保存済み記録：')`);
  const old = await seed('legacy-contract', ['delete']);
  await reload(`document.body.innerText.includes('削除の反映待ち：0件')`);
  await until(`new Promise(r=>{const q=indexedDB.open('repwise-local');q.onsuccess=()=>{const db=q.result;const g=db.transaction('workoutMutationQueue','readonly').objectStore('workoutMutationQueue').getAll();g.onsuccess=()=>{db.close();r(!g.result.some(v=>v.workoutId==='legacy-contract'))}}})`);
  const fixed = await read();
  check(server.get('legacy-contract').deletedAt && fixed.syncRecoveryArchive.some(a => a.mutation?.mutationId === old.queue[0].mutationId), 'legacy_400_queue_recovers_after_reload_with_original_archived');
  check(await overflow(), 'legacy_recovery_settings_no_horizontal_overflow_375');
  await shot(`${fixturesDir}/legacy-contract-recovered-375.png`);

  const failed = await seed('legacy-obsolete-update', ['replace', 'delete']);
  await reload(`document.body.innerText.includes('削除の反映待ち：1件')`);
  await evalJs(`(()=>{const el=Array.from(document.querySelectorAll('summary')).find(e=>e.innerText.includes('削除の反映待ち'));el.click();})()`);
  await until(`document.body.innerText.includes('原本を保護して個別復旧')`);
  await shot(`${fixturesDir}/legacy-blocked-375.png`);
  await clickText('原本を保護して個別復旧');
  await until(`document.body.innerText.includes('削除の復旧が完了')`);
  const recovered = await read();
  const archived = recovered.syncRecoveryArchive.find(a => a.reason === 'explicit-delete-reconciliation');
  check(archived?.mutations.length === 2 && archived.mutations.some(m => m.mutationId === failed.queue[0].mutationId && m.payload.workout.overallNote === '原本に残す未同期メモ'), 'explicit_recovery_keeps_obsolete_updates_and_notes_in_exportable_archive');
  check(server.get('legacy-obsolete-update').deletedAt && recovered.workoutMutationQueue.length === 0, 'explicit_recovery_applies_only_delete_and_clears_real_queue_counts');
  await setViewport(390);
  await reload(`document.body.innerText.includes('削除の反映待ち：0件')`);
  check(await overflow(), 'recovered_settings_no_horizontal_overflow_390');
  await shot(`${fixturesDir}/legacy-recovered-390.png`);
  await go('/history?status=active&month=all', `document.body.innerText.includes('履歴')`);
  await until(`!document.body.innerText.includes('読み込み中')`);
  check(!(await evalJs(`document.body.innerText.includes('旧データ復旧テスト_')`)), 'deleted_legacy_records_stay_hidden_after_reload_and_navigation');
  await shot(`${fixturesDir}/history-after-recovery-390.png`);
  // Real two-tab UI: leave an update unsynced, delete from another tab, verify shared state.
  setOnline(false);
  await go('/workouts/active/draft-other', `document.querySelector('#workout-overall-note')`);
  await type('#workout-overall-note', '別タブ削除前の未同期メモ');
  await until(`new Promise(r=>{const q=indexedDB.open('repwise-local');q.onsuccess=()=>{const db=q.result;const g=db.transaction('workoutMutationQueue','readonly').objectStore('workoutMutationQueue').getAll();g.onsuccess=()=>{db.close();r(g.result.some(v=>v.workoutId==='draft-other'&&v.operation==='replace'))}}})`);
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  registerTarget(targetId);
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  registerTarget(targetId, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Fetch.enable', { patterns: [{ urlPattern: 'http://localhost:3000/api/*', requestStage: 'Request' }] }, sessionId);
  const inTab = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await send('Page.navigate', { url: 'http://localhost:3000/history?status=active&month=all' }, sessionId);
  let ready = false;
  for (let i = 0; i < 250; i++) { if (await inTab(`Boolean(document.querySelector('button[aria-label="別の入力途中の削除操作を表示"]'))`)) { ready = true; break; } await pause(100); }
  check(ready, 'second_tab_opens_pending_workout_history');
  await inTab(`document.querySelector('button[aria-label="別の入力途中の削除操作を表示"]').click()`);
  await pause(100);
  await inTab(`document.querySelector('button[aria-label="別の入力途中を削除"]').click()`);
  await until(`document.body.innerText.includes('端末で削除済み')`);
  check(!(await evalJs(`Boolean(document.querySelector('#workout-overall-note'))`)), 'other_tab_delete_closes_stale_editor_and_preserves_navigation');
  const crossTab = await read();
  check(crossTab.workoutDrafts.some(d => d.workoutId === 'draft-other' && d.draftStatus === 'deleted' && d.workout.overallNote.includes('別タブ削除前')) && crossTab.workoutMutationQueue.some(m => m.workoutId === 'draft-other' && m.operation === 'replace') && crossTab.workoutMutationQueue.some(m => m.workoutId === 'draft-other' && m.operation === 'delete'), 'cross_tab_delete_preserves_pending_update_and_fifo_delete');
  await shot(`${fixturesDir}/other-tab-delete-390.png`);
  markClosing(sessionId);
  await send('Target.closeTarget', { targetId });
  await send('Page.bringToFront');
  setOnline(true);
  await go('/settings', `document.body.innerText.includes('保存と同期')`);
  await until(`document.body.innerText.includes('削除の反映待ち：1件')`);
  await evalJs(`Array.from(document.querySelectorAll('summary')).find(e=>e.innerText.includes('削除の反映待ち')).click()`);
  await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='削除の反映を再試行'&&!b.disabled)`);
  await clickText('削除の反映を再試行');
  await until(`document.body.innerText.includes('削除の反映待ち：0件')`);
  check(Boolean(server.get('draft-other').deletedAt), 'cross_tab_pending_update_then_delete_syncs_without_resurrection');

}
