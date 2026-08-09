/* ============================================================
   שבצ"ק שנבנה בתוך האפליקציה — the editable model.

   Most units don't keep their שבצ"ק in Google Sheets, so the app has to be
   able to hold one itself. This module is the source of truth for that:
   a plain document that the editor mutates, plus a compiler that turns it
   into exactly the same roster shape the Sheets parser produces. Everything
   downstream — search, "who's on now", reminders, change notifications, the
   leaderboard — is therefore untouched and works on both kinds identically.

   doc = {
     id, title, tz, rev,
     people:   ['תומר כהן', ...],
     posts:    [{ name, per, mode:'slot'|'daily', start:'07:00', end:'23:59' }],
     days:     ['2026-08-06', ...],                 // explicit, so gaps are allowed
     slots:    [{ start:'02:00', end:'06:00' }],
     cells:    { '<ymd>|<slotIndex>|<post>': ['name', ...] },
     unavailable: { 'תומר כהן': ['2026-08-07'] },
   }

   A daily post ignores the slot rows: everyone on it that day is on it
   together, from its own start to its own end (מטבח at 07:00, קצין מוצב for
   the whole day). Its cells live under slot index -1.
   ============================================================ */
(function (root) {
  'use strict';

  /* Deliberately standalone: parse.js is a worker-side module the browser never
     loads, and this one has to run in both. normKey and the timezone maths are
     copies of the parser's — identical behaviour, no dependency, so a demo or
     an editor works with nothing else loaded. */
  const P = root.SHParse || null;
  const _fmt = {};
  function partsFmt(tz) {
    return _fmt[tz] || (_fmt[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  }
  function tzParts(ts, tz) {
    const o = {};
    for (const q of partsFmt(tz).formatToParts(new Date(ts))) if (q.type !== 'literal') o[q.type] = q.value;
    return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
  }
  const tzOffset = (ts, tz) => { const q = tzParts(ts, tz); return Date.UTC(q.y, q.mo - 1, q.d, q.h, q.mi, q.s) - ts; };
  // wall-clock in tz -> epoch ms. Two passes settle the DST edges.
  function zonedEpoch(y, mo, d, h, mi, tz) {
    const naive = Date.UTC(y, mo - 1, d, h || 0, mi || 0);
    let ts = naive - tzOffset(naive, tz);
    return naive - tzOffset(ts, tz);
  }
  const normKey = s => String(s || '').replace(/[\u0591-\u05C7]/g, '').replace(/[\u05F3\u05F4'"]/g, '')
    .replace(/\s+/g, ' ').trim().toLowerCase();

  const pad = n => String(n).padStart(2, '0');
  const DAY_LETTER = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
  const TAB = 'שבצ״ק';                       // native rosters are a single "tab"

  const parseHM = v => {
    const x = String(v || '').match(/^(\d{1,2}):(\d{2})$/);
    return x && +x[1] <= 24 && +x[2] < 60 ? { h: +x[1], m: +x[2] } : null;
  };
  const ymdOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parseYMD = s => {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
  };
  /* Label a date without going through Date — a native doc's days are plain
     calendar dates and must not drift with whatever zone the code runs in. */
  function dayLabel(ymd) {
    const p = parseYMD(ymd);
    if (!p) return ymd;
    const wd = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay();
    return DAY_LETTER[wd] + ' ' + p.d + '.' + p.mo;
  }
  const addDays = (ymd, n) => {
    const p = parseYMD(ymd); if (!p) return ymd;
    const d = new Date(Date.UTC(p.y, p.mo - 1, p.d + n));
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  };
  const cellKey = (ymd, slotIdx, post) => ymd + '|' + slotIdx + '|' + post;

  const isNightHM = hm => { const s = parseHM(hm); return !!s && (s.h >= 22 || s.h < 6); };

  /* A whole-day post is not always one block. כרמל א turns over daily and often
     twice in a day, at whatever hour the מ״פ decided — so a day can be cut into
     as many pieces as it needs, each with its own hours and its own people.
     Missing means the simple case: one block, the post's own hours.
     Segment i lives at slot index -(i+1), so -1 stays what it always was. */
  const segKey = (ymd, post) => ymd + '|' + post;
  function segsFor(d, ymd, post) {
    const s = d.segs && d.segs[segKey(ymd, post.name)];
    if (s && s.length) return s;
    return [{ start: post.start, end: post.end }];
  }
  const segSlot = i => -(i + 1);

  function emptyDoc(o) {
    o = o || {};
    return {
      id: o.id || '', title: o.title || 'שבצ״ק', tz: o.tz || 'Asia/Jerusalem', rev: 0,
      people: [], posts: [], days: [], slots: [], cells: {}, unavailable: {}, segs: {},
    };
  }

  /* Anything the editor or the network hands us gets scrubbed here — the worker
     trusts nothing, and the editor benefits from the same normalisation. */
  function sanitise(doc, limits) {
    const L = Object.assign({ people: 400, posts: 30, days: 120, slots: 24, perCell: 20 }, limits || {});
    const d = emptyDoc(doc);
    d.title = String((doc && doc.title) || 'שבצ״ק').trim().slice(0, 80) || 'שבצ״ק';
    d.tz = /^[\w/+-]{3,40}$/.test((doc && doc.tz) || '') ? doc.tz : 'Asia/Jerusalem';
    d.rev = Math.max(0, +(doc && doc.rev) || 0);

    const seenP = new Set();
    d.people = ((doc && doc.people) || []).map(x => String(x || '').trim().replace(/\s+/g, ' '))
      .filter(x => x && x.length <= 60)
      .filter(x => { const k = normKey(x); if (seenP.has(k)) return false; seenP.add(k); return true; })
      .slice(0, L.people);

    const seenPost = new Set();
    d.posts = ((doc && doc.posts) || []).map(p => {
      const name = String((typeof p === 'string' ? p : p && p.name) || '').trim().replace(/\s+/g, ' ');
      const o = (typeof p === 'object' && p) || {};
      const mode = o.mode === 'daily' ? 'daily' : 'slot';
      const from = (o.from && typeof o.from === 'object') ? {
        posts: (Array.isArray(o.from.posts) ? o.from.posts : []).map(x => String(x || '').trim()).filter(Boolean).slice(0, 8),
        at: parseHM(o.from.at) ? o.from.at : '',
      } : null;
      return {
        name: name.slice(0, 40), per: Math.max(1, Math.min(+o.per || 1, 20)), mode,
        start: parseHM(o.start) ? o.start : '07:00',
        end: parseHM(o.end) ? o.end : '23:59',
        /* כרמל א: on it all day, in gear, first out the gate — and therefore
           given no ordinary watches that day. The exemption is the whole point
           of the duty, so it belongs to the post, not to a note somewhere. */
        exempt: !!o.exempt,
        // מטבח written under Friday and covering Saturday as well
        carry: !!o.carry,
        // כרמל ב: whoever came off another post, rather than a name typed in
        from: (from && from.posts.length) ? from : null,
      };
    }).filter(p => p.name && !seenPost.has(p.name) && seenPost.add(p.name) !== false).slice(0, L.posts);
    // a post can't be fed by itself, or by one that doesn't exist
    const nameSet = new Set(d.posts.map(p => p.name));
    d.posts.forEach(p => {
      if (!p.from) return;
      p.from.posts = p.from.posts.filter(x => x !== p.name && nameSet.has(x));
      if (!p.from.posts.length) p.from = null;
    });

    const seenD = new Set();
    d.days = ((doc && doc.days) || []).map(x => String(x || ''))
      .filter(x => parseYMD(x) && !seenD.has(x) && seenD.add(x) !== false)
      .sort().slice(0, L.days);

    d.slots = ((doc && doc.slots) || []).map(s => ({
      start: parseHM(s && s.start) ? s.start : null, end: parseHM(s && s.end) ? s.end : null,
    })).filter(s => s.start && s.end).slice(0, L.slots);

    // only keep cells that still point at a real day / slot / post
    const postNames = new Set(d.posts.map(p => p.name));
    const dailyPost = {};
    d.posts.filter(p => p.mode === 'daily').forEach(p => dailyPost[p.name] = p);
    const dayset = new Set(d.days);
    const people = new Set(d.people.map(normKey));

    d.segs = {};
    for (const [k, v] of Object.entries((doc && doc.segs) || {})) {
      const bits = String(k).split('|');
      if (bits.length !== 2 || !dayset.has(bits[0]) || !dailyPost[bits[1]]) continue;
      const list = (Array.isArray(v) ? v : []).map(x => ({
        start: parseHM(x && x.start) ? x.start : null, end: parseHM(x && x.end) ? x.end : null,
      })).filter(x => x.start && x.end).slice(0, 8);
      if (list.length) d.segs[k] = list;
    }
    const segCount = (ymd, name) => (d.segs[segKey(ymd, name)] || []).length || 1;

    d.cells = {};
    for (const [k, v] of Object.entries((doc && doc.cells) || {})) {
      const bits = String(k).split('|');
      if (bits.length !== 3) continue;
      const [ymd, si, post] = [bits[0], +bits[1], bits[2]];
      if (!dayset.has(ymd) || !postNames.has(post)) continue;
      if (dailyPost[post] ? !(si <= -1 && si >= -segCount(ymd, post)) : !(si >= 0 && si < d.slots.length)) continue;
      const names = (Array.isArray(v) ? v : []).map(x => String(x || '').trim())
        .filter(x => x && people.has(normKey(x)))
        .filter((x, i, a) => a.indexOf(x) === i)
        .slice(0, L.perCell);
      if (names.length) d.cells[k] = names;
    }

    d.unavailable = {};
    for (const [name, list] of Object.entries((doc && doc.unavailable) || {})) {
      if (!people.has(normKey(name))) continue;
      const days = (Array.isArray(list) ? list : []).filter(x => parseYMD(x)).slice(0, L.days);
      if (days.length) d.unavailable[name] = days;
    }
    return d;
  }

  /* ---------- compile to the roster shape the rest of the app reads ---------- */
  function compile(doc, opts) {
    const d = sanitise(doc);
    const tz = (opts && opts.tz) || d.tz || 'Asia/Jerusalem';
    const zoned = (ymd, hm, plusDay) => {
      const p = parseYMD(ymd), t = parseHM(hm);
      if (!p || !t) return null;
      const base = zonedEpoch(p.y, p.mo, p.d, t.h, t.m, tz);
      return plusDay ? zonedEpoch(p.y, p.mo, p.d + 1, t.h, t.m, tz) : base;
    };

    const shifts = [], seen = new Set();
    const push = (name, post, s, e) => {
      const k = [TAB, s, e, post, name].join('|');       // same key format as the parser
      if (seen.has(k)) return;
      seen.add(k);
      shifts.push({ n: name, p: post, t: TAB, s, e, k, x: 0 });
    };

    for (const ymd of d.days) {
      for (const post of d.posts) {
        if (post.mode === 'daily') {
          segsFor(d, ymd, post).forEach((seg, i) => {
            const names = d.cells[cellKey(ymd, segSlot(i), post.name)] || [];
            if (!names.length) return;
            const s = zoned(ymd, seg.start);
            let e = zoned(ymd, seg.end);
            if (e <= s) e = zoned(ymd, seg.end, true);
            names.forEach(n => push(n, post.name, s, e));
          });
        } else {
          d.slots.forEach((slot, si) => {
            const names = d.cells[cellKey(ymd, si, post.name)] || [];
            if (!names.length) return;
            const s = zoned(ymd, slot.start);
            let e = zoned(ymd, slot.end);
            if (e <= s) e = zoned(ymd, slot.end, true);
            names.forEach(n => push(n, post.name, s, e));
          });
        }
      }
    }
    shifts.sort((a, b) => a.s - b.s || (a.p < b.p ? -1 : 1));

    // a person in the roster stays searchable even with no shifts yet
    const names = d.people.slice();
    const aliases = {}; names.forEach(n => { aliases[n] = [n]; });

    return {
      kind: 'native', id: d.id, title: d.title, tz, updatedAt: Date.now(),
      posts: d.posts.map(p => p.name), rules: {},
      tabs: [TAB], scheduleTabs: [TAB],          // same shape the parser emits
      names, aliases, locations: {}, warnings: [], diags: [],
      shifts,
    };
  }

  /* A readable grid, for the אבחון screen and for copying out to anywhere else. */
  function preview(doc) {
    const d = sanitise(doc);
    const slotted = d.posts.filter(p => p.mode === 'slot');
    const daily = d.posts.filter(p => p.mode === 'daily');
    const head = ['יום', 'שעה'].concat(slotted.map(p => p.name)).concat(daily.map(p => p.name + ' (יומי)'));
    const rows = [head];
    for (const ymd of d.days) {
      d.slots.forEach((slot, si) => {
        const row = [si === 0 ? dayLabel(ymd) : '', slot.start + '-' + slot.end];
        slotted.forEach(p => row.push((d.cells[cellKey(ymd, si, p.name)] || []).join(', ')));
        daily.forEach(p => row.push(si === 0
          ? segsFor(d, ymd, p).map((seg, i) => (d.cells[cellKey(ymd, segSlot(i), p.name)] || []).join(', '))
              .filter(Boolean).join(' | ') : ''));
        rows.push(row);
      });
      if (!d.slots.length) {
        const row = [dayLabel(ymd), ''];
        slotted.forEach(() => row.push(''));
        daily.forEach(p => row.push(segsFor(d, ymd, p)
          .map((seg, i) => (d.cells[cellKey(ymd, segSlot(i), p.name)] || []).join(', ')).filter(Boolean).join(' | ')));
        rows.push(row);
      }
    }
    return rows;
  }

  /* ---------- what's wrong with this roster, right now ----------
     Runs on every keystroke in the editor, so it stays O(cells). */
  function audit(doc, o) {
    const d = sanitise(doc);
    const minRest = (o && o.minRest != null) ? Math.max(0, +o.minRest) : 1;
    const issues = [];
    /* Watches and whole-day duties are both work, but they are not the same
       work and nobody compares them. Counted apart so the numbers mean
       something: four כרמל א days is not four nights on the gate. */
    const blank = n => ({ name: n, count: 0, watch: 0, duty: 0, night: 0, hours: 0, days: new Set() });
    const load = {};
    d.people.forEach(n => { load[n] = blank(n); });
    const bump = (n, night, hours, ymd, kind) => {
      const L = load[n] || (load[n] = blank(n));
      L.count++; L[kind]++; L.hours += hours; if (night) L.night++; L.days.add(ymd);
    };
    const hoursBetween = (a, b) => {
      const s = parseHM(a), e = parseHM(b);
      if (!s || !e) return 0;
      let m = (e.h * 60 + e.m) - (s.h * 60 + s.m);
      if (m <= 0) m += 1440;
      return m / 60;
    };

    // slot index → who is on it, per day, to catch the same person twice at once
    const perSlot = new Map();
    const seq = [];                                   // [{ymd, si, name}] in time order
    d.days.forEach((ymd, di) => {
      for (const post of d.posts) {
        if (post.mode === 'daily') {
          segsFor(d, ymd, post).forEach((seg, i) => {
            const names = d.cells[cellKey(ymd, segSlot(i), post.name)] || [];
            const when = dayLabel(ymd) + ' ' + seg.start + '–' + seg.end;
            if (!post.from && names.length < post.per)
              issues.push({ kind: 'hole', text: 'חסר ' + (post.per - names.length) + ' ב' + post.name + ' · ' + when, ymd, post: post.name, si: segSlot(i) });
            names.forEach(n => {
              bump(n, isNightHM(seg.start), hoursBetween(seg.start, seg.end), ymd, 'duty');
              if ((d.unavailable[n] || []).includes(ymd))
                issues.push({ kind: 'off', text: n + ' לא זמין ב' + when + ', ' + post.name, ymd, post: post.name, si: segSlot(i), name: n });
            });
          });
        } else {
          d.slots.forEach((slot, si) => {
            const names = d.cells[cellKey(ymd, si, post.name)] || [];
            const mk = ymd + '|' + si;
            if (!perSlot.has(mk)) perSlot.set(mk, new Map());
            const m = perSlot.get(mk);
            names.forEach(n => {
              bump(n, isNightHM(slot.start), hoursBetween(slot.start, slot.end), ymd, 'watch');
              seq.push({ gi: di * Math.max(1, d.slots.length) + si, ymd, si, name: n, post: post.name });
              m.set(n, (m.get(n) || 0) + 1);
              if ((d.unavailable[n] || []).includes(ymd))
                issues.push({ kind: 'off', text: n + ' לא זמין ב' + dayLabel(ymd) + ', ' + post.name + ' ' + slot.start, ymd, post: post.name, si, name: n });
            });
            const missing = post.per - names.length;
            // a fed column has whoever came off; "missing" is not a thing there
            if (missing > 0 && !post.from)
              issues.push({ kind: 'hole', text: 'חסר ' + missing + ' ב' + post.name + ' · ' + dayLabel(ymd) + ' ' + slot.start, ymd, post: post.name, si });
          });
        }
      }
    });

    /* Standby all day means no watches all day. Breaking it is the mistake this
       roster makes most often, because the two columns look unrelated. */
    d.days.forEach(ymd => {
      const held = exemptOn(d, ymd);
      if (!held.length) return;
      const holder = {};
      d.posts.filter(p => p.exempt && p.mode === 'daily').forEach(p =>
        segsFor(d, ymd, p).forEach((seg, i) =>
          (d.cells[cellKey(ymd, segSlot(i), p.name)] || []).forEach(n => holder[n] = p.name)));
      d.posts.filter(p => p.mode === 'slot').forEach(post => {
        d.slots.forEach((slot, si) => {
          (d.cells[cellKey(ymd, si, post.name)] || []).forEach(n => {
            if (held.indexOf(n) < 0) return;
            issues.push({ kind: 'exempt', name: n, ymd, si, post: post.name,
              text: n + ' ב' + holder[n] + ' כל היום ולא אמור לקבל שמירות, אבל משובץ ל' + post.name + ' ' + slot.start + ' · ' + dayLabel(ymd) });
          });
        });
      });
    });

    perSlot.forEach((m, mk) => {
      const [ymd, si] = mk.split('|');
      m.forEach((c, n) => {
        if (c > 1) issues.push({ kind: 'double', text: n + ' משובץ פעמיים באותה משמרת · ' + dayLabel(ymd) + ' ' + ((d.slots[+si] || {}).start || ''), ymd, si: +si, name: n });
      });
    });

    if (minRest > 0) {
      const by = {};
      seq.forEach(x => (by[x.name] = by[x.name] || []).push(x));
      Object.values(by).forEach(list => {
        list.sort((a, b) => a.gi - b.gi);
        for (let i = 1; i < list.length; i++) {
          const gap = list[i].gi - list[i - 1].gi;
          if (gap > 0 && gap <= minRest)
            issues.push({ kind: 'rest', text: list[i].name + ' חוזר אחרי ' + (gap - 1) + ' משמרות מנוחה · ' + dayLabel(list[i].ymd), ymd: list[i].ymd, si: list[i].si, name: list[i].name });
        }
      });
    }

    const stats = Object.values(load).map(L => ({ name: L.name, count: L.count, watch: L.watch, duty: L.duty,
      night: L.night, hours: Math.round(L.hours * 10) / 10, days: L.days.size }))
      .sort((a, b) => b.watch - a.watch || b.count - a.count || a.name.localeCompare(b.name, 'he'));
    const counts = stats.map(s => s.watch);
    return {
      issues, stats,
      fairness: counts.length ? {
        min: Math.min.apply(null, counts), max: Math.max.apply(null, counts),
        nightMin: Math.min.apply(null, stats.map(s => s.night)),
        nightMax: Math.max.apply(null, stats.map(s => s.night)),
      } : null,
    };
  }

  /* ---------- crews that come from a rule instead of a name ----------
     כרמל ב is "whoever just came off a watch". The unit configures which posts
     feed it and at what hour, and the app keeps it in step every time anything
     upstream moves — which is the only way it stays right, because it changes
     whenever the roster does. A post fed this way is not hand-editable; the
     rule is the thing you edit. */
  function applyFrom(doc) {
    const d = sanitise(doc);
    const fed = d.posts.filter(p => p.from);
    if (!fed.length) return d;
    const cells = Object.assign({}, d.cells);

    for (const post of fed) {
      const at = post.from.at || (d.slots[0] && d.slots[0].start) || '';
      for (const ymd of d.days) {
        // wipe whatever was there: the rule owns this column
        segsFor(d, ymd, post).forEach((_, i) => delete cells[cellKey(ymd, segSlot(i), post.name)]);
        d.slots.forEach((_, si) => delete cells[cellKey(ymd, si, post.name)]);

        const crew = [];
        for (const src of post.from.posts) {
          const sp = d.posts.find(x => x.name === src);
          if (!sp || sp.mode === 'daily') continue;      // a whole-day duty never "comes off"
          d.slots.forEach((slot, si) => {
            if (slot.end !== at) return;
            /* A 22:00–02:00 slot ends at 02:00 the NEXT morning, so the crew
               coming off at 02:00 today was written on yesterday's row. */
            const srcDay = slot.end > slot.start ? ymd : addDays(ymd, -1);
            (d.cells[cellKey(srcDay, si, src)] || []).forEach(n => { if (crew.indexOf(n) < 0) crew.push(n); });
          });
        }
        if (!crew.length) continue;
        if (post.mode === 'daily') cells[cellKey(ymd, -1, post.name)] = crew;
        else {
          const si = d.slots.findIndex(sl => sl.start === at);
          if (si >= 0) cells[cellKey(ymd, si, post.name)] = crew;
        }
      }
    }
    d.cells = cells;
    return sanitise(d);
  }

  /* Who is tied up all day on a standby and therefore takes no watches. */
  function exemptOn(d, ymd) {
    const out = [];
    d.posts.filter(p => p.exempt && p.mode === 'daily').forEach(p => {
      segsFor(d, ymd, p).forEach((seg, i) =>
        (d.cells[cellKey(ymd, segSlot(i), p.name)] || []).forEach(n => { if (out.indexOf(n) < 0) out.push(n); }));
    });
    return out;
  }
  const isFed = (d, post) => !!(d.posts.find(p => p.name === post) || {}).from;

  /* ---------- fill empty places with the generator, keeping what's there ----------
     opts.only === 'empty' (default) leaves every existing assignment alone;
     'all' clears first and rebuilds from scratch. */
  /* Whole-day duties get filled too, and the standby has to be settled BEFORE
     the watch schedule is built — its four people are out of the pool for that
     day, and deciding that afterwards would mean tearing the day up again. */
  function fillDaily(d, which, cells) {
    const load = {};
    d.people.forEach(n => load[n] = 0);
    Object.entries(cells).forEach(([k, v]) => { if (+k.split('|')[1] < 0) v.forEach(n => { if (load[n] != null) load[n]++; }); });

    for (const post of d.posts.filter(p => p.mode === 'daily' && !p.from && which(p))) {
      const onPost = {};
      d.people.forEach(n => onPost[n] = 0);
      d.days.forEach(ymd => segsFor(d, ymd, post).forEach((seg, i) =>
        (cells[cellKey(ymd, segSlot(i), post.name)] || []).forEach(n => { if (onPost[n] != null) onPost[n]++; })));

      for (const ymd of d.days) {
        const segs = segsFor(d, ymd, post);
        segs.forEach((seg, i) => {
          const k = cellKey(ymd, segSlot(i), post.name);
          const have = (cells[k] || []).slice();
          if (have.length >= post.per) return;
          const busyElsewhere = new Set();
          // every other whole-day block that day, and this post's other blocks
          d.posts.filter(p => p.mode === 'daily').forEach(p =>
            segsFor(d, ymd, p).forEach((s2, j) => {
              if (p.name === post.name && j === i) return;
              (cells[cellKey(ymd, segSlot(j), p.name)] || []).forEach(n => busyElsewhere.add(n));
            }));
          // a standby can't be someone already written into a watch that day
          if (post.exempt) {
            d.posts.filter(p => p.mode === 'slot').forEach(p =>
              d.slots.forEach((_, si) => (cells[cellKey(ymd, si, p.name)] || []).forEach(n => busyElsewhere.add(n))));
          }
          const pool = d.people.filter(n =>
            have.indexOf(n) < 0 && !busyElsewhere.has(n) && !(d.unavailable[n] || []).includes(ymd));
          pool.sort((a, b) => onPost[a] - onPost[b] || load[a] - load[b] || a.localeCompare(b, 'he'));
          while (have.length < post.per && pool.length) {
            const pick = pool.shift();
            have.push(pick); onPost[pick]++; load[pick]++;
          }
          if (have.length) cells[k] = have;
        });
      }
    }
  }

  function autofill(doc, opts) {
    const G = root.SHGen || (typeof require === 'function' ? require('./gen.js') : null);
    let d = sanitise(doc);
    const o = opts || {};
    if (!G || !d.people.length || !d.days.length) return { doc: d, warnings: ['אין מספיק נתונים למילוי'] };

    if (o.only === 'all') {
      // a fed column is not a hand placement, so clearing everything keeps it
      const keep = {};
      Object.keys(d.cells).forEach(k => { const post = k.split('|')[2]; if (isFed(d, post)) keep[k] = d.cells[k]; });
      d.cells = keep;
    }

    const cells0 = Object.assign({}, d.cells);
    fillDaily(d, p => p.exempt, cells0);          // standby first: it removes people from the pool
    d.cells = cells0;

    /* Standby is a full day in gear: those people take no watches, so they are
       simply not available to the scheduler that day. Same mechanism as leave,
       which is exactly what it amounts to as far as the roster is concerned. */
    const unavailable = {};
    Object.entries(d.unavailable).forEach(([n, days]) => unavailable[n] = days.slice());
    d.days.forEach(ymd => exemptOn(d, ymd).forEach(n => {
      (unavailable[n] = unavailable[n] || []).push(ymd);
    }));

    const slotPosts = d.posts.filter(p => p.mode === 'slot' && !p.from).map(p => ({ name: p.name, per: p.per }));
    const args = {
      people: d.people, posts: slotPosts,
      start: startDate(d.days[0]), days: d.days.length,
      slots: d.slots.length ? d.slots : G.slotsEvery('02:00', 4),
      unavailable, preset: presetOf(d),
    };

    /* Nobody knows what a good rest number is, and the honest answer depends on
       how many people showed up this week. So take the largest gap that still
       fills every place, and say what it came out at. */
    let res = null, used = 0;
    const perSlot = slotPosts.reduce((a, p) => a + p.per, 0) || 1;
    const ceiling = Math.max(0, Math.min(Math.floor(d.people.length / perSlot) - 1, 12));
    for (let rest = ceiling; rest >= 0; rest--) {
      const attempt = G.build(Object.assign({}, args, { minRest: rest }));
      const holes = (attempt.warnings || []).some(w => w.indexOf('לא נמצא מי לשבץ') >= 0);
      const short = (attempt.warnings || []).some(w => w.indexOf('מנוחה קצרה') >= 0);
      res = attempt; used = rest;
      if (!holes && !short) break;                     // this gap works; no need to go lower
      if (rest === 0) break;
    }

    const cells = Object.assign({}, d.cells);
    for (const a of res.assignments || []) {
      const ymd = d.days[a.day];
      const si = d.slots.findIndex(s => s.start === a.slot.start && s.end === a.slot.end);
      if (!ymd || si < 0) continue;
      const k = cellKey(ymd, si, a.post);
      const post = d.posts.find(p => p.name === a.post);
      const cur = cells[k] || [];
      if (cur.length >= (post ? post.per : 1)) continue;   // hand-filled: leave alone
      if (cur.indexOf(a.name) >= 0) continue;
      cells[k] = cur.concat(a.name);
    }
    fillDaily(d, p => !p.exempt, cells);          // מטבח and the rest, once the watches are known
    d.cells = cells;
    d = applyFrom(d);                                   // fed columns follow whatever just changed

    const warnings = (res.warnings || []).slice();
    warnings.unshift(used > 0
      ? 'מנוחה בין שמירות: ' + used + ' משמרות (הכי הרבה שאפשר עם ' + d.people.length + ' אנשים)'
      : 'אין מספיק אנשים כדי להבטיח מנוחה בין שמירות. שבץ ידנית את מה שחשוב');
    return { doc: sanitise(d), warnings, fairness: res.fairness, saturated: res.saturated, minRest: used };
  }

  function presetOf(d) {
    // { 'day|slotIndex|post': [names] } in the generator's coordinates
    const out = {};
    d.days.forEach((ymd, di) => {
      d.posts.forEach(p => {
        if (p.mode === 'daily' || p.from) return;
        d.slots.forEach((s, si) => {
          const v = d.cells[cellKey(ymd, si, p.name)];
          if (v && v.length) out[di + '|' + si + '|' + p.name] = v.slice();
        });
      });
    });
    return out;
  }
  function startDate(ymd) {
    const p = parseYMD(ymd);
    return p ? new Date(p.y, p.mo - 1, p.d) : new Date();
  }


  /* ---------- who to call ----------
     A guard at 03:00 needs the officer's number without waking anyone to ask
     for it, so the list lives with the שבצ״ק and everyone in it can see it.
     Accepts a pasted block, one per line, in whatever order people type:
       תומר כהן, מ״פ, 050-1234567
       מ״פ תומר כהן 0501234567
     The phone is found by shape; whatever is left is the name and the role. */
  function parseContacts(text) {
    return String(text || '').split('\n').map(line => {
      const raw = line.trim();
      if (!raw) return null;
      const m = raw.match(/(\+?\d[\d\-\s().]{6,})/);
      const phone = m ? m[1].trim() : '';
      const rest = (m ? raw.replace(m[1], ' ') : raw).replace(/[,;|]+/g, ',').trim();
      const bits = rest.split(',').map(x => x.trim()).filter(Boolean);
      let name = bits[0] || '', role = bits.slice(1).join(' · ');
      if (!role && name) {                       // "מ״פ תומר כהן" with no comma
        const t = name.split(/\s+/);
        const head = t[0] || '';
        const bare = head.replace(/["\u05f4'\u05f3]/g, '');
        /* Only a rank splits off. A short first word is not enough — "בלי מספר
           בכלל" would lose its first word and gain a rank it never had. */
        const rankish = t.length >= 3 && head.length <= 5 &&
          (/["\u05f4'\u05f3]/.test(head) ||
           /^(מפ|סמפ|מכ|סמכ|סמל|רסר|רסב|רסמ|קצין|מפקד|מפלג|חמל|נגד|סגן|סרן|רסן|אלמ|מגד|סמגד)$/.test(bare));
        if (rankish) { role = head; name = t.slice(1).join(' '); }
      }
      return (name || phone) ? { name, role, phone } : null;
    }).filter(Boolean);
  }

  function sanitiseContacts(list) {
    const digits = s => String(s || '').replace(/\D/g, '');
    const seen = new Set();
    return (Array.isArray(list) ? list : []).map(c => ({
      name: String((c && c.name) || '').trim().replace(/\s+/g, ' ').slice(0, 60),
      role: String((c && c.role) || '').trim().replace(/\s+/g, ' ').slice(0, 40),
      phone: String((c && c.phone) || '').trim().replace(/[^\d+\-\s()]/g, '').replace(/\s+/g, ' ').slice(0, 25),
    })).filter(c => {
      if (!c.name && !c.phone) return false;
      if (c.phone && digits(c.phone).length < 7) c.phone = '';   // not a number, drop it
      const k = normKey(c.name) + '|' + digits(c.phone);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 80);
  }
  const contactsToText = list => (list || [])
    .map(c => [c.name, c.role, c.phone].filter(Boolean).join(', ')).join('\n');
  // tel: wants digits only, and Israeli numbers are typed with dashes and spaces
  const telHref = phone => 'tel:' + String(phone || '').replace(/[^\d+]/g, '');



  /* ---------- לוז ----------
     A לוז arrives as a block of text, pasted out of a message:

       לוז ליציאה:
       11:00 אפסון צלמים
       11:30 ארוחת צהריים
       12:25 מסדרי חדרים

     Each line is a moment, not a span. 11:00 אפסון means be there at eleven; at
     11:01 the thing you want to see is 11:30, not a row still insisting it is
     happening. So items carry no length and drop off the list the minute they
     pass. A first line with no clock on it is the title. */
  function parseLuz(text, opts) {
    const o = opts || {};
    const lines = String(text || '').split('\n').map(x => x.trim()).filter(Boolean);
    let title = '';
    const items = [];
    for (const line of lines) {
      const m = line.match(/^(\d{1,2})[:.](\d{2})\s*[-–—.)]?\s*(.*)$/);
      if (!m) { if (!items.length && !title) title = line.replace(/[:：]\s*$/, ''); continue; }
      const h = +m[1], mi = +m[2];
      if (h > 24 || mi > 59) continue;
      const what = m[3].trim();
      if (!what) continue;
      items.push({ h, mi, text: what.slice(0, 120) });
    }
    return { title, items };
  }

  /* ---------- squads ----------
     A פלוגה is not one audience. "בדיקת נשק ב-08:50" is for פיקוד, not for the
     other sixty people, and sending it to everyone is how people learn to
     ignore the notifications. A group is just a named list of roster names,
     kept per שבצ״ק, so it survives the roster being rewritten every week. */
  function sanitiseGroups(list, names) {
    const known = new Map();
    (names || []).forEach(n => known.set(normKey(n), n));
    const seen = new Set();
    return (Array.isArray(list) ? list : []).map(g => {
      const name = String((g && g.name) || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      const inner = new Set();
      const people = ((g && g.people) || []).map(x => String(x || '').trim())
        .map(x => known.size ? (known.get(normKey(x)) || x) : x)
        .filter(x => {
          const k = normKey(x);
          if (!x || inner.has(k)) return false;
          // if we know the roster, a group may only contain people who are in it
          if (known.size && !known.has(k)) return false;
          inner.add(k); return true;
        }).slice(0, 400);
      return { name, people };
    }).filter(g => {
      const k = normKey(g.name);
      if (!g.name || !g.people.length || seen.has(k)) return false;
      seen.add(k); return true;
    }).slice(0, 30);
  }
  // does this person fall inside the audience a message was sent to?
  function inAudience(to, person) {
    if (!to || to.kind !== 'people') return true;
    const k = normKey(person || '');
    return !!k && (to.names || []).some(n => normKey(n) === k);
  }

  /* ---------- convenience used by the wizard ---------- */
  function daysFrom(startYMD, n) {
    const out = [];
    for (let i = 0; i < Math.max(1, n); i++) out.push(addDays(startYMD, i));
    return out;
  }

  const api = { normKey, zonedEpoch, parseLuz, sanitiseGroups, inAudience, emptyDoc, segsFor, segSlot, segKey, applyFrom, exemptOn, parseContacts, sanitiseContacts, contactsToText, telHref, sanitise, compile, preview, audit, autofill, daysFrom, addDays, dayLabel, cellKey, parseYMD, ymdOf, TAB };
  root.SHNative = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
