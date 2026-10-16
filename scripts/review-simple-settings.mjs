// Run only in the parent localhost API fixture harness.
export async function reviewSimpleSettings({ evalJs, go, reload, until, tap, type, select, clickText, shot, setViewport, overflow, check, server, fixtureWorkout, fixturesDir, setOnline }) {
  setOnline(true);
  for (const width of [375, 390]) {
    await setViewport(width);
    await go('/analytics?range=all&exerciseId=ex-bench-press', `document.querySelector('select[aria-label="分析する部位"]')`);
    await select('select[aria-label="分析する部位"]', '背中');
    await until(`document.querySelector('select[aria-label="分析する種目"]').options.length===1 && document.querySelector('select[aria-label="分析する種目"]').value==='ex-seated-row'`);
    check(await evalJs(`document.body.innerText.includes('シーテッドロウ') && new URL(location.href).searchParams.get('exerciseId')==='ex-seated-row'`), `body_part_filters_exercise_and_updates_analysis_${width}`);
    await select('select[aria-label="分析する部位"]', '胸');
    await until(`document.querySelector('select[aria-label="分析する種目"]').value==='ex-bench-press'`);
    check(await overflow(), `analytics_body_picker_no_horizontal_overflow_${width}`);
    await shot(`${fixturesDir}/body-picker-${width}.png`);
  }
  await go('/workouts/active/draft-other', `document.body.innerText.includes('最初の種目を追加しましょう')`);
  await clickText('種目を追加');
  await until(`document.querySelector('#new-exercise-name')`);
  const name = 'ダンベル・ワンハンドロー（ベンチ支持・左右別）';
  await type('#new-exercise-name', name);
  for (const width of [375, 390]) {
    await setViewport(width);
    await evalJs(`document.querySelector('#new-exercise-name').scrollIntoView({block:'center'})`);
    check(await evalJs(`(()=>{const e=document.querySelector('#new-exercise-name');return e.value===${JSON.stringify(name)}&&e.clientWidth>=250&&e.clientHeight>=90&&e.scrollWidth<=e.clientWidth+1})()`), `exercise_name_visible_in_full_width_multiline_field_${width}`);
    check(await overflow(), `exercise_creation_no_horizontal_overflow_${width}`);
    await shot(`${fixturesDir}/exercise-name-${width}.png`);
  }
  await clickText('作成して追加');
  await until(`!document.querySelector('[role="dialog"]') && document.body.innerText.includes(${JSON.stringify(name)})`);
  check(true, 'long_japanese_name_creates_exercise_without_truncating_value');

  await go('/settings', `document.body.innerText.includes('不要な記録を整理')`);
  await until(`document.querySelector('input[aria-label="設定する種目を検索"]')`);
  check(await evalJs(`!document.body.innerText.includes('端末の保存済み記録')&&!document.body.innerText.includes('未同期：')`), 'settings_default_view_hides_sync_diagnostics');
  await shot(`${fixturesDir}/settings-default-390.png`);
  // Actual persisted legacy failed update, not a new happy-path deletion.
  const id = 'simple-cleanup-legacy';
  const active = { ...structuredClone(fixtureWorkout), id, name: '不要な途中記録', status: 'active', endedAt: null, exercises: [], version: 1, deletedAt: null, localDate: '2026-10-16', overallNote: '削除前の未同期メモも原本に保護' };
  server.set(id, { ...active, overallNote: '' });
  const now = new Date().toISOString();
  const draft = { schemaVersion: 1, workoutId: id, draftStatus: 'active', workout: active, localUpdatedAt: now, serverUpdatedAt: now, serverVersion: 1, completedAt: null };
  const mutation = { mutationId: 'legacy-blocked-before-delete', entityType: 'workout', entityId: id, workoutId: id, operation: 'replace', baseVersion: 1, payload: { workout: active }, createdAt: now, sequence: Date.now()*1000, syncStatus: 'blocked', retryCount: 1, lastAttemptAt: now, lastError: '古い入力不正（HTTP 400）' };
  await evalJs(`new Promise((resolve,reject)=>{const r=indexedDB.open('repwise-local');r.onsuccess=()=>{const db=r.result;const tx=db.transaction(['workoutDrafts','workoutMutationQueue'],'readwrite');tx.objectStore('workoutDrafts').put(${JSON.stringify(draft)});tx.objectStore('workoutMutationQueue').put(${JSON.stringify(mutation)});tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)}})`);
  await reload(`document.body.innerText.includes('不要な記録を整理')`);
  await evalJs(`Array.from(document.querySelectorAll('summary')).find(e=>e.textContent.includes('不要な記録を整理')).click()`);
  await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='この記録を削除')`);
  await shot(`${fixturesDir}/unwanted-record-390.png`);
  await evalJs(`(()=>{const button=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='この記録を削除');button.setAttribute('data-review-delete','true');button.scrollIntoView({block:'center'})})()`);
  await tap('button[data-review-delete]');
  await until(`new Promise(resolve=>{const r=indexedDB.open('repwise-local');r.onsuccess=()=>{const db=r.result;const tx=db.transaction(['workoutDrafts','workoutMutationQueue'],'readonly');const d=tx.objectStore('workoutDrafts').get('${id}');const q=tx.objectStore('workoutMutationQueue').getAll();tx.oncomplete=()=>{resolve(d.result?.deletionConfirmedAt&&!q.result.some(v=>v.workoutId==='${id}'));db.close()}}})`);
  check(Boolean(server.get(id).deletedAt), 'one_delete_action_resolves_legacy_blocked_update_and_server_delete_without_manual_recovery');
  const backup = await evalJs(`new Promise(resolve=>{const r=indexedDB.open('repwise-local');r.onsuccess=()=>{const db=r.result;const q=db.transaction('syncRecoveryArchive','readonly').objectStore('syncRecoveryArchive').getAll();q.onsuccess=()=>{resolve(q.result);db.close()}}})`);
  check(backup.some(a=>a.reason==='automatic-delete-reconciliation'&&a.mutations.some(m=>m.mutationId==='legacy-blocked-before-delete'&&m.payload.workout.overallNote==='削除前の未同期メモも原本に保護')), 'automatic_cleanup_retains_original_unsynced_note');
  await reload(`document.body.innerText.includes('不要な記録を整理')`);
  await evalJs(`Array.from(document.querySelectorAll('summary')).find(e=>e.textContent.includes('不要な記録を整理')).click()`);
  await until(`document.querySelector('a[href="/workouts/active/draft-old"]')`);
  check(!(await evalJs(`Boolean(document.querySelector('a[href="/workouts/active/${id}"]'))`)), 'deleted_legacy_record_stays_absent_after_reload');
  check(await overflow(), 'simple_settings_no_horizontal_overflow_390');
  await shot(`${fixturesDir}/cleanup-completed-390.png`);
}
