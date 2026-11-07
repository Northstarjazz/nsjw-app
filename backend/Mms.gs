/**
 * MMS sync: every write to a student goes through one guarded writer, every write is
 * logged, billing is read live, and a nightly check looks for billing that drifted.
 *
 * Writes that MMS accepts from the API (tested Nov 2026): student Status, Telephone,
 * SkillLevel, Referrer, and tag membership (Leads.gs tagWriteMany_). The student's
 * Email lives on the parent record, which the API ignores, so email changes stay in MMS.
 * Billing profiles are read-only through the API; changes to them stay in MMS.
 *
 * The change log never holds contact details: for phone it records only that it changed.
 */

var MMS_LOG_TAB = 'MMS changes';
var MMS_LOG_HEAD = ['Timestamp', 'Who', 'MMS ID', 'Action', 'Before', 'After', 'Result'];
var DRIFT_TAB = 'Billing check';
var DRIFT_HEAD = ['Month', 'MMS ID', 'Name', 'Problem', 'Detail', 'Checked'];
var CAT_NAMES = { ect_q531JP: 'Ensemble', ect_TFGxJD: 'Vocal Ensemble', ect_qk7jJc: 'Private Lesson',
  ect_qdmLJD: 'Discount', ect_qSMxJk: 'Ensemble Program', ect_qCkJJb: 'Classes' };
var WHO_ = ''; // the signed-in user for this request, set by api_

function mmsLog_(sid, action, before, after, result) {
  try {
    tab_(MMS_LOG_TAB, MMS_LOG_HEAD).appendRow([new Date(), WHO_ || 'app', sid || '', action,
      String(before == null ? '' : before).slice(0, 500), String(after == null ? '' : after).slice(0, 500), result || 'ok']);
  } catch (e) { Logger.log('mmsLog_: ' + e.message); }
}

// ---------- the guarded student writer ----------

function digits_(v) { return String(v || '').replace(/\D/g, ''); }

var STUDENT_FIELDS_ = {
  status: { label: 'Status', key: 'Status', log: true,
    get: function (s) { return s.Status || ''; },
    set: function (b, v) { b.Status = v; },
    same: function (a, b) { return a === b; } },
  phone: { label: 'Phone', key: 'Telephone', log: false,
    get: function (s) { return (s.Telephone && s.Telephone.TelephoneNumber) || ''; },
    set: function (b, v) {
      b.Telephone = b.Telephone ? JSON.parse(JSON.stringify(b.Telephone)) : { BlockedRecipientType: null, TextingAllowed: false };
      b.Telephone.TelephoneNumber = v;
    },
    same: function (a, b) { return digits_(a) === digits_(b); } },
  skill: { label: 'Skill level', key: 'SkillLevel', log: true,
    get: function (s) { return s.SkillLevel || ''; },
    set: function (b, v) { b.SkillLevel = v || null; },
    same: function (a, b) { return String(a || '') === String(b || ''); } },
  referrer: { label: 'Referred by', key: 'Referrer', log: true,
    get: function (s) { return s.Referrer || ''; },
    set: function (b, v) { b.Referrer = v || null; },
    same: function (a, b) { return String(a || '') === String(b || ''); } }
};
var VOLATILE_ = ['Active', 'AccessStatus', 'LastLogin', 'LastEventDate', 'NextEventDate', 'ParentAccessStatus'];

function getStudent_(sid) {
  var s = mms_('get', 'students/' + sid);
  if (Array.isArray(s)) s = s[0];
  if (!s || s.ID !== sid) throw new Error('Could not read the student from MMS.');
  return s;
}

/**
 * Change one or more fields on a student: read, change only those fields, write, read back,
 * confirm every field took and nothing else moved. Logged either way.
 * changes = { status: 'Active', phone: '6125551234', skill: 'Intermediate', referrer: '...' }
 */
