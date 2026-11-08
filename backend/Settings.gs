/**
 * Pipeline settings: what happens when a lead enters a stage, what each program is worth
 * (for the totals on the Leads board only; billing stays in MyMusicStaff), and the reasons
 * offered when a lead is closed. Kept in the "Settings" tab so anyone can read it there.
 *
 * Defaults come from the SOPs in the Admin Knowledge Base (Oct 2026):
 *   SOP-007 Responding to a New Inquiry: reply within one business day; Qualified sends the
 *     availability form and goes to teacher matching (SOP-009); Nurture checks back in three
 *     months; Closed records why and sets the MMS record to Inactive.
 *   REF-PRICING Pricing and What We Charge: ensemble and vocal ensemble $150/month; courses
 *     $450 over three months, billed $150/month; private lessons standard $99 / $199 / $379 a
 *     month for 1, 2 or 4 lessons (member $80 a lesson). Clinics are not priced there.
 */

var SETTINGS_TAB = 'Pipeline settings'; // not "Settings": that tab belongs to the Sequencer
var SETTINGS_HEAD = ['Kind', 'Name', 'A', 'B', 'C', 'D'];

// stage: Name = stage, A = task, B = due, C = owner, D = requires
// value: Name = program, A = price per month for the board, B = per, C = note
// reason: Name = reason
var SETTINGS_DEFAULTS = [
  ['stage', 'First Contact', 'Reply and offer a short intro call', 'In 1 business day', 'Admin', ''],
  ['stage', 'Qualified', 'Send the availability form and match a teacher (SOP-009)', 'In 1 business day', 'Admin', ''],
  ['stage', 'Committed', 'Set up enrollment (SOP-001 or SOP-002)', 'Today', 'Admin', 'Program'],
  ['stage', 'Enrolled', 'Send the welcome email, calendar invite and Slack invite', 'Today', 'Admin', 'Group or lessons'],
  ['stage', 'Nurture', 'Check back in and restart the follow-up', 'In 3 months', 'Admin', ''],
  ['stage', 'Closed', '', '', '', 'Lost reason'],
  ['value', 'Ensemble', 150, 'per month', 'REF-PRICING'],
  ['value', 'Voice', 150, 'per month', 'Vocal Ensemble, REF-PRICING'],
  ['value', 'Foundations', 150, 'per month', '$450 a course over three months'],
  ['value', 'Classes', 150, 'per month', '$450 a course over three months'],
  ['value', 'Private lessons', 199, 'per month', 'Standard every other week; weekly is $379, monthly $99'],
  ['value', 'Clinics', '', 'one time', 'Not priced in REF-PRICING'],
  ['reason', "Schedule doesn't work"],
  ['reason', 'Too expensive'],
  ['reason', 'Chose another program or school'],
  ['reason', 'No response after three nurture rounds'],
  ['reason', 'Not the right level yet'],
  ['reason', 'Asked us to stop contacting them'],
  ['reason', 'Something else']
];

function settingsSheet_() {
  var sh = tab_(SETTINGS_TAB, SETTINGS_HEAD);
  if (sh.getLastRow() < 2) {
    var rows = SETTINGS_DEFAULTS.map(function (r) { var x = r.slice(); while (x.length < SETTINGS_HEAD.length) x.push(''); return x; });
    sh.getRange(2, 1, rows.length, SETTINGS_HEAD.length).setValues(rows);
  }
  return sh;
}

function getSettings_() {
  var sh = settingsSheet_();
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, SETTINGS_HEAD.length).getValues();
  var out = { stages: [], values: [], reasons: [] };
  v.forEach(function (r) {
    if (r[0] === 'stage') out.stages.push({ stage: r[1], task: String(r[2] || ''), due: String(r[3] || ''), owner: String(r[4] || ''), requires: String(r[5] || '') });
    if (r[0] === 'value') out.values.push({ program: r[1], price: r[2] === '' ? null : Number(r[2]), per: String(r[3] || ''), note: String(r[4] || '') });
    if (r[0] === 'reason' && r[1]) out.reasons.push(String(r[1]));
  });
  // How often each reason was used: the "Lost: ..." tags on the roster.
  var used = {};
  rosterRows_().forEach(function (r) {
    split_(r['Other tags']).forEach(function (t) { if (/^Lost: /.test(t)) used[t.slice(6)] = (used[t.slice(6)] || 0) + 1; });
  });
  out.reasonUse = used;
  return out;
}

/** Save the whole settings set from the Pipeline settings screen. */
function saveSettings_(who, p) {
  var s = p.settings || {};
  var rows = [];
  (s.stages || []).forEach(function (x) { rows.push(['stage', x.stage, x.task || '', x.due || '', x.owner || '', x.requires || '']); });
  (s.values || []).forEach(function (x) { rows.push(['value', x.program, x.price === null || x.price === '' ? '' : Number(x.price), x.per || '', x.note || '', '']); });
  (s.reasons || []).forEach(function (x) { if (String(x).trim()) rows.push(['reason', String(x).trim().slice(0, 80), '', '', '', '']); });
  if (!rows.some(function (r) { return r[0] === 'stage'; })) throw new Error('Settings need the stage rules.');
  var sh = settingsSheet_();
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, SETTINGS_HEAD.length).clearContent();
  sh.getRange(2, 1, rows.length, SETTINGS_HEAD.length).setValues(rows);
  addNote_(who, { sid: '', email: who, kind: 'note', text: 'Pipeline settings changed' });
  return getSettings_();
}

/** "Today", "Tomorrow", "In 3 business days", "In 1 week", "In 3 months" -> yyyy-MM-dd. Weekends skipped for days. */
function dueFrom_(rule, from) {
  var d = new Date((from || new Date()).getTime()), m;
  rule = String(rule || '').toLowerCase();
  function biz(n) { while (n > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) n--; } }
  if (!rule || rule === 'today') { /* today */ }
  else if (rule === 'tomorrow') biz(1);
  else if ((m = /in (\d+) business days?/.exec(rule))) biz(Number(m[1]));
  else if ((m = /in (\d+) days?/.exec(rule))) d.setDate(d.getDate() + Number(m[1]));
  else if ((m = /in (\d+) weeks?/.exec(rule))) d.setDate(d.getDate() + 7 * Number(m[1]));
  else if ((m = /in (\d+) months?/.exec(rule))) d.setMonth(d.getMonth() + Number(m[1]));
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

var OWNER_EMAILS_ = { ben: 'hello@northstarjazzworkshops.com', admin: 'admin@northstarjazzworkshops.com', kelley: 'admin@northstarjazzworkshops.com',
  joe: 'joe@northstarjazzworkshops.com', chris: 'chris@northstarjazzworkshops.com' };

/**
 * After a stage change: create the follow-up the rule asks for (closing any open one first) and
 * return it so the board can say what it did. Teacher as owner falls back to Admin here.
 */
function applyStageRule_(who, sid, email, stage) {
  var rule = getSettings_().stages.filter(function (r) { return r.stage === stage; })[0];
  if (!rule || !rule.task) return null;
  try { closeNextStep_(sid); } catch (e) { Logger.log('closeNextStep_: ' + e.message); }
  var owner = OWNER_EMAILS_[String(rule.owner).toLowerCase()] || OWNER_EMAILS_.admin;
  var due = dueFrom_(rule.due);
  addNote_(who, { sid: sid, email: email, kind: 'next_step', text: rule.task, due: due, owner: owner });
  return { text: rule.task, due: due, owner: owner, row: tab_(NOTES_TAB).getLastRow() };
}
