/* Preflight: catch a half-filled wrangler.toml before it becomes a runtime 500. */
const fs = require('fs'), p = require('path');
const root = p.join(__dirname, '..');
const toml = fs.readFileSync(p.join(root, 'wrangler.toml'), 'utf8');

const val = k => { const m = toml.match(new RegExp('^\\s*' + k + '\\s*=\\s*"([^"]*)"', 'm')); return m ? m[1] : ''; };
const problems = [], notes = [];

const kv = val('id');
if (!kv || /PUT_YOUR/.test(kv)) problems.push([
  'KV namespace id is not set',
  'npx wrangler kv namespace list   → copy the id of "shavtzak-SH" into [[kv_namespaces]] id',
  'if the list is empty: npx wrangler kv namespace create SH',
]);

const cid = val('GOOGLE_CLIENT_ID');
if (!cid || /PUT_YOUR/.test(cid)) problems.push([
  'GOOGLE_CLIENT_ID is not set',
  'Google Cloud console → Google Auth Platform → Clients → your web client → copy the Client ID',
]);
else if (!/\.apps\.googleusercontent\.com$/.test(cid)) problems.push([
  'GOOGLE_CLIENT_ID does not look like a client id',
  'it should end in .apps.googleusercontent.com — you may have pasted the client secret or the project id',
]);

const vp = val('VAPID_PUBLIC');
if (!vp || /PUT_YOUR/.test(vp)) problems.push([
  'VAPID_PUBLIC is not set (no push notifications without it)',
  'npx web-push generate-vapid-keys',
  'public key → VAPID_PUBLIC here;  private key → npx wrangler secret put VAPID_PRIVATE',
]);
else if (vp.length < 80) problems.push([
  'VAPID_PUBLIC looks too short',
  'it should be ~87 characters. you may have pasted the private key (~43) by mistake',
]);

const pk = val('PICKER_API_KEY'), pn = val('GOOGLE_PROJECT_NUMBER');
if (!pk || !pn) notes.push(
  'PICKER_API_KEY / GOOGLE_PROJECT_NUMBER not set — people can still join sheets, but nobody can\n' +
  '      connect a NEW one. See SETUP.md step 5 (Google Picker).');
else if (!/^\d+$/.test(pn)) problems.push([
  'GOOGLE_PROJECT_NUMBER should be digits only',
  'Cloud console home page → "Project number". You may have pasted the project ID (a word-word-123 string)',
]);

const subj = val('VAPID_SUBJECT');
if (!subj || /you@example\.com/.test(subj)) notes.push('VAPID_SUBJECT is still the example address — set it to mailto:<your email>');

for (const f of ['public/index.html', 'public/sw.js', 'public/manifest.webmanifest']) {
  if (!fs.existsSync(p.join(root, f))) problems.push(['missing ' + f, 'run: npm run build']);
}

const RED = '\x1b[31m', YEL = '\x1b[33m', GRN = '\x1b[32m', DIM = '\x1b[2m', OFF = '\x1b[0m';
if (problems.length) {
  console.error(`\n${RED}Cannot deploy yet — ${problems.length} thing${problems.length > 1 ? 's' : ''} to fix:${OFF}\n`);
  problems.forEach(([title, ...how], i) => {
    console.error(`${RED}${i + 1}. ${title}${OFF}`);
    how.forEach(h => console.error(`   ${DIM}${h}${OFF}`));
    console.error('');
  });
  console.error(`${DIM}Full walkthrough: SETUP.md${OFF}\n`);
  process.exit(1);
}
notes.forEach(n => console.log(`${YEL}note:${OFF} ${n}`));
console.log(`${GRN}✓ config looks complete — deploying${OFF}`);
