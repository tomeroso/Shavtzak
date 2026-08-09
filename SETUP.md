# שבצ״ק — setup

Roughly 20 minutes, mostly waiting on Google's console. Do it once; after that
you and everyone else sign in a single time, ever.

---

## What you're deploying

One Cloudflare Worker. It serves the app **and** holds the only credential that
touches the sheet.

```
your phone ──sign in once──▶ Worker ──refresh token──▶ Google Sheets API
   ▲                            │
   └──── push notification ─────┘   (cron, every 5 min: read → diff → push)
```

The sheet stays private. It is never published, never given a public link.

**Or no sheet at all.** A שבצ״ק can also be built and kept inside the app — see
[שבצ״ק בתוך האפליקציה](#שבצק-בתוך-האפליקציה). It compiles to the exact same
internal shape a parsed Google Sheet does, so search, "who's on now", reminders,
change notifications and the leaderboard all work on it without knowing the
difference. The only thing that changes is where the truth lives.

**No user cap, and no consent warning for anybody.**

Google caps unverified apps at 100 lifetime consents to a *sensitive* scope.
`spreadsheets.readonly` is sensitive. **`drive.file` is not** — Google classifies
it non-sensitive/"recommended", and the Sheets API accepts it for the files a
user hands over, `includeGridData` included. So this app requests
`openid email profile` + `drive.file` and hits **no cap, no unverified-app
screen, and no verification requirement**, for every user including the ones who
connect sheets.

It's also less access than before: the worker can only read spreadsheets someone
deliberately chose in the Picker, not every sheet in their Drive.

| | scope | cap | warning | how they get in |
|---|---|---|---|---|
| connects a שבצ״ק | `drive.file` (non-sensitive) | **none** | none | picks the file from their Drive |
| everyone else | profile only | **none** | none | invite link, or paste the link and get approved |

Anyone who already granted the old `spreadsheets.readonly` keeps working — their
refresh token is untouched, and nothing needs migrating.

Invite links burn on first use and bind to the account that opened one, so a
leaked link costs one seat, not the roster. The Members screen lists everyone who
joined and revokes them in one tap. Anyone who *did* grant the Sheets scope stays
gated on the real ACL as well — remove them in Sheets and they're out within a day.

---

## 0. You need the Workers Paid plan ($5/month)

Not optional. The Workers **Free** plan allows **10 ms of CPU per invocation**,
and parsing a workbook the size of yours costs ~37 ms. Every scheduled poll would
die with Error 1102 — silently, since nobody is watching the cron. Free also caps
KV at 1,000 writes/day and 50 subrequests per invocation, which is roughly 25
sheets per tick.

Paid raises CPU to 30 s per cron, KV to 1M writes/month, and subrequests to
10,000. At $5/month it covers far more than this app will ever use.

## 1. Cloudflare

```bash
npm install
npx wrangler login
npx wrangler kv namespace create SH
```

Put the printed `id` into `wrangler.toml` under `[[kv_namespaces]]`.

## 2. Google OAuth client

<https://console.cloud.google.com> → new project →

- **APIs & Services → Library** → enable **Google Sheets API**
- The console now calls this **Google Auth Platform**. Fill the wizard
  (app name `Shavtzak`, your email, **External**), then:
  - **Data Access** → add `https://www.googleapis.com/auth/spreadsheets.readonly`
  - **Audience** → **Publish app**. Do not stay in Testing: Google expires
    refresh tokens after 7 days there, which would stop the polling every week.
    Publishing is self-serve and needs no review. It also removes the test-user
    list, so you collect nobody's email.
  - Ignore the "your app requires verification" banner and do **not** submit for
    review. It's the normal state for an unverified sensitive scope.
  - Only people who *add* a sheet see the "Google hasn't verified this app"
    screen (Advanced → Go to Shavtzak). Everyone else never does.
- **Credentials → Create credentials → OAuth client ID → Web application**
  - Authorized JavaScript origins: `https://shavtzak.<your-subdomain>.workers.dev`
  - Authorized redirect URIs: leave empty (popup flow uses `postmessage`)

Copy the client ID into `wrangler.toml` (`GOOGLE_CLIENT_ID`), then:

```bash
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

## 3. Google Picker

Connecting a *new* sheet goes through Google's own file picker; that's what
grants `drive.file` access to that one spreadsheet.

- Cloud console → **APIs & Services → Library → Google Picker API → Enable**
- **Credentials → Create credentials → API key**. Restrict it: Application
  restrictions → Websites → add `https://shavtzak.<subdomain>.workers.dev/*`.
  Put it in `wrangler.toml` as `PICKER_API_KEY`.
- Cloud console home page → copy the **Project number** (digits, not the project
  ID) into `GOOGLE_PROJECT_NUMBER`. The Picker uses it as the App ID, and
  **without it a pick silently grants nothing** — the classic failure here.
- **Data Access** → the only scope you need now is
  `https://www.googleapis.com/auth/drive.file`. You can drop
  `spreadsheets.readonly`.

## 4. Push keys

```bash
npx web-push generate-vapid-keys
```

Public key → `VAPID_PUBLIC` in `wrangler.toml`.
Private key → `npx wrangler secret put VAPID_PRIVATE`.
Set `VAPID_SUBJECT` to `mailto:` + your email.

## 5. Deploy

```bash
npm run deploy
```

`npm run check` runs first and refuses to deploy while anything above is still a
placeholder, naming the exact command that fixes each one. Run it on its own any
time to see what's left.

Open the URL, sign in, then **בחר מ-Google Drive** and pick the שבצ״ק. Google
asks for access at that moment — to that file only — and that's the consent that
hands the worker its long-lived token. From then on it polls on its own, forever,
whether or not anyone has the app open.

Pasting a link still works for *joining* a sheet that's already connected; it's
only a brand-new sheet that has to come through the Picker.

You can add as many שבצ״קים as you like; they appear as tabs across the top and
each remembers which name is yours.

---

## When a parser fix doesn't seem to do anything

Deploying a corrected parser is not enough on its own, and this bit us once.

The worker hashes each sheet's raw response and skips the whole parse when the
hash is unchanged — that is what keeps the cost near zero. But it means a
*parser* fix only reaches שבצ״קים that somebody edits afterwards. Deploy, refresh,
and the wrong reading is still sitting there, because the sheet itself hasn't
changed.

`SHParse.REV` in `shared/parse.js` is part of the cache key. Raising it forces
one full re-read and re-parse of every sheet, and the result is marked as a
rebuild so nobody gets a notification about shifts that only "changed" because
we read them properly. `npm test` fails if `parse.js` changes and `REV` doesn't:

```
parse.js changed but SHParse.REV is still 2.
   Raise REV in shared/parse.js, then run: npm run parser:rev
```

**בדוק עכשיו** in the app now also forces a real re-read rather than accepting
the cached hash, so there is always a way out without a deploy.

## Updating everyone

There is no app store and nothing for anyone to install again. `npm run deploy`
and every person is on the new version — the "app" on their home screen is a
shortcut to your worker.

When they actually see it:

- **App closed, reopened** → new version, immediately.
- **App left open** → within 15 minutes a green **יש גרסה חדשה · רענן** bar
  appears at the bottom. Reopening the app also picks it up on its own, since
  there's no unsaved state to lose.

Each build stamps a hash into the page, into `build.txt` and into the service
worker cache name. The running app compares itself against `build.txt`, so it
can tell that the server moved on instead of quietly running last week's code.

**One-time catch for anyone who installed before this build.** The old service
worker cached the page *cache-first*, which means it can serve the old shell even
after you deploy. The new one replaces it automatically, but that swap happens on
one launch and the new page appears on the next — so a few people may need to
open the app twice. If someone is still stuck after that: ⚙ → any error screen
has **נקה מטמון ואתחל**, or they can delete the home-screen icon and re-add it.
Their account and their name survive either way; it's all server-side.

**What to check after a deploy:** open
`https://shavtzak.tomereasy.workers.dev/api/config` — the `version` field tells
you the worker updated, and `build.txt` tells you the front-end did.

## The two demos

`npm run demo` writes two self-contained files. Both open straight from disk —
no server, no Google, no install — and everything they do stays in that browser.

- **demo.html** — the app on real roster data, dates slid onto today so it's
  always live. For showing someone what the app *is*.
- **demo-builder.html** — opens directly into the editor of a שבצ״ק built inside
  the app, already using the awkward post types: כרמל א as a four-man כוננות,
  כרמל ב fed from whoever came off at 06:00, מטבח carrying into an empty day.
  Tap a name then another to swap them, open עמדות to see how each one is
  configured, בעיות to see what it checks. For deciding whether the builder is
  good enough to use.

## Two screens, not one

Settings had grown to fifteen sections, most of which a normal soldier can do
nothing with — and a screen that long reads as "this app is complicated" even
when the three things he needs are at the top.

- **הגדרות** is now his: notifications, the pre-shift reminder, nicknames, his
  rosters, second device, install, tools. Seven sections.
- **ניהול השבצ״ק** is one button, shown only to admins, and holds everything
  else: members, requests, invites, the group link, מצב פתוח, squads, messages
  and לוז, the contact list, column rules, and the editor.

Whether the button appears at all is decided by one cheap call. A member who
can't use any of it is never shown a locked room.

## איך זה עובד — the guide

הגדרות → **איך זה עובד**, and offered once on the main screen the first time
somebody picks their name. Five short sections: what the big card is telling you
and what the three colours mean, how to search your own name, the two different
notifications (and, on an iPhone, that installing is a precondition), what else
is on the screen, and — the one people skip and shouldn't — **what the app is
not**. It reads the שבצ״ק; it does not change it, swap your watch or tell your
commander. Somebody who assumes otherwise finds out at the worst moment.

## Sending it to people

Two ways in, and the lazy one is the correct one.

**They paste the sheet link.** This is what people will actually do — it's easier
than chasing you for an invite. Because the שבצ״ק is already connected, the app
does *not* ask them for Google Sheets permission. It turns into a join request,
you get a push, you tap אשר in Settings, and their app opens by itself. No seat
burned, no unverified-app screen.

That matters: every person who grants the Sheets scope consumes one of Google's
permanent, non-resettable 100. If everyone self-connected the same sheet, you'd
hit the cap at 100 users and each of them would have seen the scary screen. Only
the *first* person to connect a given שבצ״ק ever needs that permission.

**Or you hand out invite links.** Settings → **צור קישורים** → one link per
person. They open it, sign in, type their name, done — no approval step. Each
link burns on first use and binds to whoever redeemed it.

**Or one link for the whole group.** Settings → **קישור קבוצתי** → שעה / 24 שעות
/ שבוע, optionally with a cap on how many people it lets in. You get a single
link you can paste once into the platoon's WhatsApp; everyone who opens it is in,
no approval. It closes itself when the clock runs out — there is deliberately no
"never expires" option, and you can kill it early with **בטל קישור**. The card
shows how long is left and how many have joined. Creating a new one invalidates
the previous link.

**A link can put people in a squad.** Pick one under מצרף אוטומטית לקבוצה when
you create the link, and whoever joins through it is added to that squad the
moment they choose their name — you can't add them at redeem time, because they
haven't said who they are yet. Hand the פיקוד link to פיקוד and the group builds
itself.

Which of the three to use: one person joining → invite link. A whole group at
once → קישור קבוצתי. Everyone already has the *sheet* link and you just want to
stop approving requests for an hour → מצב פתוח.

Installing: Settings → **איך מוסיפים למסך הבית** gives step-by-step instructions
for whatever device they're on — iPhone/Safari, iPhone with the wrong browser,
Android, or desktop — and on Android it triggers the real install prompt. There's
also a one-time nudge on the main screen that can be dismissed. On iPhone it says
plainly that installing is a *condition* for notifications, because Apple won't
push to a Safari tab.

Second device: Settings → **צור קוד העברה** → type the code on the new device.
No second sign-in.

## שבצ״ק בתוך האפליקציה

Most units don't keep a שבצ״ק in Google Sheets at all. So the app can own one.

**Creating.** A new user with nothing yet is offered this first, before the
paste-a-link box: הגדרות → **צור שבצ״ק חדש כאן**, or the button on the join
screen. You give it a name, the people (one per line), the posts, a start date,
how many days, shift length and minimum rest. Post lines take two modifiers:

| you write | you get |
|---|---|
| `שער ראשי` | one person per shift |
| `סיור x2` | two people together, every shift |
| `מטבח @07:00-23:59` | one block a day that everyone on it shares, ignoring the shift rows |

That last one is how מטבח, כוננות and קצין מוצב actually work, and it's the
thing a spreadsheet expresses badly. Choose **שבץ אוטומטית** and it comes out
filled and balanced; choose **השאר ריק** and you get an empty grid to fill by
hand.

**Editing — the part that matters.** A שבצ״ק is never right the first time.
הגדרות → **פתח את העורך**, then:

- **Tap a name, tap another name → they swap.** Tap a name, tap **כאן** in an
  empty place → they move there. This is deliberately tap-tap rather than drag:
  dragging inside a scrolling table on a phone fights the scroll.
- **+** in an empty place opens a picker sorted by who has the fewest shifts, with
  each person's load and night count on the row, and a warning next to anyone
  already busy that shift or on a day off.
- **מלא חורים** runs the generator over the empty places only — everything you
  placed by hand is treated as fixed and counts towards that person's load, so it
  schedules *around* you instead of undoing your work. **בנה הכל מחדש** starts over.
- **↺** undoes, up to 40 steps back.
- **אנשים** adds and removes people and marks days someone is away (גימלים,
  חופש). An away day is a hard constraint for the filler, not a suggestion.
- **עמדות** adds, removes and reshapes posts, changes shift length, and adds days
  a week at a time.
- **בעיות** lists everything wrong right now — empty places, someone rostered
  twice in one shift, rest shorter than you asked for, someone on a day they're
  away — and each row jumps to that day in the grid.

**Saving publishes.** שמור ופרסם diffs the new roster against the old one and
pushes to exactly the people whose own shifts changed — the same code path a
Google Sheets change goes through, minus the wait: a Sheets edit takes up to five
minutes to be noticed, an in-app edit notifies immediately. Two admins editing at
once can't clobber each other; the second save is refused with "מישהו אחר ערך את
השבצ״ק בינתיים" rather than silently winning.

Everything else works unchanged: invite links, קישור קבוצתי, מצב פתוח, roles,
ownership transfer, reminders, the leaderboard. A native שבצ״ק has no Google
Sheet behind it, so the cron poller skips it entirely — there is nothing to poll.

## The post types a real מוצב needs

A שבצ״ק is not a grid of interchangeable slots, and the builder now says so.
Every post in the editor's **עמדות** tab has its own settings:

| setting | what it means | example |
|---|---|---|
| לפי משמרות / כל היום | one row per slot, or a single block covering the day | שער vs מטבח |
| כמה | how many people at once | `סיור` ×2 |
| כוננות | on it all day, in gear — and **gets no watches that day** | כרמל א ×4 |
| ממשיך ליום ריק | if the next day's column is blank, the same people continue | מטבח Fri→Sat |
| מאויש ממי שיורד משמירה | filled from whoever came off chosen posts at a chosen hour | כרמל ב |

**A whole-day post is not always one block.** כרמל א turns over every day and
often twice in a day, at whatever hour was decided that morning. In the שיבוץ
grid each whole-day post has its own row of blocks: **פצל את היום** cuts the last
one in half, each block carries its own hours and its own people, and dragging a
changeover moves *both* sides of it — editing one end and leaving a two-hour hole
in the day is never what anyone meant by "they switch at eight". A day nobody
splits stays exactly as simple as it was.

**כוננות is a scheduling constraint, not a label.** Its four people are taken
out of the pool for that day before the watch roster is built, because deciding
it afterwards would mean tearing the day up again. If somebody hand-places one
of them on a gate anyway, בעיות says so by name — that's the mistake this roster
makes most often, since the two columns look unrelated.

**A fed column belongs to its rule.** כרמל ב is "whoever just came off", so it
is recomputed every time anything upstream moves and can't be typed into — the
thing you edit is the rule: which posts feed it, and at what hour. A shift that
runs 22:00–02:00 counts as coming off at 02:00 the *next* morning, which is
handled. What it can't do is decide *which* of the outgoing crew; it takes all
of them.

**Watches and תורנויות are counted separately** everywhere — `5 שמירות · 3
תורנויות · 4 לילה`. Four days of כרמל א is not four nights on the gate and the
numbers shouldn't pretend otherwise.

## Rest between watches is chosen for you

There is no "minimum rest" box any more. The filler takes the **largest gap that
still fills every place** and tells you what it managed:

```
מנוחה בין שמירות: 3 משמרות (הכי הרבה שאפשר עם 18 אנשים)
```

Nobody knows the right number in advance — it depends entirely on how many
people turned up this week. When there aren't enough people to guarantee any gap
it says that instead, and leaves the hard parts for you to place by hand, which
is what happens anyway.

## בנה טבלה להעתקה ל-Sheets

The older tool, for people who *do* keep the roster in a spreadsheet and just
want the maths done: it produces a grid to paste into Sheets, and creates nothing
inside the app. If you want the שבצ״ק to live here, use the section above instead.

Settings → **כלים** → בנה טבלה להעתקה ל-Sheets. Names one per line, posts one per line
(`סיור x2` = two people on that post), how many days, shift length, start hour,
and minimum rest in shifts. **מלא מהשבצ״ק הקיים** pulls the names from the sheet
you're already connected to.

It balances two things at once: total shifts per person, and **night shifts per
person** — the one people actually argue about. A greedy pass builds the roster,
then a repair pass trades shifts between the night-heaviest and night-lightest
until neither can legally give one up. On 15 people over 6 days that lands 9–10
shifts and 3–4 nights each, which is mathematically optimal.

**It tells you when the maths is against you.** With 12 people, 4 posts to fill
and a rest of 2, every person can only work every 3rd slot — so the roster
collapses into 3 fixed groups and the same people get 02:00 every single night,
forever. No scheduler can avoid that. It says so, and tells you how many people
you'd need to break the cycle.

The app has **read-only** Google permission and it stays that way, so it can't
write into your sheet. **העתק ל-Sheets** puts the grid on the clipboard as tab-
separated text — click the top-left cell in Sheets and paste, it lands as a
proper grid. Or download CSV. The output is shaped exactly like a normal שבצ״ק
(יום | שעה | one column per post) and round-trips back through the parser, which
is a test.

## Turning notifications on

The app asks by itself. Once someone has picked their name, a card offers
**להפעיל התראות?** — one tap opens the real browser dialog, and accepting also
sets a **15-minute pre-shift reminder**, because permission with no reminder
configured would only cover roster changes.

It asks *in the app first* rather than firing the browser prompt on load. A cold
prompt that gets dismissed is often unrecoverable — Chrome and Safari both hold
that against the site — so the soft ask protects the one chance you get.
Declining hides it for 3 days.

It stays quiet when it should: before a name is chosen, when permission is
already granted or already denied, and on an iPhone that hasn't been installed to
the home screen (where the install prompt shows instead, since iOS won't deliver
push to a Safari tab at all).

If someone blocked it, Settings tells them exactly where to undo that — Chrome's
padlock menu, or iPhone Settings → Notifications → שבצ״ק — because the app can
never re-prompt after a block.

Existing permission is re-registered silently on every launch, so a reinstall or
a cleared browser profile doesn't quietly leave someone subscribed-in-name-only.

## הודעה לכולם

הגדרות → **הודעה** (admins only). Everyone in the שבצ״ק gets a push, and
the message also sits on the main screen until each person taps הבנתי, because
the people who most need to see "בדיקת נשק ב-08:50" are exactly the ones with
notifications off.

**Who gets it.** A chip row above the box: **כולם**, one of your squads, or
**בחר אנשים** for a hand-picked set. A פלוגה is not one audience — "בדיקת נשק
ב-08:50" is for פיקוד, not for the other sixty people, and sending everything to
everyone is how a unit learns to ignore the notifications.

Squads are set up in הגדרות → **קבוצות**: name it, then pick the people. The
picker has a search box, a running count and **בחר את כל התוצאות**, because
פיקוד is forty names out of a hundred and fourteen and ticking those one at a
time is a punishment. A group is a list of roster names, so it survives the
שבצ״ק being rewritten every week, and it's resolved at send time — add someone to
פיקוד today and tomorrow's message reaches them.

A targeted message is filtered **on the server**. It never reaches the app of
someone it wasn't for, rather than being hidden there. The banner tells the
recipient which audience it was — `הודעה מאלון · לפיקוד`.

**Give it an hour and it stops being a message.** Tick *יש לזה שעה*, pick a date,
time and length, and it lands in everybody's day as an event — a row in הבאים
בתור, and a reminder at whatever lead time each person set for their watches.

Except for the people who are standing a watch across it. They cannot be in two
places, so it is not added to their list; the message still reaches them, and
their banner says why — `מחר ב-10:30 · אתה בשמירה אז`. That's computed against
the live roster in each person's app, so it stays right when the שבצ״ק moves.

Up to 200 characters. One message per 45 seconds unless you confirm — a stuck
finger must not become thirty pushes. **הסר הודעה קיימת** takes it off the main
screen without sending anything.

This deliberately does not read your WhatsApp group; nothing can, short of being
a WhatsApp client. It solves the same problem from the other end: the message
goes somewhere that buzzes, and the app knows who's actually in the unit.

## לוז — paste the whole thing

הגדרות → **לוז**. Paste it exactly as it arrived:

```
לוז ליציאה:
11:00 אפסון צלמים
11:30 ארוחת צהריים
12:25 מסדרי חדרים עומדים שטופים
12:40 תדרוך
```

Pick the date, and every line becomes an item in everyone's day.

**An item is a moment, not a span.** `11:00 אפסון` means be there at eleven; at
11:01 the thing you need to see is 11:30, so the eleven o'clock row drops off
rather than sitting there claiming to still be happening. Nothing has a length
and nothing asks you for one. A first line with no clock on it becomes the tag on
each row (`לוז ליציאה`), and a preview shows exactly what will be created before
you send.

It goes to whoever is selected in the audience chips above — everyone, a squad,
or hand-picked. Same on-watch rule as any event: an item is left out of the day
of anyone standing a watch at that exact moment. **בשקט, רק ביומן** publishes without a push,
for a לוז you don't want to wake people for.

## Adding something to your own day

Anyone can. On the main screen, **+ הוסף לעצמי** next to הבאים בתור: what it is
and when. It shows only to you, in orange, tagged אישי, and it reminds you the
same way a watch does. Tap it to delete it.

Personal notes are stored under their own key per person and never enter the
shared roster payload — nobody else's app ever receives them. They're also the
one kind of item that is *not* hidden when you're on watch at that hour: you
wrote it knowing, and it's not the app's business to argue.

## מפקדים וקצינים — the numbers to call

הגדרות → **מפקדים וקצינים**. Paste the list, one per line:

```
תומר כהן, מ״פ, 050-1234567
מ״פ אלון מזרחי 0521112222
יוסי לוי | סמ״פ | +972-54-333-4444
חמ״ל 04-9876543
```

Order doesn't matter — the phone number is found by shape and whatever's left is
the name and the role. A rank at the front splits off on its own (`מ״פ`, `סמל`,
`רס״ר`…), but only a real rank: "בלי מספר בכלל" keeps all three words.

**The list appears at the bottom of מי בשמירה עכשיו, for everyone in the שבצ״ק,
and one tap dials.** That's the point: whoever is at the gate at 03:00 shouldn't
have to wake somebody up to ask for a number. Only an admin can edit it. For a
שבצ״ק built in the app there's also an **אנשי קשר** tab in the editor, and the
wizard takes the list while you're creating it.

The numbers live beside the שבצ״ק, not inside it, so they don't touch the Google
Sheet and they're removed with the שבצ״ק when the last member leaves.

## תזכורת לפני שמירה

Settings → **תזכורת לפני שמירה** → 5 / 15 / 30 / 60 דק׳, each person picks their
own. A push arrives before the shift starts with the times, the post and who's
on with them, whether or not the app is open.

The reminder sweep runs every cron tick for everyone subscribed — independent of
the polling round-robin, because a late reminder is worthless. Each shift fires
at most once per person.

On iPhone this only works if the app was added to the home screen; Apple doesn't
deliver web push to a plain Safari tab.

## מי בשמירה עכשיו

The people icon in the top bar. Every post, who's on it right now, when they come
off, and who's next — with unmanned posts flagged in amber and pushed to the top.
Tap a post to jump to that person's card.

Worth knowing: an unmanned post usually means the sheet has a gap there, not that
the app missed something. Cross-check with ⚙ → אבחון before treating it as a
parsing bug.

**Same word, two tabs.** Rows are keyed by tab *and* post. A `סיור` in
מבוא דותן is not the `סיור` in תגבצים; merging them produced a single row with
eleven people on it, the end time of whichever shift ran longest, and a "next"
taken from the wrong roster entirely. The tab is printed beside the post name
whenever a שבצ״ק has more than one.

**The number, where you need it.** If somebody currently on watch is also on the
מפקדים וקצינים list, their number is printed next to their name on their own row
— as selectable text you can copy, with a call button beside it. Matched the same
fuzzy way the search box works, so a spelling difference between the roster and
the contact list doesn't hide it.

**מפקדים וקצינים is its own tab** on that screen, once the list has anyone in it:
every officer and NCO, **where each of them is right now**, and the number.
Whoever is on watch comes first (red, with the post and until when), then whoever
is on next, then those with nothing scheduled, then anyone not in the שבצ״ק at
all. Tapping a row opens that person's own day. Each number has a copy button and
a call button.

## מי בשמירה עכשיו

Every post the roster knows about, not just the ones with somebody on them right
now — a post that disappears the moment it empties is exactly the one you wanted
to look at. Three states:

- **manned** — who, and until when
- **לא מאויש** — nobody on it now, but somebody is scheduled later
- **dimmed** — the שבצ״ק doesn't reach today at all for that post; it shows when
  it last ran instead of pretending it's unmanned

The count at the top ignores the dimmed ones, so "3 מתוך 5 מאוישות" means five
posts that are actually supposed to be covered. With more than one schedule tab
the posts are grouped by tab. Tapping a manned post shows that person's day.

Two things used to break this list. A wide sheet that repeats the יום / שעה pair
on the far side had the copy read as a post called "יום" whose people were "ג 4"
and "ד 5" — a column now counts as a key column when times and dates *dominate*
it, which leaves חמ״ל (a few `10-22` markers among real names) alone. And any
post with no shift in the current window vanished entirely rather than showing
as unmanned.

## טבלת שעות

Settings → **כלים** → טבלת שעות. Who has actually done the most hours. Ranked by **completed** shifts only — a
shift that hasn't happened yet isn't hours you've done. Your own card sits on top
with your rank, your total, and how far you are from the unit average; your row
is outlined in the list.

- Range: **כל השבצ״ק** (default — the sheet is usually the natural period),
  השבוע, or החודש.
- **כולל תורנויות** is off by default. A מטבח duty running 07:00–23:59 is 17
  hours and would swamp a leaderboard of 4-hour guard shifts. Any column you set
  to *יומי* in כללי עמודות is excluded unless you switch this on.
- Night hours are counted by actual overlap with 22:00–06:00, not by whether the
  shift merely starts at night — a 22:00–02:00 shift is 4 night hours, an
  18:00–22:00 shift is none.

It lives under כלים in Settings rather than the main screen. The app's job is
answering "am I on now and when's my next one" in one glance; the hours table is
something you go looking for, not something that should compete with the answer.

## מצב פתוח — onboarding a whole unit at once

Settings → **מצב פתוח** (admin) → 15 דק׳ / שעה / 24 שעות. While the window is
open, anyone who pastes the sheet link is let straight in with no approval, and
every request already waiting is approved on the spot.

It always expires by itself — there is no permanent "open" setting, because
that is exactly what it would quietly become. Max is 24 hours, and **סגור עכשיו**
ends it early.

The trade while it's open: anyone holding the sheet link can join, not just
people you meant to add. So open it, post the link in the group, watch the count
in חברים, close it. Everyone who came in that way is tagged **מצב פתוח** in the
members list, so you can review and remove anyone who shouldn't be there.

## Leaving a שבצ״ק

הגדרות → **השבצ״קים שלי** → **עזוב** on the row. Your shifts stop showing and
the notifications stop; the Google Sheet itself is untouched. You can rejoin with
an invite link.

Three things the server handles so leaving doesn't quietly break it for everyone
else:

- **The owner walking out.** Ownership passes to another admin, or to whoever
  joined first if there are no other admins, and they get a push. Without this
  nobody could approve a request or hand out a link ever again.
- **The poll token walking out.** If the שבצ״ק was being read with the leaver's
  Google token, that's cleared, and the next poll promotes another member who
  can still open the file. Same path as someone revoking access in Google.
- **The last person out.** You get a second, blunter confirmation, because
  leaving then removes the שבצ״ק — members, invites, rules, change history. For
  one built inside the app that's the only copy there is, and it says so.

## Who runs a שבצ״ק

Whoever first connects a שבצ״ק **owns** it. Ownership is per-sheet, so another
unit connects their own sheet and runs themselves — they never need you, and you
never see their roster.

In Settings → חברים:

| | approve requests · create invites · edit column rules | promote / demote admins | transfer ownership |
|---|---|---|---|
| בעלים | yes | yes | yes |
| מנהל | yes | promote only | no |
| חבר | no | no | no |

**הפוך למנהל** hands someone the day-to-day work — think WhatsApp group admin.
An admin doesn't need Google Sheets permission for any of it, so your מ״כ can run
approvals without ever seeing a consent screen.

**העבר בעלות** (owner only) is for when you leave. The new owner takes over, and
you stay on as an admin rather than being locked out. An admin can't demote
another admin and nobody can remove the owner, so there's no way to coup the
sheet or leave it with nobody in charge.

To remove someone: **הסר**. Their session, their sheet access and their push
subscription all go at once.

---

## What it does with the sheet

Reads every tab, every 5 minutes, **with merged-cell information** — which is why
this goes through the Sheets API instead of a CSV export. In your sheet the day
column, קצין מוצב, and the כרמל blocks are all merged; a CSV export drops those
and people's shifts silently vanish.

It auto-detects three layouts and doesn't need to be told which is which:

| tab | what it found |
|---|---|
| שבצ״ק מבוא דותן | dated grid — day column + 4h slots × 12 posts → 143 shifts |
| פילבוקס חרמש | same shape but mirrored (index columns on the right) → 12 shifts |
| תגבצים | weekly, no dates — "ראשון עד חמישי" blocks, `בוקר (06:00-08:00)` rows, projected onto the next 14 days → 122 shifts |
| כ״א | no times → read as a people directory, 91 names + where each person sits |

It also ignores the things that would otherwise become fake soldiers: the
mirrored יום/שעה columns on the right, the סגל/מוצב/קורסים side lists, the
`10-22` / `22-10` boundary markers in חמ״ל, and notes like
"סיור יורד + מכולות יורד" (dropped because they're named after a post).

## The day letter is a checksum

Every Hebrew roster labels its days — `ג 4/8`, `ו 7/8`, `ש 8/9`. That letter is
free evidence about the numbers next to it, and the parser now uses it.

`ש 8/9` is Saturday, the 8th–9th of August. Read as day-and-month it is 8
September — a month away, and a Tuesday. When the letter and the numbers
contradict each other the letter wins, and the parser looks for the reading that
agrees with it: the pair as two day numbers in the month the roster is already
in, or the date written month-first. The first candidate whose weekday matches
the letter is taken, and the sheet gets a warning naming the cell:

```
התאריך בתא "ש 8/9" לא תואם ליום שכתוב בו — נקרא כ-8.8 לפי אות היום
```

It will **not** try another year. A letter that disagrees is far more often a
two-day label than a roster written twelve months off, and quietly sliding a
whole שבצ״ק into another year is the worse mistake. If nothing matches, the
original date stands and nothing is said — a silent guess would be worse than
the bug.

A block like this covers 02:00 Saturday through 02:00 Sunday, so it is dated
from the Saturday and the 22:00–02:00 slot ends on the 9th by the normal
crosses-midnight rule.

## A block that spans two days

Weekends are often written as one range: `ש 8-9.8` — Saturday to Sunday, 8–9
August. Read as an ordinary date that is "the 8th, of the 9th": a month away,
and on a Tuesday. The symptom is unmistakable once you know it — the app says
you're free for a month and points at a shift on a weekday you don't recognise,
while the real one is two days out.

Ranges are now matched before plain dates, and the block is dated from the day it
starts: `8-9.8`, `8-9/8/26`, `31.8-1.9`, and `30-1.9` (where the 30th belongs to
the month before the one written). And a bare hyphen no longer separates a date
at all — `3-4` and `10-22` are a name and a pair of hours, not the 3rd of April
and the 10th of the 22nd. A hyphenated date still reads if it carries a year:
`8-8-26`.

## Days written on the row instead of the block

A weekly שבצ״ק groups rows under a day heading — `ראשון עד חמישי`, then `שישי`.
Rows inside a block normally inherit its day. But a row can name a different day
itself, and then it wins:

```
שישי
בוקר (06:00-08:00)      ← Friday, from the block
מוצ״ש (20:30-22:00)     ← Saturday night, from the row
```

`מוצ״ש` used to inherit the block's Friday, so that shift appeared a day early.
On a Friday that is the worst possible day to be wrong on: the app skips
tomorrow completely and points at the day after. A row only overrides when it
actually names a day and the sheet has no date column — otherwise the block
still rules.

## A duty written once that covers two days

The מטבח crew put down under Friday is on for Saturday as well, and the only
sign of it in the sheet is that Saturday's column is blank. A parser must not
decide that on its own — blank usually means blank — so it's a per-column
setting you turn on: הגדרות → **כללי עמודות** → mark the column יומי and tick
**ממשיך ליום ריק**.

It only fills a day that is genuinely empty, it never overwrites a day that is
written, it never chains past one day, and every day it invents is named in the
warnings:

```
מטבח: אין שיבוץ ב8.8 — הועתק מהיום שלפניו (הראל מירון, אוהד גולדווסר, אור סלע)
```

If instead you merge the cell down across both days in Sheets, that already
works with no setting at all — the app reads merges from the live API and fills
every row the merge covers. (A CSV export loses merges, which is why the same
sheet can look different in an export.)

## Cells that name another post instead of a person

`סיור יורד + מכולות יורד` is a rule, not a name: whoever just came off סיור,
plus whoever just came off מכולות. Left as text it became a person by that name,
permanently on watch, cluttering the roster and the search box.

- `<post> יורד` — the crew whose shift on that post ends exactly when this one starts
- `<post> עולה` — the crew coming on at the same time
- `מ״כ <post> יורד` — only the commander of that crew, which is the first name
  written in the cell (that's the convention; if your unit writes it differently,
  say so and I'll change the rule)

Several can be joined with `+`, `,` or `/`. A cell only counts as a rule when
*every* part of it is one, so `יורדן כהן` stays a person. Resolution happens after
the whole tab is read, since the shift being referred to is often further down
the grid. If nothing lines up — usually because the referenced shift is on a day
the sheet doesn't cover — the שבצ״ק gets a warning naming the cell and nobody is
invented:

```
לא הצלחתי לפענח מי מגיע מ: סיור יורד + מכולות יורד — אין משמרת שמסתיימת בדיוק בשעה הזו
```

## Columns that carry their own hours

Some posts don't run on the sheet's shift rows. A חמ״ל doing two 12-hour blocks
while the guard posts do four-hour slots is the usual case, and a שבצ״ק writes
that one of two ways. Both are read now:

```
חמ״ל                          חמ״ל
10-22          ← a marker      08:00-16:00 יוסי לוי   ← hours next to the name
עילאי גניזה     ← on 10:00-22:00
גלעד אפריים     ← same block, so they show as "איתך"
22-10
תמיר לויצקי     ← 22:00-10:00, crossing midnight
```

A time marker governs every name under it and is forgotten at the next day, so
it can't bleed across. Two people under the same marker land on the *same*
block rather than in sequence, which is what makes them show up as each other's
company. Names that appear *above* the first marker of a day keep the time of
their own row.

This used to fail silently and badly: `10-22` made the parser read the whole
column as a second time axis and discard it, so the post produced **zero**
shifts with nothing said about it. On the sample שבצ״ק that was 13 חמ״ל shifts
and 5 people who simply didn't exist as far as the app was concerned.

Two guards against a repeat: a number range only counts as hours when it can't
be part of a name (`כיתה 3-4` stays a name), and **any column heading that
yields no shifts at all is now named out loud** — in the warnings and in
אבחון, which lists every column with its shift count next to it. A `0` beside a
post name is the answer to "why isn't X counted".

## Columns that don't follow the row times

Some columns aren't guard slots. מטבח is a day duty: you're on it from 07:00,
and everyone listed in that column that day is on it together — even though they
appear on three separate rows with three different slot times.

Settings → **כללי עמודות** (sheet owner only). Every column the parser found is
listed with two choices:

- **לפי השעות בשורה** — normal. The row's time slot is the shift.
- **יומי משעה קבועה** — pick a start and end. Every name in that column on a
  given day collapses onto one shared block, so three rows of the same person
  become one shift, and three different people show up as "איתך".

Saving re-reads the sheet immediately, and deliberately does *not* notify anyone
— changing a rule moves everyone's times, which would otherwise push a
notification to every affected person.

Set it yourself when the format shifts again; it needs no redeploy.

## Spelling

Your sheet spells the same person several ways. The app merges them
automatically — 16 of them in the export you sent:

```
אראל דנשצ'יקוב ⟸ הראל דנצ׳יקוב        עדן אברמזון  ⟸ עדן אברהמזון / עדן
אריה ליכטזון   ⟸ אריה ליכטנזון        עומר טהר לב  ⟸ עומר טהרלב
דביר גל אלברג  ⟸ דביר גל אלנברג       עילאי גנזיה  ⟸ גנזיה
אריאל חולדלקו  ⟸ אריאל חולדנקו        ליאב עובד    ⟸ ליאוב עובד / עובד
שגיב מבשב      ⟸ שגיא מבשב            יותם עמיר    ⟸ יותם אמיר
```

A bare surname only folds into a full name when exactly one full name is a clear
match — `גנזיה` → `עילאי גנזיה` yes, `יואב` stays alone because both יואב שלום
and יואב שפר exist. Two names that appear in the same slot are never merged;
they're provably different people.

## Finding your name

Type anything. All of these land on תומר אוסוביצקי:

`תומר אוסוביצקי` · `אוסוביצקי` · `תמר אוסוביצקי` · `כהן תומר`-style reversal ·
`תומראוסוביצקי` · `tomer osovizky` · `osovizky tomer` · `oso`

It handles final letters (`פרצ`=`פרץ`), niqqud, geresh, missing or added
vowel letters (`תמר`=`תומר`, `דויד`=`דוד`), doubled letters, transpositions,
and Hebrew↔Latin by phonetic folding (`shahar ginat` → `שחר גינת`). Anything it
still misses, you add as a nickname in Settings and it sticks to your account.

### Your name is sticky

Once chosen it is never dropped, by anything. A שבצ״ק gets rewritten every week
and people fall out of it constantly — being left off this week's roster must not
log you out of your own identity. The name is held server-side per sheet **and**
cached locally, and if the server ever comes back blank the app pushes the local
copy back up.

When the selected name isn't in the current sheet at all, the card says
**השם הזה עדיין לא מופיע בשבצ״ק** and offers **החלף שם** — a dead-looking screen
with no way out is the failure mode to avoid here.

### A name that isn't in the שבצ״ק yet

New arrivals, anyone on leave for this roster, or a spelling nobody has typed the
same way: type it and pick **השתמש ב״…״** at the bottom of the list. The app says
plainly that the name isn't in the sheet and that it'll start working once they
are assigned.

It genuinely does start working. Every time the roster refreshes, a stored name
that isn't literally in the sheet is re-matched with the same fuzzy engine at a
strict threshold (0.93). So someone who set themselves up as `תומר אוסוביצקי`
gets picked up when the sheet later says `אוסוביצקי`, and their reminders and
change notifications fire — the worker resolves it too, not just the app. When
the resolved name differs from what they typed, the header shows
`typed → matched` so it's never a silent substitution.

---

## Scale

Every sheet is polled every 5 minutes, but a poll normally costs almost nothing:
the worker hashes the raw API response and stops there if it matches last time —
no JSON parse, no re-parse, no KV write. Only a sheet that actually changed costs
anything.

Sheets are polled round-robin, `POLL_BATCH` per tick (default 20), so the work
per invocation stays flat no matter how many sheets exist. 100 sheets means each
one is checked every 25 minutes rather than every 5. Raise `POLL_BATCH` to
shorten that; on the Paid plan the ceiling is subrequests (2 per sheet, 10,000
available), not CPU.

`GET /api/health` reports sheet count, batch size, how long a full cycle takes,
and the last tick's results.

Rough shape at a few hundred sheets, Paid plan: a handful of dollars a month,
dominated by Workers requests rather than KV. If it ever gets genuinely big the
thing to change first is polling — a webhook or Drive change-watch instead of a
fixed interval.

## Notes

- `npm run mock` + `npm run e2e` run the whole UI against your real exported tabs
  with no Cloudflare and no Google. Screenshots land in `shots/`.
- `npm test` runs the parser and matcher against those tabs and prints what it
  extracted.
- `npm run test:layouts` checks the parser against layouts neither of us has a
  sample of: dates across the top, transposed sheets, section-label posts,
  `0800-1600` / `8-16` times, English headers, merged all-day cells, and tabs
  that aren't schedules at all (which must fail loudly, not silently).
- All times are anchored to **Asia/Jerusalem**, not to whatever clock the code or
  the phone happens to be on. Cloudflare Workers run in UTC, so building shift
  times with the runtime's local zone silently shifted every shift. Override with
  a `TZ_NAME` var in `wrangler.toml` if a unit is somewhere else.
- The session is stored twice: a token in localStorage **and** an HttpOnly
  cookie. Safari evicts script-writable storage after ~7 idle days and an
  installed app can get a different storage bucket from the tab it was installed
  from — either would look like being logged out. If the token is gone the app
  silently recovers from the cookie via `/api/session`.
- Losing the network never shows the sign-in screen. The last roster is cached
  locally, so a cold offline start still shows your shifts, marked
  **⚠ לא מחובר — מידע שמור**.
- The service worker cache is stamped with a build hash, and the page itself is
  network-first. A cache-first page is how a stale build survives a deploy
  forever — which happened here during testing.
- Notification payloads are never sent over the push service — the push is empty
  and the app fetches the detail itself over an authenticated connection. Names
  and times never pass through Apple's or Google's push servers.
