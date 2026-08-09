/* ============================================================
   שבצ"ק grid parser
   Input:  { values: string[][], merges: [{r,c,rs,cs}], title }
   Output: { shifts, names, posts, blocks, warnings }
   Handles:
     - merged cells (day column, all-day officer, multi-slot posts)
     - dated grids   (יום | שעה | post columns…)
     - weekly grids  (block header = day name / range, rows = "בוקר (06:00-08:00)")
     - mirrored index columns, side tables, boundary cells like "10-22"
   ============================================================ */
(function (root) {
  'use strict';

  /* ---------- CSV ---------- */
  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
      else if (c !== '\r') f += c;
    }
    row.push(f); rows.push(row);
    while (rows.length && rows[rows.length - 1].every(c => !String(c).trim())) rows.pop();
    return rows.map(r => r.map(c => String(c).replace(/ /g, ' ').replace(/\s+/g, ' ').trim()));
  }

  /* Bump this whenever the parser's OUTPUT can change for the same sheet.
     The worker skips re-reading a sheet whose content hash is unchanged — which
     means a parser fix would otherwise never reach a שבצ״ק nobody has edited
     since. REV is part of the cache key, so raising it forces one full re-parse
     of every sheet and marks the result as a rebuild, so nobody gets notified
     about shifts that only "changed" because we read them better.
     test/parser-rev.js fails if parse.js changes and this doesn't. */
  const REV = 12;

  /* ---------- dates & times ---------- */
  const B = "(?<![\\p{L}\\p{N}])", A = "(?![\\p{L}\\p{N}])";
  const day = alt => new RegExp(B + "(?:\u05d9\u05d5\u05dd\\s*)?(?:" + alt + ")" + A, 'u');
  const DAY_NAMES = [
    [day("\u05e8\u05d0\u05e9\u05d5\u05df|\u05d0['\u05f3]?"), 0], [day("\u05e9\u05e0\u05d9|\u05d1['\u05f3]?"), 1],
    [day("\u05e9\u05dc\u05d9\u05e9\u05d9|\u05d2['\u05f3]?"), 2], [day("\u05e8\u05d1\u05d9\u05e2\u05d9|\u05d3['\u05f3]?"), 3],
    [day("\u05d7\u05de\u05d9\u05e9\u05d9|\u05d4['\u05f3]?"), 4], [day("\u05e9\u05d9\u05e9\u05d9|\u05d5['\u05f3]?"), 5],
    [day("\u05e9\u05d1\u05ea|\u05de\u05d5\u05e6[\"\u05f4']?\u05e9|\u05e9['\u05f3]?"), 6],
  ];


  function findDate(str, ref) {
    if (!str) return null;
    const s = String(str);
    let m = s.match(/(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})/);
    if (m) return { y: +m[1], mo: +m[2], d: +m[3] };

    /* A block that spans two days writes one range: "ש 8-9.8" = Sat–Sun, 8–9
       August. Read naively that is "8" and "9" — the 8th of the 9th month, a
       month away and on the wrong weekday. Ranges are matched first, and the
       block is dated from the day it starts. */
    const yearFor = (mo, d) => {
      const r = ref || new Date(); let y = r.getFullYear();
      const c = new Date(y, mo - 1, d);
      if (c - r < -150 * 864e5) y++; else if (c - r > 250 * 864e5) y--;
      return y;
    };
    // 8-9.8  ·  8-9/8/26  ·  30-1.9 (the 30th belongs to the month before)
    m = s.match(/(?:^|[^\d:.\/])(\d{1,2})\s*[-\u2013\u2014]\s*(\d{1,2})\s*[.\/](\d{1,2})(?:[.\/](\d{2,4}))?(?![\d:])/);
    if (m) {
      const d1 = +m[1], d2 = +m[2];
      let mo = +m[3];
      if (d1 >= 1 && d1 <= 31 && d2 >= 1 && d2 <= 31 && mo >= 1 && mo <= 12) {
        let y = m[4] ? (+m[4] < 100 ? +m[4] + 2000 : +m[4]) : null;
        let mo2 = +m[3], y2 = y;
        if (d1 > d2) { mo -= 1; if (mo < 1) { mo = 12; if (y !== null) y -= 1; } }   // 30-1.9
        const yy = y === null ? yearFor(mo, d1) : y;
        return { y: yy, mo, d: d1, alt: { y: y2 === null ? yearFor(mo2, d2) : y2, mo: mo2, d: d2 } };
      }
    }
    // 31.8-1.9
    m = s.match(/(?:^|[^\d:.\/])(\d{1,2})[.\/](\d{1,2})\s*[-\u2013\u2014]\s*(\d{1,2})[.\/](\d{1,2})(?![\d:])/);
    if (m) {
      const d1 = +m[1], mo1 = +m[2];
      if (d1 >= 1 && d1 <= 31 && mo1 >= 1 && mo1 <= 12 && +m[3] >= 1 && +m[3] <= 31 && +m[4] >= 1 && +m[4] <= 12) {
        return { y: yearFor(mo1, d1), mo: mo1, d: d1 };
      }
    }
    /* A hyphen alone is a range, not a date separator: "כיתה 3-4" is a name and
       "10-22" is a pair of hours. It only reads as a date with a year on it. */
    m = s.match(/(?:^|[^\d:])(\d{1,2})[.\/](\d{1,2})(?:[.\/-](\d{2,4}))?(?![\d:])/) ||
        s.match(/(?:^|[^\d:])(\d{1,2})-(\d{1,2})-(\d{2,4})(?![\d:])/);
    if (m) {
      const d = +m[1], mo = +m[2];
      if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
      let y = m[3] ? +m[3] : null;
      if (y !== null && y < 100) y += 2000;
      if (y === null) {
        const r = ref || new Date(); y = r.getFullYear();
        const c = new Date(y, mo - 1, d);
        if (c - r < -150 * 864e5) y++; else if (c - r > 250 * 864e5) y--;
      }
      return { y, mo, d };
    }
    return null;
  }

  // "ראשון עד חמישי" -> [0,1,2,3,4] ; "שישי" -> [5]
  function findWeekdays(str) {
    if (!str) return null;
    const s = String(str);
    const rng = s.match(/(.+?)\s*(?:עד|-|–)\s*(.+)/);
    if (rng) {
      const a = oneDay(rng[1]), b = oneDay(rng[2]);
      if (a != null && b != null) {
        const out = []; let i = a;
        for (let n = 0; n < 7; n++) { out.push(i); if (i === b) break; i = (i + 1) % 7; }
        return out;
      }
    }
    const d = oneDay(s);
    return d == null ? null : [d];
  }
  function oneDay(s) {
    for (const [re, i] of DAY_NAMES) if (re.test(s)) return i;
    return null;
  }

  function findTimeRange(str) {
    if (!str) return null;
    const s = String(str).replace(/[‒-―−]/g, '-');
    let m = s.match(/(\d{1,2})[:.](\d{2})\s*-\s*(\d{1,2})[:.](\d{2})/);
    if (m) return { sh: +m[1], sm: +m[2], eh: +m[3], em: +m[4] };
    m = s.match(/(?:^|\D)(\d{3,4})\s*-\s*(\d{3,4})(?:\D|$)/);
    if (m) {
      const a = m[1].padStart(4, '0'), b = m[2].padStart(4, '0');
      const r = { sh: +a.slice(0, 2), sm: +a.slice(2), eh: +b.slice(0, 2), em: +b.slice(2) };
      if (r.sh <= 24 && r.eh <= 24 && r.sm < 60 && r.em < 60) return r;
    }
    m = s.match(/^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/);
    if (m && +m[1] <= 24 && +m[2] <= 24) return { sh: +m[1], sm: 0, eh: +m[2], em: 0 };
    return null;
  }
  /* An explicit HH:MM-HH:MM inside a cell that also holds names. Deliberately
     stricter than findTimeRange: "3-4" or "190-2" must not become hours. */
  function strictTimeIn(str) {
    const s = String(str || '').replace(/[\u2012-\u2015\u2212]/g, '-');
    const m = s.match(/(\d{1,2})[:.](\d{2})\s*-\s*(\d{1,2})[:.](\d{2})/);
    if (!m) return null;
    const r = { sh: +m[1], sm: +m[2], eh: +m[3], em: +m[4] };
    if (r.sh > 24 || r.eh > 24 || r.sm > 59 || r.em > 59) return null;
    if (!s.replace(m[0], ' ').replace(/[^\p{L}]/gu, '')) return null;   // time-only cell: not this
    return { range: r, text: m[0] };
  }
  // a cell that is ONLY a time range ("10-22") is a boundary marker, not a person
  function isOnlyTime(str) {
    const s = String(str || '').trim();
    if (!s) return false;
    return !!findTimeRange(s) && /^[\d\s:.\-–—]+$/.test(s);
  }

  /* ---------- timezone-anchored clock times ----------
     A sheet that says 22:00 means 22:00 where the unit is, not 22:00 wherever
     the code happens to run. Cloudflare Workers run in UTC, so building dates
     with new Date(y,m,d,h,mi) silently shifted every shift. */
  const DEFAULT_TZ = 'Asia/Jerusalem';
  const _fmtCache = {};
  function partsFmt(tz) {
    return _fmtCache[tz] || (_fmtCache[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  function tzParts(ts, tz) {
    const o = {};
    for (const p of partsFmt(tz).formatToParts(new Date(ts))) if (p.type !== 'literal') o[p.type] = p.value;
    return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
  }
  function tzOffset(ts, tz) {
    const p = tzParts(ts, tz);
    return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - ts;
  }
  // wall-clock (y,mo,d,h,mi) in tz -> epoch ms. Two passes settle DST edges.
  function zonedEpoch(y, mo, d, h, mi, tz) {
    const naive = Date.UTC(y, mo - 1, d, h || 0, mi || 0);
    let ts = naive - tzOffset(naive, tz);
    ts = naive - tzOffset(ts, tz);
    return ts;
  }
  const parseHM = v => { const m = String(v || '').match(/^(\d{1,2}):(\d{2})$/); return m && +m[1] <= 24 && +m[2] < 60 ? { h: +m[1], m: +m[2] } : null; };
  const mkDateTZ = (dp, h, mi, tz) => new Date(zonedEpoch(dp.y, dp.mo, dp.d, h, mi, tz || DEFAULT_TZ));
  const nextDay = dp => { const t = Date.UTC(dp.y, dp.mo - 1, dp.d) + 864e5; const x = new Date(t); return { y: x.getUTCFullYear(), mo: x.getUTCMonth() + 1, d: x.getUTCDate() }; };

  /* ---------- name cells ---------- */
  const NOISE = new Set(['', '-', '--', '—', 'x', 'ריק', 'פנוי', 'אין', 'חופש', 'חופשה', 'n/a', 'na', '0', '.', 'ללא']);
  const isNoise = s => NOISE.has(s) || NOISE.has(s.toLowerCase());

  function splitNames(cell) {
    if (!cell) return [];
    let s = String(cell).trim();
    if (isNoise(s) || isOnlyTime(s)) return [];
    if (/^[\d\s.:\/\-–—+]+$/.test(s)) return [];
    // "אורי גבאי ואריה ליכטמן" -> split before a vav-prefixed word when the chunk is long
    const parts = s.split(/\s*(?:,|\/|\||\+|&|;|\n|\bו-)\s*/);
    const out = [];
    for (const p0 of parts) {
      const p = p0.trim();
      if (!p) continue;
      const toks = p.split(/\s+/);
      if (toks.length >= 3) {
        let cut = -1;
        for (let i = 1; i < toks.length; i++) if (/^ו[א-ת]{2,}/.test(toks[i])) { cut = i; break; }
        if (cut > 0) {
          out.push(toks.slice(0, cut).join(' '));
          out.push((toks[cut].slice(1) + ' ' + toks.slice(cut + 1).join(' ')).trim());
          continue;
        }
      }
      out.push(p);
    }
    return out.map(x => x.trim()).filter(x => x && !isNoise(x) && x.length > 1 && !isOnlyTime(x));
  }
  // "יכ״צ", "מ״כ" – role abbreviations, keep out of the searchable name list
  const isAbbrev = s => /["״']/.test(s) && s.replace(/["״'\s]/g, '').length <= 4;

  /* ---------- merge expansion ---------- */
  function expand(values, merges) {
    const h = values.length, w = values.reduce((a, r) => Math.max(a, r.length), 0);
    const grid = [];
    for (let r = 0; r < h; r++) {
      grid[r] = [];
      for (let c = 0; c < w; c++) grid[r][c] = { v: (values[r] && values[r][c]) || '', span: 1, anchor: r * 1e4 + c };
    }
    for (const m of (merges || [])) {
      const v = (values[m.r] && values[m.r][m.c]) || '';
      for (let r = m.r; r < m.r + (m.rs || 1) && r < h; r++)
        for (let c = m.c; c < m.c + (m.cs || 1) && c < w; c++)
          grid[r][c] = { v, span: (m.rs || 1), anchor: m.r * 1e4 + m.c };
    }
    return { grid, h, w };
  }

  /* ---------- hidden rows and columns ----------
     A column someone hid in the sheet is usually a post that was retired, a
     scratch column, or a copy kept "just in case". Reading it puts people on
     watches nobody expects. Drop them before anything else looks at the grid,
     and shift the merge rectangles to match, so a merge that straddled a
     dropped column simply gets narrower instead of landing on the wrong post. */
  function dropHidden(values, merges, hCols, hRows) {
    const cs = new Set(hCols || []), rs = new Set(hRows || []);
    if (!cs.size && !rs.size) return { values, merges };
    const w = values.reduce((a, r) => Math.max(a, r.length), 0);
    const keepC = [], colAt = [];        // colAt[old] = new index, or -1
    for (let c = 0; c < w; c++) { if (cs.has(c)) colAt[c] = -1; else { colAt[c] = keepC.length; keepC.push(c); } }
    const keepR = [], rowAt = [];
    for (let r = 0; r < values.length; r++) { if (rs.has(r)) rowAt[r] = -1; else { rowAt[r] = keepR.length; keepR.push(r); } }
    const out = keepR.map(r => keepC.map(c => (values[r] && values[r][c]) || ''));
    // a merge anchored on a hidden cell moves to its first surviving cell
    const shifted = [];
    for (const m of (merges || [])) {
      const c0 = m.c, c1 = m.c + (m.cs || 1), r0 = m.r, r1 = m.r + (m.rs || 1);
      let nc = -1, ncs = 0, nr = -1, nrs = 0;
      for (let c = c0; c < c1; c++) if (colAt[c] >= 0) { if (nc < 0) nc = colAt[c]; ncs++; }
      for (let r = r0; r < r1; r++) if (rowAt[r] >= 0) { if (nr < 0) nr = rowAt[r]; nrs++; }
      if (nc < 0 || nr < 0) continue;
      /* Google writes a merged block's text into its top-left cell only. If
         that corner was the hidden one, the text would vanish with it, so move
         it onto whichever cell of the block survived. */
      if (!out[nr][nc]) out[nr][nc] = (values[r0] && values[r0][c0]) || '';
      shifted.push({ r: nr, c: nc, rs: nrs, cs: ncs });
    }
    return { values: out, merges: merges ? shifted : merges };
  }

  function transpose(values, merges, h, w) {
    const out = [];
    for (let c = 0; c < w; c++) { out[c] = []; for (let r = 0; r < h; r++) out[c][r] = (values[r] && values[r][c]) || ''; }
    const m = (merges || []).map(x => ({ r: x.c, c: x.r, rs: x.cs || 1, cs: x.rs || 1 }));
    return { values: out, merges: merges ? m : null };
  }
  // a date sitting in a title cell above the table
  function sheetDate(grid, headerRow, ref) {
    for (let r = 0; r <= headerRow; r++)
      for (const cell of grid[r]) { const d = findDate(cell.v, ref); if (d) return d; }
    return null;
  }

  /* ============================================================ */
  function parseGrid(input, opts) {
    opts = opts || {};
    const ref = opts.now || new Date();
    const tz = opts.tz || DEFAULT_TZ;
    // Per-post overrides. A "daily" post ignores the row's time slot: everyone
    // listed in that column on a given day is on one shared block. Three rows
    // of the same person collapse to one shift, three different people end up
    // on the same block and therefore show as "איתך".
    const rules = opts.rules || {};
    const mkDate = (dp, hh, mm) => mkDateTZ(dp, hh, mm, tz);
    /* Hidden columns are skipped unless the admin asked for them. Somebody hid
       them on purpose, and reading a retired post puts people on watches that
       do not exist. opts.hidden === 'keep' brings them back. */
    const useHidden = opts.hidden === 'keep';
    const hCols = useHidden ? [] : (input.hcols || []);
    const hRows = useHidden ? [] : (input.hrows || []);
    const dropped = dropHidden(input.values || [], input.merges, hCols, hRows);
    const values = dropped.values;
    const { grid, h, w } = expand(values, dropped.merges);
    const tab = input.title || '';
    const warnings = [];
    const shifts = [];
    const rowVals = r => grid[r].map(c => c.v);
    const diag = { tab, rows: h, cols: w };

    // ---- row axis: which column carries the time, and which the date
    let timeCol = -1, dateCol = -1, bestT = 1, bestD = 1;
    const tHits = [], dHits = [], tOnly = [], dOnly = [], nameHits = [], filled = [];
    // "ה 6.8" is a date cell; "כיתה 3-4 יוסי לוי" is not, however loosely it reads
    const isMostlyDate = v => String(v).replace(/[^\p{L}]/gu, '').length <= 6;
    for (let c = 0; c < w; c++) {
      let t = 0, d = 0, to = 0, dof = 0, nm = 0, n = 0;
      for (let r = 0; r < h; r++) {
        const v = grid[r][c].v; if (!v) continue;
        n++;
        if (findTimeRange(v)) { t++; if (isOnlyTime(v)) to++; }
        else if (findDate(v, ref)) { d++; if (isMostlyDate(v)) dof++; }
        if (splitNames(v).length) nm++;
      }
      tHits[c] = t; dHits[c] = d; tOnly[c] = to; dOnly[c] = dof; nameHits[c] = nm; filled[c] = n;
    }
    // the real שעה column holds nothing but hours; a post column that happens to
    // carry its own hours must never win the time axis
    let bestTO = 1;
    for (let c = 0; c < w; c++) if (tOnly[c] > bestTO) { bestTO = tOnly[c]; timeCol = c; }
    if (timeCol < 0) for (let c = 0; c < w; c++) if (tHits[c] > bestT) { bestT = tHits[c]; timeCol = c; }
    /* Same trap as the time axis: "כיתה 3-4 יוסי לוי" reads as a date to a
       loose matcher. A real date column holds dates and a day letter, nothing
       more, so prefer columns whose cells are almost all date. */
    let bestDO = 1;
    for (let c = 0; c < w; c++) if (c !== timeCol && dOnly[c] > bestDO) { bestDO = dOnly[c]; dateCol = c; }
    if (dateCol < 0) for (let c = 0; c < w; c++) if (c !== timeCol && dHits[c] > bestD) { bestD = dHits[c]; dateCol = c; }

    // ---- no time column? the sheet may be transposed (times across the top)
    if (timeCol < 0) {
      let bestRow = -1, bestN = 1;
      for (let r = 0; r < Math.min(h, 12); r++) {
        const n = rowVals(r).filter(v => v && findTimeRange(v)).length;
        if (n > bestN) { bestN = n; bestRow = r; }
      }
      if (bestRow >= 0 && !opts._transposed) {
        const t = transpose(values, dropped.merges, h, w);
        const res = parseGrid({ values: t.values, merges: t.merges, title: tab },
          Object.assign({}, opts, { _transposed: true }));
        res.warnings = (res.warnings || []).concat('הגיליון נקרא במאונך (שעות בשורה העליונה)');
        res.diag = Object.assign({ transposed: true }, res.diag);
        return res;
      }
      diag.reason = 'no time axis';
      return { shifts: [], names: [], posts: [], warnings: ['לא נמצאה עמודת שעות'], tab, diag };
    }

    const keyCols = new Set([timeCol]);
    if (dateCol >= 0) keyCols.add(dateCol);
    /* A column that merely CONTAINS times is not a time column. חמל and כוננות
       often run different hours from the guard posts, so the sheet writes them
       inside the cell — "08:00-16:00 יוסי לוי". Dropping that column as a time
       axis made the post vanish silently: no shifts, no warning, nothing.
       Only drop a column when its cells carry no names at all. */
    for (let c = 0; c < w; c++) {
      if ((tHits[c] >= 2 || dHits[c] >= 2) && nameHits[c] === 0) { keyCols.add(c); continue; }
      /* Wide שבצ״קים repeat the יום / שעה pair on the right so you can read the
         far columns without scrolling back. The copy is a key column too — left
         as a post it becomes one called "יום" whose people are "ג 4" and "ד 5".
         Dominance, not presence: חמ״ל holds a few "10-22" markers among its
         names and must stay a post. */
      const keyish = tOnly[c] + dOnly[c];
      if (keyish >= 2 && keyish >= 0.6 * filled[c]) keyCols.add(c);
    }

    let firstData = -1;
    for (let r = 0; r < h; r++) if (findTimeRange(grid[r][timeCol].v)) { firstData = r; break; }
    if (firstData <= 0) { diag.reason = 'no header row above the first slot'; return { shifts: [], names: [], posts: [], warnings: ['לא נמצאה שורת כותרת'], tab, diag }; }

    let hdrRow = firstData - 1;
    while (hdrRow > 0 && rowVals(hdrRow).filter(v => v).length < 2) hdrRow--;   // skip section labels
    const headers = [hdrRow];
    if (dateCol < 0) {
      for (let r = firstData; r < h; r++) {
        const v = grid[r][timeCol].v;
        if (v && !findTimeRange(v) && findWeekdays(v) && rowVals(r).filter(x => x).length >= 3) headers.push(r);
      }
    }

    const seen = new Set();
    const derived = [];                 // cells that point at another post instead of naming people
    const colSeen = {};                 // every heading we considered, and what it yielded
    let colAxis = 'post';
    for (let bi = 0; bi < headers.length; bi++) {
      const hr = headers[bi];
      const end = bi + 1 < headers.length ? headers[bi + 1] : h;
      const hdr = rowVals(hr);
      const blockWeekdays = findWeekdays(hdr[timeCol] || '');
      const blockDate = findDate(hdr[timeCol] || '', ref);

      // ---- column axis: are the headings posts, dates, or times?
      const cand = [];
      for (let c = 0; c < w; c++) {
        if (keyCols.has(c)) continue;
        const nm = (hdr[c] || '').trim();
        if (!nm || nm.length > 40) continue;
        cand.push({ c, name: nm, date: findDate(nm, ref), time: findTimeRange(nm) });
      }
      if (!cand.length) continue;
      cand.forEach(x => { if (!(x.name in colSeen)) colSeen[x.name] = 0; });
      const nd = cand.filter(x => x.date).length, nt = cand.filter(x => x.time).length;
      colAxis = nd / cand.length >= 0.6 ? 'date' : nt / cand.length >= 0.6 ? 'time' : 'post';
      // a date column plus date headings would double-count; trust the column
      if (colAxis === 'date' && dateCol >= 0) colAxis = 'post';
      const posts = cand.filter(x => colAxis !== 'date' || x.date);

      let runningDate = blockDate || sheetDate(grid, hr, ref) || null;
      let section = '';
      /* Some posts run their own hours and the column says so in its own cells:
             חמ״ל
             10-22          ← a marker, not a person
             עילאי גניזה     ← on 10:00-22:00, not on this row's 4-hour slot
             גלעד אפריים
             22-10
             תמיר לויצקי
         The marker governs the names under it, and is forgotten at the next day
         so it can't bleed across. */
      let colTime = {};
      /* Which cell decided this row's date. Kept on every shift so אבחון can
         show it: when a date comes out wrong the only question that matters is
         what the sheet literally said, and guessing at it wastes days. */
      let dateSrc = hdr[timeCol] || '';
      for (let r = hr + 1; r < end; r++) {
        const rv = rowVals(r);
        const filled = rv.filter(v => v).length;
        if (!filled) continue;
        if (filled === 1) {                       // a lone cell is a section label or a date row
          const only = rv.find(v => v);
          const dp0 = findDate(only, ref);
          if (dp0) runningDate = dp0;
          else if (!findTimeRange(only)) section = only;
          continue;
        }
        const rowTime = findTimeRange(grid[r][timeCol].v);
        if (!rowTime && colAxis !== 'time') continue;
        /* A row can name its own day inside a block labelled with a different
           one — "מוצ״ש (20:30-22:00)" sitting under שישי is Saturday night, not
           Friday night. The row wins; it is the more specific statement. */
        const rowWeekdays = dateCol < 0 ? findWeekdays(grid[r][timeCol].v) : null;
        let dp = dateCol >= 0 ? findDate(grid[r][dateCol].v, ref) : null;
        if (dp) {
          const raw = grid[r][dateCol].v;
          const fixed = reconcileDate(raw, dp, runningDate, ref, tz);
          if (fixed !== dp) {
            warnings.push('התאריך בתא "' + String(raw).trim() + '" לא תואם ליום שכתוב בו, נקרא כ-' +
              fixed.d + '.' + fixed.mo + ' לפי אות היום');
            dp = fixed;
          }
          runningDate = dp; colTime = {}; dateSrc = raw;
        } else dp = runningDate;

        for (const p of posts) {
          const raw = grid[r][p.c].v;
          if (!raw) continue;
          if (isOnlyTime(raw)) { colTime[p.c] = findTimeRange(raw); continue; }
          const refs = relRefs(raw);
          /* "08:00-16:00 יוסי לוי" — the cell states its own hours. Only the
             explicit HH:MM form counts, so "כיתה 3-4" stays a name. */
          const own = strictTimeIn(raw);
          const names = refs ? [] : splitNames(own ? raw.replace(own.text, ' ') : raw);
          if (!refs && !names.length) continue;

          const label = colAxis === 'post' ? p.name : (section || '');
          const rule = rules[normKey(label)];
          let tr = colAxis === 'time' ? (p.time || rowTime) : rowTime;
          if (colAxis !== 'time') tr = own ? own.range : (colTime[p.c] || tr);
          if (rule && rule.mode === 'daily') {
            const a = parseHM(rule.start), b = parseHM(rule.end);
            if (a && b) tr = { sh: a.h, sm: a.m, eh: b.h, em: b.m };
          }
          if (!tr) continue;

          let dates;
          const wholeDay = rule && rule.mode === 'daily';
          if (colAxis === 'date' && p.date) dates = [p.date];
          else if (dp) dates = (wholeDay && dp.alt) ? [dp, dp.alt] : [dp];
          else if (rowWeekdays) dates = nextOccurrences(rowWeekdays, ref, opts.horizonDays || 14, tz);
          else if (blockWeekdays) dates = nextOccurrences(blockWeekdays, ref, opts.horizonDays || 14, tz);
          else dates = [dateOfTZ(ref, tz)];

          for (const d0 of dates) {
            const start = mkDate(d0, tr.sh, tr.sm);
            let endT = mkDate(d0, tr.eh, tr.em);
            if (endT <= start) endT = mkDate(nextDay(d0), tr.eh, tr.em);   // crosses midnight
            if (refs) { derived.push({ post: label, tab, start, end: endT, refs, raw }); continue; }
            for (const nm of names) {
              const k = [tab, +start, +endT, label, nm].join('|');
              if (seen.has(k)) continue;
              seen.add(k);
              shifts.push({ name: nm, start, end: endT, post: label, tab, aux: isAbbrev(nm), key: k,
                            src: String(dateSrc || '').slice(0, 40), row: r + 1 });
            }
          }
        }
      }
    }

    resolveDerived(shifts, derived, seen, tab, warnings);
    carryDaily(shifts, rules, tz, warnings);

    shifts.forEach(sh => { colSeen[sh.post] = (colSeen[sh.post] || 0) + 1; });
    const columns = Object.keys(colSeen).map(name => ({ name, n: colSeen[name] }))
      .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'he'));
    Object.assign(diag, {
      timeCol, dateCol, headerRow: headers[0], blocks: headers.length, colAxis,
      shifts: shifts.length, transposed: !!opts._transposed, columns,
      hidden: { cols: (input.hcols || []).length, rows: (input.hrows || []).length, kept: useHidden },
    });
    /* A column that reads fine but yields nothing is the failure people actually
       hit — the post silently disappears. Say its name instead of staying quiet. */
    const dead = columns.filter(c => !c.n).map(c => c.name);
    if (dead.length && shifts.length) {
      warnings.push('עמודות שלא הניבו אף שיבוץ: ' + dead.slice(0, 6).join(', ') +
        (dead.length > 6 ? ' ועוד' : ''));
    }
    if (!shifts.length) { diag.reason = 'no names found in any post column'; warnings.push('לא נמצאו שמות בגיליון'); }
    if (dateCol < 0 && colAxis !== 'date' && !headers.some(r => findWeekdays(rowVals(r)[timeCol] || ''))) {
      warnings.push('לא נמצא תאריך, הונח היום הנוכחי');
    }

    shifts.sort((a, b) => a.start - b.start);
    const posts = Array.from(new Set(shifts.map(s => s.post).filter(Boolean)));
    const postKeys = new Set(posts.map(normKey));
    for (const s2 of shifts) {
      const toks = normKey(s2.name).split(' ');
      if (toks.length >= 2 && toks.some(t => postKeys.has(t))) s2.aux = true;   // "סיור יורד" is a note, not a soldier
    }
    if (!input.merges) warnings.push('נטען בלי מידע על תאים ממוזגים, משמרות שנפרסות על כמה שורות עלולות להיחתך');
    return { shifts, names: rosterNames(shifts), posts, warnings, tab, diag, axes: { timeCol, dateCol } };
  }

  function rosterNames(shifts) {
    const m = new Map();
    shifts.forEach(s => { if (s.aux) return; const k = normKey(s.name); if (!m.has(k)) m.set(k, s.name); });
    return Array.from(m.values()).sort((a, b) => a.localeCompare(b, 'he'));
  }

  const dateOf = d => ({ y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate() });
  const dateOfTZ = (d, tz) => { const p = tzParts(+d, tz || DEFAULT_TZ); return { y: p.y, mo: p.mo, d: p.d }; };
  function weekdayTZ(dp, tz) {
    return new Date(zonedEpoch(dp.y, dp.mo, dp.d, 12, 0, tz || DEFAULT_TZ)).getUTCDay();
  }
  function nextOccurrences(weekdays, ref, horizon, tz) {
    const out = [];
    let dp = dateOfTZ(ref, tz);
    for (let i = 0; i < horizon; i++) {
      if (weekdays.indexOf(weekdayTZ(dp, tz)) >= 0) out.push(dp);
      dp = nextDay(dp);
    }
    return out;
  }
  /* A Hebrew roster labels every day with its letter, and that letter is a free
     checksum on the numbers beside it. "ש 8/9" is Saturday — but read as day and
     month it is 8 September, which is a Tuesday. The sheet means the 8th–9th:
     "/" here separates two day numbers, not day from month, and the month is
     simply the one the roster is already in.

     So when a cell carries both a weekday and a date and they contradict each
     other, the letter wins and we look for the reading that agrees with it. Only
     one candidate is ever accepted, and if none agree the original stands and
     the sheet gets a warning — guessing silently would be worse than the bug. */
  function reconcileDate(text, parsed, prev, ref, tz) {
    const wd = findWeekdays(text);
    if (!parsed || !wd || wd.length !== 1) return parsed;
    const want = wd[0];
    if (weekdayTZ(parsed, tz) === want) return parsed;          // already agrees

    const m = String(text).match(/(\d{1,2})\s*[.\/-]\s*(\d{1,2})(?:\s*[.\/-]\s*(\d{2,4}))?/);
    const a = m ? +m[1] : null, b = m ? +m[2] : null;
    const base = prev || parsed;
    const cand = [];
    // "8/9" = the 8th to the 9th, in the month the roster is already in
    if (a && a <= 31 && b && b <= 31) {
      cand.push({ y: base.y, mo: base.mo, d: a, twin: { y: base.y, mo: base.mo, d: b } });
      cand.push({ y: base.y, mo: base.mo, d: b, twin: { y: base.y, mo: base.mo, d: a } });
      if (base.mo === 12) cand.push({ y: base.y + 1, mo: 1, d: a });
      if (base.mo === 1) cand.push({ y: base.y - 1, mo: 12, d: a });
    }
    if (a && b && b <= 31 && a <= 12) cand.push({ y: parsed.y, mo: a, d: b });   // written month-first
    /* Deliberately NOT trying other years. A letter that disagrees is far more
       often a two-day label than a roster written twelve months off, and
       silently sliding a whole שבצ״ק into another year is the worse mistake. */

    for (const c of cand) {
      if (c.d < 1 || c.d > 31 || c.mo < 1 || c.mo > 12) continue;
      if (new Date(Date.UTC(c.y, c.mo - 1, c.d)).getUTCDate() !== c.d) continue;  // 31.9 etc
      if (weekdayTZ(c, tz) !== want) continue;
      /* "ש 8/9" names two days. The slot rows below it are a single 24-hour
         cycle and belong to the first, but a whole-day duty written there —
         מטבח, כוננות — runs for both, which is exactly how the unit reads it. */
      if (c.twin && c.twin.d >= 1 && c.twin.d <= 31) return Object.assign({}, c, { alt: c.twin });
      return c;
    }
    return parsed;
  }

  /* A whole-day duty that runs into the next day without being written there
     again. The מטבח crew put down under Friday is on for Saturday too, and the
     sheet says so only by leaving Saturday's column blank — which is not
     something a parser may assume on its own. So it is a per-column setting the
     unit turns on, it only fills a day that is genuinely empty, it never chains
     past one day, and every day it invents is named in the warnings. */
  function carryDaily(shifts, rules, tz, warnings) {
    const wanted = Object.entries(rules || {}).filter(([, v]) => v && v.mode === 'daily' && v.carry);
    if (!wanted.length || !shifts.length) return;
    const dayOf = d => { const p = tzParts(d, tz); return p.y + '-' + p.mo + '-' + p.d; };
    const parseDay = k => { const [y, mo, d] = k.split('-').map(Number); return { y, mo, d }; };
    const days = Array.from(new Set(shifts.map(s => dayOf(s.start)))).sort((a, b) => {
      const A = parseDay(a), B = parseDay(b);
      return A.y - B.y || A.mo - B.mo || A.d - B.d;
    });

    for (const [key, rule] of wanted) {
      const mine = shifts.filter(s => normKey(s.post) === key);
      if (!mine.length) continue;
      const label = mine[0].post;
      const byDay = new Map();
      mine.forEach(s => { const k = dayOf(s.start); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(s); });
      const a = parseHM(rule.start), b = parseHM(rule.end);
      if (!a || !b) continue;

      for (let i = 1; i < days.length; i++) {
        const today = days[i], prev = days[i - 1];
        if (byDay.has(today) || !byDay.has(prev)) continue;      // only a genuinely empty day
        const src = byDay.get(prev);
        if (src.some(s => s.carried)) continue;                  // never chain past one day
        const dp = parseDay(today);
        const start = mkDateTZ(dp, a.h, a.m, tz);
        let end = mkDateTZ(dp, b.h, b.m, tz);
        if (end <= start) end = mkDateTZ(nextDay(dp), b.h, b.m, tz);
        const added = [];
        for (const s of src) {
          const k = [s.tab, +start, +end, label, s.name].join('|');
          if (shifts.some(x => x.key === k)) continue;
          const ns = { name: s.name, start, end, post: label, tab: s.tab, aux: false, carried: true, key: k };
          shifts.push(ns); added.push(ns);
        }
        if (added.length) {
          byDay.set(today, added);
          warnings.push(label + ': אין שיבוץ ב' + dp.d + '.' + dp.mo + ', הועתק מהיום שלפניו (' +
            added.map(x => x.name).slice(0, 4).join(', ') + ')');
        }
      }
    }
  }

  /* "יורד" is the crew whose shift on that post ends exactly when this one
     starts; "עולה" is the one starting alongside it. Resolved after the whole
     tab is read, because the shift being referred to is often further down the
     grid than the cell referring to it. */
  function resolveDerived(shifts, derived, seen, tab, warnings) {
    if (!derived.length) return;
    const byPost = new Map();
    for (const sh of shifts) {
      const k = normKey(sh.post);
      if (!byPost.has(k)) byPost.set(k, []);
      byPost.get(k).push(sh);
    }
    const unresolved = new Set();
    for (const d of derived) {
      let found = 0;
      for (const ref of d.refs) {
        const pool = byPost.get(normKey(ref.post)) || [];
        let hits = pool.filter(sh => ref.kind === 'up' ? +sh.start === +d.start : +sh.end === +d.start);
        if (ref.head) hits = hits.slice(0, 1);           // the commander only
        for (const sh of hits) {
          const k = [tab, +d.start, +d.end, d.post, sh.name].join('|');
          if (seen.has(k)) continue;
          seen.add(k);
          shifts.push({ name: sh.name, start: d.start, end: d.end, post: d.post, tab,
                        aux: false, derivedFrom: ref.post, key: k });
          found++;
        }
      }
      if (!found) unresolved.add(d.raw);
    }
    if (unresolved.size) {
      warnings.push('לא הצלחתי לפענח מי מגיע מ: ' + Array.from(unresolved).slice(0, 3).join(' · ') +
        '. אין משמרת שמסתיימת בדיוק בשעה הזו');
    }
  }

  /* Some cells hold a rule instead of a name: "סיור יורד + מכולות יורד" means
     whoever just came off סיור, plus whoever just came off מכולות. Left alone
     it becomes a person called "סיור יורד + מכולות יורד" who is on watch
     forever. Resolved, it names the right people automatically every time the
     roster changes — which is the point of writing it that way. */
  const REL_DOWN = /^(.*?)\s*(?:יורד(?:ת|ים|ות)?|סיים(?:ו|ה)?|מסיים(?:ת|ים|ות)?)$/;
  const REL_UP = /^(.*?)\s*(?:עול(?:ה|ים|ות)|נכנס(?:ת|ים|ות)?)$/;
  function relRefs(cell) {
    const parts = String(cell || '').split(/\s*[+,;\/]\s*/).map(x => x.trim()).filter(Boolean);
    if (!parts.length) return null;
    const refs = [];
    for (const part of parts) {
      let m = part.match(REL_DOWN);
      let kind = 'down';
      if (!m) { m = part.match(REL_UP); kind = 'up'; }
      if (!m || !m[1] || !m[1].trim()) return null;      // one plain name and it is not a rule
      let post = m[1].trim(), head = false;
      /* "מ״כ סיור יורד" — only the commander of that crew. Israeli rosters list
         the commander first in the cell, so that is who it takes. */
      const c = post.match(/^(?:מ["\u05f4]?כ|מ["\u05f4]?מ|מפקד(?:ת)?)\s+(.+)$/);
      if (c) { post = c[1].trim(); head = true; }
      refs.push({ post, kind, head });
    }
    return refs;
  }

  function normKey(s) {
    return String(s || '').replace(/[֑-ׇ]/g, '').replace(/[׳״'"]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /* ---------- people-directory tabs (כ״א): names, no times ----------
     Gives the authoritative spelling of every name plus where they sit. */
  const ROLE = /^(מ["״]?[מכ]|ממ|מכ|סמל|סגן|רס["״]?ר|קצין|מפקד|לוחם|נהג|חובש|מיקום|שם|צוות|פלוגה|כיתה)\b/;
  function looksLikePerson(s) {
    const v = String(s || '').trim();
    if (!v || /\d/.test(v) || v.length > 30) return false;
    if (ROLE.test(v)) return false;
    const t = v.split(/\s+/);
    if (t.length < 2 || t.length > 4) return false;
    return t.every(x => x.replace(/["״'׳]/g, '').length >= 2) && /[א-תA-Za-z]/.test(v);
  }
  function parseDirectory(input) {
    const values = input.values || [];
    if (values.some(r => r.some(v => findTimeRange(v)))) return null;   // it's a schedule, not a directory
    const counts = new Map();
    values.forEach(r => r.forEach(v => { const k = normKey(v); if (k) counts.set(k, (counts.get(k) || 0) + 1); }));
    const labels = new Set(Array.from(counts.entries()).filter(([k, n]) => n >= 3 && k.split(/\s+/).length <= 3).map(([k]) => k));
    const people = [];
    for (let r = 0; r < values.length; r++) {
      const row = values[r] || [];
      let loc = '';
      for (let c = 0; c < row.length; c++) {
        const v = String(row[c] || '').trim();
        if (!v) continue;
        if (labels.has(normKey(v))) { loc = v; continue; }   // repeated value = a place/role label
        if (looksLikePerson(v)) people.push({ name: v, loc, tab: input.title || '' });
      }
    }
    if (people.length < 8) return null;
    const seen = new Set(), out = [];
    for (const p of people) { const k = normKey(p.name); if (seen.has(k)) continue; seen.add(k); out.push(p); }
    return { people: out, tab: input.title || '' };
  }

  /* ---------- merge near-identical spellings of the same person ----------
     The sheet really does contain "ליאוב עובד" and "ליאב עובד" for one guy.
     Two names collapse only if they are very similar AND never share a slot. */
  function clusterNames(shifts, threshold, seed) {
    const M = root.SHMatch;
    const th = threshold || 0.875;
    const freq = new Map(), display = new Map();
    // directory names are authoritative: seed them first with a big weight
    for (const p of (seed || [])) {
      const k = normKey(p.name || p);
      freq.set(k, (freq.get(k) || 0) + 1000);
      if (!display.has(k)) display.set(k, String(p.name || p).trim());
    }
    for (const s of shifts) {
      if (s.aux) continue;
      const k = normKey(s.name);
      freq.set(k, (freq.get(k) || 0) + 1);
      if (!display.has(k)) display.set(k, s.name.trim());
    }
    // names that co-occur in the same slot are definitely different people
    const slot = new Map();
    for (const s of shifts) {
      const sk = +s.start + '|' + s.post;
      if (!slot.has(sk)) slot.set(sk, new Set());
      slot.get(sk).add(normKey(s.name));
    }
    const conflict = new Set();
    slot.forEach(set => {
      const arr = Array.from(set);
      for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++)
        conflict.add(arr[i] < arr[j] ? arr[i] + ' ' + arr[j] : arr[j] + ' ' + arr[i]);
    });

    const order = Array.from(freq.keys()).sort((a, b) => freq.get(b) - freq.get(a) || a.localeCompare(b));
    const reps = [], canon = new Map(), variants = new Map();
    const blocks = new Map();                    // block key -> reps that carry it
    const addRep = r => { if (!M) return; for (const b of M.blockKeys(display.get(r))) { if (!blocks.has(b)) blocks.set(b, []); blocks.get(b).push(r); } };
    const candidates = k => {
      if (!M) return [];
      const seen = new Set(), out = [];
      for (const b of M.blockKeys(display.get(k))) for (const r of (blocks.get(b) || [])) if (!seen.has(r)) { seen.add(r); out.push(r); }
      return out;
    };
    for (const k of order) {
      const single = display.get(k).trim().split(/\s+/).length === 1;
      const hits = [];
      for (const r of candidates(k)) {
        const pair = k < r ? k + ' ' + r : r + ' ' + k;
        if (conflict.has(pair)) continue;
        const sc = M.nameScore(display.get(k), display.get(r));
        if (sc >= th) hits.push({ r, sc });
      }
      hits.sort((a, b) => b.sc - a.sc);
      // a bare surname folds into a full name only when exactly one full name fits:
      // "גנזיה" -> "עילאי גנזיה" yes ; "יואב" with both יואב שלום and יואב שפר no
      // a bare surname folds in only when one full name is a clear winner
      const clear = hits.length === 1 || (hits.length > 1 && hits[0].sc - hits[1].sc >= 0.04);
      const hit = hits.length ? (single ? (clear ? hits[0].r : null) : hits[0].r) : null;
      if (hit) { canon.set(k, hit); variants.get(hit).push(display.get(k)); }
      else { reps.push(k); addRep(k); canon.set(k, k); variants.set(k, [display.get(k)]); }
    }
    return { canon, display, variants };
  }

  /* ---------- merge several tabs ---------- */
  function parseWorkbook(tabs, opts) {
    opts = opts || {};
    const all = [], warnings = [], directory = [];
    const scheduleTabs = [], allPosts = new Set(), diags = [];
    for (const t of tabs) {
      const r = parseGrid(t, opts);
      diags.push(Object.assign({ title: t.title, warnings: r.warnings || [] }, r.diag || {}));
      if (r.shifts.length) {
        all.push(...r.shifts);
        scheduleTabs.push(t.title);
        (r.posts || []).forEach(x => allPosts.add(x));
        r.warnings.forEach(w => warnings.push((t.title ? t.title + ': ' : '') + w));
        continue;
      }
      const dir = parseDirectory(t);
      if (dir) directory.push(...dir.people);
    }
    all.sort((a, b) => a.start - b.start);

    const { canon, display, variants } = clusterNames(all, opts.clusterThreshold, directory);
    for (const s of all) s.person = display.get(canon.get(normKey(s.name))) || s.name;

    const locOf = {};
    for (const p of directory) {
      const c = display.get(canon.get(normKey(p.name)));
      if (c && p.loc && !locOf[c]) locOf[c] = p.loc;
    }
    const withShifts = new Set(all.filter(s => !s.aux).map(s => s.person));
    const dirNames = new Set(directory.map(p => display.get(canon.get(normKey(p.name)))).filter(Boolean));
    const names = Array.from(new Set([...withShifts, ...dirNames])).sort((a, b) => a.localeCompare(b, 'he'));

    const aliases = {};
    variants.forEach((vs, k) => { const d = display.get(k); if (vs.length > 1) aliases[d] = Array.from(new Set(vs)); });

    return {
      shifts: all, names, aliases, locations: locOf, warnings,
      posts: Array.from(allPosts).sort((a, b) => a.localeCompare(b, 'he')),
      diags,
      tabs: tabs.map(t => t.title), scheduleTabs,
      directorySize: directory.length,
    };
  }

  /* ---------- per-person view ---------- */
  function shiftsFor(roster, name) {
    const t = normKey(name);
    return roster.shifts.filter(s => normKey(s.person || s.name) === t || normKey(s.name) === t);
  }
  function statusFor(roster, name, now) {
    now = now || new Date();
    const mine = shiftsFor(roster, name);
    const active = mine.filter(s => s.start <= now && now < s.end);
    const current = active[0] || null;
    const upcoming = mine.filter(s => s.start > now);
    const next = upcoming[0] || null;
    const withMe = current ? uniq(roster.shifts.filter(s => +s.start === +current.start && s.post === current.post && normKey(s.name) !== normKey(name)).map(s => s.name)) : [];
    const relief = current ? uniq(roster.shifts.filter(s => +s.start === +current.end && s.post === current.post).map(s => s.name)) : [];
    return { current, active, next, upcoming, withMe, relief, total: mine.length };
  }
  const uniq = a => Array.from(new Set(a));

  /* ---------- diffing, for change notifications ---------- */
  function diff(prevShifts, nextShifts) {
    const A = new Map(), B = new Map();
    (prevShifts || []).forEach(s => A.set(s.key, s));
    (nextShifts || []).forEach(s => B.set(s.key, s));
    const added = [], removed = [];
    B.forEach((s, k) => { if (!A.has(k)) added.push(s); });
    A.forEach((s, k) => { if (!B.has(k)) removed.push(s); });
    const byPerson = new Map();
    const put = (s, kind) => {
      const k = normKey(s.name);
      if (!byPerson.has(k)) byPerson.set(k, { name: s.name, added: [], removed: [] });
      byPerson.get(k)[kind].push(s);
    };
    added.forEach(s => put(s, 'added'));
    removed.forEach(s => put(s, 'removed'));
    return { added, removed, byPerson: Array.from(byPerson.values()) };
  }

  const api = {
    REV,
    parseCSV, parseGrid, parseWorkbook, parseDirectory, clusterNames,
    zonedEpoch, tzParts, tzOffset, DEFAULT_TZ,
    shiftsFor, statusFor, diff,
    findDate, findTimeRange, findWeekdays, splitNames, normKey, expand,
  };
  root.SHParse = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
