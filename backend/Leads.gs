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

var LEAD_STAGES = ['New Lead', 'Qualified', 'Deposit Submitted', 'Nurture', 'Closed'];
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
  if (t) return t;
  if (r.Status === 'Active') return 'Enrolled';
  if (r.Status === 'Inactive') return 'Closed';
  // An "Ensemble Deposit" form on file means they paid, even if nobody tagged it yet.
  if (/\(Ensemble Deposit\)/.test(String(r.Note || ''))) return 'Deposit Submitted';
  return 'New Lead';
}

function listLeads_() {
  return { options: leadOptions_(), leads: leadRows_() };
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
      formInterests: formInterests_(s.interested),
      formInstruments: formInstruments_(s.instrument),
      lastContact: n.last ? gday_(n.last) : '',
      notes: n.count || 0,
      next: n.next ? { text: n.next.Text, due: gday_(n.next.Due), owner: n.next.Owner } : null
    };
  });
}

function formInterests_(s) {
  s = String(s || '').toLowerCase();
  var out = [];
  if (/ensemble|small group/.test(s)) out.push('Ensemble');
  if (/private/.test(s)) out.push('Private lessons');
  if (/foundation/.test(s)) out.push('Foundations');
  if (/(^|[^r])class|course/.test(s)) out.push('Classes');
  if (/workshop|masterclass|clinic/.test(s)) out.push('Clinics');
  if (/voice|vocal|sing/.test(s)) out.push('Voice');
  return out;
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
function tagWrite_(sid, name, on) {
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
  Utilities.sleep(600);
  var ids = members_(g.ID);
  if (g.StudentCount != null && ids.length !== Number(g.StudentCount)) {
    throw new Error('Stopped: MMS says "' + name + '" has ' + g.StudentCount + ' people but only ' + ids.length +
      ' came back. Nothing was changed.');
  }
  var has = ids.indexOf(sid) >= 0;
  if (has === on) return { changed: false };
  var next = on ? ids.concat([sid]) : ids.filter(function (x) { return x !== sid; });
  var body = {};
  Object.keys(g).forEach(function (k) { body[k] = g[k]; });
  body.StudentIDs = next;
  body.Students = null;
  Utilities.sleep(600);
  mms_('put', 'studentgroups/' + g.ID, body);
  Utilities.sleep(800);
  var after = members_(g.ID);
  var ok = (after.indexOf(sid) >= 0) === on && after.length === next.length;
  if (!ok) throw new Error('MMS did not confirm the change to "' + name + '". Check the tag in MMS.');
  return { changed: true };
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
      if (p.value !== 'New Lead') { tagWrite_(sid, 'Stage: ' + p.value, true); rosterTag_(sid, 'Stage: ' + p.value, true); }
      changes.push('Stage set to ' + p.value);
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
