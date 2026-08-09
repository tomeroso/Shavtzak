const fs = require('fs'), p = require('path');
const R = __dirname, OUT = p.join(R, 'public');
fs.mkdirSync(OUT, { recursive: true });

const tpl = fs.readFileSync(p.join(R, 'app/index.tpl.html'), 'utf8');
const match = fs.readFileSync(p.join(R, 'shared/match.js'), 'utf8');
const app = fs.readFileSync(p.join(R, 'app/app.js'), 'utf8');
const gen = fs.readFileSync(p.join(R, 'shared/gen.js'), 'utf8');
const native = fs.readFileSync(p.join(R, 'shared/native.js'), 'utf8');
let html = tpl.replace('/*MATCH*/', () => match).replace('/*GEN*/', () => gen).replace('/*NATIVE*/', () => native).replace('/*APP*/', () => app);

// stamp the service worker AND the page with a build id, so a running client can
// notice that the server has moved on
const crypto = require('crypto');
const build = crypto.createHash('sha1').update(html).digest('hex').slice(0, 10);
html = html.replace('<div id="view"></div>', `<div id="view"></div>\n<script>window.__BUILD=${JSON.stringify(build)}</script>`);
fs.writeFileSync(p.join(OUT, 'index.html'), html);
fs.writeFileSync(p.join(OUT, 'build.txt'), build);
fs.writeFileSync(p.join(OUT, 'sw.js'),
  fs.readFileSync(p.join(R, 'app/sw.js'), 'utf8').replace('__BUILD__', build));

fs.writeFileSync(p.join(OUT, 'manifest.webmanifest'), JSON.stringify({
  name: 'שבצ״ק', short_name: 'שבצ״ק', lang: 'he', dir: 'rtl',
  start_url: '/', scope: '/', display: 'standalone', orientation: 'portrait',
  background_color: '#0b0f14', theme_color: '#0b0f14',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
  /* Long-press the icon. Android honours these; iOS ignores them, which costs
     nothing. */
  shortcuts: [
    { name: 'מי בשמירה עכשיו', short_name: 'עכשיו', url: '/#board',
      icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
    { name: 'המדריך', short_name: 'מדריך', url: '/#guide',
      icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
  ],
}, null, 2));

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" rx="112" fill="#0b0f14"/>
<path d="M256 92l132 58v100c0 92-56 158-132 174-76-16-132-82-132-174V150z" fill="none" stroke="#2dd4bf" stroke-width="30" stroke-linejoin="round"/>
<circle cx="256" cy="266" r="74" fill="none" stroke="#2dd4bf" stroke-width="22"/>
<path d="M256 222v46l32 20" fill="none" stroke="#2dd4bf" stroke-width="22" stroke-linecap="round"/>
</svg>`;
fs.writeFileSync(p.join(OUT, 'icon.svg'), svg);

const legal = (title, body) => `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — שבצ״ק</title>
<style>body{font-family:-apple-system,"Segoe UI","Noto Sans Hebrew",Arial,sans-serif;background:#0b0f14;color:#e8eef5;
max-width:640px;margin:0 auto;padding:40px 20px;line-height:1.7}h1{font-size:24px}h2{font-size:16px;margin-top:28px}
a{color:#2dd4bf}@media(prefers-color-scheme:light){body{background:#fff;color:#111}}</style></head>
<body><h1>${title}</h1>${body}<p><a href="/">חזרה לאפליקציה</a></p></body></html>`;

fs.writeFileSync(p.join(OUT, 'privacy.html'), legal('מדיניות פרטיות', `
<p>שבצ״ק היא אפליקציה פרטית לשימוש פנימי של יחידה אחת. היא מציגה למשתמש את משמרות השמירה שלו מתוך גיליון Google Sheets קיים.</p>
<h2>איזה מידע נשמר</h2>
<ul>
<li>כתובת הדוא״ל של חשבון Google שאיתו התחברת, לצורך זיהוי בלבד.</li>
<li>אסימון רענון של Google, כדי לקרוא את הגיליון ולוודא שעדיין יש לך גישה אליו.</li>
<li>השם שבחרת מתוך השבצ״ק, וכינויים שהוספת בעצמך.</li>
<li>מנוי להתראות דחיפה, אם הפעלת אותן.</li>
</ul>
<h2>מה לא נעשה במידע</h2>
<p>המידע אינו נמכר, אינו משותף עם צד שלישי, ואינו משמש לפרסום או לניתוח התנהגות. אין מערכות מעקב או Analytics באפליקציה.</p>
<h2>הרשאת Google</h2>
<p>האפליקציה מבקשת הרשאת קריאה בלבד (<code>spreadsheets.readonly</code>). היא אינה יכולה לשנות, למחוק או ליצור גיליונות. גישה מוגבלת לגיליון השבצ״ק שהוגדר בלבד.</p>
<h2>מחיקה</h2>
<p>ניתן לבטל את הגישה בכל רגע בכתובת <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>. הסרת גישתך לגיליון ב-Sheets מוחקת את החשבון שלך באפליקציה בתוך 24 שעות.</p>`));

fs.writeFileSync(p.join(OUT, 'terms.html'), legal('תנאי שימוש', `
<p>האפליקציה ניתנת כמות שהיא, ללא אחריות, לשימוש פנימי של היחידה בלבד.</p>
<p>השבצ״ק המוצג הוא שיקוף של הגיליון בזמן הסנכרון האחרון. <b>הגיליון הוא המקור המחייב</b> — אין להסתמך על האפליקציה כתחליף לבדיקת השבצ״ק עצמו או להוראות המפקד.</p>
<p>אין להעביר גישה לאפליקציה למי שאין לו גישה לגיליון.</p>`));

console.log('built public/ → build', build, '·', fs.readdirSync(OUT).join(', '));