function studentPut_(sid, changes) {
  var keys = Object.keys(changes).filter(function (k) { return STUDENT_FIELDS_[k]; });
  if (!keys.length) throw new Error('Nothing to change.');
  var before = getStudent_(sid);
  var todo = keys.filter(function (k) { return !STUDENT_FIELDS_[k].same(STUDENT_FIELDS_[k].get(before), changes[k]); });
  if (!todo.length) return { changed: false };
  var body = JSON.parse(JSON.stringify(before));
  todo.forEach(function (k) { STUDENT_FIELDS_[k].set(body, changes[k]); });
  function desc(s) { return todo.map(function (k) { var f = STUDENT_FIELDS_[k]; return f.label + ': ' + (f.log ? f.get(s) || '(blank)' : 'on file'); }).join('; '); }
  var action = 'Change ' + todo.map(function (k) { return STUDENT_FIELDS_[k].label.toLowerCase(); }).join(', ');
  Utilities.sleep(600);
  try {
    mms_('put', 'students/' + sid, body);
  } catch (e) {
    mmsLog_(sid, action, desc(before), '', 'failed: ' + e.message);
    throw e;
  }
  Utilities.sleep(800);
  var after = getStudent_(sid);
  var missed = todo.filter(function (k) { return !STUDENT_FIELDS_[k].same(STUDENT_FIELDS_[k].get(after), changes[k]); });
  var touched = todo.map(function (k) { return STUDENT_FIELDS_[k].key; });
  var drift = Object.keys(before).filter(function (k) {
    if (touched.indexOf(k) >= 0 || VOLATILE_.indexOf(k) >= 0) return false;
    var a = before[k], b = after[k];
    if ((a === '' || a == null) && (b === '' || b == null)) return false;
    return JSON.stringify(a) !== JSON.stringify(b);
  });
  var result = missed.length ? 'not confirmed: ' + missed.join(', ') : drift.length ? 'ok, but also changed ' + drift.join(', ') : 'ok';
  mmsLog_(sid, action, desc(before), desc(after), result);
  if (missed.length) throw new Error('MMS did not take the change to ' + missed.map(function (k) { return STUDENT_FIELDS_[k].label.toLowerCase(); }).join(', ') + '. Check the student in MMS.');
  // Write-through: the roster tab shows the new value now, not after the next 15-minute sync.
  var cols = { status: 'Status', phone: 'Phone', skill: 'Skill level' }, set = {};
  todo.forEach(function (k) { if (cols[k]) set[cols[k]] = STUDENT_FIELDS_[k].get(after); });
  rosterSet_(sid, set);
  return { changed: true, after: { phone: STUDENT_FIELDS_.phone.get(after), skill: after.SkillLevel || '', status: after.Status } };
}

/** Update cells on one roster row by header name. */
function rosterSet_(sid, set) {
  var names = Object.keys(set);
  if (!names.length) return;
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ROSTER_TAB);
  if (!sh || sh.getLastRow() < 2) return;
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] !== sid) continue;
    names.forEach(function (n) { var c = head.indexOf(n); if (c >= 0) sh.getRange(i + 2, c + 1).setValue(set[n]); });
    return;
  }
}

/** API: edit phone, skill level or referrer from the person page. */
function studentEdit_(who, p) {
  var sid = String(p.sid || '');
  if (!/^sdt_/.test(sid)) throw new Error('This person is not in MMS yet.');
  var field = String(p.field || ''), value = String(p.value == null ? '' : p.value).trim();
  if (['phone', 'skill', 'referrer'].indexOf(field) < 0) throw new Error('That field is changed in MMS.');
  if (field === 'phone') {
    var d = digits_(value);
    if (d.length === 11 && d[0] === '1') d = d.slice(1);
    if (d && d.length !== 10) throw new Error('Phone needs 10 digits.');
    value = d;
  }
  if (value.length > 100) throw new Error('That is too long.');
  var ch = {}; ch[field] = value;
  var r = studentPut_(sid, ch);
  var labels = { phone: 'phone', skill: 'skill level', referrer: 'referred by' };
  addNote_(who, { sid: sid, kind: 'note', text: 'Changed ' + labels[field] + ' in MMS' + (field === 'phone' ? '' : ' to ' + (value || '(blank)')) });
  return { ok: true, changed: r.changed, after: r.after };
}

// ---------- live billing for one person ----------

