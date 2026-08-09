/* מי בשמירה עכשיו: every post shows, and the contact list is one tap from it. */
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
  page.on('console', m => { if (m.type() === 'error' && !/gsi|accounts\.google|ERR_TUNNEL|409/.test(m.text())) errs.push('CONSOLE ' + m.text()); });

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
  await page.goto(BASE);
  await page.waitForSelector('#q', { timeout: 8000 });
  await page.fill('#q', 'תומר אוסוביצקי'); await page.waitForTimeout(150);
  await page.click('.res'); await page.waitForSelector('.hero');

  await page.click('#board'); await page.waitForSelector('#board .item');
  const posts = await page.$$eval('#board .item .p b', ns => ns.map(n => n.textContent));
  step('posts listed', posts.length + ' → ' + posts.join(', '));
  const rosterPosts = await page.evaluate(async () => (await (await fetch('/api/roster')).json()).posts);
  const missing = rosterPosts.filter(p => posts.indexOf(p) < 0);
  step('every post from the roster is on the board', missing.length ? '✗ missing ' + missing.join(', ') : '✓');
  step('header', await page.$eval('.note', e => e.textContent.trim()));
  step('kitchen present', posts.some(p => /מטבח/.test(p)) ? '✓' : '✗');
  step('junk column absent', posts.some(p => p === 'יום' || p === 'שעה') ? '✗ still there' : '✓');

  // with no contacts there is no tab at all
  await page.evaluate(async () => {
    await fetch('/api/sheets/contacts?sheet=1MOCKSHEETIDxxxxxxxxxxxxxxxxxxxx', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contacts: [] }),
    });
  });
  await page.click('#again2'); await page.waitForTimeout(700);
  step('no staff tab before any contact exists', (await page.$('.tb[data-b="staff"]')) ? '✗' : '✓');

  // edit them from settings
  await page.click('#back2'); await page.waitForSelector('.hero');
  await openAdminPage('nav-contacts'); await page.waitForSelector('#ctxt', { timeout: 8000 });
  step('settings prefilled', JSON.stringify(await page.$eval('#ctxt', e => e.value)));
  await page.fill('#ctxt', 'אלון מזרחי, מ״פ, 050-1234567\nיוסי לוי, סמ״פ, 052-111-2222\nחמ״ל 04-9876543');
  await page.click('#csave'); await page.waitForTimeout(700);
  step('after save', (await page.$eval('#cprev', e => e.innerText)).replace(/\n+/g, ' | '));

  await goHome();
  await page.click('#board'); await page.waitForSelector('.tb[data-b="staff"]');
  await page.click('.tb[data-b="staff"]'); await page.waitForSelector('.item.staff');
  step('board now shows', (await page.$$eval('.item.staff', ns => ns.map(n => n.innerText.replace(/\n/g, ' ')))).join(' | '));
  await page.click('.tb[data-b="posts"]'); await page.waitForTimeout(250);

  // a post name that exists in two tabs must not merge into one row
  const dupes = await page.$$eval('#board .item .p', ns => {
    const seen = {}, out = [];
    ns.forEach(n => { const t = n.innerText.trim(); if (seen[t]) out.push(t); seen[t] = 1; });
    return out;
  });
  step('no two rows share a post+tab label', dupes.length ? '✗ ' + dupes.join(',') : '✓');
  const sameName = await page.$$eval('#board .item .p b', ns => ns.map(n => n.textContent));
  step('סיור appears once per tab', sameName.filter(x => x === 'סיור').length + ' row(s)');

  // whoever is on watch and in the contact list gets a call button on their row
  // pick whoever is genuinely on watch at this moment, so the test can't drift
  await page.evaluate(async () => {
    const live = await (await fetch('/api/roster')).json();
    const now = Date.now();
    const on = live.shifts.find(s => s.s <= now && now < s.e);
    await fetch('/api/sheets/contacts?sheet=1MOCKSHEETIDxxxxxxxxxxxxxxxxxxxx', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contacts: [{ name: on.n, role: 'ממ', phone: '0509443979' }] }),
    });
  });
  await page.click('#again2'); await page.waitForTimeout(700);
  const inline = await page.$$eval('.callin', ns => ns.map(n => n.getAttribute('href')));
  step('call button beside the person on watch', inline.length ? '✓ ' + inline[0] : '✗ none');
  const shown = await page.$$eval('#board .tel', ns => ns.map(n => n.textContent));
  step('the digits are printed as text', shown.length ? '✓ ' + shown[0] : '✗ none');
  const selectable = await page.$eval('#board .tel', n => getComputedStyle(n).userSelect || getComputedStyle(n).webkitUserSelect);
  step('and selectable for copy-paste', selectable);
  await page.click('.tb[data-b="staff"]'); await page.waitForSelector('.item.staff');
  step('copy button on the staff rows', (await page.$$('.item.staff .cp')).length ? '✓' : '✗');
  const cardTel = await page.$$eval('.item.staff .tel', ns => ns.map(n => n.textContent));
  step('numbers on the staff rows', cardTel.join(' | '));
  await page.click('.tb[data-b="posts"]'); await page.waitForTimeout(250);

  // the מפקדים tab: who they are, where they are, and the number
  await page.evaluate(async () => {
    const live = await (await fetch('/api/roster')).json();
    const now = Date.now();
    const onNow = live.shifts.find(s => s.s <= now && now < s.e);
    const later = live.shifts.find(s => s.s > now && s.n !== onNow.n);
    await fetch('/api/sheets/contacts?sheet=1MOCKSHEETIDxxxxxxxxxxxxxxxxxxxx', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contacts: [
        { name: onNow.n, role: 'ממ', phone: '050-944-3979' },
        { name: later.n, role: 'סמ״פ', phone: '052-111-2222' },
        { name: 'מישהו שלא בשבצ״ק', role: 'מ״פ', phone: '04-9876543' },
      ] }),
    });
  });
  await page.click('#again2'); await page.waitForTimeout(700);
  step('staff tab offered', (await page.$('.tb[data-b="staff"]')) ? '✓' : '✗');
  await page.click('.tb[data-b="staff"]'); await page.waitForSelector('.item.staff');
  const staff = await page.$$eval('.item.staff', ns => ns.map(n => n.innerText.replace(/\n/g, ' · ')));
  staff.forEach((x, i) => step('staff ' + (i + 1), x));
  step('on-watch one is first', /עכשיו/.test(staff[0]) ? '✓' : '✗');
  step('the one not in the roster is last', /לא מופיע בשבצ״ק/.test(staff[staff.length - 1]) ? '✓' : '✗');
  step('numbers present', (await page.$$('.item.staff .tel')).length);
  step('call links', (await page.$$eval('.item.staff .acts2 a', ns => ns.map(n => n.getAttribute('href')))).join(' '));
  await page.click('.tb[data-b="posts"]'); await page.waitForTimeout(300);
  step('back to posts', (await page.$$('#board .item.board')).length + ' rows');

  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : '  no JS errors ✓');
  await b.close();
})();
