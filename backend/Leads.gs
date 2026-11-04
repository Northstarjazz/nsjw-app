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
    if (/^instrument/.test(k)) out.instrument = m[2].trim();
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
  var bySid = {};
  notes.forEach(function (n) {
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
    return {
      id: r.ID, name: r.Name, status: r.Status, email: r.Email, phone: r.Phone,
      started: gday_(r.Started), skill: r['Skill level'],
      stage: stageOf_(r, tags),
      instruments: split_(r.Instruments),
      interests: tags.filter(function (t) { return /^Interest: /.test(t); }).map(function (t) { return t.slice(10); }),
      nights: tags.filter(function (t) { return /^Nights: /.test(t); }).map(function (t) { return t.slice(8); }),
      programs: split_(r.Programs),
      form: s,
      formInterests: formInterests_(s.interested, s.form),
      formInstruments: formInstruments_(s.instrument),
      lastContact: n.last ? gday_(n.last) : '',
      stageAt: n.stageAt ? gday_(n.stageAt) : '',
      track: track_(tracksOf_(tags, s)),
      tracks: tracksOf_(tags, s),
      notes: n.count || 0,
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
  var sid = String(p.sid || ''), group = String(p.group || '');
  if (!/^sdt_/.test(sid)) throw new Error('This person is not in MMS yet.');
  var known = listGroups_().map(function (g) { return g.name; });
  if (known.indexOf(group) < 0) throw new Error('Unknown group');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another change is running. Try again in a moment.');
  var done = [];
  try {
    tagWrite_(sid, group, true); done.push('Tagged ' + group);
    if (/^Group \d+/.test(group)) {
      try { tagWrite_(sid, 'Ensemble Member', true); done.push('Tagged Ensemble Member'); }
      catch (e) { done.push('Add the Ensemble Member tag in MMS (it has teachers on it)'); }
    }
    var r = rosterRows_().filter(function (x) { return x.ID === sid; })[0];
    split_(r ? r['Other tags'] : '').filter(function (t) { return /^Stage: /.test(t); }).forEach(function (t) {
      tagWrite_(sid, t, false); rosterTag_(sid, t, false);
    });
    if (!r || r.Status !== 'Active') { setStatus_(sid, 'Active'); done.push('Status set to Active'); }
    rosterProgram_(sid, group, 'Active');
  } finally {
    lock.releaseLock();
    if (done.length) {
      tab_(NOTES_TAB, ['Timestamp', 'MMS ID', 'Email', 'Author', 'Kind', 'Text', 'Due', 'Owner', 'Done'])
        .appendRow([new Date(), sid, String(p.email || '').toLowerCase(), who, 'change', 'Placed in ' + group + ': ' + done.join('; '), '', '', '']);
    }
  }
  return { ok: true, done: done };
}

function setStatus_(sid, status) {
  var before = mms_('get', 'students/' + sid);
  if (Array.isArray(before)) before = before[0];
  if (!before || before.ID !== sid) throw new Error('Could not read the student from MMS.');
  var body = JSON.parse(JSON.stringify(before));
  body.Status = status;
  Utilities.sleep(600);
  mms_('put', 'students/' + sid, body);
  Utilities.sleep(800);
  var after = mms_('get', 'students/' + sid);
  if (Array.isArray(after)) after = after[0];
  if (!after || after.Status !== status) throw new Error('MMS did not take the status change. Check the student in MMS.');
  var drift = Object.keys(before).filter(function (k) {
    if (k === 'Status' || k === 'Active' || k === 'AccessStatus' || k === 'LastLogin') return false;
    var a = before[k], b = after[k];
    if ((a === '' || a == null) && (b === '' || b == null)) return false;
    return JSON.stringify(a) !== JSON.stringify(b);
  });
  if (drift.length) {
    tab_(NOTES_TAB).appendRow([new Date(), sid, '', 'app', 'change', 'Check in MMS: status change also touched ' + drift.join(', '), '', '', '']);
  }
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
    if (end && r.Status !== 'Inactive') {
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
