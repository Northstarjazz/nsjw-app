# North Star HQ (was "Student Journey")

One screen for the whole student journey at North Star Jazz Workshops: lead to
member to alumni. Replaces Monday.com. Scope doc: "North Star Student Journey
app: Scope" (Claude Docs, Nov 2026).

## What this is and is not

- A front end over systems North Star already runs. It never becomes a database
  of people.
- People, statuses, tags, billing, attendance and calendar events live in
  MyMusicStaff (MMS). The app reads them and writes back only the fields listed
  under Rules.
- Sequences, notes, follow-ups and the activity log live in the "NSJW Sequencer"
  Google Sheet (id 1OEj-BdyB26Qv8HIwFVkEuktMQlTdlqOniGoKTgfvJEw). Its Apps Script
  is the backend (`backend/NSJW_Sequencer.gs` is the source of truth; paste it
  into the Sheet's script editor to deploy).
- Email goes out from hello@northstarjazzworkshops.com through that script.
  Mailchimp keeps the newsletter and anything bulk.
- Programs, capacity and enrollment come from the "NSJW Programming" Sheet
  (id 1gOMDxn3TiZuWsszLCyp_zYHCDNh4UTsxq-vpEvsLJIc), which the programming
  planner already reads.
- Click tracking: links go through https://northstarjazzworkshops.com/go
  (`go.html` in the site repo), which pings the script and forwards.

## Stack

- Static front end: plain HTML, CSS and JS in `web/`, deployed to GitHub Pages
  at a North Star subdomain, installable as a PWA. One shared stylesheet
  (`web/css/nsjw.css`) that the NSJW-Tools dashboards will adopt too.
- No framework, no bundler, no Node build step, no Postgres, no Supabase, no
  Vercel. If a page needs a library, load it from a CDN with a pinned version.
- Google sign-in on the page, restricted to northstarjazzworkshops.com accounts.
- Backend: the Sequencer Apps Script exposed as a JSON web app. Add endpoints
  there; do not stand up another server.
- Phone first. Design from the "Leads pipeline" canvas (Claude design artifact, Nov 2026),
  card 4 "One set of parts": `web/css/hq.css`, loaded last, is the source of truth.
  Figtree only; page #F4F3EC, white cards with 12px corners, items 8px, tags 4px; lines
  1px #E2E0D4; one accent #204E46; dark side nav #23231F. Buttons fully rounded, 36px
  (28px small), 44px on touch screens. Tags (interests, groups) are square-ish green tints;
  status is a rounded pill and color only ever means status. No shadows, no all-caps,
  no diamonds. The older sgraffito/natural sheets stay underneath until screens are rebuilt.
  Screen rules (design review, Nov 9): every screen is `.pagewrap > .page-card > .ph` (title),
  then stat strip, underline tabs, filter bar, content. Underline tabs (`.vtabs`) pick which
  records; the segmented toggle (`.seg`) picks the layout. Lists are one bordered box with
  hairline rows (`.rlist` / `.rl-r`); tables are the same box with a header (Tabulator, or
  `.rt`). Stage is a dot and a word; MMS status is a pill; open seats are amber tags; red only
  means late or wrong. Dates drop the year when it is this year. Under 700px, tables become
  row lists and the filter bar scrolls sideways.

  Look (Verdara, Nov 9, `web/css/verdara.css`, loaded last and wins): parchment page #F5EEDF,
  cards #FBF7EE (never pure white), moss #143A2B for text, primary buttons and the nav, ochre
  #F2B233 for "open / needs attention soon", coral #EC6A47 for late or wrong, sage #C8D6B4 and
  mist #9DC9E5 for quiet tags. Fraunces for page titles, section titles, names and stat numbers;
  Inter for everything else. Buttons, tabs, filters, tags are pills; cards 20px, items 14px.
  No gradients, shadows only on dialogs and popovers, focus is a 3px ochre ring. Stat strip is
  separate tiles: first one moss with the seal, a tile goes coral or ochre when its value is
  `.red` / `.amber`. Side nav is moss with img/header-strata.jpg multiplied in; nav icons are
  Phosphor regular, inlined as `svg.ph`. Find bar (`#find`, `/` or Cmd+K) sits above every
  screen and searches people, groups and screens. Earlier colour notes above are superseded.

## Rules (do not loosen these)

1. Never store a contact in this app. If a feature seems to need its own table
   of people, it is wrong; read from MMS.
2. MMS writes: status and tag changes may run unattended. Creating groups,
   events or attendees shows a full preview and runs on one explicit approval.
   Anything that touches billing, invoices or charges requires Ben to confirm
   each run. Never delete in MMS.
3. Email from here is personal, one-to-one or small-batch, from Ben's inbox.
   No bulk marketing; that is Mailchimp.
4. Over a few hundred sends gets staggered across days (Apps Script allows
   about 1,500 a day). Reply-stop is mandatory on every sequence.
5. Texting (when added) is opt-in only, with STOP handling, from a registered
   North Star number.
6. Secrets never go in this repo: no API keys, no MMS credentials, no OAuth
   client secrets. The MMS key lives in ~/.nsjw/mms.env on Ben's Mac and,
   for the backend, in the Apps Script's Script Properties as MMS_API_KEY
   (set by Ben, never by Claude). GOOGLE_CLIENT_ID sits beside it.
   Every API action verifies a northstarjazzworkshops.com Google ID token
   (`backend/Api.gs`); never add an action that skips it.
7. No em dashes in any copy. Warm, direct, plain language. Match the North Star
   voice (see the nsjw-brand-voice skill).

## Screens (build in this order)

1. Person: contact and tags from MMS, timeline (notes, sequence emails with
   open/click/reply, Gmail threads), next step with owner and date, actions.
2. Today: follow-ups due, unanswered replies, new sign-ups, open seats with
   waitlist matches, subs needed, quiet members, numbers strip.
3. Programs: every offering with dates, instructor, capacity, enrolled, fill
   rate; open seats matched to waiting students; New group form.
4. Teachers: groups, students, pay this month, availability, sub requests,
   contract status.

Everything else in the scope doc is an action launched from one of these four.

## Working here

- Plan mode before any new screen. Run the page in a browser after every
  change. Screenshot it at phone width (390) before calling it done.
- Keep `backend/NSJW_Sequencer.gs` and the deployed script identical; when
  the script changes, note it in the commit and redeploy a new version.
- Sheet column order is a contract. Changing a column in Enrollments or
  Sequences means changing the ENROLL / SEQ maps in the script and the
  front end in the same commit.
- Commit small. Push through GitHub Desktop (this sandbox has no git auth).
- Bump the ?v= number on the css and js links in web/index.html with every front-end change, or phones keep the old files.
