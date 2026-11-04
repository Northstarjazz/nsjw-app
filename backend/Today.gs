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
  var deposits = open.filter(function (l) { return l.stage === 'Deposit Submitted'; });

  // Who could fill each open ensemble seat: waiting, trial, or a lead from the last six months.
  var soon = new Date(t0.getTime() - 180 * 864e5);
  var pool = open.filter(function (l) {
    if (l.status === 'Waiting' || l.status === 'Trial' || l.stage === 'Deposit Submitted' || l.stage === 'Qualified') return true;
    var s = d(l.started); return s && s >= soon;
  });
  var seats = groups.filter(function (g) { return g.when === 'Current' && g.open.length; }).map(function (g) {
    var need = {}; g.open.forEach(function (s) { need[s] = true; });
    var n = pool.filter(function (l) {
      var inst = l.instruments.length ? l.instruments : l.formInstruments;
      return inst.some(function (i) { return need[seat_(i)]; });
    }).length;
    return { name: g.name, schedule: g.schedule, teacher: g.teacher, open: g.open, matches: n };
  }).sort(function (a, b) { return b.matches - a.matches; });

  function slim(l) { return { id: l.id, name: l.name, stage: l.stage, next: l.next, started: l.started,
    instruments: l.instruments.length ? l.instruments : l.formInstruments,
    interests: l.interests.length ? l.interests : l.formInterests, source: l.form.source || '' }; }

  return {
    stats: { active: active.length, joined: joined, leads: open.length,
      seats: groups.filter(function (g) { return g.when === 'Current'; }).reduce(function (n, g) { return n + g.open.length; }, 0) },
    follow: follow.slice(0, 15).map(slim), followCount: follow.length,
    fresh: fresh.slice(0, 10).map(slim), freshCount: fresh.length,
    deposits: deposits.map(slim),
    seats: seats.slice(0, 8)
  };
}
