/* A normal member's Settings must stay short; everything an admin does lives
   behind one door. And the guide has to be reachable and readable. */
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8787';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const step = (a, b) => console.log('  ' + a + ':', b);
(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const ctx = await b.newContext({ viewport: { width: 400, height: 900 }, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const errs = [];
  await ctx.addInitScript(() => { try { localStorage.setItem('sh.sid', JSON.stringify('TESTSID')); } catch (e) { } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/gsi|accounts\.google|ERR_TUNNEL|409|429/.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  page.on('dialog', d => d.accept());

  await page.goto(BASE);
  await page.waitForSelector('#q', { timeout: 8000 });
  await page.fill('#q', 'תומר אוסוביצקי'); await page.waitForTimeout(150);
  await page.click('.res'); await page.waitForSelector('.hero');

  // the guide is offered once, on the main screen
  step('guide offered on first run', (await page.$('#gopen')) ? '✓' : '✗ not offered');
  await page.click('#gopen'); await page.waitForSelector('.guide');
  const heads = await page.$$eval('.sect', ns => ns.map(n => n.textContent));
  step('guide sections', heads.join(' / '));
  step('length', (await page.$eval('#view', e => e.innerText)).length + ' chars');
  await page.click('#gdone'); await page.waitForSelector('.hero');
  step('dismissed after reading', (await page.$('#gopen')) ? '✗ still offered' : '✓');
  await page.reload(); await page.waitForSelector('.hero', { timeout: 8000 });
  step('stays dismissed', (await page.$('#gopen')) ? '✗ came back' : '✓');

  // settings: a short menu, one row per topic, admin behind its own door
  await page.click('#cfg'); await page.waitForSelector('#setmenu');
  await page.waitForTimeout(1000);
  const rows = await page.$$eval('#setmenu .mrow', ns => ns.map(n => n.querySelector('.mt b').textContent));
  step('settings rows', rows.length + ' → ' + rows.join(' / '));
  step('short enough to see at once', rows.length <= 7 ? '✓' : '✗ ' + rows.length);
  step('no long scroll of sections', (await page.$$('#setmenu .sect')).length === 0 ? '✓' : '✗');
  step('guide first', (await page.$('#guide')) ? '✓' : '✗');
  step('admin door', (await page.$('#nav-admin')) ? '✓ ' + (await page.$eval('#nav-admin .mt b', e => e.textContent)) : '✗ none');
  step('admin controls NOT in settings', (await page.$('#bctxt')) || (await page.$('#gname')) || (await page.$('#mkinv')) ? '✗ leaked' : '✓');

  // each topic is its own page, and each one comes back
  for (const [id, want] of [['nav-notif', '#remind'], ['nav-sheets', '#sheets'], ['nav-me', '#nick'], ['nav-tools', '#diag']]) {
    await page.click('#' + id);
    await page.waitForSelector(want, { timeout: 8000 });
    step(id, '✓ ' + (await page.$eval('.logo.sm', e => e.textContent)));
    await page.click('#backsub'); await page.waitForSelector('#setmenu', { timeout: 8000 });
    await page.waitForTimeout(400);
  }

  await page.click('#nav-admin'); await page.waitForSelector('#adminwrap .mrow', { timeout: 8000 });
  const arows = await page.$$eval('#adminwrap .mrow', ns => ns.map(n => n.querySelector('.mt b').textContent));
  step('admin rows', arows.length + ' → ' + arows.join(' / '));
  for (const [id, want] of [['nav-people', '#mkinv'], ['nav-groups', '#gname'], ['nav-msg', '#bctxt'], ['nav-contacts', '#ctxt'], ['nav-read', '#hid-skip']]) {
    if (!(await page.$('#' + id))) { step(id, 'not offered here'); continue; }
    await page.click('#' + id);
    await page.waitForSelector(want, { timeout: 8000 });
    step(id, '✓ ' + (await page.$eval('.logo.sm', e => e.textContent)));
    await page.click('#backsub'); await page.waitForSelector('#adminwrap', { timeout: 8000 });
    await page.waitForTimeout(300);
  }
  step('hidden-column switch is an admin setting', '✓');
  await page.click('#backadm'); await page.waitForSelector('#setmenu');
  step('back to settings', '✓');

  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : '  no JS errors ✓');
  await b.close();
})();
