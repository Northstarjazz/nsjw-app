/**
 * Leads: the funnel, built from MMS. A lead's stage, interests and nights are
 * MMS tags ("Stage: Qualified", "Interest: Ensemble", "Nights: Tue"), and its
 * instruments are the existing "Plays: ..." tags. So the funnel lives where the
 * student lives, and the app stores no people of its own. Next steps and notes
 * stay in the Notes tab.
 *
 * Tag writes: MMS keeps membership on the tag, and PUT studentgroups/{id}
 * REPLACES the whole member list. So every change reads the current members,
 * checks the count against MMS's own StudentCount, sends the union (or the
 * difference), and reads back. If the count does not match, it stops.
 */

// The board: First Contact, Qualified, Committed (ensemble deposit,
// lesson package, or class registration form), then Enrolled (MMS status Active).
// Nurture and Closed (lost) sit off the board.
var LEAD_STAGES = ['First Contact', 'Qualified', 'Committed', 'Nurture', 'Closed'];
var LOST_REASONS = ['Timing', 'Price', 'Schedule', 'Level', 'No reply', 'Went elsewhere'];
// Tags written before Nov 4, 2026 used these names; read them as the new stages.
var LEGACY_STAGES = { 'New Lead': 'First Contact', 'Deposit Submitted': 'Committed', 'Ready to Join': 'Committed' };
// Days in a stage with no activity before a card turns red on the board.
var STALE_DAYS = { 'First Contact': 2, 'Qualified': 7, 'Committed': 7 };
var BOARD_DAYS = 60;
var LEAD_INTERESTS = ['Ensemble', 'Private lessons', 'Foundations', 'Classes', 'Clinics', 'Voice'];
var LEAD_NIGHTS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
var LEAD_INSTRUMENTS = ['Sax', 'Trumpet', 'Trombone', 'Flute', 'Piano/Keys', 'Guitar', 'Bass', 'Drums', 'Voice', 'Violin', 'French Horn', 'Harmonica'];
var TAG_PREFIX_OK = /^(Stage|Interest|Nights|Plays): /;

function leadOptions_() {
  return { stages: LEAD_STAGES, interests: LEAD_INTERESTS, nights: LEAD_NIGHTS, instruments: LEAD_INSTRUMENTS };
}

