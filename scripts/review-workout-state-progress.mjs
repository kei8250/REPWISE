// Run via the isolated localhost API harness with --state-progress.
export async function reviewWorkoutStateProgress({
  send,
  registerTarget,
  markClosing,
  evalJs,
  go,
  reload,
  until,
  tap,
  clickText,
  type,
  select,
  pause,
  shot,
  setViewport,
  overflow,
  check,
  server,
  fixtureWorkout,
  oldSets,
  dialogs,
  setOnline,
  setFailureCode,
  setRecommendation,
  fixturesDir,
}) {
  async function local(id) {
    return evalJs(
      `new Promise((resolve,reject)=>{const r=indexedDB.open('repwise-local');r.onsuccess=()=>{const db=r.result;const q=db.transaction('workoutDrafts','readonly').objectStore('workoutDrafts').get(${JSON.stringify(id)});q.onsuccess=()=>{resolve(q.result);db.close()};q.onerror=()=>reject(q.error)};r.onerror=()=>reject(r.error)})`,
    );
  }
  async function readyCancel() {
    await until(
      `Array.from(document.querySelectorAll('button')).some(button=>button.textContent.trim()==='キャンセル'&&!button.disabled)`,
    );
  }
  await setViewport(375);
  setOnline(false);
  const pending = {
    ...structuredClone(fixtureWorkout),
    id: 'cancel-review',
    name: 'キャンセル確認記録',
    localDate: '2026-10-15',
    status: 'active',
    endedAt: null,
    rating: 4,
  };
  server.set(pending.id, pending);
  await go(
    '/workouts/active/cancel-review',
    `document.body.innerText.includes('キャンセル確認記録')`,
  );
  await clickText('終了');
  await until(
    `location.pathname==='/workouts/cancel-review' && document.body.innerText.includes('完了済み')`,
  );
  check(
    server.get(pending.id).status === 'active',
    'cancel_fixture_server_still_active',
  );
  const original = (await local(pending.id)).workout;
  await clickText('編集');
  await until(`document.querySelector('#completed-workout-name')`);
  await type('#completed-workout-name', '取り消す名前');
  await readyCancel();
  await clickText('キャンセル');
  await until(
    `!document.querySelector('#completed-workout-name') && document.body.innerText.includes('完了済み')`,
  );
  let restored = await local(pending.id);
  check(
    restored.workout.status === 'completed' &&
      restored.draftStatus === 'completed' &&
      restored.workout.name === original.name &&
      restored.workout.endedAt === original.endedAt &&
      restored.workout.rating === 4,
    'cancel_preserves_completed_snapshot_while_server_active',
  );
  check(
    await evalJs(
      `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='編集') && document.body.innerText.includes('今回の評価') && document.body.innerText.includes('削除')`,
    ),
    'cancel_keeps_rating_edit_delete_controls',
  );
  await shot(`${fixturesDir}/cancel-completed-375.png`);
  await clickText('編集');
  await until(`document.querySelector('#completed-workout-note')`);
  await type('#completed-workout-note', '再読み込み後も取り消すメモ');
  await readyCancel();
  await reload(
    `document.querySelector('#completed-workout-note')?.value==='再読み込み後も取り消すメモ'`,
  );
  await readyCancel();
  await clickText('キャンセル');
  await until(
    `!document.querySelector('#completed-workout-note') && document.body.innerText.includes('完了済み')`,
  );
  restored = await local(pending.id);
  check(
    restored.workout.overallNote === original.overallNote &&
      restored.workout.status === 'completed',
    'cancel_after_reload_uses_durable_baseline',
  );
  await setViewport(390);
  await reload(`document.body.innerText.includes('完了済み')`);
  check(await overflow(), 'completed_detail_no_overflow_390');
  await shot(`${fixturesDir}/cancel-after-reload-390.png`);

  const { targetId } = await send('Target.createTarget', {
    url: 'about:blank',
  });
  registerTarget(targetId);
  const { sessionId } = await send('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  registerTarget(targetId, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send(
    'Fetch.enable',
    {
      patterns: [
        { urlPattern: 'http://localhost:3000/api/*', requestStage: 'Request' },
      ],
    },
    sessionId,
  );
  await send(
    'Page.navigate',
    { url: 'http://localhost:3000/workouts/cancel-review' },
    sessionId,
  );
  let tabCompleted = false;
  for (let attempt = 0; attempt < 250; attempt++) {
    const response = await send(
      'Runtime.evaluate',
      {
        expression: `Boolean(document.body) && document.body.innerText.includes('完了済み') && Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='編集')`,
        returnByValue: true,
      },
      sessionId,
    );
    if (response.result.value) {
      tabCompleted = true;
      break;
    }
    await pause(100);
  }
  check(tabCompleted, 'completed_cancel_state_is_consistent_in_second_tab');
  markClosing(sessionId);
  await send('Target.closeTarget', { targetId });
  await send('Page.bringToFront');

  setOnline(true);
  await go(
    '/workouts/valid-history',
    `document.body.innerText.includes('完了済み')`,
  );
  await clickText('編集');
  await until(`document.querySelector('#completed-workout-name')`);
  await type('#completed-workout-name', '保存した完了記録');
  await readyCancel();
  await clickText('変更を保存');
  await until(
    `!document.querySelector('#completed-workout-name') && document.body.innerText.includes('保存した完了記録')`,
  );
  await reload(
    `document.body.innerText.includes('保存した完了記録') && !document.querySelector('#completed-workout-name')`,
  );
  check(
    (await local('valid-history')).draftStatus === 'completed',
    'saved_edit_ack_does_not_reopen_editor_after_reload',
  );

  // Exercise the actual UI delete/undo/delete sequence with an active record.
  setOnline(true);
  async function removeOld() {
    await until(
      `document.querySelector('a[href="/workouts/active/draft-old"]')`,
    );
    await evalJs(
      `document.querySelector('button[aria-label="削除対象の古い入力途中の削除操作を表示"]').click()`,
    );
    await tap('button[aria-label="削除対象の古い入力途中を削除"]');
    await until(`document.body.innerText.includes('削除を同期済み')`);
  }
  await go(
    '/history?status=active&month=all',
    `document.querySelector('a[href="/workouts/active/draft-old"]')`,
  );
  await removeOld();
  await clickText('削除を取り消す');
  await until(`document.querySelector('a[href="/workouts/active/draft-old"]')`);
  await removeOld();
  check(
    server.get('draft-old').status === 'active' &&
      server.get('draft-old').endedAt === null &&
      Boolean(server.get('draft-old').deletedAt),
    'active_delete_undo_delete_stays_active_and_syncs',
  );
  await shot(`${fixturesDir}/delete-synced-390.png`);
  setOnline(false);
  setFailureCode(400);
  await evalJs(
    `document.querySelector('button[aria-label="別の入力途中の削除操作を表示"]').click()`,
  );
  await tap('button[aria-label="別の入力途中を削除"]');
  await until(
    `document.body.innerText.includes('削除の同期に失敗') && document.body.innerText.includes('HTTP 400')`,
  );
  await reload(`document.body.innerText.includes('削除の同期に失敗')`);
  await setViewport(375);
  check(await overflow(), 'delete_failure_no_overflow_375');
  await shot(`${fixturesDir}/delete-failed-retry-375.png`);
  setOnline(true);
  setFailureCode(500);
  await clickText('削除の同期を再試行');
  await until(`document.body.innerText.includes('削除を同期済み')`);
  check(
    Boolean(server.get('draft-other').deletedAt),
    'legacy_blocked_delete_retries_from_history_without_settings',
  );

  // Mixed loads and explicit roles use separate historical targets and memos.
  oldSets.forEach((set, index) =>
    Object.assign(set, {
      role: index === 0 ? 'top' : 'backoff',
      actualLoadGrams: index === 0 ? 62500 : 60000,
      actualReps: index === 0 ? 8 : 10,
      targetRepMin: index === 0 ? 6 : 10,
      targetRepMax: index === 0 ? 8 : 12,
    }),
  );
  const mixed = {
    ...structuredClone(fixtureWorkout),
    id: 'mixed-review',
    name: 'トップとバックオフ',
    localDate: '2026-10-15',
    status: 'active',
    endedAt: null,
  };
  mixed.exercises[0].status = 'in_progress';
  mixed.exercises[0].sets = oldSets.map((set, index) => ({
    ...set,
    id: `mixed-set-${index}`,
    status: 'planned',
    actualLoadGrams: null,
    actualReps: null,
    completedAt: null,
    targetLoadGrams: set.actualLoadGrams,
  }));
  server.set(mixed.id, mixed);
  setRecommendation({
    status: 'set_specific',
    reasonCode: 'set_specific_progression',
    currentLoadGrams: null,
    nextTarget: null,
    evaluatedSetIds: oldSets.map((set) => set.id),
    sourceWorkoutId: 'valid-history',
    sourceWorkoutVersion: 1,
    setDecisions: oldSets.map((set) => ({
      position: set.position,
      role: set.role,
      currentLoadGrams: set.actualLoadGrams,
      actualReps: set.actualReps,
      targetLoadGrams: set.actualLoadGrams + (set.position === 0 ? 2500 : 0),
      targetRepMin: set.targetRepMin,
      targetRepMax: set.targetRepMax,
      increase: set.position === 0,
    })),
  });
  for (const width of [375, 390]) {
    await setViewport(width);
    await go(
      '/workouts/active/mixed-review',
      `document.body.innerText.includes('セット別の次回提案') && document.body.innerText.includes('SET 1：肩を下げる')`,
    );
    check(await overflow(), `mixed_roles_no_overflow_${width}`);
    check(
      await evalJs(
        `document.body.innerText.includes('65kg') && document.body.innerText.includes('60kg') && document.querySelector('input[aria-label="セット1の実績重量"]').value===''`,
      ),
      `mixed_suggestions_do_not_become_actuals_${width}`,
    );
    await evalJs(
      `(()=>{const r=Array.from(document.querySelectorAll('p')).find(p=>p.textContent==='セット別の次回提案（未確定）').getBoundingClientRect();window.scrollBy(0,r.top-document.querySelector('header').getBoundingClientRect().bottom-16)})()`,
    );
    await pause(200);
    await shot(`${fixturesDir}/mixed-proposals-${width}.png`);
  }
  // Exact 10..10 achievement and ending the exercise with the last set blank.
  await type('input[aria-label="セット1の目標rep下限"]', '10');
  await type('input[aria-label="セット1の目標rep上限"]', '10');
  await type('input[aria-label="セット1の実績重量"]', '62.5');
  await type('input[aria-label="セット1の実績rep"]', '10');
  await tap('button[aria-label="セット1を完了"]');
  await until(`document.body.innerText.includes('目標達成・上限10回を達成')`);
  await type('input[aria-label="セット2の実績重量"]', '60');
  await type('input[aria-label="セット2の実績rep"]', '10');
  await tap('button[aria-label="セット2を完了"]');
  await clickText('この種目を完了');
  await until(`document.body.innerText.includes('この種目は完了しました')`);
  check(
    dialogs.some((message) => message.includes('未入力の1セット')),
    'exercise_completion_confirms_skipped_blank_set',
  );
  check(
    await evalJs(
      `!document.body.innerText.includes('次に取り組む SET 3') && document.body.innerText.includes('未実施（スキップ）') && Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='ワークアウトを終了')`,
    ),
    'completed_exercise_has_next_action_instead_of_next_blank_set',
  );
  await pause(800);
  console.log(
    JSON.stringify({
      completionBounds: await evalJs(
        `(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='ワークアウトを終了');return {button: b.getBoundingClientRect().toJSON(),panel:b.parentElement.getBoundingClientRect().toJSON(), header:document.querySelector('header').getBoundingClientRect().toJSON(),nav:document.querySelector('nav[aria-label="モバイルナビゲーション"]').getBoundingClientRect().toJSON(),scrollY,active:document.activeElement?.tagName}})()`,
      ),
    }),
  );
  await shot(`${fixturesDir}/exercise-finished-390.png`);
  check(
    await evalJs(
      `(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='ワークアウトを終了');const r=b.getBoundingClientRect();const nav=document.querySelector('nav[aria-label="モバイルナビゲーション"]').getBoundingClientRect();return r.top>=document.querySelector('header').getBoundingClientRect().bottom&&r.bottom<=nav.top})()`,
    ),
    'exercise_next_action_visible_above_fixed_navigation',
  );
  await shot(`${fixturesDir}/exercise-finished-390.png`);
  await tap('[id^="exercise-completed-"] button');
  await until(
    `location.pathname==='/workouts/mixed-review' && document.body.innerText.includes('完了済み')`,
  );
  const done = (await local(mixed.id)).workout;
  check(
    done.exercises[0].sets[2].status === 'skipped' &&
      done.exercises[0].sets[0].actualLoadGrams === 62500,
    'mixed_completion_preserves_actuals_and_skipped_state',
  );

  await go('/workouts/new', `document.querySelector('#workout-date')?.value`);
  await clickText('記録を開始');
  await until(
    `location.pathname.includes('/active/') && document.body.innerText.includes('最初の種目')`,
  );
  const sideId = await evalJs(`location.pathname.split('/').at(-1)`);
  await clickText('種目を追加');
  await until(`document.querySelector('#new-exercise-rep-mode')`);
  await select('#new-exercise-rep-mode', 'per_side');
  await select('#new-exercise-load-basis', 'paired_total');
  await type('input[placeholder="種目名"]', '重量基準の左右別テスト');
  await evalJs(
    `document.querySelector('#new-exercise-load-basis').scrollIntoView({block:'center'})`,
  );
  await shot(`${fixturesDir}/create-load-basis-390.png`);
  await clickText('作成して追加');
  await until(`document.querySelector('input[aria-label="セット1の右回数"]')`);
  await type('input[aria-label="セット1の実績重量"]', '40');
  await type('input[aria-label="セット1の右回数"]', '10');
  await type('input[aria-label="セット1の左回数"]', '8');
  await type('textarea', '左右合計40kg。フォームは右肩を上げない');
  await evalJs(
    `document.querySelector('input[aria-label="セット1の実績重量"]').scrollIntoView({block:'center'})`,
  );
  check(
    await evalJs(
      `document.body.innerText.includes('入力重量÷2×左右の回数合計')`,
    ),
    'paired_total_explains_input_and_volume_formula',
  );
  await shot(`${fixturesDir}/paired-load-input-390.png`);
  check(await overflow(), 'paired_basis_no_overflow_390');
  await tap('button[aria-label="セット1を完了"]');
  await clickText('終了');
  await until(
    `location.pathname===${JSON.stringify('/workouts/')}+${JSON.stringify(sideId)} && document.body.innerText.includes('右 10 / 左 8 回')`,
  );
  const side = (await local(sideId)).workout.exercises[0].sets[0];
  check(
    side.loadBasis === 'paired_total' &&
      side.actualLoadGrams === 40000 &&
      side.actualRepsLeft === 8 &&
      side.actualRepsRight === 10,
    'paired_basis_and_side_reps_survive_completion',
  );
}
