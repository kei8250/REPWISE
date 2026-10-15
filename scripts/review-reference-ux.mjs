// All API requests use the parent harness's synthetic data; no public site writes.
export async function reviewReferenceUx({ evalJs, go, reload, until, tap, clickText, shot, setViewport, overflow, check, fixturesDir, setOnline }) {
  setOnline(true);
  async function tapText(text) {
    await evalJs(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw new Error('Button missing');b.setAttribute('data-review-tap','true');b.scrollIntoView({block:'center'});})()`);
    await tap('button[data-review-tap="true"]');
    await evalJs(`document.querySelectorAll('[data-review-tap]').forEach(b=>b.removeAttribute('data-review-tap'))`);
  }
  await setViewport(375);
  await go('/workouts/active/draft-other', `document.body.innerText.includes('最初の種目を追加しましょう')`);
  await tapText('種目を追加');
  await until(`document.querySelector('[role="dialog"]') && Array.from(document.querySelectorAll('[role="dialog"] button')).some(b=>b.textContent.includes('ベンチプレス'))`);
  await evalJs(`Array.from(document.querySelectorAll('[role="dialog"] button')).find(b=>b.textContent.includes('ベンチプレス')).click()`);
  await until(`document.body.innerText.includes('セット別の前回実績を参照中') && document.body.innerText.includes('80.5')`);
  check(!(await evalJs(`document.body.innerText.includes('参考記録なし')`)), 'overview_and_set_cards_agree_after_adding_bench');
  check(await overflow(), 'reference_view_no_horizontal_overflow_375');
  await shot(`${fixturesDir}/set-references-375.png`);

  await go('/history?month=2026-10&status=completed&exerciseName='+encodeURIComponent('存在しない種目'), `document.body.innerText.includes('指定した種目・部位に一致する記録がありません')`);
  check(!(await evalJs(`document.body.innerText.includes('この期間の完了した記録はありません')`)), 'filtered_empty_state_does_not_claim_period_has_no_records');
  await shot(`${fixturesDir}/filtered-empty-375.png`);
  await tapText('条件をクリア');
  await until(`document.querySelector('a[href="/workouts/valid-history"]')`);
  check(await evalJs(`!new URL(location.href).searchParams.has('exerciseName') && new URL(location.href).searchParams.get('month')==='2026-10' && document.querySelector('#history-exercise').value==='' && document.querySelector('#history-body-part').value===''`), 'one_tap_clear_resets_fields_and_url_but_keeps_period');

  await go('/analytics?exerciseId=ex-bench-press', `document.querySelector('[aria-label="分析期間"]')`);
  await tapText('全期間');
  await until(`new URL(location.href).searchParams.get('range')==='all'`);
  await reload(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='全期間'&&b.getAttribute('aria-pressed')==='true')`);
  check(await evalJs(`new URL(location.href).searchParams.get('exerciseId')==='ex-bench-press'`), 'analytics_range_survives_reload_and_keeps_exercise_link');
  await shot(`${fixturesDir}/all-periods-after-reload-375.png`);
  await go('/analytics?range=90d&exerciseId=ex-bench-press', `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='90日'&&b.getAttribute('aria-pressed')==='true')`);
  check(true, 'shared_analytics_url_restores_range');

  for (const width of [375, 390]) {
    await setViewport(width);
    await go('/workouts/valid-history', `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='編集')`);
    await until(`document.body.innerText.includes('判定の根拠・ルールを確認')`);
    await shot(`${fixturesDir}/completed-actions-${width}.png`);
    check(await evalJs(`(()=>{const buttons=Array.from(document.querySelectorAll('button'));const nav=Array.from(document.querySelectorAll('nav')).find(n=>n.getBoundingClientRect().height>0);return ['編集','同じメニューで開始'].every(text=>{const r=buttons.find(b=>b.textContent.trim()===text).getBoundingClientRect();return r.top>=0&&r.bottom<(nav?.getBoundingClientRect().top??innerHeight)&&r.height>=44})})()`), `primary_completed_actions_visible_without_scroll_${width}`);
    check(await overflow(), `completed_detail_no_horizontal_overflow_${width}`);
    check(await evalJs(`Array.from(document.querySelectorAll('details')).filter(d=>d.textContent.includes('判定の根拠・ルールを確認')).every(d=>!d.open)`), `judgment_rules_initially_collapsed_${width}`);
    check(!(await evalJs(`document.body.innerText.includes('reps')`)), `completed_target_uses_japanese_rep_unit_${width}`);
    await shot(`${fixturesDir}/completed-actions-${width}.png`);
    await tapText('編集');
    await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='キャンセル')`);
    await clickText('キャンセル');
    await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='編集')`);
    check(true, `top_edit_action_and_cancel_work_by_touch_${width}`);
  }
  await tapText('同じメニューで開始');
  await until(`location.pathname.startsWith('/workouts/active/') && document.querySelector('#workout-overall-note')`);
  check(true, 'top_copy_action_starts_new_workout_by_touch');
}