/** Pull "Question: answer" pairs out of the sign-up note MMS stores. */
function signup_(note) {
  var out = {};
  String(note || '').split(/\r?\n/).forEach(function (line) {
    var m = line.match(/^\s*([^:]{3,60}):\s*(.+)$/);
    if (!m) return;
    var k = m[1].toLowerCase();
    if (/instrument/.test(k)) out.instrument = m[2].trim();
    else if (/experience level/.test(k)) out.experience = m[2].trim();
    else if (/interested/.test(k)) out.interested = m[2].trim();
    else if (/hear about/.test(k)) out.source = m[2].trim();
  });
  var d = String(note || '').match(/^(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(.+?)\./);
  if (d) out.form = d[2].replace(/[​]/g, '').trim();
  return out;
}

function stageOf_(r, tags) {
  var t = tags.filter(function (x) { return /^Stage: /.test(x); }).map(function (x) { return x.slice(7); })[0];
  if (t) return LEGACY_STAGES[t] || t;
  if (r.Status === 'Active') return 'Enrolled';
  if (r.Status === 'Inactive') return 'Closed';
  // An "Ensemble Deposit" form on file means they paid, even if nobody tagged it yet.
  if (/\(Ensemble Deposit\)/.test(String(r.Note || ''))) return 'Committed';
  return 'First Contact';
}

function listLeads_() {
  return { options: leadOptions_(), leads: leadRows_(), enrolled: recentEnrolled_(), stale: STALE_DAYS, boardDays: BOARD_DAYS };
}

/** Notes the app or the roster sync wrote by itself (not a person reaching out). */
function autoNote_(n) { return n.Author === 'app' || n.Author === 'MMS sync'; }

/** Ensemble / Private lessons / Classes: from their Interest tags, or the sign-up form if they have none. */
function tracksOf_(tags, s) {
  var t = tags.filter(function (x) { return /^Interest: /.test(x); }).map(function (x) { return x.slice(10); });
  if (!t.length) t = formInterests_(s.interested, s.form);
  return ['Ensemble', 'Private lessons', 'Classes'].filter(function (x) { return t.indexOf(x) >= 0; });
}

/** Which program a lead is heading for, for the board: Ensemble, Lessons or Class. */
function track_(interests) {
  if (interests.indexOf('Ensemble') >= 0) return 'Ensemble';
  if (interests.indexOf('Private lessons') >= 0) return 'Lessons';
  if (interests.some(function (i) { return i === 'Foundations' || i === 'Classes' || i === 'Clinics'; })) return 'Class';
  if (interests.indexOf('Voice') >= 0) return 'Ensemble';
  return '';
}

/** People who became students in the last 30 days, for the Enrolled column. */
function recentEnrolled_() {
  var since = new Date(Date.now() - 30 * 864e5);
  var when = {};
  sheetObjects_(NOTES_TAB).forEach(function (n) {
    if (!/^(Placed in |Joined: )/.test(String(n.Text))) return;
    var ts = n.Timestamp instanceof Date ? n.Timestamp : new Date(n.Timestamp);
    if (ts >= since && (!when[n['MMS ID']] || ts > when[n['MMS ID']])) when[n['MMS ID']] = ts;
  });
  return rosterRows_().filter(function (r) {
    if (r.Status !== 'Active') return false;
    var st = r.Started instanceof Date ? r.Started : (r.Started ? new Date(r.Started) : null);
    return when[r.ID] || (st && st >= since);
  }).map(function (r) {
    var at = when[r.ID] || r.Started;
    return { id: r.ID, name: r.Name, programs: split_(r.Programs), instruments: split_(r.Instruments), at: gday_(at) };
  }).sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
}

function leadRows_() {
  var notes = sheetObjects_(NOTES_TAB);
  var mail = {};
  try { mail = mailIndex_(); } catch (e) { Logger.log('Mail index: ' + e.message); }
  var bySid = {};
  notes.forEach(function (n) {
    if (autoNote_(n)) return; // the app's own bookkeeping is not contact with the person
    var k = n['MMS ID'] || ('e:' + String(n.Email).toLowerCase());
    var o = bySid[k] = bySid[k] || { last: null, next: null, count: 0 };
    o.count++;
    var ts = n.Timestamp instanceof Date ? n.Timestamp : new Date(n.Timestamp);
    if (!o.last || ts > o.last) o.last = ts;
    if (n.Kind === 'next_step') o.next = n.Done ? null : n;
    if (n.Kind === 'change' && /^Stage set to /.test(String(n.Text)) && (!o.stageAt || ts > o.stageAt)) o.stageAt = ts;
  });
  return rosterRows_().filter(function (r) {
    var tags = split_(r['Other tags']);
    var staged = tags.some(function (t) { return /^Stage: /.test(t); });
    return r.Status === 'Lead' || r.Status === 'Trial' || r.Status === 'Waiting' || staged;
  }).map(function (r) {
    var tags = split_(r['Other tags']);
    var n = bySid[r.ID] || bySid['e:' + String(r.Email).toLowerCase()] || {};
    var s = signup_(r.Note);
    var m = mail[String(r.Email).toLowerCase()] || {};
    var lastC = [n.last ? gday_(n.last) : '', m.out || ''].filter(Boolean).sort().pop() || '';
    return {
      id: r.ID, name: r.Name, status: r.Status, email: r.Email, phone: r.Phone,
      emailedAt: m.out || '', repliedAt: m['in'] || '',
      started: gday_(r.Started), skill: r['Skill level'],
      stage: stageOf_(r, tags),
      instruments: split_(r.Instruments),
      interests: tags.filter(function (t) { return /^Interest: /.test(t); }).map(function (t) { return t.slice(10); }),
      nights: tags.filter(function (t) { return /^Nights: /.test(t); }).map(function (t) { return t.slice(8); }),
      programs: split_(r.Programs),
      form: s,
      formInterests: formInterests_(s.interested, s.form),
      formInstruments: formInstruments_(s.instrument),
      lastContact: lastC,
      stageAt: n.stageAt ? gday_(n.stageAt) : '',
      track: track_(tracksOf_(tags, s)),
      tracks: tracksOf_(tags, s),
      notes: (n.count || 0) + (m.out ? 1 : 0),
      next: n.next ? { text: n.next.Text, due: gday_(n.next.Due), owner: n.next.Owner } : null
    };
  });
}

function formInterests_(s, form) {
  s = String(s || '').toLowerCase();
  // "Group classes (Foundations, Jazz Guitar, Voice, etc.)" is one option; read it as Classes, not Voice.
  var classes = /group classes|course/.test(s);
  s = s.replace(/group classes \([^)]*\)/g, ' ');
  var out = [];
  if (/ensemble|small group/.test(s)) out.push('Ensemble');
  if (/private/.test(s)) out.push('Private lessons');
  if (/foundation/.test(s)) out.push('Foundations');
  if (classes || /(^|[^r])class/.test(s) || /course|registration|playground|foundations|improvisation|voice lab/i.test(String(form || ''))) out.push('Classes');
  if (/workshop|masterclass|clinic/.test(s)) out.push('Clinics');
  if (/voice|vocal|sing/.test(s)) out.push('Voice');
  return out.filter(function (x, i) { return out.indexOf(x) === i; });
}

function formInstruments_(s) {
  s = String(s || '').toLowerCase();
  var out = [];
  var rules = [[/sax/, 'Sax'], [/trumpet|flugel|cornet/, 'Trumpet'], [/trombone/, 'Trombone'], [/flute/, 'Flute'],
    [/piano|keys|keyboard|organ/, 'Piano/Keys'], [/guitar/, 'Guitar'], [/bass(?!oon)/, 'Bass'], [/drum|percussion/, 'Drums'],
    [/voice|vocal|sing/, 'Voice'], [/violin|fiddle/, 'Violin'], [/french horn/, 'French Horn'], [/harmonica/, 'Harmonica']];
  rules.forEach(function (r) { if (r[0].test(s) && out.indexOf(r[1]) < 0) out.push(r[1]); });
  // "bass" inside "bass clarinet" or "bari sax" should not count as bass.
  if (/bari|clarinet/.test(s) && !/upright|electric|double bass|bass guitar/.test(s)) out = out.filter(function (x) { return x !== 'Bass'; });
  return out;
}

// ---------- tag writes ----------

function members_(groupId) {
  var ids = [], off = 0;
  for (var page = 0; page < 10; page++) {
    var rows = mms_('post', 'search/students?offset=' + off + '&limit=500', { StudentGroupIDs: [groupId] });
    rows.forEach(function (s) { ids.push(s.ID); });
    if (rows.length < 500) break;
    off += 500;
    Utilities.sleep(600);
  }
  return ids;
}

/** Add or remove one student on one tag, safely. Creates the tag if it is new. */
function tagWrite_(sid, name, on) { return tagWriteMany_(name, [sid], on); }

