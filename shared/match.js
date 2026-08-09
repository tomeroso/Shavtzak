/* ============================================================
   Hebrew-aware fuzzy name matching + nicknames + transliteration
   ============================================================ */
(function (root) {
  'use strict';

  const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };

  /* norm/skel/phon/roman get called tens of thousands of times during
     clustering on the same handful of strings. Cache them. */
  function memo1(fn, cap) {
    const m = new Map();
    return x => {
      if (m.has(x)) return m.get(x);
      const v = fn(x);
      if (m.size > (cap || 20000)) m.clear();
      m.set(x, v);
      return v;
    };
  }

  function _norm(s) {
    if (!s) return '';
    let x = String(s)
      .replace(/[֑-ׇ]/g, '')
      .replace(/[׳״'"`‘’“”]/g, '')
      .toLowerCase();
    x = x.normalize('NFD').replace(/[̀-ͯ]/g, '');
    x = x.replace(/[^\p{L}\p{N} ]+/gu, ' ');
    x = x.split('').map(c => FINALS[c] || c).join('');
    return x.replace(/\s+/g, ' ').trim();
  }

  const norm = memo1(_norm);
  const isHeb = s => /[א-ת]/.test(s);

  // mater-lectionis-insensitive Hebrew skeleton (תומר == תמר)
  const skel = memo1(function (s) {
    return norm(s).replace(/[אהוי]/g, '').replace(/(.)\1+/g, '$1');
  });

  /* ---------- cross-script phonetic skeleton ----------
     Folds Hebrew and Latin spellings of the same name onto one string.
     תומר / tomer          -> TMR
     אוסוביצקי / osovizky  -> SBSK
     שרון / sharon         -> SRN                                      */
  const HEB_CONS = {
    'ב': 'B', 'ג': 'G', 'ד': 'D', 'ז': 'S', 'ח': 'H', 'ט': 'T', 'כ': 'K', 'ל': 'L',
    'מ': 'M', 'נ': 'N', 'ס': 'S', 'פ': 'P', 'צ': 'S', 'ק': 'K', 'ר': 'R', 'ש': 'S', 'ת': 'T',
  };
  function phonHeb(w) {
    const ch = w.split('');
    let out = '';
    for (let i = 0; i < ch.length; i++) {
      const c = ch[i];
      if (c === 'א' || c === 'ע') continue;                        // silent
      if (c === 'ה') { if (i < ch.length - 1) out += 'H'; continue; }  // silent word-finally
      if (c === 'ו') {                                             // vav: vowel unless doubled/initial
        if (ch[i + 1] === 'ו') { out += 'B'; i++; continue; }
        if (i === 0) { out += 'B'; continue; }
        continue;
      }
      if (c === 'י') {                                             // yod: vowel unless doubled
        if (ch[i + 1] === 'י') { i++; continue; }
        continue;
      }
      if (HEB_CONS[c]) out += HEB_CONS[c];
    }
    return out;
  }
  const LAT_DI = [['sch', 'S'], ['sh', 'S'], ['ch', 'H'], ['kh', 'H'], ['tz', 'S'], ['ts', 'S'], ['ph', 'P'], ['th', 'T'], ['ck', 'K']];
  const LAT_ONE = { b: 'B', v: 'B', w: 'B', p: 'P', f: 'P', k: 'K', c: 'K', q: 'K', g: 'G', j: 'G', d: 'D', z: 'S', s: 'S', t: 'T', l: 'L', m: 'M', n: 'N', r: 'R', h: 'H', x: 'KS' };

  /* readable transliteration, vowels kept — powers substring nicknames ("oso") */
  const HEB_ROM = {
    'א': 'a', 'ב': 'v', 'ג': 'g', 'ד': 'd', 'ה': 'h', 'ו': 'o', 'ז': 'z', 'ח': 'h', 'ט': 't',
    'י': 'i', 'כ': 'k', 'ל': 'l', 'מ': 'm', 'נ': 'n', 'ס': 's', 'ע': 'a', 'פ': 'p', 'צ': 'ts',
    'ק': 'k', 'ר': 'r', 'ש': 'sh', 'ת': 't',
  };
  const roman = memo1(function (s) {
    const n = norm(s);
    if (!isHeb(n)) return n.replace(/ /g, '');
    return n.split('').map(c => HEB_ROM[c] != null ? HEB_ROM[c] : (c === ' ' ? '' : c)).join('');
  });
  function phonLat(w) {
    let s = w.toLowerCase(), out = '';
    for (let i = 0; i < s.length;) {
      let hit = null;
      for (const [d, v] of LAT_DI) if (s.startsWith(d, i)) { hit = [d.length, v]; break; }
      if (hit) { out += hit[1]; i += hit[0]; continue; }
      const c = s[i];
      if (LAT_ONE[c]) out += LAT_ONE[c];
      i++;
    }
    return out;
  }
  const phon = memo1(function (word) {
    const w = norm(word).replace(/ /g, '');
    if (!w) return '';
    return (isHeb(w) ? phonHeb(w) : phonLat(w)).replace(/(.)\1+/g, '$1');
  });

  /* ---------- Damerau-Levenshtein (OSA) ---------- */
  function dl(a, b) {
    const n = a.length, m = b.length;
    if (!n) return m;
    if (!m) return n;
    let prev2 = null, prev = new Array(m + 1), cur = new Array(m + 1);
    for (let j = 0; j <= m; j++) prev[j] = j;
    for (let i = 1; i <= n; i++) {
      cur[0] = i;
      for (let j = 1; j <= m; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let v = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
        cur[j] = v;
      }
      prev2 = prev; prev = cur; cur = new Array(m + 1);
    }
    return prev[m];
  }
  const sim = (a, b) => (!a || !b) ? 0 : 1 - dl(a, b) / Math.max(a.length, b.length);

  /* ---------- token similarity ---------- */
  function tokenScore(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    let s = sim(a, b);

    // prefix / nickname: "אוס" → "אוסוביצקי", "oso" → "osovizky"
    if (a.length >= 3 && b.startsWith(a)) s = Math.max(s, 0.80 + 0.15 * (a.length / b.length));
    else if (b.length >= 3 && a.startsWith(b)) s = Math.max(s, 0.78 + 0.15 * (b.length / a.length));

    // mater lectionis (same script) — needs a skeleton with real substance,
    // otherwise אורי and יאיר both reduce to "ר" and collapse into one person
    const sa = skel(a), sb = skel(b);
    if (sa && sa === sb && sa.length >= 3) s = Math.max(s, 0.94);
    else if (sa && sa === sb && sa.length === 2) s = Math.max(s, 0.86);
    else if (sa && sb && sa.length >= 3 && sb.length >= 3 && dl(sa, sb) === 1) s = Math.max(s, 0.80);

    // cross-script / phonetic
    const cross = isHeb(a) !== isHeb(b);
    const pa = phon(a), pb = phon(b);
    if (pa && pb && pa.length >= 2) {
      if (pa === pb) s = Math.max(s, cross ? 0.95 : 0.90);
      else if (pa.length >= 3 && pb.startsWith(pa)) s = Math.max(s, 0.82);
      else if (dl(pa, pb) === 1) {
        const L = Math.max(pa.length, pb.length);
        if (L >= 5) s = Math.max(s, 0.80);          // long keys: one sound off is a typo
        else if (L === 4) s = Math.max(s, 0.72);    // short keys collide too easily (GB vs SGB)
      }
    }
    // nickname by substring of the readable transliteration: "oso" ⊂ "aosovitski"
    if (a.length >= 3) {
      const ra = roman(a), rb = roman(b);
      if (rb.length >= a.length && rb.indexOf(ra) >= 0) s = Math.max(s, rb.startsWith(ra) ? 0.86 : 0.82);
    }
    return Math.max(0, Math.min(1, s));
  }

  /* ---------- full-name similarity, order independent ---------- */
  function nameScore(query, cand) {
    const qt = norm(query).split(' ').filter(Boolean);
    const ct = norm(cand).split(' ').filter(Boolean);
    if (!qt.length || !ct.length) return 0;
    if (qt.join(' ') === ct.join(' ')) return 1;

    const used = new Set();
    let total = 0;
    for (const q of qt) {
      let best = 0, bi = -1;
      for (let i = 0; i < ct.length; i++) {
        if (used.has(i)) continue;
        const s = tokenScore(q, ct[i]);
        if (s > best) { best = s; bi = i; }
      }
      if (bi >= 0 && best > 0) { used.add(bi); total += best; }
    }
    let score = qt.length ? total / qt.length : 0;
    const coverage = used.size / ct.length;
    if (coverage < 1) score *= 0.94 + 0.06 * coverage;   // partial name (surname only) stays strong

    // glued query: "תומראוסוביצקי"
    const wa = norm(query).replace(/ /g, ''), wb = norm(cand).replace(/ /g, '');
    score = Math.max(score, sim(wa, wb) * 0.98);
    // glued phonetic: "tomerosovizky"
    const pa = phon(wa), pb = phon(wb);
    if (pa.length >= 4 && pa === pb) score = Math.max(score, 0.93);
    return score;
  }

  const THRESHOLD = 0.62;

  function rankNames(query, names, limit, aliases) {
    const q = String(query || '').trim();
    if (q.length < 2) return [];
    const out = [];
    for (const n of names) {
      let s = nameScore(q, n);
      const al = aliases && aliases[n];
      if (al) for (const a of al) s = Math.max(s, nameScore(q, a) * 0.99);
      if (s >= THRESHOLD) out.push({ name: n, score: s });
    }
    out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'he'));
    return out.slice(0, limit || 8);
  }

  // Candidate keys for cheap blocking: two names can only score >=0.87 if they
  // share at least one of these, so clustering can skip everything else.
  function blockKeys(name) {
    const out = new Set();
    for (const t of norm(name).split(' ')) {
      if (!t) continue;
      const p = phon(t), k = skel(t);
      if (p) out.add('p' + p.slice(0, 3));
      if (k) out.add('k' + k.slice(0, 3));
      out.add('t' + t.slice(0, 3));
    }
    return out;
  }

  const api = { norm, skel, phon, roman, dl, sim, tokenScore, nameScore, rankNames, blockKeys, THRESHOLD };
  root.SHMatch = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
