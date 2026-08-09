const { chromium } = require('playwright');
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const step=(a,b)=>console.log('  '+a+':',b);
(async()=>{const b=await chromium.launch({executablePath:EXE});
const ctx=await b.newContext({viewport:{width:420,height:900},locale:'he-IL',timezoneId:'Asia/Jerusalem'});
const errs=[]; await ctx.addInitScript(()=>{try{localStorage.setItem('sh.sid',JSON.stringify('TESTSID'))}catch(e){}});
const p=await ctx.newPage();
p.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
p.on('console',m=>{if(m.type()==='error'&&!/gsi|accounts\.google|ERR_TUNNEL|409/.test(m.text()))errs.push('CONSOLE '+m.text())});
await p.goto('http://127.0.0.1:8787'); await p.waitForSelector('#q');
await p.fill('#q','תומר אוסוביצקי'); await p.waitForTimeout(150); await p.click('.res'); await p.waitForSelector('.hero');
await p.click('#cfg'); await p.waitForSelector('#nav-sheets'); await p.click('#nav-sheets'); await p.waitForSelector('#newsh2'); await p.click('#newsh2'); await p.waitForSelector('#ntitle');
step('no rest field in the wizard', (await p.$('#nrest'))?'✗ still there':'✓');
await p.fill('#ntitle','מוצב מתקדם');
await p.fill('#npeople',Array.from({length:18},(_,i)=>'איש '+String.fromCharCode(1488+i%22)+' '+i).join('\n'));
await p.fill('#nposts','שער\nסיור x2\nכרמל א x4 @00:00-23:59\nכרמל ב @00:00-23:59\nמטבח x2 @07:00-23:59');
await p.fill('#ndays','4'); await p.click('#ngo');
await p.waitForSelector('table.ed',{timeout:10000});

await p.click('.tb[data-k="posts"]'); await p.waitForSelector('.pcard');
step('post cards', (await p.$$('.pcard')).length);
step('no rest field in the editor', (await p.$('#erest'))?'✗ still there':'✓');
// כרמל א -> כוננות
const cards = await p.$$('.pcard');
const nameOf = async c => (await c.$eval('.phead b', e=>e.textContent));
let idxA=-1, idxB=-1;
for (let i=0;i<cards.length;i++){const n=await nameOf(cards[i]); if(n==='כרמל א')idxA=i; if(n==='כרמל ב')idxB=i;}
await (await (await p.$$('.pcard'))[idxA]).$eval('.cx', e=>e.click());
await p.waitForTimeout(400);
step('כרמל א marked as כוננות', await p.$$eval('.pcard', (cs)=>{
  const c=cs.find(x=>x.querySelector('.phead b').textContent==='כרמל א'); return c.querySelector('.cx').checked?'✓':'✗';}));
// כרמל ב fed by סיור + שער
await p.$$eval('.pcard', cs=>{const c=cs.find(x=>x.querySelector('.phead b').textContent==='כרמל ב'); c.querySelector('.cf').click();});
await p.waitForTimeout(300);
const chips = await p.$$eval('.pcard .fromposts .chip', ns=>ns.map(n=>n.textContent));
step('feeder chips offered', chips.join(','));
await p.$$eval('.pcard', cs=>{const c=cs.find(x=>x.querySelector('.phead b').textContent==='כרמל ב');
  [...c.querySelectorAll('.fromposts .chip')].filter(b=>['סיור','שער'].includes(b.textContent)).forEach(b=>b.click());});
await p.waitForTimeout(500);
step('fed by', await p.$$eval('.pcard', cs=>{const c=cs.find(x=>x.querySelector('.phead b').textContent==='כרמל ב');
  return [...c.querySelectorAll('.fromposts .chip.on')].map(b=>b.textContent).join('+')||'none';}));

await p.click('.tb[data-k="grid"]'); await p.waitForSelector('table.ed');
await p.click('#gall'); await p.waitForTimeout(200);
p.on('dialog',d=>d.accept());
await p.click('#gall'); await p.waitForTimeout(1500);
step('toast', await p.$eval('body',e=>(e.innerText.match(/מנוחה בין שמירות[^\n]*/)||['—'])[0]));
const dailyCells = await p.$$eval('table.ed td[data-si="-1"] .nm', ns=>ns.map(n=>n.textContent));
step('whole-day cells filled', dailyCells.length+' → '+dailyCells.slice(0,8).join(', '));
// day 1 has no previous night to come off, so look at day 2
await p.click('.dchip[data-i="1"]'); await p.waitForTimeout(400);
step('fed column on day 2', await p.$$eval('.nm.auto', ns=>ns.map(n=>n.textContent).join(', '))||'(empty)');
step('fed chips are not buttons', await p.$$eval('.nm.auto', ns=>ns.every(n=>n.tagName==='SPAN')?'✓':'✗'));
step('load line', await p.$$eval('.card .crow', ns=>ns.slice(0,2).map(n=>n.innerText.replace(/\n/g,' ')).join(' | ')));
await p.click('.tb[data-k="issues"]'); await p.waitForTimeout(300);
step('issues', (await p.$eval('#view',e=>e.innerText)).replace(/\n+/g,' | ').slice(0,220));
console.log(errs.length?'ERRORS:\n'+errs.join('\n'):'  no JS errors ✓');
await b.close();})();
