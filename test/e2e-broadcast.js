/* An admin's message to everyone: pushed, and left on the main screen. */
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

  await openAdminPage('nav-msg'); await page.waitForSelector('#bctxt');
  step('no presets', (await page.$('#qmsg')) ? '✗ still there' : '✓');
  await page.fill('#bctxt', 'בדיקת נשק ב-08:50 ליד החמ״ל');
  await page.click('#bcsend'); await page.waitForTimeout(900);
  step('sent toast', await page.$eval('body', e => (e.innerText.match(/נשלח ל-[^\n]*/) || ['—'])[0]));

  await goHome();
  const banner = await page.$('.banner.msg');
  step('banner on the main screen', banner ? '✓ ' + (await banner.innerText()).replace(/\n/g, ' | ') : '✗ none');
  await page.click('#bcok'); await page.waitForTimeout(400);
  step('dismissed', (await page.$('.banner.msg')) ? '✗ still there' : '✓');
  await page.reload(); await page.waitForSelector('.hero', { timeout: 8000 });
  step('stays dismissed after reload', (await page.$('.banner.msg')) ? '✗ came back' : '✓');

  // a second, different message must show again
  await openAdminPage('nav-msg'); await page.waitForSelector('#bctxt');
  await page.fill('#bctxt', 'הקנטינה פתוחה');
  await page.click('#bcsend'); await page.waitForTimeout(900);
  await goHome();
  step('a new message shows again', (await page.$('.banner.msg')) ? '✓' : '✗ hidden');

  await openAdminPage('nav-msg'); await page.waitForSelector('#bcclear');
  await page.click('#bcclear'); await page.waitForTimeout(700);
  await goHome();
  step('removing it clears the banner', (await page.$('.banner.msg')) ? '✗ still there' : '✓');

  /* A message with an hour on it becomes a row in the day — for the people who
     are not standing a watch across it. */
  const info = await page.evaluate(async () => {
    const r = await (await fetch('/api/roster')).json();
    const now = Date.now();
    const me = r.me;
    const mine = r.shifts.filter(s => s.n === me).sort((a, b) => a.s - b.s);
    const free = mine.find(s => s.s > now + 3 * 3600e3);
    return { me, freeAt: free ? free.s - 90 * 60000 : now + 4 * 3600e3, busyAt: free ? free.s + 30 * 60000 : 0 };
  });

  const sendAt = async (ts, text) => {
    await openAdminPage('nav-msg'); await page.waitForSelector('#bctxt');
    await page.fill('#bctxt', text);
    await page.$eval('#bchas', e => { if (!e.checked) e.click(); });
    await page.waitForTimeout(150);
    await page.evaluate(t => {
      const d = new Date(t);
      const p = n => String(n).padStart(2, '0');
      document.getElementById('bcd').value = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
      document.getElementById('bch').value = p(d.getHours()) + ':' + p(d.getMinutes());
    }, ts);
    await page.click('#bcsend'); await page.waitForTimeout(900);
    await goHome();
  };

  await sendAt(info.freeAt, 'בדיקת נשק ליד החמ״ל');
  step('time box appears', '✓');
  const rows = await page.$$eval('.item.evt', ns => ns.map(n => n.innerText.replace(/\n/g, ' ')));
  step('event added to the day', rows.length ? '✓ ' + rows[0] : '✗ not in the list');
  step('marked as an event', (await page.$('.item.evt .tagsm')) ? '✓' : '✗');

  if (info.busyAt) {
    await sendAt(info.busyAt, 'מסדר מפקד');
    const rows2 = await page.$$eval('.item.evt', ns => ns.map(n => n.innerText));
    step('not added while you are on watch', rows2.length ? '✗ added anyway' : '✓');
    const banner = await page.$('.banner.msg');
    step('but the message still reaches you', banner ? '✓ ' + (await banner.innerText()).replace(/\n/g, ' | ') : '✗');
  }

  /* ---- squads and targeting ---- */
  await openAdminPage('nav-groups'); await page.waitForSelector('#gname');
  step('groups section', (await page.$('#glist')) ? '✓ empty: ' + (await page.$eval('#glist', e => e.innerText.trim())) : '✗');
  await page.fill('#gname', 'פיקוד');
  await page.click('#gadd'); await page.waitForSelector('.picksheet');
  step('picker opens', (await page.$eval('.picksheet .sect', e => e.textContent)));
  await page.fill('#ppq', 'אור');
  await page.waitForTimeout(200);
  await page.click('#ppall'); await page.waitForTimeout(150);
  const picked = await page.$eval('#ppn', e => e.textContent);
  step('bulk select', picked);
  await page.click('#ppdone'); await page.waitForTimeout(800);
  step('group saved', await page.$eval('#glist', e => e.innerText.replace(/\n/g, ' | ')));

  await openAdminPage('nav-msg'); await page.waitForSelector('#bcto');
  const chips = await page.$$eval('#bcto .chip', ns => ns.map(n => n.textContent));
  step('target chips', chips.join(' / '));
  await page.click('#bcto .chip:nth-child(2)'); await page.waitForTimeout(200);
  step('squad selected', await page.$$eval('#bcto .chip.on', ns => ns.map(n => n.textContent).join(',')));
  await page.fill('#bctxt', 'פיקוד בלבד — התייצבות');
  await page.click('#bcsend'); await page.waitForTimeout(900);
  step('sent to the squad', await page.$eval('body', e => (e.innerText.match(/נשלח ל-[^\n]*/) || ['—'])[0]));

  await goHome();
  const seen = await page.$('.banner.msg');
  const meIn = await page.evaluate(async () => {
    const r = await (await fetch('/api/roster')).json();
    return !!(r.bcast && r.bcast.to && (r.bcast.to.names || []).some(n => n === r.me));
  });
  step('message reaches a member of the squad only', (meIn ? (seen ? '✓ shown' : '✗ hidden') : (seen ? '✗ shown to an outsider' : '✓ withheld')));
  if (seen) step('banner names the audience', (await seen.innerText()).split('\n')[0]);

  // and the other direction: a squad that does include me
  await openAdminPage('nav-msg'); await page.waitForSelector('#bctxt');
  const me = await page.evaluate(async () => (await (await fetch('/api/roster')).json()).me);
  await page.click('#bcto .chip:nth-child(3)'); await page.waitForSelector('.picksheet');
  await page.fill('#ppq', me); await page.waitForTimeout(250);
  await page.click('.picksheet .res'); await page.waitForTimeout(150);
  await page.click('#ppdone'); await page.waitForTimeout(300);
  step('hand-picked', await page.$$eval('#bcto .chip.on', ns => ns.map(n => n.textContent).join(',')));
  await page.fill('#bctxt', 'רק אליך');
  await page.click('#bcsend'); await page.waitForTimeout(900);
  await goHome();
  const mine2 = await page.$('.banner.msg');
  step('a message aimed at me arrives', mine2 ? '✓ ' + (await mine2.innerText()).split('\n').slice(0, 2).join(' | ') : '✗ missing');

  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : '  no JS errors ✓');
  await b.close();
})();
