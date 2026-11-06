/**
 * Student Journey app API. Served from the same web app as the tracking pixel:
 * requests with an `action` parameter come here, everything else is tracking.
 *
 * Script Properties (Project Settings > Script Properties), set by Ben:
 *   MMS_API_KEY       the MyMusicStaff API key (Business Settings > Integrations)
 *   GOOGLE_CLIENT_ID  OAuth client ID of the app's Google sign-in
 *
 * Every request must carry a Google ID token from a northstarjazzworkshops.com
 * account. The web app itself is open ("Anyone") so the tracking pixel works;
 * this check is what keeps student data private.
 */

var APP_DOMAIN = 'northstarjazzworkshops.com';
var MMS_BASE = 'https://api.mymusicstaff.com/v1/';
var ROSTER_TAB = 'MMS roster';
var NOTES_TAB = 'Notes';

// ---------- router ----------

/**
 * The app posts JSON as text/plain (no CORS preflight), so the sign-in token
 * travels in the body, never in a URL.
 */
function doPost(e) {
  var p = {};
  try { p = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}
  return api_({ parameter: p });
}

function api_(e) {
  var p = (e && e.parameter) || {};
  var out;
  try {
    var who = verifyUser_(p.id_token);
    if (!READS_[p.action]) bumpVer_(); // any write makes cached reads stale
    switch (p.action) {
      case 'whoami': out = { email: who }; break;
      case 'person': out = cachedRead_('person:' + (p.sid || p.email), 300, function () { return getPerson_(p.sid, p.email); }); break;
      case 'people': out = listPeople_(p.q, p.status); break;
      case 'contacts': out = cachedRead_('contacts', 900, listContacts_); break;
      case 'note':   out = addNote_(who, p); break;
      case 'lessons': out = cachedRead_('lessons', 900, listLessons_); break;
      case 'lesson': out = saveLesson_(who, p); break;
      case 'groups': out = cachedRead_('groups', 900, listGroups_); break;
      case 'group':  out = getGroup_(String(p.name || '')); break;
      case 'leads':  out = cachedRead_('leads', 600, listLeads_); break;
      case 'today':  out = cachedRead_('today', 600, today_); break;
      case 'leadtag': out = setLeadTag_(who, p); break;
      case 'nextdone': out = nextDone_(who, p); break;
      case 'place':  out = placeInGroup_(who, p); break;
      case 'leave':  out = leaveGroup_(who, p); break;
      case 'logcall': out = logCall_(who, p); break;
      case 'groupmail': out = sendGroupEmail_(who, p); break;
      case 'calpreview': out = calPreview_(who, p); break;
      case 'caladd': out = calAdd_(who, p); break;
      case 'myteaching': out = myTeaching_(who, p); break;
      case 'subrequest': out = requestSub_(who, p); break;
      case 'subtake': out = takeSubApi_(who, p); break;
      case 'subcancel': out = cancelSub_(who, p); break;
      default: throw new Error('Unknown action');
    }
    if (!READS_[p.action]) bumpVer_(); // again after the write, so nothing cached mid-write survives
  } catch (err) {
    out = { error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- read cache ----------
// Reads are cached in CacheService under a version stamp. Any write, and every roster
// sync, bumps the stamp, so a cached answer is never older than the last change.
// Values over 90 KB are split across keys (CacheService caps one value at 100 KB).
var READS_ = { whoami: 1, person: 1, people: 1, contacts: 1, lessons: 1, groups: 1, group: 1, leads: 1, today: 1, myteaching: 1, templates: 1, calpreview: 1 };

function cacheVer_() {
  var c = CacheService.getScriptCache(), v = c.get('ver');
  if (!v) { v = String(Date.now()); c.put('ver', v, 21600); }
  return v;
}
function bumpVer_() { CacheService.getScriptCache().put('ver', String(Date.now()), 21600); }

function cachedRead_(key, ttl, fn) {
  var c = CacheService.getScriptCache(), base = 'r:' + cacheVer_() + ':' + key;
  try {
    var n = Number(c.get(base));
    if (n) {
      var keys = []; for (var i = 0; i < n; i++) keys.push(base + ':' + i);
      var got = c.getAll(keys), parts = [];
      for (var j = 0; j < n; j++) { if (got[keys[j]] == null) { parts = null; break; } parts.push(got[keys[j]]); }
      if (parts) return JSON.parse(parts.join(''));
    }
  } catch (e) { /* fall through to a fresh read */ }
  var out = fn();
  try {
    var str = JSON.stringify(out), size = 90000, chunks = {}, count = Math.ceil(str.length / size);
    if (count <= 40) {
      for (var k = 0; k < count; k++) chunks[base + ':' + k] = str.slice(k * size, (k + 1) * size);
      c.putAll(chunks, ttl);
      c.put(base, String(count), ttl);
    }
  } catch (e2) { /* caching is best effort */ }
  return out;
}

/** After each roster sync: new stamp, then build the big reads so the first screen is quick. */
function warmCache_() {
  bumpVer_();
  [['today', 600, today_], ['leads', 600, listLeads_], ['contacts', 900, listContacts_], ['groups', 900, listGroups_], ['lessons', 900, listLessons_]]
    .forEach(function (x) { try { cachedRead_(x[0], x[1], x[2]); } catch (e) { Logger.log('warm ' + x[0] + ': ' + e.message); } });
}

// ---------- auth ----------

function verifyUser_(token) {
  if (!token) throw new Error('Sign in required');
  var cache = CacheService.getScriptCache();
  var ck = 'tok:' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  var hit = cache.get(ck);
  if (hit) return hit;
  var r = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' +
    encodeURIComponent(token), { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('Sign-in expired. Sign in again.');
  var t = JSON.parse(r.getContentText());
  var clientId = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID');
  if (!clientId || t.aud !== clientId) throw new Error('This sign-in is not for this app.');
  if (t.hd !== APP_DOMAIN || String(t.email_verified) !== 'true') {
    throw new Error('North Star accounts only.');
  }
  cache.put(ck, t.email, 600);
  return t.email;
}

// ---------- MMS ----------

function mms_(method, path, body) {
  var key = PropertiesService.getScriptProperties().getProperty('MMS_API_KEY');
  if (!key) throw new Error('MMS key is not set in Script Properties.');
  // MMS 404s without the trailing slash before the query string.
  var parts = path.replace(/^\//, '').split('?');
  if (!/\/$/.test(parts[0])) parts[0] += '/';
  var url = MMS_BASE + parts.join('?');
  var opts = {
    method: method, muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' }
  };
  if (body) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
  for (var i = 0; i < 4; i++) {
    var r = UrlFetchApp.fetch(url, opts);
    var code = r.getResponseCode();
    if (code === 429) { Utilities.sleep(1500 * (i + 1)); continue; }
    if (code !== 200) throw new Error('MMS ' + code + ' on ' + parts[0]);
    var data = JSON.parse(r.getContentText());
    return Array.isArray(data) ? data : (data.ItemSubset || data);
  }
  throw new Error('MMS busy, try again');
}

/**
 * Pull every student with tags into the hidden roster tab. Runs every 15 minutes.
 * MMS does not return tags on the student (StudentGroups is always null), so
 * membership is read per tag with POST search/students {StudentGroupIDs:[id]}.
 */
function syncRoster() {
  var started = new Date();
  var rows = mms_('get', 'students');
  var tagsBySid = {};
  mms_('get', 'studentgroups').forEach(function (g) {
    if (!g.StudentCount) return;
    Utilities.sleep(600); // MMS returns 429 on bursts
    mms_('post', 'search/students?offset=0&limit=1000', { StudentGroupIDs: [g.ID] }).forEach(function (s) {
      (tagsBySid[s.ID] = tagsBySid[s.ID] || []).push(g.Name);
    });
  });
  var out = [['ID', 'Name', 'First', 'Status', 'Email', 'Phone', 'Started', 'Last event',
    'Next event', 'Programs', 'Instruments', 'Other tags', 'Note', 'Synced', 'Skill level']];
  var now = new Date();
  rows.forEach(function (s) {
    var tags = tagsBySid[s.ID] || [];
    var inst = tags.filter(function (t) { return /^Plays: /.test(t); })
      .map(function (t) { return t.replace('Plays: ', ''); });
    var prog = tags.filter(function (t) { return isProgramTag_(t); });
    var other = tags.filter(function (t) { return !/^Plays: /.test(t) && !isProgramTag_(t); });
    out.push([s.ID, s.FullName || '', s.FirstName || '', s.Status || '',
      (s.Email && s.Email.EmailAddress) || '', (s.Telephone && s.Telephone.TelephoneNumber) || '',
      day_(s.DateStarted), day_(s.LastEventDate), day_(s.NextEventDate),
      prog.join('; '), inst.join('; '), other.join('; '), String(s.Note || '').slice(0, 2000), now, s.SkillLevel || '']);
  });
  var sh = tab_(ROSTER_TAB);
  keepAppEdits_(sh, out, started);
  logStatusChanges_(sh, out);
  sh.clearContents();
  sh.getRange(1, 1, out.length, out[0].length).setValues(out);
  if (!sh.isSheetHidden()) sh.hideSheet();
  try { seedInterestTags_(); } catch (e) { Logger.log('Interest seeding: ' + e.message); }
  try { mailIndex_('sync'); } catch (e) { Logger.log('Mail index: ' + e.message); }
  try { warmCache_(); } catch (e) { Logger.log('Warm cache: ' + e.message); }
  return out.length - 1;
}

/**
 * The sync reads MMS over a minute or two. Anyone the app changed in that window
 * (convert, end membership, stage, tags) would be overwritten with the older
 * snapshot, so keep the roster row the app already updated for those people.
 */
function keepAppEdits_(sh, out, started) {
  var touched = {};
  sheetObjects_(NOTES_TAB).forEach(function (n) {
    var ts = n.Timestamp instanceof Date ? n.Timestamp : new Date(n.Timestamp);
    if (n['MMS ID'] && n.Author !== 'MMS sync' && !isNaN(ts) && ts >= started) touched[n['MMS ID']] = true;
  });
  if (!Object.keys(touched).length || sh.getLastRow() < 2) return;
  var old = {};
  sh.getRange(2, 1, sh.getLastRow() - 1, out[0].length).getValues().forEach(function (r) { old[r[0]] = r; });
  for (var i = 1; i < out.length; i++) {
    var sid = out[i][0];
    if (touched[sid] && old[sid]) out[i] = old[sid].slice(0, out[0].length);
  }
}

/**
 * Compare the old roster with the new one and log anyone who became Active or
 * stopped being Active, so Today can count joins and departures. Only the MMS ID
 * and the status change are written, never contact details.
 */
function logStatusChanges_(sh, out) {
  if (sh.getLastRow() < 2) return;
  var old = {};
  sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().forEach(function (r) { old[r[0]] = r[3]; });
  var rows = [], now = new Date();
  out.slice(1).forEach(function (r) {
    var was = old[r[0]], is = r[3];
    if (was === undefined || was === is) return;
    if (was === 'Active' && is !== 'Active') rows.push([now, r[0], '', 'MMS sync', 'change', 'Left: MMS status went from Active to ' + is, '', '', '']);
    if (was !== 'Active' && is === 'Active') rows.push([now, r[0], '', 'MMS sync', 'change', 'Joined: MMS status went from ' + was + ' to Active', '', '', '']);
  });
  if (!rows.length) return;
  var n = tab_(NOTES_TAB, ['Timestamp', 'MMS ID', 'Email', 'Author', 'Kind', 'Text', 'Due', 'Owner', 'Done']);
  n.getRange(n.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function isProgramTag_(t) {
  return /^Group \d+/.test(t) || /^Vocal Ensemble/.test(t) || / - (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Spring|Summer|Fall|Winter)/.test(t) ||
    /^(Foundations|JSP|Jam Session Skills|Jazz Guitar|Jazz Singer|Jazz Voice|Improv Lab|Open Spaces|Guitar|Vocal Class|Private Lessons - Active|Workshop)/.test(t) ||
    / (Course|Class|Clinic|Workshop)$/.test(t);
}

function installRosterTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncRoster') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncRoster').timeBased().everyMinutes(15).create();
  return 'Roster syncs every 15 minutes. Rows now: ' + syncRoster();
}

// ---------- reads ----------

function rosterRows_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ROSTER_TAB);
  if (!sh) return [];
  var v = sh.getDataRange().getValues();
  var head = v.shift();
  return v.map(function (r) {
    var o = {}; head.forEach(function (h, i) { o[h] = r[i]; }); return o;
  });
}

/**
 * Everyone on the roster with the columns the People table shows. The page filters,
 * sorts and pages in the browser. Last activity = the newest timeline entry
 * (note, call, stage change, email log) in the Notes tab.
 */
function listContacts_() {
  var last = {};
  sheetObjects_(NOTES_TAB).forEach(function (n) {
    if (autoNote_(n)) return;
    var ts = n.Timestamp instanceof Date ? n.Timestamp : new Date(n.Timestamp);
    if (isNaN(ts)) return;
    var k = n['MMS ID'] || ('e:' + String(n.Email).toLowerCase());
    if (!last[k] || ts > last[k]) last[k] = ts;
  });
  return rosterRows_().map(function (r) {
    var tags = split_(r['Other tags']), s = signup_(r.Note);
    var la = last[r.ID] || last['e:' + String(r.Email).toLowerCase()];
    return { id: r.ID, name: r.Name, email: r.Email, phone: r.Phone, status: r.Status,
      stage: stageOf_(r, tags), programs: split_(r.Programs), instruments: split_(r.Instruments),
      tracks: tracksOf_(tags, s), source: s.source || '', created: gday_(r.Started),
      interests: tags.filter(function (t) { return /^Interest: /.test(t); }).map(function (t) { return t.slice(10); }),
      nights: tags.filter(function (t) { return /^Nights: /.test(t); }).map(function (t) { return t.slice(8); }),
      lastActivity: la ? Utilities.formatDate(la, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm") : '' };
  });
}

function listPeople_(q, status) {
  q = String(q || '').toLowerCase();
  return rosterRows_().filter(function (r) {
    if (status && r.Status !== status) return false;
    if (!q) return true;
    return (r.Name + ' ' + r.Email + ' ' + r.Programs + ' ' + r.Instruments).toLowerCase().indexOf(q) >= 0;
  }).slice(0, 200).map(function (r) {
    return { id: r.ID, name: r.Name, status: r.Status, email: r.Email,
      programs: r.Programs, instruments: r.Instruments, nextEvent: r['Next event'] };
  });
}

function getPerson_(sid, email) {
  var roster = rosterRows_();
  var r = roster.filter(function (x) {
    return (sid && x.ID === sid) || (email && String(x.Email).toLowerCase() === String(email).toLowerCase());
  })[0];
  if (!r && !email) throw new Error('Not found');
  sid = r ? r.ID : '';
  email = String(r ? r.Email : email).toLowerCase();

  var timeline = [];

  // Sequence emails and their opens, clicks, replies
  var log = sheetObjects_('Log');
  log.filter(function (l) { return String(l.Email).toLowerCase() === email; }).forEach(function (l) {
    timeline.push({ at: l.Timestamp, kind: 'email-' + l.Event, sequence: l.Sequence, step: l.Step, text: l.Detail });
  });
  var enroll = sheetObjects_('Enrollments').filter(function (x) {
    return String(x.Email).toLowerCase() === email;
  }).map(function (x) {
    return { sequence: x.Sequence, status: x.Status, step: x['Next step'], nextSend: x['Next send'],
      opens: x.Opens, clicks: x.Clicks, repliedAt: x['Replied at'] };
  });

  // Notes and next steps
  var notes = sheetObjects_(NOTES_TAB).filter(function (n) {
    return (sid && n['MMS ID'] === sid) || String(n.Email).toLowerCase() === email;
  });
  notes.forEach(function (n) {
    timeline.push({ at: n.Timestamp, kind: n.Kind || 'note', author: n.Author, text: n.Text, due: n.Due, owner: n.Owner });
  });
  var nextStep = notes.filter(function (n) { return n.Kind === 'next_step' && !n.Done; }).pop() || null;

  // Gmail threads with this person
  // If Gmail is over its daily limit, the page still loads; it just shows no emails.
  var threads = [], allMsgs = [], mailError = '';
  try {
    threads = email ? GmailApp.search('from:' + email + ' OR to:' + email, 0, 10) : [];
    allMsgs = threads.length ? GmailApp.getMessagesForThreads(threads) : [];
  } catch (e) { threads = []; allMsgs = []; mailError = String(e.message || e); }
  var mail = threads.map(function (t, ti) {
    var last = t.getLastMessageDate();
    var msgs = allMsgs[ti];
    var lastMsg = msgs[msgs.length - 1];
    var theyWrote = lastMsg.getFrom().toLowerCase().indexOf(email) >= 0;
    timeline.push({ at: last, kind: theyWrote ? 'mail-in' : 'mail-out', text: t.getFirstMessageSubject(),
      snippet: lastMsg.getPlainBody().slice(0, 200), url: 'https://mail.google.com/mail/u/0/#all/' + t.getId() });
    return { subject: t.getFirstMessageSubject(), last: last, count: t.getMessageCount(), theyWroteLast: theyWrote };
  });

  if (r && r.Note) timeline.push({ at: r.Started || '', kind: 'signup', text: r.Note });
  timeline.sort(function (a, b) { return new Date(b.at) - new Date(a.at); });

  return {
    id: sid, name: r ? r.Name : email, first: r ? r.First : '', status: r ? r.Status : 'Not in MMS',
    email: email, phone: r ? r.Phone : '', started: r ? r.Started : '', skill: r ? r['Skill level'] : '',
    lastEvent: r ? r['Last event'] : '', nextEvent: r ? r['Next event'] : '',
    programs: r ? split_(r.Programs) : [], instruments: r ? split_(r.Instruments) : [],
    formInstruments: r ? formInstruments_(signup_(r.Note).instrument) : [],
    tags: r ? split_(r['Other tags']) : [],
    mmsUrl: sid ? 'https://app.mymusicstaff.com/Teacher/v2/en/students/details?id=' + sid : '',
    nextStep: nextStep, sequences: enroll, threads: mail, mailError: mailError, timeline: timeline.slice(0, 60),
    lesson: sid ? (sheetObjects_(LESSONS_TAB).filter(function (l) { return l['MMS ID'] === sid; })[0] || null) : null
  };
}

// ---------- private lessons ----------
// One row per lesson arrangement, keyed by MMS ID. Contact details stay in MMS.

var LESSONS_TAB = 'Lessons';
var LESSON_FIELDS = ['Stage', 'Teacher', 'Instrument', 'Frequency', 'Day and time', 'Length', 'Monthly cost',
  'Start date', 'Contract sent', 'Billed in MMS', 'Calendar invite sent', 'Cancellation date', 'Schedule notes', 'Setup notes'];

function listLessons_() {
  var roster = {};
  rosterRows_().forEach(function (r) { roster[r.ID] = r; });
  return sheetObjects_(LESSONS_TAB).map(function (l) {
    var r = roster[l['MMS ID']] || {};
    l.email = r.Email || ''; l.phone = r.Phone || ''; l.mmsStatus = r.Status || '';
    l.nextEvent = r['Next event'] || ''; l.lastEvent = r['Last event'] || '';
    return l;
  });
}

function saveLesson_(who, p) {
  var sid = String(p.sid || '').trim();
  if (!/^sdt_/.test(sid)) throw new Error('Lessons need an MMS student ID');
  var sh = tab_(LESSONS_TAB);
  var data = sh.getDataRange().getValues();
  var head = data[0];
  var idCol = head.indexOf('MMS ID');
  var rowIdx = -1;
  for (var i = 1; i < data.length; i++) if (data[i][idCol] === sid) { rowIdx = i; break; }
  var row = rowIdx > 0 ? data[rowIdx].slice() : head.map(function () { return ''; });
  if (rowIdx < 0) {
    row[idCol] = sid;
    var r = rosterRows_().filter(function (x) { return x.ID === sid; })[0];
    row[head.indexOf('Name')] = r ? r.Name : (p.name || '');
  }
  var f = p.fields || {};
  LESSON_FIELDS.forEach(function (k) {
    var c = head.indexOf(k);
    if (c >= 0 && Object.prototype.hasOwnProperty.call(f, k)) row[c] = String(f[k]).slice(0, 2000);
  });
  if (rowIdx > 0) sh.getRange(rowIdx + 1, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);
  addNote_(who, { sid: sid, email: p.email || '', kind: 'note', text: 'Lesson updated: ' +
    Object.keys(f).filter(function (k) { return LESSON_FIELDS.indexOf(k) >= 0; }).map(function (k) { return k + ' ' + f[k]; }).join(', ') });
  return { ok: true };
}

// ---------- writes ----------

function addNote_(who, p) {
  var kind = p.kind === 'next_step' ? 'next_step' : 'note';
  var text = String(p.text || '').trim();
  if (!text) throw new Error('Empty note');
  var sh = tab_(NOTES_TAB, ['Timestamp', 'MMS ID', 'Email', 'Author', 'Kind', 'Text', 'Due', 'Owner', 'Done']);
  sh.appendRow([new Date(), p.sid || '', String(p.email || '').toLowerCase(), who, kind,
    text.slice(0, 5000), p.due || '', p.owner || '', '']);
  return { ok: true };
}

// ---------- helpers ----------

function tab_(name, header) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (header) { sh.appendRow(header); sh.setFrozenRows(1); }
  }
  return sh;
}

function sheetObjects_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getDataRange().getValues();
  var head = v.shift();
  return v.map(function (r) { var o = {}; head.forEach(function (h, i) { o[h] = r[i]; }); return o; });
}

function split_(s) { return String(s || '').split(';').map(function (x) { return x.trim(); }).filter(String); }
function day_(s) { return s ? String(s).slice(0, 10) : ''; }
