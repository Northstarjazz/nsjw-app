/**
 * Groups: every ensemble, class and clinic, built from the program tags on the
 * MMS roster. Nothing about people is stored here; the "Groups" tab only holds
 * facts about each program (kind, when, schedule, teacher, level, seats) that
 * MMS has no field for. Ben edits that tab; new tags are added to it with a
 * best guess the first time they show up.
 */

var GROUPS_TAB = 'Groups';
var GROUPS_HEAD = ['Program', 'Kind', 'When', 'Schedule', 'Teacher', 'Level', 'Seats', 'Notes'];

// Seeded from the ensemble openings tracker (NSJW-Tools index.html).
var GROUP_SEED = {
  'Group 1': ['Sat 11am to 1pm · weeks 1 and 3', 1.7], 'Group 2': ['Sat 2 to 4pm · weeks 1 and 3', 4.0],
  'Group 3': ['Sun 12 to 2pm · weeks 1 and 3', 3.25], 'Group 4': ['Sun 2:30 to 4:30pm · weeks 1 and 3', 4.6],
  'Group 5': ['Mon 5:30 to 7:30pm · weeks 1 and 3', 2.6], 'Group 6': ['Mon 7:45 to 9:45pm · weeks 1 and 3', 2.0],
  'Group 7': ['Thu 5:30 to 7:30pm · weeks 1 and 3', 1.2], 'Group 8': ['Thu 7:45 to 9:45pm · weeks 1 and 3', 2.2],
  'Group 9': ['Sat 11am to 1pm · weeks 2 and 4', 3.6], 'Group 10': ['Sat 2 to 4pm · weeks 2 and 4', 3.5],
  'Group 11': ['Sun 12 to 2pm · weeks 2 and 4', 1.9], 'Group 12': ['Sun 2:30 to 4:30pm · weeks 2 and 4', 2.5],
  'Group 14': ['Mon 7:45 to 9:45pm · weeks 2 and 4', 3.0], 'Group 15': ['Thu 5:30 to 7:30pm · weeks 2 and 4', 2.3],
  'Group 16': ['Thu 7:45 to 9:45pm · weeks 2 and 4', 4.25], 'Group 17': ['Thu 7:45 to 9:45pm · weeks 2 and 4', 2.75],
  'Group 18': ['', 3.75]
};
// Standard small-group seats: one each of drums, bass, guitar, piano, three horns.
var ENSEMBLE_SEATS = 'Drums 1, Bass 1, Guitar 1, Piano 1, Horn 3';
var MONTHS_ = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, July: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  Winter: 0, Spring: 3, Summer: 6, Fall: 8 };

function seat_(instrument) {
  var i = String(instrument || '').toLowerCase();
  if (!i) return '';
  if (/drum|percuss|vibraphone/.test(i)) return 'Drums';
  if (/voice|vocal|sing/.test(i)) return 'Voice';
  if (/bass/.test(i) && !/sax|bari|trombone/.test(i)) return 'Bass';
  if (/guitar/.test(i)) return 'Guitar';
  if (/piano|keys|keyboard/.test(i)) return 'Piano';
  return 'Horn';
}

function guessGroup_(tag) {
  var kind = /^Group \d+|^Vocal Ensemble/.test(tag) ? 'Ensemble'
    : /Clinic|Workshop/.test(tag) ? 'Clinic' : /^Private Lessons/.test(tag) ? 'Lessons' : 'Class';
  var when = 'Current';
  var m = tag.match(/ - (\w+) (\d{4})$/);
  if (m && MONTHS_[m[1]] !== undefined) {
    var start = new Date(Number(m[2]), MONTHS_[m[1]], 1), now = new Date();
    var months = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth();
    when = months < 0 ? 'Upcoming' : months <= 2 ? 'Current' : 'Past';
  } else if (kind === 'Clinic') {
    when = 'Past';
  }
  var seed = GROUP_SEED[tag] || ['', ''];
  return [tag, kind, when, seed[0], '', seed[1], kind === 'Ensemble' && /^Group/.test(tag) ? ENSEMBLE_SEATS : '', ''];
}

