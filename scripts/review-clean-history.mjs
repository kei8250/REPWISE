export async function reviewCleanHistory({ evalJs, go, reload, until, tap, type, shot, setViewport, overflow, check, server, fixtureWorkout, fixturesDir, setOnline }) {
  setOnline(true);
  await setViewport(375);
  await go('/settings', `document.querySelector('input[aria-label="設定する種目を検索"]')`);
  const now = new Date().toISOString();
  const completed = { ...structuredClone(fixtureWorkout), id: 'completed-edit-cache', name: '完了した記録は完了のみ', localDate: '2026-10-16' };
  const active = { ...completed, status: 'active', endedAt: null };
  server.set(active.id, active);
  const old = { ...structuredClone(fixtureWorkout), id: 'old-deleted-hidden', name: '表示してはいけない削除記録', deletedAt: now, version: 2 };
  server.set(old.id, old);
  const empty = { ...structuredClone(fixtureWorkout), id: 'empty-completed', name: '実績のない完了フラグ', exercises: [] };
  server.set(empty.id, empty);
  const drafts = [
    { workoutId: active.id, schemaVersion: 1, draftStatus: 'completed_edit', workout: active, editBaseline: completed, serverUpdatedAt: null, serverVersion: 1, localUpdatedAt: now, completedAt: now },
    { workoutId: old.id, schemaVersion: 1, draftStatus: 'deleted', workout: old, serverUpdatedAt: now, serverVersion: 2, localUpdatedAt: now, completedAt: now },
  ];
  const mutation = { mutationId: 'old-edit-with-active-cache', workoutId: active.id, entityId: active.id, entityType: 'workout', operation: 'edit', baseVersion: 1, payload: { workout: active }, createdAt: now, sequence: Date.now()*1000, syncStatus: 'blocked', retryCount: 1, lastAttemptAt: now, lastError: '古い入力不正（HTTP 400）' };
  await evalJs(`new Promise((resolve,reject)=>{const r=indexedDB.open('repwise-local');r.onsuccess=()=>{const db=r.result;const tx=db.transaction(['workoutDrafts','workoutMutationQueue'],'readwrite');for(const draft of ${JSON.stringify(drafts)})tx.objectStore('workoutDrafts').put(draft);tx.objectStore('workoutMutationQueue').put(${JSON.stringify(mutation)});tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)}})`);
  const forbidden = `!document.body.innerText.includes('表示してはいけない削除記録')&&!document.body.innerText.includes('削除状態を確認')&&!document.body.innerText.includes('削除を取り消す')&&!document.body.innerText.includes('元に戻す')`;
  await go('/history?status=completed&month=all', `document.querySelector('a[href="/workouts/completed-edit-cache"]')`);
  check(await evalJs(`${forbidden}&&!document.body.innerText.includes('実績のない完了フラグ')`), 'completed_history_contains_only_recorded_workouts_without_deleted_rows');
  await shot(`${fixturesDir}/completed-only-375.png`);
  await go('/history?status=active&month=all', `document.querySelector('a[href="/workouts/active/draft-other"]')`);
  check(await evalJs(`${forbidden}&&!document.body.innerText.includes('完了した記録は完了のみ')`), 'completed_edit_baseline_does_not_reappear_as_incomplete');
  await shot(`${fixturesDir}/incomplete-only-375.png`);
  await setViewport(390);
  await go('/history?status=completed&month=all', `document.querySelector('a[href="/workouts/valid-history"]')`);
  await evalJs(`document.querySelector('button[aria-label="10月10日ベンチ履歴の削除操作を表示"]').scrollIntoView({block:'center'})`);
  await tap('button[aria-label="10月10日ベンチ履歴の削除操作を表示"]');
  await until(`!document.querySelector('button[aria-label="10月10日ベンチ履歴を削除"]').disabled`);
  await tap('button[aria-label="10月10日ベンチ履歴を削除"]');
  await until(`!document.querySelector('a[href="/workouts/valid-history"]')`);
  await until(`new Promise(resolve=>{const r=indexedDB.open('repwise-local');r.onsuccess=()=>{const db=r.result;const q=db.transaction('workoutDrafts','readonly').objectStore('workoutDrafts').get('valid-history');q.onsuccess=()=>{resolve(q.result?.permanentDeletionConfirmed);db.close()}}})`);
  check(server.get('valid-history').exercises.length===0 && server.get('valid-history').overallNote==='', 'delete_removes_record_content_without_restore_action');
  await reload(`document.querySelector('a[href="/workouts/completed-edit-cache"]')`);
  check(await evalJs(`${forbidden}&&!document.querySelector('a[href="/workouts/valid-history"]')`), 'deleted_record_stays_absent_after_reload_without_status_notices');
  check(await overflow(), 'clean_history_no_horizontal_overflow_390');
  await shot(`${fixturesDir}/after-delete-390.png`);
  await go('/settings', `document.querySelector('input[aria-label="設定する種目を検索"]')`);
  await evalJs(`document.querySelectorAll('details').forEach(d=>d.open=true)`);
  check(await evalJs(`!document.querySelector('#sync-idle')&&!document.body.textContent.includes('削除状態が未確認')&&!document.body.textContent.includes('表示してはいけない削除記録')&&!document.body.textContent.includes('削除を取り消す')`), 'settings_contains_no_sync_interval_or_deleted_state_confirmation');
  await shot(`${fixturesDir}/settings-without-deleted-state-390.png`);
  await go('/workouts/valid-history', `document.body.innerText.includes('削除しました')`);
  check(await evalJs(`!document.body.innerText.includes('元に戻す')&&!document.body.innerText.includes('削除を同期')`), 'direct_deleted_url_offers_only_navigation_not_restore_or_sync_details');
  const correctionId = 'correct-invalid-input';
  const correctedFixture = { ...structuredClone(fixtureWorkout), id: correctionId, name: '入力を修正して保存', status: 'active', endedAt: null };
  correctedFixture.exercises[0].status = 'in_progress';
  correctedFixture.exercises[0].sets = [{ ...correctedFixture.exercises[0].sets[0], status: 'planned', actualReps: 8, actualLoadGrams: 60000 }];
  server.set(correctionId, structuredClone(correctedFixture));
  const invalid = structuredClone(correctedFixture);
  invalid.exercises[0].sets[0].actualReps = -1;
  const correctionTime = new Date().toISOString();
  const badDraft = { workoutId: correctionId, schemaVersion: 1, draftStatus: 'active', workout: invalid, serverUpdatedAt: correctionTime, serverVersion: 1, localUpdatedAt: correctionTime, completedAt: null };
  const badMutation = { mutationId: 'old-invalid-rep-before-correction', workoutId: correctionId, entityId: correctionId, entityType: 'workout', operation: 'replace', baseVersion: 1, payload: { workout: invalid }, createdAt: correctionTime, sequence: Date.now()*1000, syncStatus: 'blocked', retryCount: 1, lastAttemptAt: correctionTime, lastError: 'actualReps：1〜999の整数（HTTP 400）' };
  await evalJs(`new Promise(resolve=>{const r=indexedDB.open('repwise-local');r.onsuccess=()=>{const db=r.result;const tx=db.transaction(['workoutDrafts','workoutMutationQueue'],'readwrite');tx.objectStore('workoutDrafts').put(${JSON.stringify(badDraft)});tx.objectStore('workoutMutationQueue').put(${JSON.stringify(badMutation)});tx.oncomplete=()=>{db.close();resolve(true)}}})`);
  await go('/workouts/active/'+correctionId, `document.querySelector('input[aria-label="セット1の実績rep"]')`);
  await type('input[aria-label="セット1の実績rep"]', '10');
  await until(`new Promise(resolve=>{const r=indexedDB.open('repwise-local');r.onsuccess=()=>{const db=r.result;const q=db.transaction('workoutMutationQueue','readonly').objectStore('workoutMutationQueue').getAll();q.onsuccess=()=>{resolve(!q.result.some(m=>m.workoutId==='${correctionId}'));db.close()}}})`);
  check(server.get(correctionId).exercises[0].sets[0].actualReps===10 && server.get(correctionId).exercises[0].sets[0].actualLoadGrams===60000, 'correcting_rep_completes_sync_without_manual_queue_actions_or_changing_weight');
  await shot(`${fixturesDir}/corrected-input-saved-390.png`);

}
