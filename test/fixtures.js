const fs = require('fs'), path = require('path');

/* The real exported שבצ״קים are deliberately not in the repository. They are a
   live guard roster with everybody's full name and exact hours on it, and that
   does not belong on GitHub even in a private repo.

   So the tests that read them skip when they are absent, and say so rather than
   passing quietly. Everything that can be tested from made-up data — the
   parser's layout handling, the builder, the widget's sentences — lives in
   files that need none of this and always runs. */
const DIR = process.env.SH_FIXTURES ||
  '/root/.claude/uploads/c15cd98b-5aa4-5033-9718-6043eaa36723';

const FILES = [
  ['שבצ״ק מבוא דותן', '50e1319b'],
  ['פילבוקס  חרמש', '80c939ec'],
  ['תגבצים', '9ae688c2'],
  ['כ״א', 'd4efa89c'],
];

function present() {
  try { return fs.existsSync(DIR) && fs.readdirSync(DIR).some(f => f.endsWith('.csv')); }
  catch (e) { return false; }
}

/** Parsed tabs, or null when the exports are not on this machine. */
function tabs(P) {
  if (!present()) return null;
  const dir = fs.readdirSync(DIR);
  const out = [];
  for (const [title, pre] of FILES) {
    const f = dir.find(x => x.startsWith(pre) && x.endsWith('.csv'));
    if (!f) return null;
    out.push({ title, values: P.parseCSV(fs.readFileSync(path.join(DIR, f), 'utf8')) });
  }
  return out;
}

function skip(what) {
  console.log('  – ' + what + ' needs the exported sheets, which are not in the repo. Skipped.');
  console.log('    Point SH_FIXTURES at a folder of exports to run it.');
}

module.exports = { DIR, FILES, present, tabs, skip };
