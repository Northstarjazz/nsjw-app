/**
 * Today: one call that answers "what needs me right now". Built from the same
 * pieces as Leads and Groups, so there is nothing new to keep in sync.
 */
function today_() {
  var roster = rosterRows_();
  var leads = leadRows_();
  var groups = listGroups_();
  var t0 = new Date(new Date().toDateString());
  var monthStart = new Date(t0.getFullYear(), t0.getMonth(), 1);
  var recent = new Date(t0.getTime() - 14 * 864e5);
  function d(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? new Date(+m[1], m[2] - 1, +m[3]) : null; }

  var active = roster.filter(function (r) { return r.Status === 'Active'; });
  var joined = active.filter(function (r) { var s = d(gday_(r.Started)); return s && s >= monthStart; }).length;
  var open = leads.filter(function (l) { return l.stage !== 'Closed' && l.stage !== 'Enrolled'; });

  var follow = open.filter(function (l) { var due = l.next && d(l.next.due); return due && due <= t0; })
    .sort(function (a, b) { return String(a.next.due).localeCompare(String(b.next.due)); });
  var fresh = open.filter(function (l) { var s = d(l.started); return s && s >= recent && !l.notes; })
    .sort(function (a, b) { return String(b.started).localeCompare(String(a.started)); });
  var deposits = open.filter(function (l) { return l.stage === 'Committed'; });

  // Who could fill each open ensemble seat, same rules as the group page:
  // waitlist, trial, Committed or Qualified, or a lead from the last year who wants an ensemble.
  var soon = new Date(t0.getTime() - 365 * 864e5), seen = {};
  var pool = open.filter(function (l) {
    if (l.stage === 'Nurture' || l.status === 'Active' || l.status === 'Inactive') return false;
    var key = String(l.name).toLowerCase().replace(/[^a-z]/g, '') + '|' + String(l.email).toLowerCase();
    if (seen[key]) return false; seen[key] = true;
    if (l.status === 'Waiting' || l.status === 'Trial' || l.stage === 'Committed' || l.stage === 'Qualified') return true;
    var s = d(l.started); return s && s >= soon && (l.interests || []).indexOf('Ensemble') >= 0;
  });
  var seats = groups.filter(function (g) { return g.when === 'Current' && g.open.length; }).map(function (g) {
    var need = {}; g.open.forEach(function (s) { need[s] = true; });
    var bySeat = {}, n = 0;
    pool.forEach(function (l) {
      var inst = l.instruments.length ? l.instruments : l.formInstruments, hit = false;
      inst.forEach(function (i) { var st = seat_(i); if (need[st]) { bySeat[st] = (bySeat[st] || 0) + 1; hit = true; } });
      if (hit) n++;
    });
    return { name: g.name, schedule: g.schedule, teacher: g.teacher, open: g.open, matches: n, bySeat: bySeat };
  }).sort(function (a, b) { return b.matches - a.matches; });

  function slim(l) { return { id: l.id, name: l.name, stage: l.stage, next: l.next, started: l.started,
    instruments: l.instruments.length ? l.instruments : l.formInstruments,
    interests: l.interests.length ? l.interests : l.formInterests, source: l.form.source || '' }; }

  return {
    numbers: numbers_(roster, groups, t0),
    stats: { active: active.length, joined: joined, leads: open.length,
      seats: groups.filter(function (g) { return g.when === 'Current'; }).reduce(function (n, g) { return n + g.open.length; }, 0) },
    follow: follow.slice(0, 15).map(slim), followCount: follow.length,
    fresh: fresh.slice(0, 10).map(slim), freshCount: fresh.length,
    deposits: deposits.map(slim),
    seats: seats.slice(0, 8)
  };
}

/**
 * The numbers strip: active students by program, ensemble fill, what happened to
 * people added in the last 90 days, and joins vs departures this month.
 * Program counts are snapshotted once a day (counts only) so we can show the
 * change from a month ago once a month of history exists.
 */
function numbers_(roster, groups, t0) {
  function d(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? new Date(+m[1], m[2] - 1, +m[3]) : null; }
  var active = roster.filter(function (r) { return r.Status === 'Active'; });
  var tags = {};
  active.forEach(function (r) { split_(r.Programs).forEach(function (t) { tags[t] = true; }); });
  var cfg = groupConfig_(Object.keys(tags));
  var bucket = { Ensemble: 'ensembles', Lessons: 'lessons', Class: 'classes', Clinic: 'clinics' };
  var prog = { ensembles: 0, lessons: 0, classes: 0, clinics: 0, none: 0 };
  active.forEach(function (r) {
    var seen = {};
    split_(r.Programs).forEach(function (t) {
      var g = cfg[t]; if (!g || g.When === 'Past') return;
      var b = bucket[g.Kind]; if (b) seen[b] = true;
    });
    var ks = Object.keys(seen);
    if (!ks.length) prog.none++;
    ks.forEach(function (k) { prog[k]++; });
  });

  var ens = groups.filter(function (g) { return g.kind === 'Ensemble' && g.when === 'Current' && g.capacity; });
  var cap = ens.reduce(function (n, g) { return n + g.capacity; }, 0);
  var open = ens.reduce(function (n, g) { return n + g.open.length; }, 0);

  var since = new Date(t0.getTime() - 90 * 864e5);
  var added = roster.filter(function (r) { var s = d(gday_(r.Started)); return s && s >= since; });
  var addedActive = added.filter(function (r) { return r.Status === 'Active'; }).length;

  var monthStart = new Date(t0.getFullYear(), t0.getMonth(), 1);
  var joined = active.filter(function (r) { var s = d(gday_(r.Started)); return s && s >= monthStart; }).length;
  var left = 0, tracking = null;
  var nsh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NOTES_TAB);
  if (nsh && nsh.getLastRow() > 1) {
    nsh.getRange(2, 1, nsh.getLastRow() - 1, 6).getValues().forEach(function (r) {
      var txt = String(r[5]);
      if (!/^(Left: |Membership ended)/.test(txt)) return;
      var ts = r[0] instanceof Date ? r[0] : new Date(r[0]);
      if (ts >= monthStart) left++;
    });
  }
  var snap = snapshot_(prog, active.length, t0);
  return { programs: prog, active: active.length, monthAgo: snap.monthAgo, historyFrom: snap.first,
    fill: { filled: cap - open, capacity: cap, open: open },
    added90: { total: added.length, active: addedActive },
    month: { joined: joined, left: left } };
}

function snapshot_(prog, active, t0) {
  var head = ['Date', 'Active', 'Ensembles', 'Lessons', 'Classes', 'Clinics'];
  var sh = tab_('Daily counts', head);
  var day = Utilities.formatDate(t0, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var v = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues() : [];
  var rows = v.map(function (r) { return { day: gday_(r[0]), active: r[1], ensembles: r[2], lessons: r[3], classes: r[4], clinics: r[5] }; });
  if (!rows.some(function (r) { return r.day === day; })) {
    sh.appendRow([day, active, prog.ensembles, prog.lessons, prog.classes, prog.clinics]);
    rows.push({ day: day });
  }
  var target = Utilities.formatDate(new Date(t0.getTime() - 30 * 864e5), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var older = rows.filter(function (r) { return r.day && r.day <= target; });
  return { first: rows.length ? rows[0].day : day, monthAgo: older.length ? older[older.length - 1] : null };
}