/** Add (or remove) many students on one tag in a single safe write. */
function tagWriteMany_(name, sids, on) {
  var groups = mms_('get', 'studentgroups');
  var g = groups.filter(function (x) { return x.Name === name; })[0];
  if (!g) {
    if (!on) return { changed: false };
    var id = mms_('post', 'studentgroups', { Name: name, Type: 'Group', Color: 'Beach',
      Description: 'Set by the Student Journey app' });
    id = Array.isArray(id) ? id[0] : id;
    Utilities.sleep(600);
    g = mms_('get', 'studentgroups').filter(function (x) { return x.ID === id || x.Name === name; })[0];
    if (!g) throw new Error('Could not create the tag ' + name);
  }
  // MMS clears a tag's teachers on any PUT that does not list them, and the API cannot
  // read which teachers are on a tag. So never touch a tag that has teachers on it.
  if (Number(g.TeacherCount) > 0) {
    throw new Error('"' + name + '" has teachers on it in MMS, and changing it from the app would remove them. Change this one in MMS.');
  }
  Utilities.sleep(600);
  var ids = members_(g.ID);
  if (g.StudentCount != null && ids.length !== Number(g.StudentCount)) {
    throw new Error('Stopped: MMS says "' + name + '" has ' + g.StudentCount + ' people but only ' + ids.length +
      ' came back. Nothing was changed.');
  }
  var want = {}; sids.forEach(function (x) { want[x] = true; });
  var next = on ? ids.concat(sids.filter(function (x) { return ids.indexOf(x) < 0; }))
    : ids.filter(function (x) { return !want[x]; });
  if (next.length === ids.length && (on || ids.every(function (x) { return !want[x]; }))) return { changed: false };
  var body = {};
  Object.keys(g).forEach(function (k) { body[k] = g[k]; });
  body.StudentIDs = next;
  body.Students = null;
  Utilities.sleep(600);
  mms_('put', 'studentgroups/' + g.ID, body);
  Utilities.sleep(800);
  var after = members_(g.ID);
  var ok = after.length === next.length && sids.every(function (x) { return (after.indexOf(x) >= 0) === on; });
  mmsLog_(sids.join(' '), (on ? 'Add tag ' : 'Remove tag ') + name, ids.length + ' people', after.length + ' people', ok ? 'ok' : 'not confirmed');
  if (!ok) throw new Error('MMS did not confirm the change to "' + name + '". Check the tag in MMS.');
  return { changed: true, count: after.length };
}

/**
 * Starting interest tags from the sign-up form. For leads (Lead, Waiting, Trial)
 * who have no Interest tag yet and were never seeded before, read "What are you
 * interested in?" and the form name, and add Interest: Ensemble / Private lessons /
 * Classes / Clinics. One write per tag. Each seeded person gets a timeline note,
 * so someone you later clear by hand is never re-tagged. Runs after each roster sync.
 */
var SEED_INTERESTS = ['Ensemble', 'Private lessons', 'Classes', 'Clinics'];
function seedInterestTags_() {
  var seeded = {};
  sheetObjects_(NOTES_TAB).forEach(function (n) {
    if (/^Interest tags from sign-up form/.test(String(n.Text))) seeded[n['MMS ID']] = true;
  });
  var bySid = {}, byTag = {};
  rosterRows_().forEach(function (r) {
    if (['Lead', 'Waiting', 'Trial'].indexOf(r.Status) < 0 || seeded[r.ID]) return;
    if (split_(r['Other tags']).some(function (t) { return /^Interest: /.test(t); })) return;
    var s = signup_(r.Note);
    var list = formInterests_(s.interested, s.form).filter(function (i) { return SEED_INTERESTS.indexOf(i) >= 0; });
    if (!list.length) return;
    bySid[r.ID] = list;
    list.forEach(function (i) { (byTag[i] = byTag[i] || []).push(r.ID); });
  });
  if (!Object.keys(byTag).length) return 0;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return 0; // someone is editing tags; try again next sync
  var done = {};
  try {
  Object.keys(byTag).forEach(function (i) {
    try {
      tagWriteMany_('Interest: ' + i, byTag[i], true);
      byTag[i].forEach(function (sid) { (done[sid] = done[sid] || []).push(i); rosterTag_(sid, 'Interest: ' + i, true); });
    } catch (e) { Logger.log('Seeding ' + i + ' failed: ' + e.message); }
  });
  } finally { lock.releaseLock(); }
  var rows = Object.keys(done).map(function (sid) {
    return [new Date(), sid, '', 'app', 'change', 'Interest tags from sign-up form: ' + done[sid].join(', '), '', '', ''];
  });
  if (rows.length) {
    var n = tab_(NOTES_TAB, ['Timestamp', 'MMS ID', 'Email', 'Author', 'Kind', 'Text', 'Due', 'Owner', 'Done']);
    n.getRange(n.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }
  return rows.length;
}

/** Rewrite one roster row's tag columns so the app shows the change before the next sync. */
function rosterTag_(sid, name, on) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ROSTER_TAB);
  if (!sh) return;
  var v = sh.getDataRange().getValues(), head = v[0];
  var col = /^Plays: /.test(name) ? head.indexOf('Instruments') : head.indexOf('Other tags');
  var val = /^Plays: /.test(name) ? name.slice(7) : name;
  for (var i = 1; i < v.length; i++) {
    if (v[i][0] !== sid) continue;
    var list = split_(v[i][col]).filter(function (x) { return x !== val; });
    if (on) list.push(val);
    sh.getRange(i + 1, col + 1).setValue(list.join('; '));
    return;
  }
}

/**
 * p: { sid, email, field: 'stage'|'interest'|'nights'|'instrument', value, on }
 * Stage is single-choice: setting one clears the others.
 */
