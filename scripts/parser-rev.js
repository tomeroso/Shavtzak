/* A parser fix that never runs is worse than no fix: the worker skips any sheet
   whose content hash is unchanged, so a corrected reading only reaches שבצ״קים
   that somebody happens to edit afterwards. SHParse.REV is part of the cache
   key; this pins parse.js to it so the two can't drift.

     node scripts/parser-rev.js          check   (runs in npm test)
     node scripts/parser-rev.js --write  record  (after bumping REV)
*/
const fs = require('fs'), p = require('path'), crypto = require('crypto');
const root = p.join(__dirname, '..');
const src = fs.readFileSync(p.join(root, 'shared/parse.js'), 'utf8');
const sha = crypto.createHash('sha1').update(src).digest('hex').slice(0, 12);
const rev = require(p.join(root, 'shared/parse.js')).REV;
const lockPath = p.join(root, 'shared/parse.rev.json');
const lock = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, 'utf8')) : { rev: 0, sha: '' };

const RED = '\x1b[31m', GRN = '\x1b[32m', DIM = '\x1b[2m', OFF = '\x1b[0m';

if (process.argv.includes('--write')) {
  if (sha !== lock.sha && rev <= lock.rev) {
    console.error(`${RED}parse.js changed but REV is still ${rev}. Raise REV in shared/parse.js first.${OFF}`);
    process.exit(1);
  }
  fs.writeFileSync(lockPath, JSON.stringify({ rev, sha }, null, 2) + '\n');
  console.log(`${GRN}✓ recorded parser REV ${rev} (${sha})${OFF}`);
  process.exit(0);
}

if (sha === lock.sha) { console.log(`  ✓ parser REV ${rev} matches parse.js`); process.exit(0); }
if (rev > lock.rev) { console.log(`  ✓ parser REV raised to ${rev} — run: npm run parser:rev`); process.exit(0); }
console.error(`\n${RED}parse.js changed but SHParse.REV is still ${rev}.${OFF}
   ${DIM}Every existing שבצ״ק is cached by content hash, so the new reading would
   never reach one that nobody edits. Raise REV in shared/parse.js, then run:
     npm run parser:rev${OFF}\n`);
process.exit(1);
