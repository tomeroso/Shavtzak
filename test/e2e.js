const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8787';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const ctx = await b.newContext({ viewport: { width: 400, height: 880 }, deviceScaleFactor: 2, locale: 'he-IL', timezoneId: 'Asia/Jerusalem', colorScheme: 'dark' });
  const errs = [];
  await ctx.addInitScript(() => { try { localStorage.setItem('sh.sid', JSON.stringify('TESTSID')); } catch (e) { } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/gsi|accounts\.google|ERR_TUNNEL|409|429/.test(m.text())) errs.push('CONSOLE ' + m.text()); });

  await page.goto(BASE);
  await page.waitForSelector('#q', { timeout: 8000 });
  await page.screenshot({ path: 'shots/1-pick.png' });

  const cases = [['tomer osovizky', 'תומר אוסוביצקי'], ['אוסוביצקי', 'תומר אוסוביצקי'], ['oso', 'תומר אוסוביצקי'],
  ['דנציקוב', 'אראל דנשצ\'יקוב'], ['shahar ginat', 'שחר גינת'], ['גנזיה', 'עילאי גנזיה']];
  for (const [q, want] of cases) {
    await page.fill('#q', q);
    await page.waitForTimeout(90);
    const top = await page.$$eval('.res .rn', ns => ns.map(n => n.childNodes[0].textContent.trim()));
    console.log(`  "${q}" → ${top.slice(0, 2).join(' | ') || '—'}  ${top[0] === want ? '✓' : '✗ want ' + want}`);
  }

  await page.fill('#q', 'תומר אוסוביצקי');
  await page.waitForTimeout(120);
  await page.screenshot({ path: 'shots/2-search.png' });
  await page.click('.res');
  await page.waitForSelector('.hero');
  console.log('  hero:', (await page.$eval('.hero', e => e.innerText)).replace(/\n+/g, ' | '));
  const hasBanner = await page.$('.banner');
  console.log('  change banner:', hasBanner ? 'shown ✓' : 'absent');
  await page.screenshot({ path: 'shots/3-main.png', fullPage: true });

  // pick someone who is on duty right now
  const names = await page.evaluate(async () => {
    const r = await (await fetch('/api/roster')).json();
    const now = Date.now();
    const on = r.shifts.filter(s => s.s <= now && now < s.e).map(s => s.n);
    return [...new Set(on)];
  });
  console.log('  on duty right now:', names.slice(0, 4).join(', ') || 'nobody');
  if (names.length) {
    await page.click('#other'); await page.waitForSelector('#q');
    await page.fill('#q', names[0]); await page.waitForTimeout(120); await page.click('.res');
    await page.waitForSelector('.hero.on', { timeout: 3000 }).catch(() => { });
    console.log('  on-duty hero:', (await page.$eval('.hero', e => e.innerText)).replace(/\n+/g, ' | '));
    await page.screenshot({ path: 'shots/4-onduty.png', fullPage: true });
  }

  // sheet switcher
  const tabs = await page.$$eval('.stab', ns => ns.map(n => n.textContent));
  const badge = await page.$('.stab .badge');
  console.log('  sheet tabs:', tabs.join(' | ') || 'none', '| pending badge:', badge ? '✓' : 'none');

  await page.click('#cfg'); await page.waitForSelector('#setmenu');
  await page.waitForTimeout(1000);
  if (await page.$('#nav-admin')) {
    await page.click('#nav-admin'); await page.waitForSelector('#adminwrap', { timeout: 8000 });
    await page.click('#nav-people'); await page.waitForSelector('#mkinv', { timeout: 8000 });
  }
  await page.click('#mkinv').catch(() => { });
  await page.waitForTimeout(300);
  const invites = await page.$$eval('.invrow', ns => ns.map(n => n.textContent));
  console.log('  invite links:', invites.length, invites[0] ? '→ ' + invites[0] : '');
  const mem = await page.$$eval('#mem .crow', ns => ns.length);
  console.log('  members listed:', mem);
  const reqs = await page.$$eval('#reqs .crow', ns => ns.map(n => n.textContent.trim().split('\n')[0]));
  console.log('  join requests:', reqs.length, reqs.join(', '));
  const openBtns = await page.$$eval('.ow', ns => ns.map(n => n.textContent));
  console.log('  open-mode options:', openBtns.join(' / ') || 'none');
  if (openBtns.length) {
    await page.click('.ow[data-m="60"]');
    await page.waitForSelector('.openon', { timeout: 4000 }).catch(() => {});
    const on = await page.$eval('.openon', e => e.textContent).catch(() => null);
    console.log('  after enabling:', on ? on.trim() : 'FAILED');
    const off = await page.$('#openoff');
    console.log('  close button:', off ? '✓' : '✗');
  }
  const roles = await page.$$eval('#mem .crow', ns => ns.map(n => {
    const tag = n.querySelector('.tagsm');
    const acts = [...n.querySelectorAll('.acts button')].map(b => b.textContent);
    return (tag ? tag.textContent : 'חבר') + ' [' + acts.join('/') + ']';
  }));
  console.log('  member roles:', roles.join('  |  '));
  // how the sheet is read lives on its own page now
  await page.click('#backsub'); await page.waitForSelector('#adminwrap', { timeout: 8000 });
  await page.click('#nav-read'); await page.waitForSelector('#hid-skip', { timeout: 8000 });
  const rules = await page.$$eval('.rule', ns => ns.map(n => n.querySelector('.rname').textContent + '=' + n.querySelector('select').value));
  console.log('  column rules:', rules.length, '→', rules.filter(r => r.endsWith('daily')).join(', ') || '(all slot-based)');
  const hid = await page.$$eval('#hch .chip', ns => ns.map(n => n.textContent + (n.classList.contains('on') ? '*' : '')));
  console.log('  hidden columns:', hid.join(' / '), '|', (await page.$eval('#hch', e => e.parentNode.querySelector('.note').textContent.trim())).slice(0, 60));
  await page.click('#backsub'); await page.waitForSelector('#adminwrap', { timeout: 8000 });
  await page.click('#backadm'); await page.waitForSelector('#setmenu', { timeout: 8000 });
  await page.click('#nav-me'); await page.waitForSelector('#xfer', { timeout: 8000 });
  await page.click('#xfer'); await page.waitForTimeout(300);
  console.log('  transfer code:', (await page.$('.code')) ? '✓' : '✗');
  await page.click('#backsub'); await page.waitForSelector('#setmenu', { timeout: 8000 });
  await page.screenshot({ path: 'shots/5-settings.png', fullPage: true });

  const mf = await page.evaluate(async () => (await fetch('/manifest.webmanifest')).ok);
  const sw = await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => !!r));
  console.log('  manifest:', mf ? '✓' : '✗', ' service worker:', sw ? '✓' : '✗');

  const ctx2 = await b.newContext({ viewport: { width: 400, height: 880 }, deviceScaleFactor: 2, locale: 'he-IL', timezoneId: 'Asia/Jerusalem', colorScheme: 'light' });
  await ctx2.addInitScript(() => { try { localStorage.setItem('sh.sid', JSON.stringify('TESTSID')); } catch (e) { } });
  const p2 = await ctx2.newPage();
  await p2.goto(BASE); await p2.waitForSelector('.hero, #q');
  if (await p2.$('#who')) await p2.click('#who');
  await p2.waitForSelector('#q');
  await p2.fill('#q', 'ליאב'); await p2.waitForTimeout(120); await p2.click('.res');
  await p2.waitForSelector('.hero');
  await p2.screenshot({ path: 'shots/6-light.png', fullPage: true });

  // live board
  await page.goto(BASE); await page.waitForSelector('.hero, #q');
  if (await page.$('#q')) { await page.fill('#q', 'ליאב'); await page.waitForTimeout(120); await page.click('.res'); }
  await page.waitForSelector('.hero');
  await page.click('#board'); await page.waitForSelector('#board .item, .item.board');
  const board = await page.$$eval('.item.board', ns => ns.map(n => n.innerText.replace(/\n/g, ' · ')));
  console.log('  board rows:', board.length);
  board.slice(0, 4).forEach(r => console.log('    ', r));
  console.log('  unmanned flagged:', (await page.$$('.item.board.empty')).length);
  await page.screenshot({ path: 'shots/e-board.png', fullPage: true });
  await page.click('#back2'); await page.waitForSelector('.hero');

  // reminder chips
  if (!(await page.$('#setmenu'))) { await page.click('#cfg'); await page.waitForSelector('#setmenu', { timeout: 8000 }); }
  await page.click('#nav-notif'); await page.waitForSelector('#remind', { timeout: 8000 });
  const chips = await page.$$eval('#remind .chip', ns => ns.map(n => n.textContent + (n.classList.contains('on') ? '*' : '')));
  console.log('  reminder options:', chips.join(' / '));

  // going offline must NOT look like being logged out
  const ctx3 = await b.newContext({ viewport: { width: 400, height: 880 }, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  await ctx3.addInitScript(() => { try { localStorage.setItem('sh.sid', JSON.stringify('TESTSID')); } catch (e) { } });
  const p3 = await ctx3.newPage();
  await p3.goto(BASE); await p3.waitForSelector('.hero, #q');
  if (await p3.$('#who')) await p3.click('#who');
  await p3.waitForSelector('#q');
  await p3.fill('#q', 'ליאב'); await p3.waitForTimeout(120); await p3.click('.res');
  await p3.waitForSelector('.hero');
  await ctx3.setOffline(true);
  await p3.reload();
  await p3.waitForTimeout(1500);
  const offHero = await p3.$('.hero');
  const offSignin = await p3.$('#gsi');
  const foot = await p3.$eval('.foot span', e => e.textContent).catch(() => '');
  console.log('  offline reload → hero:', offHero ? '✓ shown' : '✗ missing',
              '| sign-in shown:', offSignin ? '✗ BAD' : 'no ✓', '|', foot.trim());

  await b.close();
  console.log(errs.length ? '\nJS ERRORS:\n' + errs.join('\n') : '\nno JS errors ✓');
  process.exit(errs.length ? 1 : 0);
})();