function setLeadTag_(who, p) {
  var sid = String(p.sid || '');
  if (!/^sdt_/.test(sid)) throw new Error('This person is not in MMS yet.');
  var map = { stage: ['Stage: ', LEAD_STAGES], interest: ['Interest: ', LEAD_INTERESTS],
    nights: ['Nights: ', LEAD_NIGHTS], instrument: ['Plays: ', LEAD_INSTRUMENTS] }[p.field];
  if (!map || map[1].indexOf(p.value) < 0) throw new Error('Unknown choice');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another change is running. Try again in a moment.');
  try {
    var changes = [];
    if (p.field === 'stage') {
      var r = rosterRows_().filter(function (x) { return x.ID === sid; })[0];
      var current = r ? split_(r['Other tags']).filter(function (t) { return /^Stage: /.test(t); }) : [];
      current.forEach(function (t) {
        if (t !== 'Stage: ' + p.value) { tagWrite_(sid, t, false); rosterTag_(sid, t, false); }
      });
      if (p.value !== 'First Contact') { tagWrite_(sid, 'Stage: ' + p.value, true); rosterTag_(sid, 'Stage: ' + p.value, true); }
      var why = String(p.reason || '').trim().slice(0, 300);
      // Why a lead was lost, as MMS tags ("Lost: Price"), so it stays with them in MMS.
      // Only the preset reasons become tags; anything typed stays in the note. Reopening clears them.
      var lostNow = r ? split_(r['Other tags']).filter(function (t) { return /^Lost: /.test(t); }) : [];
      if (p.value === 'Closed') {
        var parts = why.split(',').map(function (x) { return x.trim(); });
        LOST_REASONS.filter(function (x) { return parts.indexOf(x) >= 0 && lostNow.indexOf('Lost: ' + x) < 0; }).forEach(function (x) {
          tagWrite_(sid, 'Lost: ' + x, true); rosterTag_(sid, 'Lost: ' + x, true);
        });
      } else {
        lostNow.forEach(function (t) { tagWrite_(sid, t, false); rosterTag_(sid, t, false); });
      }
      changes.push('Stage set to ' + p.value + (why ? ' (' + why + ')' : ''));
    } else {
      var name = map[0] + p.value, on = !!p.on;
      tagWrite_(sid, name, on);
      rosterTag_(sid, name, on);
      changes.push((on ? 'Added ' : 'Removed ') + name);
    }
    var sh = tab_(NOTES_TAB, ['Timestamp', 'MMS ID', 'Email', 'Author', 'Kind', 'Text', 'Due', 'Owner', 'Done']);
    sh.appendRow([new Date(), sid, String(p.email || '').toLowerCase(), who, 'change', changes.join('; '), '', '', '']);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/** Mark the open next step done. */
function nextDone_(who, p) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NOTES_TAB);
  if (!sh) return { ok: true };
  var v = sh.getDataRange().getValues(), head = v[0];
  var c = { sid: head.indexOf('MMS ID'), email: head.indexOf('Email'), kind: head.indexOf('Kind'), done: head.indexOf('Done') };
  var email = String(p.email || '').toLowerCase();
  for (var i = v.length - 1; i >= 1; i--) {
    var mine = (p.sid && v[i][c.sid] === p.sid) || (email && String(v[i][c.email]).toLowerCase() === email);
    if (mine && v[i][c.kind] === 'next_step' && !v[i][c.done]) {
      sh.getRange(i + 1, c.done + 1).setValue(new Date());
      return { ok: true };
    }
  }
  return { ok: true };
}

/** Mark the newest open next step for this student done. Returns its text, or ''. */
function closeNextStep_(sid) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NOTES_TAB);
  if (!sh) return '';
  var v = sh.getDataRange().getValues(), head = v[0];
  var cs = head.indexOf('MMS ID'), ck = head.indexOf('Kind'), cd = head.indexOf('Done'), ct = head.indexOf('Text');
  for (var i = v.length - 1; i >= 1; i--) {
    if (v[i][cs] === sid && v[i][ck] === 'next_step' && !v[i][cd]) {
      sh.getRange(i + 1, cd + 1).setValue(new Date());
      return String(v[i][ct]);
    }
  }
  return '';
}

// ---------- place in a group ----------

/**
 * Place a lead in a program: add the program tag (and "Ensemble Member" for
 * numbered groups), clear their funnel stage, set MMS status to Active, and log it.
 * Billing and calendar events stay a manual step in MMS (they need Ben's eyes).
 *
 * Status write follows the safe protocol from the MMS notes: GET the single
 * record, change Status only, PUT it back, GET again and compare every field.
 */
