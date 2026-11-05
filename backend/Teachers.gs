/**
 * Teachers: each teacher's week and sub requests.
 *
 * Who is a teacher comes from MMS (GET teachers), matched on the signed-in
 * northstarjazzworkshops.com email. Their groups come from the Groups tab
 * (Teacher column) and their private lessons from the Lessons tab.
 *
 * Sub requests live in the "Subs" tab. The requesting teacher picks who to ask;
 * each person asked gets an email from this inbox with an "I can cover it" link.
 * First yes wins: the requester and Ben get told, everyone else asked is told
 * it's covered. Changing the teacher on the MMS calendar event stays a manual
 * step (calendar writes need Ben's eyes), so Today lists it for Ben.
 */

var SUBS_TAB = 'Subs';
var SUBS_HEAD = ['ID', 'Created', 'Requested by', 'Teacher', 'Class', 'Date', 'Time', 'Note', 'Asked', 'Status', 'Covered by', 'Covered at'];
var SUB_ADMIN = 'hello@northstarjazzworkshops.com';

function mmsTeachers_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('mmsteachers');
  if (hit) return JSON.parse(hit);
  var seen = {}, out = [];
  mms_('get', 'teachers').forEach(function (t) {
    var email = String((t.Email && t.Email.EmailAddress) || '').trim().toLowerCase();
    if (!email || seen[email]) return;
    seen[email] = true;
    out.push({ id: t.ID, name: t.FullName || t.Name || '', first: t.FirstName || String(t.FullName || '').split(' ')[0], email: email });
  });
  out.sort(function (a, b) { return a.name.localeCompare(b.name); });
  cache.put('mmsteachers', JSON.stringify(out), 21600);
  return out;
}

function teacherOf_(email) {
  email = String(email || '').toLowerCase();
  return mmsTeachers_().filter(function (t) { return t.email === email; })[0] || null;
}

// "Chris Bates" matches a Teacher cell of "Chris Bates" or "Joe Hartnett / Chris Bates"; a bare first name only if that is the whole cell.
function teaches_(cell, t) {
  var c = String(cell || '').toLowerCase().trim();
  if (!c) return false;
  return c.indexOf(t.name.toLowerCase()) >= 0 || c === t.first.toLowerCase();
}

function subRows_() {
  return sheetObjects_(SUBS_TAB).map(function (r) {
    return { id: r.ID, created: r.Created, by: r['Requested by'], teacher: r.Teacher, cls: r.Class,
      date: gday_(r.Date), time: r.Time, note: r.Note, asked: split_(r.Asked), status: r.Status,
      coveredBy: r['Covered by'], coveredAt: r['Covered at'] };
  });
}

/** The signed-in teacher's week. Ben can preview anyone's with p.as (a teacher email). */
function myTeaching_(who, p) {
  var t = teacherOf_(who === SUB_ADMIN && p.as ? p.as : who);
  var out = { teacher: null, groups: [], lessons: [], mine: [], asked: [], teachers: [], admin: who === SUB_ADMIN };
  var today = Utilities.formatDate(new Date(Date.now() - 864e5), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var subs = subRows_().filter(function (s) { return s.date >= today && s.status !== 'Cancelled'; });
  if (out.admin) out.allSubs = subs;
  if (!t) return out;
  out.teacher = t;
  out.groups = listGroups_().filter(function (g) { return g.when !== 'Past' && teaches_(g.teacher, t); })
    .map(function (g) { return { name: g.name, kind: g.kind, schedule: g.schedule, when: g.when, members: g.members }; });
  out.lessons = sheetObjects_(LESSONS_TAB).filter(function (l) {
    return (l.Stage === 'Active' || l.Stage === 'Scheduling') && teaches_(l.Teacher, t);
  }).map(function (l) { return { sid: l['MMS ID'], name: l.Name, when: l['Day and time'], instrument: l.Instrument, frequency: l.Frequency, stage: l.Stage }; });
  out.mine = subs.filter(function (s) { return String(s.by).toLowerCase() === t.email; });
  out.asked = subs.filter(function (s) { return s.asked.indexOf(t.email) >= 0 && String(s.by).toLowerCase() !== t.email; });
  out.teachers = mmsTeachers_().filter(function (x) { return x.email !== t.email; });
  return out;
}

function subSecret_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('SUB_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('SUB_SECRET', s); }
  return s;
}
function subSig_(id, email) {
  var raw = Utilities.computeHmacSha256Signature(id + '|' + email, subSecret_());
  return Utilities.base64EncodeWebSafe(raw).replace(/=+$/, '').slice(0, 22);
}
function subLink_(id, email) {
  return ScriptApp.getService().getUrl() + '?sub=' + encodeURIComponent(id) + '&e=' + encodeURIComponent(email) + '&s=' + subSig_(id, email);
}
function subWhen_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s.date || ''));
  var d = m ? new Date(+m[1], m[2] - 1, +m[3]) : null;
  return (d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'EEEE, MMMM d') : String(s.date)) + (s.time ? ' at ' + s.time : '');
}

