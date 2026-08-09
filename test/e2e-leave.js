/* Leaving a שבצ״ק: the ordinary case, and the one where you're the last out. */
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8787';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const step = (a, b) => console.log('  ' + a + ':', b);
(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const ctx = await b.newContext({ viewport: { width: 400, height: 880 }, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const errs = [];
  await ctx.addInitScript(() => { try { localStorage.setItem('sh.sid', JSON.stringify('TESTSID')); } catch (e) { } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/gsi|accounts\.google|ERR_TUNNEL|409/.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  const confirms = [];
  page.on('dialog', d => { confirms.push(d.message()); d.accept(); });

  await page.goto(BASE);
  await page.waitForSelector('#q', { timeout: 8000 });
  await page.fill('#q', 'תומר אוסוביצקי'); await page.waitForTimeout(150);
  await page.click('.res'); await page.waitForSelector('.hero');

  const openSheets = async () => {
    if (!(await page.$('#setmenu'))) { await page.click('#cfg'); await page.waitForSelector('#setmenu'); }
    await page.click('#nav-sheets'); await page.waitForSelector('#sheets .crow', { timeout: 8000 });
  };
  await openSheets();
  const rows = () => page.$$eval('#sheets .crow', ns => ns.map(n => n.innerText.split('\n')[0]));
  step('sheets before', (await rows()).join(' | '));
  step('leave button per row', (await page.$$('#sheets .crow .danger')).length);

  // leave the second (non-active) sheet
  const btns = await page.$$('#sheets .crow .danger');
  await btns[1].click();
  await page.waitForTimeout(900);
  step('confirm asked', confirms.length ? '✓ ' + confirms[0].split('\n')[0] : '✗ none');
  step('sheets after', (await page.$$eval('#sheets .crow', ns => ns.map(n => n.innerText.split('\n')[0]))).join(' | '));
  step('still on a roster', await page.$eval('#view', e => e.innerText.indexOf('שבצ״ק') >= 0 ? '✓ settings' : '?'));

  // now make a native one and leave it as the last member
  await page.click('#newsh2'); await page.waitForSelector('#ntitle');
  await page.fill('#ntitle', 'לבדיקת יציאה');
  await page.fill('#npeople', ['א א', 'ב ב', 'ג ג', 'ד ד', 'ה ה', 'ו ו'].join('\n'));
  await page.fill('#nposts', 'שער'); await page.fill('#ndays', '2');
  await page.click('#ngo'); await page.waitForSelector('table.ed', { timeout: 8000 });
  await page.click('#eback'); await page.waitForTimeout(500);
  if (await page.$('#q')) { await page.fill('#q', 'א א'); await page.waitForTimeout(200); await page.click('.res'); await page.waitForSelector('.hero'); }
  await openSheets();
  const before = await page.$$eval('#sheets .crow', ns => ns.map(n => n.innerText.split('\n')[0]));
  step('sheets now', before.join(' | '));
  const i = before.findIndex(t => t.indexOf('לבדיקת יציאה') >= 0);
  confirms.length = 0;
  (await page.$$('#sheets .crow .danger'))[i].click();
  await page.waitForTimeout(1200);
  step('second confirm warns about deletion', confirms.length === 2 && /יימחק/.test(confirms[1]) ? '✓ ' + confirms[1].split('\n')[0] : '✗ ' + JSON.stringify(confirms));
  step('sheets after deleting', (await page.$$eval('#sheets .crow', ns => ns.map(n => n.innerText.split('\n')[0]))).join(' | '));

  // leaving the last one has to land somewhere usable, not on a blank screen
  confirms.length = 0;
  while (await page.$('#sheets .crow .danger')) {
    await (await page.$('#sheets .crow .danger')).click();
    await page.waitForTimeout(900);
    if (!(await page.$('#sheets'))) break;
  }
  step('after leaving every שבצ״ק', (await page.$eval('#view', e => e.innerText)).split('\n').slice(0, 2).join(' | '));
  step('offered a way back in', (await page.$('#newsh')) && (await page.$('#link')) ? '✓ create or join' : '✗');

  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : '  no JS errors ✓');
  await b.close();
})();