function placeInGroup_(who, p) {
  var sid = String(p.sid || '');
  if (!/^sdt_/.test(sid)) throw new Error('This person is not in MMS yet.');
  var groups = (p.groups || (p.group ? [p.group] : [])).map(String).filter(Boolean);
  var lessons = p.lessons && p.lessons.teacher ? p.lessons : null;
  if (!groups.length && !lessons) throw new Error('Pick a group or class, or private lessons.');
  var known = listGroups_().map(function (g) { return g.name; });
  groups.forEach(function (g) { if (known.indexOf(g) < 0) throw new Error('Unknown group: ' + g); });
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another change is running. Try again in a moment.');
  var done = [], todo = [];
  // Read status before rosterProgram_ writes 'Active' into the roster sheet, or the
  // MMS status change below gets skipped (found in the Nov 2026 walkthrough).
  var r0 = rosterRows_().filter(function (x) { return x.ID === sid; })[0];
  var stages0 = split_(r0 ? r0['Other tags'] : '').filter(function (t) { return /^Stage: /.test(t); });
  try {
    groups.forEach(function (g) {
      tagWrite_(sid, g, true); rosterProgram_(sid, g, 'Active'); done.push('Tagged ' + g);
    });
    if (groups.some(function (g) { return /^Group \d+/.test(g); })) {
      try { tagWrite_(sid, 'Ensemble Member', true); done.push('Tagged Ensemble Member'); }
      catch (e) { todo.push('Add the Ensemble Member tag in MMS'); }
    }
    if (lessons) {
      saveLesson_(who, { sid: sid, email: p.email, fields: { Stage: 'Scheduling', Teacher: lessons.teacher,
        Instrument: lessons.instrument || '', Frequency: lessons.frequency || '', Length: lessons.length || '',
        'Day and time': lessons.when || '', 'Start date': lessons.start || '' } });
      done.push('Private lessons with ' + lessons.teacher + ' added to Lessons');
      todo.push('Add the Private Lessons - Active tag in MMS');
    }
    stages0.forEach(function (t) { tagWrite_(sid, t, false); rosterTag_(sid, t, false); });
    if (stages0.length) done.push('Cleared ' + stages0.join(', '));
    var st = mmsStudent_(sid);
    if (!st || st.Status !== 'Active') { setStatus_(sid, 'Active'); done.push('MMS status set to Active'); }
    rosterStatus_(sid, 'Active');
    var ns = closeNextStep_(sid);
    if (ns) done.push('Closed the next step "' + ns + '"');
    // The rest of the Member Onboarding doc stays manual in MMS.
    todo.push('In MMS: assign the teacher, billing "same amount each month"' + (lessons ? ' (lessons at the member rate)' : ' at $150'));
    if (groups.length) todo.push('In MMS: add them to the calendar event for ' + groups.join(' and ') + ' (this starts billing)');
    if (groups.length + (lessons ? 1 : 0) > 1) todo.push('In MMS: create the second recurring charge (two programs)');
    var fam = st && st.FamilyID ? mmsFamily_(st.FamilyID) : null;
    if (!fam || !fam.AutoInvoicingEnabled) todo.push('In MMS: turn on auto-invoicing and Auto-Email for the family (it is off, so no invoice would go out)');
    todo.push('Send the onboarding email');
  } finally {
    lock.releaseLock();
    if (done.length) {
      tab_(NOTES_TAB, ['Timestamp', 'MMS ID', 'Email', 'Author', 'Kind', 'Text', 'Due', 'Owner', 'Done'])
        .appendRow([new Date(), sid, String(p.email || '').toLowerCase(), who, 'change',
          'Placed in ' + groups.concat(lessons ? ['private lessons'] : []).join(' and ') + ': ' + done.join('; ') +
          (todo.length ? '. To do: ' + todo.join('; ') : ''), '', '', '']);
    }
  }
  return { ok: true, done: done, todo: todo };
}

function mmsStudent_(sid) {
  var r = mms_('post', 'search/students', { IDs: [sid], Statuses: ['Active', 'Lead', 'Inactive', 'Trial', 'Waiting'] });
  return (r || []).filter(function (x) { return x.ID === sid; })[0] || null;
}
function mmsFamily_(fid) {
  var r = mms_('post', 'search/families', { IDs: [fid] });
  return (r || []).filter(function (x) { return x.ID === fid; })[0] || null;
}

/** Status change through the guarded writer (Mms.gs): verified, logged, written through to the roster. */
function setStatus_(sid, status) {
  if (['Active', 'Inactive', 'Lead', 'Trial', 'Waiting'].indexOf(status) < 0) throw new Error('Unknown status ' + status);
  studentPut_(sid, { status: status });
}

/** Reflect a placement in the roster tab right away. */
function rosterProgram_(sid, group, status) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ROSTER_TAB);
  if (!sh) return;
  var v = sh.getDataRange().getValues(), head = v[0];
  var cp = head.indexOf('Programs'), cs = head.indexOf('Status');
  for (var i = 1; i < v.length; i++) {
    if (v[i][0] !== sid) continue;
    var list = split_(v[i][cp]);
    if (list.indexOf(group) < 0) list.push(group);
    sh.getRange(i + 1, cp + 1).setValue(list.join('; '));
    sh.getRange(i + 1, cs + 1).setValue(status);
    return;
  }
}

// ---------- take out of a group / end membership ----------

/**
 * p: { sid, email, group, end, reason }
 * group: take them out of that one program tag. end: take them out of every
 * program tag and set MMS status to Inactive. Tags with teachers on them are
 * never written (tagWrite_ refuses); those come back as manual steps.
 * Billing and calendar events stay manual in MMS.
 */
function leaveGroup_(who, p) {
  var sid = String(p.sid || ''), end = !!p.end, reason = String(p.reason || '').trim().slice(0, 500);
  if (!/^sdt_/.test(sid)) throw new Error('This person is not in MMS yet.');
  var r = rosterRows_().filter(function (x) { return x.ID === sid; })[0];
  if (!r) throw new Error('Could not find them on the roster. Try again after the next sync.');
  var programs = split_(r.Programs);
  var targets = end ? programs : [String(p.group || '')];
  if (!end && programs.indexOf(targets[0]) < 0) throw new Error('They are not in ' + targets[0] + '.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another change is running. Try again in a moment.');
  var done = [], manual = [];
  try {
    targets.forEach(function (t) {
      try { tagWrite_(sid, t, false); rosterProgramOff_(sid, t); done.push('Removed ' + t); }
      catch (e) { manual.push('Remove the "' + t + '" tag in MMS'); }
    });
    var left = programs.filter(function (t) { return targets.indexOf(t) < 0; });
    var tags = split_(r['Other tags']);
    if (tags.indexOf('Ensemble Member') >= 0 && !left.some(function (t) { return /^Group \d+/.test(t); })) {
      manual.push('Remove the "Ensemble Member" tag in MMS');
    }
    var mi = end ? mmsStudent_(sid) : null;
    if (end && (!mi || mi.Status !== 'Inactive')) {
      setStatus_(sid, 'Inactive'); done.push('Status set to Inactive');
      rosterStatus_(sid, 'Inactive');
    }
    manual.push(end ? 'Stop their recurring billing and future lessons in MMS' : 'Check their billing in MMS');
  } finally {
    lock.releaseLock();
    if (done.length || manual.length) {
      var text = (end ? 'Membership ended' : 'Taken out of ' + targets[0]) + (reason ? ' (' + reason + ')' : '') +
        ': ' + done.concat(manual.map(function (m) { return 'to do: ' + m; })).join('; ');
      tab_(NOTES_TAB, ['Timestamp', 'MMS ID', 'Email', 'Author', 'Kind', 'Text', 'Due', 'Owner', 'Done'])
        .appendRow([new Date(), sid, String(p.email || '').toLowerCase(), who, 'change', text, '', '', '']);
    }
  }
  return { ok: true, done: done, manual: manual };
}