/** A teacher asks for a sub and picks who to ask. */
function requestSub_(who, p) {
  var t = teacherOf_(who === SUB_ADMIN && p.as ? p.as : who);
  if (!t) throw new Error('Only teachers in MMS can ask for a sub.');
  var cls = String(p.cls || '').trim(), date = String(p.date || '').trim();
  if (!cls || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Pick the class and the date.');
  var all = {}; mmsTeachers_().forEach(function (x) { all[x.email] = x; });
  var to = (p.to || []).map(function (e) { return String(e).toLowerCase(); }).filter(function (e) { return all[e] && e !== t.email; });
  if (!to.length) throw new Error('Pick at least one teacher to ask.');
  var s = { id: 'sub_' + Utilities.getUuid().slice(0, 8), date: date, time: String(p.time || '').trim(), cls: cls, note: String(p.note || '').trim() };
  tab_(SUBS_TAB, SUBS_HEAD).appendRow([s.id, new Date(), t.email, t.name, s.cls, s.date, s.time, s.note, to.join('; '), 'Open', '', '']);
  var opts = { name: 'North Star Jazz Workshops', replyTo: t.email };
  to.forEach(function (e) {
    var x = all[e];
    GmailApp.sendEmail(e, 'Sub needed: ' + s.cls + ', ' + subWhen_(s),
      'Hi ' + x.first + ',\n\n' + t.name + ' needs a sub for ' + s.cls + ' on ' + subWhen_(s) + '.' +
      (s.note ? '\n\n' + s.note : '') +
      '\n\nCan you cover it? Tap here to take it:\n' + subLink_(s.id, e) +
      '\n\nFirst one to say yes gets it. If you can\'t, no need to reply.\n\nNorth Star Jazz Workshops', opts);
  });
  GmailApp.sendEmail(t.email, 'Sub request sent: ' + s.cls + ', ' + subWhen_(s),
    'We asked ' + to.map(function (e) { return all[e].name; }).join(', ') + ' to cover ' + s.cls + ' on ' + subWhen_(s) +
    '. You will get an email as soon as someone says yes.\n\nNorth Star Jazz Workshops',
    { name: 'North Star Jazz Workshops', cc: t.email === SUB_ADMIN ? '' : SUB_ADMIN });
  return { ok: true, id: s.id, asked: to.length };
}

/** Taking a sub, from the email link (signed) or from the app. First yes wins. */
function takeSub_(id, email) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = tab_(SUBS_TAB, SUBS_HEAD), v = sh.getDataRange().getValues(), h = v[0];
    var c = {}; h.forEach(function (k, i) { c[k] = i; });
    for (var i = 1; i < v.length; i++) {
      if (v[i][c.ID] !== id) continue;
      var row = v[i], s = { id: id, cls: row[c.Class], date: gday_(row[c.Date]), time: row[c.Time] };
      var me = teacherOf_(email) || { name: email, email: email, first: '' };
      if (split_(row[c.Asked]).indexOf(email) < 0) return { ok: false, msg: 'This request was not sent to you.' };
      if (row[c.Status] === 'Cancelled') return { ok: false, msg: 'This sub is no longer needed. Thanks anyway!' };
      if (row[c.Status] === 'Covered') {
        return String(row[c['Covered by']]).toLowerCase().indexOf(email) >= 0
          ? { ok: true, msg: 'You are already down to cover ' + s.cls + ' on ' + subWhen_(s) + '. Thank you!' }
          : { ok: false, msg: 'Someone already took this one. Thanks for offering!' };
      }
      sh.getRange(i + 1, c.Status + 1).setValue('Covered');
      sh.getRange(i + 1, c['Covered by'] + 1).setValue(me.name + ' <' + email + '>');
      sh.getRange(i + 1, c['Covered at'] + 1).setValue(new Date());
      var opts = { name: 'North Star Jazz Workshops' };
      var by = String(row[c['Requested by']]).toLowerCase();
      GmailApp.sendEmail(by, 'Covered: ' + s.cls + ', ' + subWhen_(s),
        me.name + ' will cover ' + s.cls + ' on ' + subWhen_(s) + '.\n\nNorth Star Jazz Workshops',
        { name: opts.name, cc: by === SUB_ADMIN ? '' : SUB_ADMIN });
      split_(row[c.Asked]).forEach(function (e) {
        if (e === email) return;
        GmailApp.sendEmail(e, 'Covered, thanks: ' + s.cls + ', ' + subWhen_(s),
          'Thanks for looking. ' + me.name + ' is covering ' + s.cls + ' on ' + subWhen_(s) + ', so nothing needed from you.\n\nNorth Star Jazz Workshops', opts);
      });
      return { ok: true, msg: 'You are covering ' + s.cls + ' on ' + subWhen_(s) + '. Thank you! ' + row[c.Teacher] + ' has been told.' };
    }
    return { ok: false, msg: 'We could not find that sub request.' };
  } finally { lock.releaseLock(); }
}

