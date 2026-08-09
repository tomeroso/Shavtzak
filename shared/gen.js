/* ============================================================
   שבצ"ק builder — names + posts in, a fair roster out.
   Pure and deterministic: same input, same output.
   ============================================================ */
(function (root) {
  'use strict';

  const pad = n => String(n).padStart(2, '0');
  const hm = ({ h, m }) => pad(h) + ':' + pad(m);
  const parseHM = v => {
    const x = String(v || '').match(/^(\d{1,2}):(\d{2})$/);
    return x && +x[1] <= 24 && +x[2] < 60 ? { h: +x[1], m: +x[2] } : null;
  };
  const DAYS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  // ה׳ for חמישי and ש׳ for שבת — not the first letter of the word
  const DAY_LETTER = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

  /* slots of a fixed length starting at a given hour, wrapping a full day */
  function slotsEvery(startHM, hours) {
    const s = parseHM(startHM) || { h: 0, m: 0 };
    const n = Math.max(1, Math.round(24 / hours));
    const out = [];
    let cur = s.h * 60 + s.m;
    for (let i = 0; i < n; i++) {
      const a = cur % 1440, b = (cur + hours * 60) % 1440;
      out.push({ start: hm({ h: Math.floor(a / 60), m: a % 60 }), end: hm({ h: Math.floor(b / 60), m: b % 60 }) });
      cur += hours * 60;
    }
    return out;
  }

  const isNight = slot => {
    const s = parseHM(slot.start);
    return !!s && (s.h >= 22 || s.h < 6);
  };

  /* ------------------------------------------------------------
     build({ people, posts, start, days, slots, minRest, unavailable })
       people      ['תומר כהן', ...]
       posts       ['שער', {name:'סיור', per:2}, ...]
       start       Date (day 1)
       days        how many days
       slots       [{start:'02:00', end:'06:00'}, ...]
       minRest     how many slots off between shifts (default 2)
       unavailable { 'תומר כהן': ['2026-08-06'] }  // whole days off
       preset      { '<day>|<slotIndex>|<post>': ['name', ...] }
                   assignments that already exist and must not move — the
                   editor's hand-placed people. They count towards everyone's
                   load so the generator schedules around them fairly.
     ------------------------------------------------------------ */
  function build(opts) {
    const people = (opts.people || []).map(s => String(s).trim()).filter(Boolean);
    const posts = (opts.posts || []).map(p => typeof p === 'string' ? { name: p.trim(), per: 1 } : { name: String(p.name).trim(), per: Math.max(1, +p.per || 1) })
      .filter(p => p.name);
    const slots = (opts.slots || slotsEvery('02:00', 4));
    const days = Math.max(1, +opts.days || 1);
    const minRest = opts.minRest == null ? 2 : Math.max(0, +opts.minRest);
    const start = opts.start ? new Date(opts.start) : new Date();
    const unavailable = opts.unavailable || {};
    const warnings = [];

    if (!people.length) return { warnings: ['לא הוזנו שמות'], rows: [], stats: [], assignments: [] };
    if (!posts.length) return { warnings: ['לא הוזנו עמדות'], rows: [], stats: [], assignments: [] };

    const perSlot = posts.reduce((a, p) => a + p.per, 0);
    if (perSlot > people.length) warnings.push('אין מספיק אנשים למלא את כל העמדות בו-זמנית');

    /* Saturation check. With a minimum rest of R slots each person can work at
       most every R+1 slots, so the roster can only sustain people/(R+1) at a
       time. Hit that exactly and the schedule collapses into fixed groups that
       land on the same hours every day — the same person gets 02:00 forever and
       no scheduler can prevent it. Say so instead of quietly producing it. */
    const capacity = people.length / (minRest + 1);
    const saturated = perSlot >= capacity - 1e-9;
    if (saturated) {
      const need1 = Math.ceil(perSlot * (minRest + 1)) + 1;
      warnings.push('לו״ז צפוף: ' + people.length + ' אנשים, ' + perSlot +
        ' תקנים בכל משמרת ומנוחה של ' + minRest + '. ככה כל אחד ייתקע באותן שעות בכל יום. צריך ' +
        need1 + ' אנשים כדי לסובב את הלילות, או מנוחה קטנה יותר.');
    }

    const st = {};
    people.forEach((p, i) => { st[p] = { count: 0, night: 0, last: -999, order: i, byPost: {} }; });

    /* Fixed placements are seeded into everyone's counters before the greedy
       starts, so a person who was hand-placed four times isn't then handed four
       more. They are never re-assigned and never traded away. */
    const preset = opts.preset || {};
    const fixedAt = {};                                  // 'day|slot|post' -> [names]
    for (const [k, v] of Object.entries(preset)) {
      const names = (v || []).filter(n => st[n]);
      if (!names.length) continue;
      fixedAt[k] = names;
      const post = k.split('|')[2];
      const si = +k.split('|')[1];
      const night = isNight(slots[si] || slots[0] || { start: '00:00' });
      names.forEach(n => {
        st[n].count++; if (night) st[n].night++;
        st[n].byPost[post] = (st[n].byPost[post] || 0) + 1;
      });
    }

    const dayKey = d => {
      const x = new Date(start); x.setDate(x.getDate() + d);
      return { date: x, ymd: x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate()),
               label: DAY_LETTER[x.getDay()] + ' ' + x.getDate() + '.' + (x.getMonth() + 1) };
    };

    const assignments = [];
    let gi = 0;                                        // global slot index
    for (let d = 0; d < days; d++) {
      const dk = dayKey(d);
      for (let si = 0; si < slots.length; si++, gi++) {
        const slot = slots[si];
        const night = isNight(slot);
        const takenThisSlot = new Set();

        // hand-placed people occupy their spot before anyone else is considered
        for (const post of posts) {
          for (const n of (fixedAt[d + '|' + si + '|' + post.name] || [])) {
            if (takenThisSlot.has(n)) continue;
            takenThisSlot.add(n);
            st[n].last = gi;
            assignments.push({ day: d, dayLabel: dk.label, ymd: dk.ymd, gi, slot, post: post.name, name: n, fixed: true });
          }
        }

        for (const post of posts) {
          const already = (fixedAt[d + '|' + si + '|' + post.name] || []).length;
          for (let k = already; k < post.per; k++) {
            let pick = null;
            // relax the rest requirement rather than leaving a hole
            for (let rest = minRest; rest >= 0 && !pick; rest--) {
              const pool = people.filter(p =>
                !takenThisSlot.has(p) &&
                !(unavailable[p] || []).includes(dk.ymd) &&
                gi - st[p].last > rest);
              if (!pool.length) continue;
              pool.sort((a, b) => {
                const A = st[a], B = st[b];
                /* On a night slot, night-count leads: nobody cares that the load
                   is even if they personally get every 02:00. On a day slot, load
                   leads and the night-heavy go first, so they're busy in daylight
                   and not the only ones rested when 02:00 comes round again. */
                if (night) {
                  if (A.night !== B.night) return A.night - B.night;
                  if (A.count !== B.count) return A.count - B.count;
                } else {
                  if (A.count !== B.count) return A.count - B.count;
                  if (A.night !== B.night) return B.night - A.night;
                }
                const ap = A.byPost[post.name] || 0, bp = B.byPost[post.name] || 0;
                if (ap !== bp) return ap - bp;                                 // vary the post
                if (A.last !== B.last) return A.last - B.last;                 // longest rested
                return A.order - B.order;
              });
              pick = pool[0];
              if (rest < minRest && pick) warnings.push('מנוחה קצרה מהמבוקש ב' + dk.label + ' ' + slot.start);
            }
            if (!pick) { warnings.push('לא נמצא מי לשבץ: ' + dk.label + ' ' + slot.start + ' · ' + post.name); continue; }
            takenThisSlot.add(pick);
            const s2 = st[pick];
            s2.count++; s2.last = gi; if (night) s2.night++;
            s2.byPost[post.name] = (s2.byPost[post.name] || 0) + 1;
            assignments.push({ day: d, dayLabel: dk.label, ymd: dk.ymd, gi, slot, post: post.name, name: pick });
          }
        }
      }
    }

    /* Greedy commits early, so night counts end up lopsided even when there is
       room to do better. Trade shifts after the fact: give one of the
       night-heaviest person's nights to the night-lightest, and hand back a day
       shift, keeping rest and double-booking rules intact. */
    repairNights(assignments, people, slots, minRest, unavailable);

    // recount after the repair pass
    people.forEach(p => { st[p].count = 0; st[p].night = 0; });
    assignments.forEach(a => { st[a.name].count++; if (isNight(a.slot)) st[a.name].night++; });

    // grid shaped like a normal שבצ"ק: יום | שעה | one column per post
    const header = ['יום', 'שעה'].concat(posts.map(p => p.name));
    const rows = [header];
    for (let d = 0; d < days; d++) {
      const dk = dayKey(d);
      for (let si = 0; si < slots.length; si++) {
        const slot = slots[si];
        const row = [si === 0 ? dk.label : '', slot.start + '-' + slot.end];
        for (const post of posts) {
          row.push(assignments
            .filter(a => a.day === d && a.slot === slot && a.post === post.name)
            .map(a => a.name).join(', '));
        }
        rows.push(row);
      }
    }

    const idle = people.filter(p => !st[p].count);
    if (idle.length) warnings.push('יש יותר אנשים מהנדרש. ' + idle.length +
      ' לא שובצו בכלל (' + idle.slice(0, 3).join(', ') + (idle.length > 3 ? '…' : '') + ')');

    const counts = people.map(p => st[p].count);
    const stats = people.map(p => ({ name: p, count: st[p].count, night: st[p].night }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'he'));

    return {
      rows, assignments, stats, warnings: [...new Set(warnings)],
      saturated,
      fairness: {
        min: Math.min.apply(null, counts), max: Math.max.apply(null, counts),
        spread: Math.max.apply(null, counts) - Math.min.apply(null, counts),
        nightMin: Math.min.apply(null, people.map(p => st[p].night)),
        nightMax: Math.max.apply(null, people.map(p => st[p].night)),
        total: assignments.length, used: people.length - idle.length, people: people.length,
      },
    };
  }

  function repairNights(assignments, people, slots, minRest, unavailable) {
    const giList = name => assignments.filter(a => a.name === name).map(a => a.gi).sort((x, y) => x - y);
    const restOk = list => {
      for (let i = 1; i < list.length; i++) if (list[i] - list[i - 1] <= minRest) return false;
      return true;
    };
    const busyAt = (name, gi) => assignments.some(a => a.name === name && a.gi === gi);
    const freeOn = (name, ymd) => !(unavailable[name] || []).includes(ymd);

    for (let iter = 0; iter < 400; iter++) {
      const nights = {};
      people.forEach(p => { nights[p] = 0; });
      assignments.forEach(a => { if (isNight(a.slot)) nights[a.name]++; });
      const sorted = people.slice().sort((a, b) => nights[b] - nights[a]);
      if (nights[sorted[0]] - nights[sorted[sorted.length - 1]] <= 1) return;

      // Try every over-loaded / under-loaded pair, not just the two extremes:
      // one blocked pair says nothing about the rest.
      let swapped = false;
      outer:
      for (const hi of sorted) {
        for (let j = sorted.length - 1; j >= 0; j--) {
          const lo = sorted[j];
          if (nights[hi] - nights[lo] <= 1) continue;
          const mine = assignments.filter(a => a.name === hi && !a.fixed && isNight(a.slot));
          const theirs = assignments.filter(a => a.name === lo && !a.fixed && !isNight(a.slot));
          for (const a of mine) {
            for (const b of theirs) {
              if (a.gi === b.gi) continue;
              if (busyAt(lo, a.gi) || busyAt(hi, b.gi)) continue;
              if (!freeOn(lo, a.ymd) || !freeOn(hi, b.ymd)) continue;
              const hiNew = giList(hi).filter(g => g !== a.gi).concat(b.gi).sort((x, y) => x - y);
              const loNew = giList(lo).filter(g => g !== b.gi).concat(a.gi).sort((x, y) => x - y);
              if (!restOk(hiNew) || !restOk(loNew)) continue;
              a.name = lo; b.name = hi;
              swapped = true; break outer;
            }
          }
        }
      }
      if (!swapped) return;                 // nothing legal left to trade
    }
  }

  const toTSV = rows => rows.map(r => r.join('\t')).join('\n');
  const toCSV = rows => rows.map(r => r.map(c => /[",\n]/.test(c || '') ? '"' + String(c).replace(/"/g, '""') + '"' : (c || '')).join(',')).join('\n');

  const api = { build, slotsEvery, toTSV, toCSV };
  root.SHGen = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