function rosterProgramOff_(sid, group) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ROSTER_TAB);
  if (!sh) return;
  var v = sh.getDataRange().getValues(), cp = v[0].indexOf('Programs');
  for (var i = 1; i < v.length; i++) {
    if (v[i][0] !== sid) continue;
    sh.getRange(i + 1, cp + 1).setValue(split_(v[i][cp]).filter(function (x) { return x !== group; }).join('; '));
    return;
  }
}

function rosterStatus_(sid, status) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ROSTER_TAB);
  if (!sh) return;
  var v = sh.getDataRange().getValues(), cs = v[0].indexOf('Status');
  for (var i = 1; i < v.length; i++) if (v[i][0] === sid) { sh.getRange(i + 1, cs + 1).setValue(status); return; }
}


// ---------- email counts as contact ----------

/**
 * Who you have emailed (and who wrote back) from this inbox in the last 90 days:
 * { email: { out: 'yyyy-mm-dd', in: 'yyyy-mm-dd' } }. Kept only in the script cache
 * (never written to the sheet) and refreshed by the roster sync; built on demand if empty.
 */
/**
 * Last email in and out per address, for the Leads board.
 * Gmail reads count against a daily Google limit, so this is light on purpose:
 *  - a full scan (300 most recent threads, 90 days) happens at most once a day,
 *  - the 15-minute sync only adds threads from the last day, and only once an hour.
 * Kept in CacheService for 6 hours; if it expires, the next hourly sync rebuilds it.
 */
function mailIndex_(mode) {
  var cache = CacheService.getScriptCache(), props = PropertiesService.getScriptProperties();
  var hit = cache.get('mailidx');
  var idx = hit ? JSON.parse(hit) : null;
  if (mode !== 'sync') {
    if (idx) return idx;
    // Cache expired between syncs: serve what we have rather than scanning on a page load.
    return {};
  }
  var now = Date.now(), lastFull = Number(props.getProperty('MAILIDX_FULL') || 0), lastInc = Number(props.getProperty('MAILIDX_INC') || 0);
  if (!idx || now - lastFull > 24 * 3600e3) {
    idx = mailScan_({}, 'newer_than:90d -in:spam -in:trash', 3);
    props.setProperty('MAILIDX_FULL', String(now)); props.setProperty('MAILIDX_INC', String(now));
  } else if (now - lastInc > 3600e3) {
    idx = mailScan_(idx, 'newer_than:1d -in:spam -in:trash', 1);
    props.setProperty('MAILIDX_INC', String(now));
  } else {
    return idx;
  }
  var json = JSON.stringify(idx);
  if (json.length < 95000) cache.put('mailidx', json, 6 * 3600);
  return idx;
}

function mailScan_(idx, query, pages) {
  var tz = Session.getScriptTimeZone();
  // Ours = anything sent from a North Star address (no extra Google permission needed).
  var ours = function (a) { return /@northstarjazzworkshops\.com$/.test(a); };
  for (var page = 0, start = 0; page < pages; page++, start += 100) {
    var threads = GmailApp.search(query, start, 100);
    if (!threads.length) break;
    GmailApp.getMessagesForThreads(threads).forEach(function (msgs) {
      msgs.forEach(function (msg) {
        var day = Utilities.formatDate(msg.getDate(), tz, 'yyyy-MM-dd');
        var from = addr_(msg.getFrom())[0] || '';
        if (ours(from)) {
          addr_(msg.getTo() + ',' + msg.getCc()).forEach(function (a) {
            if (ours(a)) return;
            var o = idx[a] = idx[a] || {};
            if (!o.out || day > o.out) o.out = day;
          });
        } else if (from) {
          var o2 = idx[from] = idx[from] || {};
          if (!o2['in'] || day > o2['in']) o2['in'] = day;
        }
      });
    });
    if (threads.length < 100) break;
  }
  return idx;
}