/** The Groups tab as objects keyed by program tag; adds rows for tags it has not seen. */
function groupConfig_(tags) {
  var sh = tab_(GROUPS_TAB, GROUPS_HEAD);
  var have = {};
  sheetObjects_(GROUPS_TAB).forEach(function (g) { if (g.Program) have[g.Program] = g; });
  var add = tags.filter(function (t) { return !have[t]; }).sort(function (a, b) {
    return a.localeCompare(b, 'en', { numeric: true });
  }).map(guessGroup_);
  if (add.length) {
    sh.getRange(sh.getLastRow() + 1, 1, add.length, GROUPS_HEAD.length).setValues(add);
    add.forEach(function (r) { var o = {}; GROUPS_HEAD.forEach(function (h, i) { o[h] = r[i]; }); have[r[0]] = o; });
  }
  return have;
}

function parseSeats_(s) {
  var out = {};
  String(s || '').split(',').forEach(function (part) {
    var m = part.trim().match(/^(.+?)\s+(\d+)$/);
    if (m) out[m[1].trim()] = Number(m[2]);
  });
  return out;
}

function person_(r) {
  return { id: r.ID, name: r.Name, status: r.Status, instruments: r.Instruments, seat: seat_(split_(r.Instruments)[0]),
    skill: r['Skill level'], started: gday_(r.Started), lastEvent: gday_(r['Last event']) };
}

// Sheet dates come back as Date objects; send plain yyyy-mm-dd.
function gday_(v) {
  return v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') : day_(v);
}

/** List of every program with counts, open seats and fill. */
function listGroups_() {
  var roster = rosterRows_();
  var byTag = {};
  roster.forEach(function (r) {
    split_(r.Programs).forEach(function (t) { (byTag[t] = byTag[t] || []).push(r); });
  });
  var cfg = groupConfig_(Object.keys(byTag));
  return Object.keys(cfg).filter(function (t) { return cfg[t].Kind !== 'Lessons'; }).map(function (t) {
    return summary_(cfg[t], byTag[t] || []);
  }).sort(function (a, b) { return a.name.localeCompare(b.name, 'en', { numeric: true }); });
}

function summary_(g, rows) {
  var members = rows.filter(function (r) { return r.Status === 'Active' || r.Status === 'Trial'; });
  var seats = parseSeats_(g.Seats);
  var filled = {};
  members.forEach(function (r) { var s = seat_(split_(r.Instruments)[0]); filled[s] = (filled[s] || 0) + 1; });
  var open = [];
  Object.keys(seats).forEach(function (s) {
    for (var i = (filled[s] || 0); i < seats[s]; i++) open.push(s);
  });
  var cap = Object.keys(seats).reduce(function (n, s) { return n + seats[s]; }, 0);
  return { name: g.Program, kind: g.Kind, when: g.When || 'Current', schedule: g.Schedule, teacher: g.Teacher,
    level: g.Level, notes: g.Notes, members: members.length, others: rows.length - members.length,
    capacity: cap || null, open: open };
}

/** One program: members, people also tagged, open seats and who could fill them. */
function getGroup_(name) {
  var roster = rosterRows_();
  var rows = roster.filter(function (r) { return split_(r.Programs).indexOf(name) >= 0; });
  var cfg = groupConfig_([name])[name];
  var s = summary_(cfg, rows);
  s.memberList = rows.filter(function (r) { return r.Status === 'Active' || r.Status === 'Trial'; }).map(person_);
  s.otherList = rows.filter(function (r) { return !(r.Status === 'Active' || r.Status === 'Trial'); }).map(person_);
  var need = {};
  s.open.forEach(function (x) { need[x] = true; });
  var inGroup = {};
  rows.forEach(function (r) { inGroup[r.ID] = true; });
  var soon = new Date(Date.now() - 180 * 864e5);
  s.matches = roster.filter(function (r) {
    if (inGroup[r.ID]) return false;
    var inst = split_(r.Instruments);
    if (!inst.length) inst = formInstruments_(signup_(r.Note).instrument);
    if (!inst.some(function (i) { return need[seat_(i)]; })) return false;
    if (r.Status === 'Waiting' || r.Status === 'Trial') return true;
    return r.Status === 'Lead' && r.Started && new Date(r.Started) > soon;
  }).map(function (r) {
    var p = person_(r);
    if (!p.instruments) p.instruments = formInstruments_(signup_(r.Note).instrument).join(', ') + ' (from form)';
    return p;
  }).sort(function (a, b) {
    var rank = { Waiting: 0, Trial: 1, Lead: 2 };
    return (rank[a.status] - rank[b.status]) || String(b.started).localeCompare(String(a.started));
  }).slice(0, 25);
  return s;
}
