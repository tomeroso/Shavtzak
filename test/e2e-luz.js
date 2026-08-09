/* A pasted לוז, a personal note, and a link that puts you in a squad. */
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8787';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const step = (a, b) => console.log('  ' + a + ':', b);
(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const ctx = await b.newContext({ viewport: { width: 400, height: 950 }, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const errs = [];
  await ctx.addInitScript(() => { try { localStorage.setItem('sh.sid', JSON.stringify('TESTSID')); } catch (e) { } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/gsi|accounts\.google|ERR_TUNNEL|409|429/.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  // settings is a menu of small pages now; walk back out of wherever we are
  const goHome = async () => {
    for (let i = 0; i < 4; i++) {
      if (await page.$('.hero')) return;
      const b = await page.$('#backsub') || await page.$('#backadm') || await page.$('#back');
      if (!b) break;
      await b.click(); await page.waitForTimeout(250);
    }
    await page.waitForSelector('.hero', { timeout: 8000 });
  };
  // settings -> ניהול -> the page that holds the control we want
  const openAdmin = async () => {
    if (!(await page.$('#adminwrap'))) {
      if (!(await page.$('#setmenu'))) { await page.click('#cfg'); await page.waitForSelector('#setmenu'); }
      await page.waitForSelector('#nav-admin', { timeout: 8000 });
      await page.click('#nav-admin');
      await page.waitForSelector('#adminwrap', { timeout: 8000 });
    }
  };
  const openAdminPage = async id => {
    await goHome();
    await openAdmin();
    await page.click('#' + id);
    await page.waitForTimeout(400);
  };
  page.on('dialog', d => d.accept());

  await page.goto(BASE);
  await page.waitForSelector('#q', { timeout: 8000 });
  await page.fill('#q', 'תומר אוסוביצקי'); await page.waitForTimeout(150);
  await page.click('.res'); await page.waitForSelector('.hero');

  // ---- לוז
  await openAdminPage('nav-msg'); await page.waitForSelector('#lztxt');
  const tomorrow = await page.evaluate(() => {
    const d = new Date(Date.now() + 864e5); const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  });
  await page.fill('#lzd', tomorrow);
  await page.fill('#lztxt', 'לוז ליציאה:\n11:00 אפסון צלמים\n11:30 ארוחת צהריים\n12:25 מסדרי חדרים עומדים שטופים\n12:40 תדרוך');
  await page.waitForTimeout(300);
  step('preview', (await page.$eval('#lzprev', e => e.innerText)).replace(/\n/g, ' | '));
  await page.click('#lzsend'); await page.waitForTimeout(900);
  step('published', await page.$eval('body', e => (e.innerText.match(/פורסמו[^\n]*/) || ['—'])[0]));

  await goHome();
  const rows = await page.$$eval('.item.evt', ns => ns.map(n => n.innerText.replace(/\n/g, ' ')));
  step('לוז in the day', rows.length + ' rows');
  rows.slice(0, 4).forEach((r, i) => step('  ' + (i + 1), r));
  step('title used as the tag', rows.some(r => /לוז ליציאה/.test(r)) ? '✓' : '✗');

  // ---- personal
  await page.click('#addmine'); await page.waitForSelector('#pvt');
  await page.fill('#pvt', 'לקחת נשק מהנשקייה');
  await page.fill('#pvd', tomorrow); await page.fill('#pvh', '09:15');
  step('no duration asked', (await page.$('#pvm')) ? '✗ still there' : '✓');
  await page.click('#pvok'); await page.waitForTimeout(900);
  const mineRows = await page.$$eval('.item.evt.mine', ns => ns.map(n => n.innerText.replace(/\n/g, ' ')));
  step('personal item', mineRows.length ? '✓ ' + mineRows[0] : '✗ missing');
  step('marked אישי', mineRows[0] && /אישי/.test(mineRows[0]) ? '✓' : '✗');
  const priv = await page.evaluate(async () => {
    const r = await (await fetch('/api/roster')).json();
    return (r.events || []).filter(e => e.mine).length;
  });
  step('only in my own list', priv === 1 ? '✓' : '✗ ' + priv);
  await page.click('.item.evt.mine'); await page.waitForTimeout(800);
  step('deletable', (await page.$$('.item.evt.mine')).length === 0 ? '✓' : '✗ still there');

  // ---- a link that adds you to a squad
  await openAdminPage('nav-groups'); await page.waitForSelector('#gname');
  await page.fill('#gname', 'פיקוד');
  await page.click('#gadd'); await page.waitForSelector('.picksheet');
  await page.fill('#ppq', 'אור'); await page.waitForTimeout(200);
  await page.click('#ppall'); await page.click('#ppdone'); await page.waitForTimeout(800);
  await openAdminPage('nav-people');
  await page.waitForSelector('#ggrp', { timeout: 8000 });
  step('link can pick a squad', (await page.$$eval('#ggrp option', ns => ns.map(n => n.textContent))).join(' / '));
  await page.selectOption('#ggrp', 'פיקוד');
  await page.click('.gw[data-m="1440"]'); await page.waitForTimeout(800);
  step('link says where it puts you', await page.$eval('.openon', e => e.textContent.trim()));

  /* A moment stops being shown the minute it passes: an 11:00 item at 11:01
     must give way to the 11:30 one. */
  const drift = await page.evaluate(async () => {
    const now = Date.now();
    const mk = (mins, text) => ({ at: now + mins * 60000, text });
    await fetch('/api/sheets/events', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clearAll: true }) });
    await fetch('/api/sheets/events', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'לוז', items: [mk(-1, 'כבר עבר'), mk(20, 'הדבר הבא'), mk(60, 'ואחריו')] }) });
    return true;
  });
  await page.reload(); await page.waitForSelector('.hero', { timeout: 8000 });
  const shown = await page.$$eval('.item.evt', ns => ns.map(n => n.innerText.replace(/\n/g, ' ')));
  step('a minute-old item is gone', shown.some(r => /כבר עבר/.test(r)) ? '✗ still shown' : '✓');
  step('the next one is what you see', shown[0] || '(none)');
  step('shown as a single time, no range', /–/.test(shown[0] || '') ? '✗ has a range' : '✓');

  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : '  no JS errors ✓');
  await b.close();
})();