function addr_(s) {
  return (String(s || '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).map(function (x) { return x.toLowerCase(); });
}

// ---------- log a call (Lead Intake doc, steps 4 and 5) ----------

/**
 * p: { sid, email, channel, path, notes, interest, teacher, sitIn, sitInGroup, followUp }
 * path: 'qualified' (A), 'waitlist' (B), 'longterm' (C), 'sitin' (D), 'note' (no change).
 * Writes the call to the timeline, moves the stage, sets the next step and date.
 */
function logCall_(who, p) {
  var sid = String(p.sid || '');
  if (!/^sdt_/.test(sid)) throw new Error('This person is not in MMS yet.');
  var path = String(p.path || 'note'), channel = String(p.channel || 'Call');
  var lines = [channel + (p.notes ? ': ' + String(p.notes).slice(0, 3000) : '')];
  if (p.interest) lines.push('Level of interest: ' + p.interest);
  if (p.teacher) lines.push('Preferred teacher: ' + p.teacher);
  var next = { qualified: ['Match to a group or teacher and offer the spot', 2],
    waitlist: ['Waitlist check-in: any seat open yet?', 21],
    longterm: ['Long-term follow-up: check in personally', 45],
    sitin: ['Follow up after the sit-in' + (p.sitInGroup ? ' at ' + p.sitInGroup : ''), 2] }[path];
  if (path === 'sitin') lines.push('Sit-in' + (p.sitInGroup ? ' at ' + p.sitInGroup : '') + (p.sitIn ? ' on ' + p.sitIn : ''));
  var stage = { qualified: 'Qualified', waitlist: 'Qualified', longterm: 'Nurture', sitin: 'Qualified' }[path];
  var notes = tab_(NOTES_TAB, ['Timestamp', 'MMS ID', 'Email', 'Author', 'Kind', 'Text', 'Due', 'Owner', 'Done']);
  notes.appendRow([new Date(), sid, String(p.email || '').toLowerCase(), who, 'call', lines.join('\n'), '', '', '']);
  var done = [];
  if (stage) { setLeadTag_(who, { sid: sid, email: p.email, field: 'stage', value: stage }); done.push('Stage set to ' + stage); }
  if (path === 'waitlist') {
    var mw = mmsStudent_(sid);
    if (!mw || mw.Status !== 'Waiting') { setStatus_(sid, 'Waiting'); done.push('MMS status set to Waiting'); }
    rosterStatus_(sid, 'Waiting');
  }
  if (next) {
    var due = p.followUp ? String(p.followUp) : '';
    if (!due) {
      var base = path === 'sitin' && p.sitIn ? new Date(p.sitIn + 'T12:00:00') : new Date();
      due = Utilities.formatDate(new Date(base.getTime() + next[1] * 864e5), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
    nextDone_(who, { sid: sid, email: p.email });
    notes.appendRow([new Date(), sid, String(p.email || '').toLowerCase(), who, 'next_step', next[0], due, who.split('@')[0], '']);
    done.push('Next step: ' + next[0] + ' (' + due + ')');
  }
  return { ok: true, done: done };
}

// ---------- email a group (one-to-one copies from this inbox) ----------

/**
 * p: { sids: [...], subject, body, test }
 * Sends each person their own copy from this inbox ({first} becomes their first
 * name), logs it on their timeline, and caps a send at 50 people (rule 3: bigger
 * lists belong in Mailchimp). test: sends one copy, filled in for the first person,
 * to whoever is signed in.
 */
var GROUP_MAIL_MAX = 50;
function sendGroupEmail_(who, p) {
  var subject = String(p.subject || '').trim(), body = String(p.body || '').trim();
  if (!subject || !body) throw new Error('Add a subject and a message.');
  var want = {}; (p.sids || []).forEach(function (s) { want[String(s)] = true; });
  var people = rosterRows_().filter(function (r) { return want[r.ID] && /@/.test(String(r.Email)); });
  if (!people.length) throw new Error('None of these people have an email address in MMS.');
  if (people.length > GROUP_MAIL_MAX) throw new Error('That is ' + people.length + ' people. Send to ' + GROUP_MAIL_MAX + ' or fewer from here, or use Mailchimp.');
  var fill = function (s, r) { return s.replace(/\{first\}/gi, r.First || String(r.Name).split(' ')[0] || 'there'); };
  var opts = { name: 'North Star Jazz Workshops' };
  if (p.test) {
    GmailApp.sendEmail(who, '[Test] ' + fill(subject, people[0]), fill(body, people[0]), opts);
    return { ok: true, test: true, to: who };
  }
  // MailApp needs its own OAuth scope this script was never granted; GmailApp has no quota call.
  // So check when we can, and otherwise let GmailApp's own limit error come back per person.
  var left = null;
  try { left = MailApp.getRemainingDailyQuota(); } catch (e) {}
  if (left != null && left < people.length) throw new Error('Gmail has fewer than ' + people.length + ' sends left today. Try tomorrow.');
  var sent = [], failed = [], now = new Date();
  people.forEach(function (r) {
    try { GmailApp.sendEmail(String(r.Email).trim(), fill(subject, r), fill(body, r), opts); sent.push(r); }
    catch (e) { failed.push(r.Name); }
  });
  if (sent.length) {
    var n = tab_(NOTES_TAB, ['Timestamp', 'MMS ID', 'Email', 'Author', 'Kind', 'Text', 'Due', 'Owner', 'Done']);
    n.getRange(n.getLastRow() + 1, 1, sent.length, 9).setValues(sent.map(function (r) {
      return [now, r.ID, String(r.Email).toLowerCase(), who, 'email', (people.length === 1 ? 'Email: ' : 'Group email: ') + subject, '', '', ''];
    }));
  }
  return { ok: true, sent: sent.length, failed: failed };
}

// ---------- add a member to their ensemble's MMS calendar events ----------
//
// Billing comes from the calendar: an attendee on a group's events is charged
// through their billing profile with that event's teacher. The API cannot read or
// safely create billing profiles (an assignment to a teacher whose events generate
// charges once back-billed a whole roster), so Ben sets the teacher and price in
// MMS first and ticks that he did. This only adds the attendee, after a preview.

/** "Group 6" -> events whose description is "Ensemble 6 ..." from today out ~6 months. */
var EVENTS_MEMO_ = {};
function ensembleEvents_(days) {
  if (EVENTS_MEMO_[days]) return EVENTS_MEMO_[days];
  var tz = Session.getScriptTimeZone(), now = new Date();
  var from = Utilities.formatDate(now, tz, "yyyy-MM-dd'T'00:00:00");
  var to = Utilities.formatDate(new Date(now.getTime() + days * 864e5), tz, "yyyy-MM-dd'T'23:59:59");
  var rows = mms_('post', 'search/calendar/events', { StartDate: from, EndDate: to, EventCategoryIDs: ['ect_q531JP', 'ect_TFGxJD'] }) || [];
  return (EVENTS_MEMO_[days] = rows);
}
/** "Group 6" -> its MMS rehearsals from today out `days` (default ~6 months), soonest first. */
function groupEvents_(group, days) {
  var m = /^Group (\d+)$/.exec(String(group));
  if (!m) throw new Error('Adding to the calendar works for numbered ensembles (Group N) for now. Add ' + group + ' in MMS.');
  // MMS names vary: "Ensemble 6 Rehearsal", "Group 1 Rehearsal", "Group 21 - 1st & 3rd Tuesdays..."
  var re = new RegExp('^(Ensemble|Group) ' + m[1] + '(\\D|$)', 'i');
  return ensembleEvents_(days || 183).filter(function (e) { return re.test(String(e.Description || '')); })
    .sort(function (a, b) { return String(a.StartDate).localeCompare(String(b.StartDate)); });
}

function calPreview_(who, p) {
  var sid = String(p.sid || ''), group = String(p.group || '');
  if (!/^sdt_/.test(sid)) throw new Error('This person is not in MMS yet.');
  var evs = groupEvents_(group);
  var st = mmsStudent_(sid);
  var fam = st && st.FamilyID ? mmsFamily_(st.FamilyID) : null;
  var teachers = {};
  var out = evs.map(function (e) {
    var t = (e.Teacher && e.Teacher.Name) || '';
    teachers[t] = true;
    var ids = (e.Attendances || []).map(function (a) { return a.StudentID; });
    return { id: e.ID, start: e.StartDate, mins: e.Duration, title: e.Description, teacher: t,
      people: ids.length, already: ids.indexOf(sid) >= 0 };
  });
  return { group: group, events: out, teachers: Object.keys(teachers).filter(Boolean),
    status: st ? st.Status : '', autoInvoicing: fam ? !!fam.AutoInvoicingEnabled : null };
}

function calAdd_(who, p) {
  var sid = String(p.sid || ''), group = String(p.group || '');
  if (!/^sdt_/.test(sid)) throw new Error('This person is not in MMS yet.');
  if (p.billingDone !== true) throw new Error('Set up their teacher and billing in MMS first, then tick the box.');
  var want = {}; (p.ids || []).forEach(function (x) { want[String(x)] = true; });
  if (!Object.keys(want).length) throw new Error('Pick at least one rehearsal.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another change is running. Try again in a moment.');
  var added = [], skipped = [], failed = '';
  try {
    var evs = groupEvents_(group).filter(function (e) { return want[e.ID]; });
    for (var i = 0; i < evs.length; i++) {
      var e = evs[i];
      var before = (e.Attendances || []).map(function (a) { return a.StudentID; });
      if (before.indexOf(sid) >= 0) { skipped.push(e.StartDate); continue; }
      var body = {
        ID: e.ID, EventCategoryID: e.EventCategory && e.EventCategory.ID,
        EventLocationID: e.EventLocation ? e.EventLocation.ID : null,
        TeacherID: e.TeacherID, OriginalTeacherID: e.OriginalTeacherID,
        StartDate: e.StartDate, EndDate: e.EndDate, Duration: e.Duration,
        Description: e.Description, DisplayDescriptionOnCalendar: e.DisplayDescriptionOnCalendar,
        IsPublic: e.IsPublic, AllDay: e.AllDay, Recurring: e.Recurring, RepeatDetails: e.RepeatDetails,
        PricePerParticipantType: e.PricePerParticipantType, PricePerParticipant: e.PricePerParticipant,
        StudentIDs: before.concat([sid])
      };
      Utilities.sleep(600);
      mms_('put', 'calendar/events/' + e.ID, body);
      Utilities.sleep(900);
      var day = String(e.StartDate).slice(0, 10);
      var back = (mms_('post', 'search/calendar/events', { StartDate: day + 'T00:00:00', EndDate: day + 'T23:59:59',
        TeacherIDs: [e.TeacherID] }) || []).filter(function (x) { return x.ID === e.ID; })[0];
      var after = back ? (back.Attendances || []).map(function (a) { return a.StudentID; }) : [];
      var lost = before.filter(function (x) { return after.indexOf(x) < 0; });
      if (!back || after.indexOf(sid) < 0 || lost.length || back.TeacherID !== e.TeacherID) {
        failed = 'Stopped at ' + day + ': MMS did not confirm the change' + (lost.length ? ' and ' + lost.length + ' attendee(s) went missing' : '') +
          '. Check that event in MMS.';
        break;
      }
      added.push(e.StartDate);
    }
  } finally {
    lock.releaseLock();
    if (added.length || failed) {
      tab_(NOTES_TAB, ['Timestamp', 'MMS ID', 'Email', 'Author', 'Kind', 'Text', 'Due', 'Owner', 'Done'])
        .appendRow([new Date(), sid, String(p.email || '').toLowerCase(), who, 'change',
          'Added to ' + added.length + ' ' + group + ' rehearsal' + (added.length === 1 ? '' : 's') + ' in MMS' +
          (failed ? '. ' + failed : '') + '. Check the family ledger in MMS for the $150 monthly charge.', '', '', '']);
    }
  }
  if (failed) throw new Error((added.length ? 'Added ' + added.length + '. ' : '') + failed);
  return { ok: true, added: added.length, skipped: skipped.length };
}