function teacherNames_() {
  var m = {};
  try { mmsTeachers_().forEach(function (t) { m[t.id] = t.name; }); } catch (e) {}
  return m;
}
function ym_(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM'); }
function iso_(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss"); }

/** Every page of a search (MMS returns one page per call). */
function searchAll_(entity, body) {
  var out = [], size = 500;
  for (var off = 0, page = 0; page < 40; page++, off += size) {
    if (page) Utilities.sleep(600);
    var rows = mms_('post', 'search/' + entity + '?offset=' + off + '&limit=' + size, body) || [];
    out = out.concat(rows);
    if (rows.length < size) break;
  }
  return out;
}

/** Events in a date range, as { sid: { teacherId: count } }. */
function eventsByStudent_(from, to, sids) {
  var body = { StartDate: iso_(from), EndDate: iso_(to) };
  if (sids) body.StudentIDs = sids;
  var out = {};
  searchAll_('calendar/events', body).forEach(function (e) {
    (e.Attendances || []).forEach(function (a) {
      if (!a.StudentID) return;
      var m = out[a.StudentID] = out[a.StudentID] || {};
      // A sub's event still counts for the regular teacher, whose profile does the billing.
      [e.TeacherID, e.OriginalTeacherID].filter(function (t, i, l) { return t && l.indexOf(t) === i; })
        .forEach(function (t) { m[t] = (m[t] || 0) + 1; });
    });
  });
  return out;
}

/** Charges and discounts for some students, slimmed (MMS repeats the whole student on every row). */
function transactions_(sids) {
  var out = [];
  for (var i = 0; i < sids.length; i += 25) {
    if (i) Utilities.sleep(600);
    searchAll_('transactions', { StudentIDs: sids.slice(i, i + 25) }).forEach(function (t) {
      out.push({ id: t.ID, sid: t.StudentID, type: t.Type, date: String(t.Date || '').slice(0, 10),
        amount: Number(t.ChargeWithTax || 0), teacher: t.TeacherID || '', cat: t.CategoryID || '',
        source: t.Source || '', desc: t.DisplayDescription || '' });
    });
  }
  return out;
}

/** The checks, for one month. Shared by the person page and the nightly run. */
function driftFor_(sid, status, month, charges, events, profiles, names) {
  var out = [], byT = {};
  charges.filter(function (c) { return c.type === 'Charge' && c.date.slice(0, 7) === month && c.source === 'FixedMonthly'; })
    .forEach(function (c) { (byT[c.teacher] = byT[c.teacher] || []).push(c); });
  var ev = events || {};
  Object.keys(byT).forEach(function (t) {
    var n = names[t] || 'a teacher';
    if (byT[t].length > 1) out.push({ problem: 'Charged twice by one teacher', detail: byT[t].length + ' monthly charges from ' + n + ' in ' + month });
    if (!ev[t]) out.push({ problem: 'Charge with no events', detail: '$' + byT[t][0].amount + ' from ' + n + ' but no ' + n + ' events this month' });
  });
  if (status === 'Inactive' && Object.keys(byT).length) out.push({ problem: 'Inactive but charged', detail: 'Status is Inactive and ' + month + ' has charges' });
  (profiles || []).forEach(function (p) {
    if (!p.Active || p.DefaultBillingMode !== 'FixedMonthly' || !(p.BillingRate > 0)) return;
    if (ev[p.TeacherID] && !byT[p.TeacherID]) out.push({ problem: 'Events but no charge', detail: (names[p.TeacherID] || 'A teacher') + ' has events this month at $' + p.BillingRate + '/month, and no charge' });
  });
  return out;
}

/** API: billing profiles, recent charges and checks for one student. Read only. */
function billing_(p) {
  var sid = String(p.sid || '');
  if (!/^sdt_/.test(sid)) return { profiles: [], charges: [], issues: [] };
  var names = teacherNames_();
  var profiles = searchAll_('billingprofiles', { StudentIDs: [sid] });
  Utilities.sleep(400);
  var now = new Date(), month = ym_(now);
  var from = new Date(now.getFullYear(), now.getMonth(), 1), to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  var events = eventsByStudent_(from, to, [sid])[sid] || {};
  Utilities.sleep(400);
  var tx = transactions_([sid]);
  var lo = ym_(new Date(now.getFullYear(), now.getMonth() - 2, 1)), hi = ym_(new Date(now.getFullYear(), now.getMonth() + 1, 1));
  var r = rosterRows_().filter(function (x) { return x.ID === sid; })[0] || {};
  return {
    month: month,
    profiles: profiles.filter(function (b) { return b.Active; }).map(function (b) {
      return { teacher: names[b.TeacherID] || b.TeacherID, category: (b.EventCategory && b.EventCategory.Name) || CAT_NAMES[b.EventCategoryID] || '',
        rate: b.BillingRate, mode: b.DefaultBillingMode, eventsThisMonth: events[b.TeacherID] || 0 };
    }).sort(function (a, b) { return (b.eventsThisMonth - a.eventsThisMonth) || (b.rate - a.rate); }),
    charges: tx.filter(function (t) { var m = t.date.slice(0, 7); return m >= lo && m <= hi && t.type !== 'Payment'; })
      .sort(function (a, b) { return a.date < b.date ? 1 : -1; })
      .map(function (t) { return { date: t.date, type: t.type, amount: t.amount, desc: t.desc }; }),
    issues: driftFor_(sid, r.Status || '', month, tx, events, profiles, names)
  };
}

// ---------- nightly billing check ----------

/**
 * For this month: anyone Active, or Inactive with a lesson in the last 120 days, gets the
 * checks above. Results replace the Billing check tab. Nothing in MMS is changed.
 */
function billingCheck() {
  var now = new Date(), month = ym_(now), names = teacherNames_();
  var from = new Date(now.getFullYear(), now.getMonth(), 1), to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  var recent = ym_(new Date(now.getTime() - 120 * 864e5));
  var people = rosterRows_().filter(function (r) {
    return r.Status === 'Active' || (r.Status === 'Inactive' && String(r['Last event']).slice(0, 7) >= recent);
  });
  var sids = people.map(function (r) { return r.ID; });
  var events = eventsByStudent_(from, to);
  var tx = transactions_(sids), txBy = {};
  tx.forEach(function (t) { (txBy[t.sid] = txBy[t.sid] || []).push(t); });
  var prof = {};
  for (var i = 0; i < sids.length; i += 50) {
    Utilities.sleep(600);
    searchAll_('billingprofiles', { StudentIDs: sids.slice(i, i + 50) }).forEach(function (b) {
      (prof[b.StudentID] = prof[b.StudentID] || []).push(b);
    });
  }
  var rows = [], stamp = new Date();
  people.forEach(function (r) {
    driftFor_(r.ID, r.Status, month, txBy[r.ID] || [], events[r.ID], prof[r.ID], names).forEach(function (x) {
      rows.push([month, r.ID, r.Name, x.problem, x.detail, stamp]);
    });
  });
  var sh = tab_(DRIFT_TAB, DRIFT_HEAD);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, DRIFT_HEAD.length).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, DRIFT_HEAD.length).setValues(rows);
  bumpVer_();
  return rows.length + ' to check for ' + month;
}

/** For Today: the latest billing check. */
function billingIssues_() {
  return sheetObjects_(DRIFT_TAB).filter(function (r) { return r['MMS ID']; }).map(function (r) {
    return { id: r['MMS ID'], name: r.Name, problem: r.Problem, detail: r.Detail };
  });
}

/** Run once from the editor: the billing check every night at about 2am. */
function installBillingCheck() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'billingCheck') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('billingCheck').timeBased().everyDays(1).atHour(2).create();
  return 'Billing check runs nightly. First run: ' + billingCheck();
}

/** API: the latest MMS changes, for one person or everyone. */
function mmsChanges_(p) {
  var rows = sheetObjects_(MMS_LOG_TAB);
  if (p.sid) rows = rows.filter(function (r) { return r['MMS ID'] === p.sid; });
  return rows.slice(-50).reverse().map(function (r) {
    return { at: r.Timestamp, who: r.Who, sid: r['MMS ID'], action: r.Action, before: r.Before, after: r.After, result: r.Result };
  });
}