function takeSubApi_(who, p) { return takeSub_(String(p.id || ''), String(who).toLowerCase()); }

function cancelSub_(who, p) {
  var sh = tab_(SUBS_TAB, SUBS_HEAD), v = sh.getDataRange().getValues(), h = v[0];
  var c = {}; h.forEach(function (k, i) { c[k] = i; });
  for (var i = 1; i < v.length; i++) {
    if (v[i][c.ID] !== p.id) continue;
    var by = String(v[i][c['Requested by']]).toLowerCase();
    if (by !== String(who).toLowerCase() && who !== SUB_ADMIN) throw new Error('Only the teacher who asked can cancel this.');
    sh.getRange(i + 1, c.Status + 1).setValue('Cancelled');
    var s = { cls: v[i][c.Class], date: gday_(v[i][c.Date]), time: v[i][c.Time] };
    split_(v[i][c.Asked]).forEach(function (e) {
      GmailApp.sendEmail(e, 'No longer needed: ' + s.cls + ', ' + subWhen_(s),
        'Good news, the sub for ' + s.cls + ' on ' + subWhen_(s) + ' is no longer needed.\n\nNorth Star Jazz Workshops', { name: 'North Star Jazz Workshops' });
    });
    return { ok: true };
  }
  throw new Error('Not found');
}

/** The page a teacher sees after tapping the link in the email. */
function subPage_(p) {
  var id = String(p.sub || ''), email = String(p.e || '').toLowerCase(), res;
  if (!id || !email || p.s !== subSig_(id, email)) res = { ok: false, msg: 'That link does not look right. Reply to the email and we will sort it out.' };
  else res = takeSub_(id, email);
  var esc = function (x) { return String(x).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; }); };
  return HtmlService.createHtmlOutput(
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>North Star Jazz Workshops</title></head>' +
    '<body style="margin:0;font-family:Helvetica,Arial,sans-serif;background:#F6F5EA;color:#1A1A1A">' +
    '<div style="background:#204E46;color:#FFFFED;padding:28px 24px;font-family:Georgia,serif;font-size:26px">' + (res.ok ? 'Thank you' : 'North Star') + '</div>' +
    '<p style="padding:24px;font-size:18px;line-height:1.5;max-width:520px">' + esc(res.msg) + '</p></body></html>'
  ).setTitle('North Star Jazz Workshops');
}
