const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8787';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const step = (a,b) => console.log('  ' + a + ':', b);
(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const ctx = await b.newContext({ viewport: { width: 400, height: 880 }, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const errs = [];
  await ctx.addInitScript(() => { try { localStorage.setItem('sh.sid', JSON.stringify('TESTSID')); } catch (e) { } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/gsi|accounts\.google|ERR_TUNNEL/.test(m.text())) errs.push('CONSOLE ' + m.text()); });

  await page.goto(BASE);
  await page.waitForSelector('#q', { timeout: 8000 });
  await page.fill('#q', 'תומר אוסוביצקי'); await page.waitForTimeout(150);
  await page.click('.res'); await page.waitForSelector('.hero');

  // settings -> create a new one in-app
  await page.click('#cfg'); await page.waitForSelector('#nav-sheets'); await page.click('#nav-sheets'); await page.waitForSelector('#newsh2');
  await page.click('#newsh2'); await page.waitForSelector('#ntitle');
  await page.fill('#ntitle', 'שבצ״ק פלוגה ב׳');
  await page.fill('#npeople', ['אבי לוי','בן כהן','גיל מזרחי','דור פרץ','הראל שרון','ויקטור ביטון','זיו דהן','חן גולן','טל אזולאי','יואב חדד','כפיר מלכה','לירן נחום'].join('\n'));
  await page.fill('#nposts', 'שער ראשי\nסיור x2\nמטבח @07:00-23:59');
  await page.fill('#ndays', '4');
  await page.selectOption('#nhours', '4');
  await page.click('#ngo');
  await page.waitForSelector('table.ed', { timeout: 10000 });
  step('editor opened', await page.$eval('.edbar .grow', e => e.textContent));
  step('days', (await page.$$('.dchip')).length);
  step('columns', await page.$$eval('table.ed th', ns => ns.map(n => n.textContent).join(' | ')));

  const cellNames = () => page.$$eval('table.ed td[data-post] .nm', ns => ns.map(n => n.textContent));
  const before = await cellNames();
  step('names on day 1', before.length);
  step('daily post row', (await page.$$('table.ed td[data-si="-1"]')).length ? 'present ✓' : 'MISSING');

  // swap the first two people
  const nms = await page.$$('table.ed td[data-post] .nm');
  const n0 = await nms[0].textContent(), n1 = await nms[1].textContent();
  await nms[0].click();
  await page.waitForSelector('.selbar');
  step('selected', await page.$eval('.selbar .who', e => e.textContent));
  await (await page.$$('table.ed td[data-post] .nm'))[1].click();
  await page.waitForTimeout(200);
  const after = await cellNames();
  step('swap ' + n0 + ' ⇄ ' + n1, (after[0] === n1 && after[1] === n0) ? '✓' : '✗ got ' + after.slice(0,2).join(','));

  // undo
  await page.click('#eundo'); await page.waitForTimeout(200);
  const undone = await cellNames();
  step('undo', (undone[0] === n0 && undone[1] === n1) ? '✓' : '✗');

  // move to an empty daily cell
  await (await page.$$('table.ed td[data-post] .nm'))[0].click();
  await page.waitForTimeout(120);
  const adds = await page.$$('table.ed td[data-si="-1"] .add');
  if (adds.length) { await adds[0].click(); await page.waitForTimeout(200); }
  step('moved into מטבח', (await page.$$eval('table.ed td[data-si="-1"] .nm', n=>n.length)) > 0 ? '✓' : '✗');

  // picker
  const plusAll = await page.$$('table.ed td[data-post] .add');
  if (plusAll.length) {
    await plusAll[plusAll.length-1].click();
    await page.waitForSelector('.picksheet', { timeout: 4000 });
    step('picker rows', await page.$$eval('.picksheet .res', n => n.length));
    await page.fill('#pq', 'גיל');
    await page.waitForTimeout(150);
    step('picker search', await page.$$eval('.picksheet .res .rn', ns => ns.slice(0,2).map(n=>n.childNodes[0].textContent.trim()).join(' | ')));
    await page.click('#pclose');
  }

  // issues tab
  await page.click('.tb[data-k="issues"]'); await page.waitForTimeout(200);
  step('issues screen', (await page.$eval('#view', e => e.innerText)).split('\n').slice(0,3).join(' | '));

  // people tab: mark someone unavailable
  await page.click('.tb[data-k="people"]'); await page.waitForTimeout(200);
  step('people rows', (await page.$$('.prow')).length);
  await page.click('.prow .link');
  await page.waitForSelector('#offdays');
  await page.click('#offdays .dchip');
  await page.click('#offclose'); await page.waitForTimeout(250);
  step('marked unavailable', (await page.$eval('#view', e => e.innerText)).indexOf('היעדרות') >= 0 ? '✓' : '✗');

  // posts tab: add a post
  await page.click('.tb[data-k="posts"]'); await page.waitForTimeout(200);
  await page.fill('#postnew', 'עמדה דרומית x2');
  await page.click('#postadd'); await page.waitForTimeout(250);
  step('post added', (await page.$$('#postlist > *')).length);
  await page.click('#dadd7'); await page.waitForTimeout(250);
  await page.click('.tb[data-k="grid"]'); await page.waitForTimeout(250);
  step('days after +week', (await page.$$('.dchip')).length);

  // fill holes then save
  await page.click('#gfill'); await page.waitForTimeout(400);
  await page.click('#esave');
  await page.waitForTimeout(700);
  step('save', (await page.$eval('#view', e => e.innerText)).indexOf('שמור') >= 0 ? 'button back ✓' : '?');
  step('toast', await page.$eval('body', e => (e.innerText.match(/נשמר[^\n]*/) || ['—'])[0]));

  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : '  no JS errors ✓');
  await b.close();
})();
