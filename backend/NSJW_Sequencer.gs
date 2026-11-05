/**
 * NSJW Sequencer
 * Sends multi-step email sequences from this Gmail account, stops when someone replies,
 * and tracks opens and clicks through this script's web app URL.
 *
 * Setup (once):
 *   1. In the NSJW Sequencer sheet: Extensions > Apps Script. Replace the default code with this file. Save.
 *   2. Run > installDailyTrigger. Approve the permissions when asked.
 *   3. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone. Deploy.
 *      Paste the web app URL into Settings!B2.
 *   4. Reload the sheet. A "Sequencer" menu appears.
 *
 * Tabs this script expects (already built): Enrollments, Sequences, Log, Stats, Settings.
 */

var ENROLL = {
  EMAIL: 0, FIRST: 1, INSTRUMENT: 2, SEQUENCE: 3, STATUS: 4, NEXT_STEP: 5, NEXT_SEND: 6,
  LAST_SENT: 7, THREAD_ID: 8, OPENS: 9, CLICKS: 10, REPLIED_AT: 11, SEND_NOW: 12, NOTES: 13
};
var SEQ = { NAME: 0, STEP: 1, DELAY: 2, SUBJECT: 3, BODY: 4, IN_THREAD: 5 };

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Sequencer')
    .addItem('Send due now', 'sendDue')
    .addItem('Check for replies only', 'checkRepliesOnly')
    .addItem('Install daily trigger', 'installDailyTrigger')
    .addToUi();
}

// ---------- settings ----------

function settings() {
  var rows = sheet_('Settings').getDataRange().getValues();
  var s = {};
  for (var i = 1; i < rows.length; i++) s[String(rows[i][0]).trim()] = rows[i][1];
  return {
    webAppUrl: String(s['Web app URL'] || '').trim(),
    clickBase: String(s['Click redirect URL'] || '').trim(),
    senderName: String(s['Sender name'] || 'North Star Jazz Workshops'),
    firstNameFallback: String(s['First name fallback'] || 'there'),
    maxPerRun: Number(s['Max sends per run'] || 150),
    signature: String(s['Signature'] || ''),
    sendHour: Number(s['Send hour'] || 7),
    tz: String(s['Timezone'] || 'America/Chicago'),
    senderEmail: String(s['Sender email'] || 'hello@northstarjazzworkshops.com').trim()
  };
}

function sheet_(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

// ---------- the daily run ----------

function sendDue() {
  var cfg = settings();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    var es = sheet_('Enrollments');
    var data = es.getDataRange().getValues();
    var steps = loadSequences_();
    var now = new Date();
    var sent = 0;

    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      var email = String(row[ENROLL.EMAIL]).trim();
      if (!email || row[ENROLL.STATUS] !== 'Active') continue;

      var seqName = String(row[ENROLL.SEQUENCE]).trim();
      var seqSteps = steps[seqName];
      if (!seqSteps || !seqSteps.length) continue;

      var stepNo = Number(row[ENROLL.NEXT_STEP] || 1);
      var sendNow = row[ENROLL.SEND_NOW] === true;
      var nextSend = row[ENROLL.NEXT_SEND];

      // Reply check before every send after the first.
      if (stepNo > 1 && row[ENROLL.LAST_SENT]) {
        var reply = findReply_(email, row[ENROLL.LAST_SENT], row[ENROLL.THREAD_ID]);
        if (reply) {
          es.getRange(r + 1, ENROLL.STATUS + 1).setValue('Replied');
          es.getRange(r + 1, ENROLL.REPLIED_AT + 1).setValue(reply);
          log_(email, seqName, stepNo - 1, 'reply', 'Stopped before step ' + stepNo);
          continue;
        }
      }

      // First send: when enrolled with no Next send, send today (or on Send now).
      var due = sendNow || !nextSend || (nextSend instanceof Date && nextSend <= now);
      if (!due) continue;
      if (sent >= cfg.maxPerRun) break;

      var step = seqSteps[stepNo - 1];
      if (!step) { es.getRange(r + 1, ENROLL.STATUS + 1).setValue('Done'); continue; }

      var threadId = sendStep_(cfg, row, step, r + 1);
      sent++;
      log_(email, seqName, stepNo, 'sent', step.subject);

      var isLast = stepNo >= seqSteps.length;
      var updates = [];
      es.getRange(r + 1, ENROLL.LAST_SENT + 1).setValue(now);
      es.getRange(r + 1, ENROLL.SEND_NOW + 1).setValue(false);
      if (threadId) es.getRange(r + 1, ENROLL.THREAD_ID + 1).setValue(threadId);
      if (isLast) {
        es.getRange(r + 1, ENROLL.STATUS + 1).setValue('Done');
        es.getRange(r + 1, ENROLL.NEXT_SEND + 1).setValue('');
      } else {
        var next = seqSteps[stepNo];
        var when = new Date(now.getTime() + Number(next.delay || 0) * 86400000);
        when.setHours(cfg.sendHour, 0, 0, 0);
        es.getRange(r + 1, ENROLL.NEXT_STEP + 1).setValue(stepNo + 1);
        es.getRange(r + 1, ENROLL.NEXT_SEND + 1).setValue(when);
      }
      Utilities.sleep(400);
    }
  } finally {
    lock.releaseLock();
  }
}

function checkRepliesOnly() {
  var es = sheet_('Enrollments');
  var data = es.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    if (row[ENROLL.STATUS] !== 'Active' || !row[ENROLL.LAST_SENT]) continue;
    var reply = findReply_(String(row[ENROLL.EMAIL]).trim(), row[ENROLL.LAST_SENT], row[ENROLL.THREAD_ID]);
    if (reply) {
      es.getRange(r + 1, ENROLL.STATUS + 1).setValue('Replied');
      es.getRange(r + 1, ENROLL.REPLIED_AT + 1).setValue(reply);
      log_(String(row[ENROLL.EMAIL]), String(row[ENROLL.SEQUENCE]), Number(row[ENROLL.NEXT_STEP]) - 1, 'reply', 'Found on reply check');
    }
  }
}

// ---------- sending ----------

function sendStep_(cfg, row, step, rowNumber) {
  var email = String(row[ENROLL.EMAIL]).trim();
  var first = String(row[ENROLL.FIRST] || '').trim() || cfg.firstNameFallback;
  var token = Utilities.base64EncodeWebSafe(rowNumber + '|' + step.step + '|' + email);

  var body = step.body
    .replace(/\{\{\s*first_name\s*\}\}/g, first)
    .replace(/\{\{\s*instrument\s*\}\}/g, String(row[ENROLL.INSTRUMENT] || ''))
    .replace(/\{\{\s*email\s*\}\}/g, email);

  var plain = body + (cfg.signature ? '\n\n' + cfg.signature : '');
  var html = toHtml_(body, token, cfg) + (cfg.signature ? '<br><br>' + toHtml_(cfg.signature, null, cfg) : '');
  if (cfg.webAppUrl) {
    html += '<img src="' + cfg.webAppUrl + '?k=o&t=' + token + '" width="1" height="1" alt="" style="display:none">';
  }

  var options = { name: cfg.senderName, htmlBody: html };

  if (step.inThread && row[ENROLL.THREAD_ID]) {
    try {
      var thread = GmailApp.getThreadById(String(row[ENROLL.THREAD_ID]));
      if (thread) {
        thread.reply(plain, options);
        return thread.getId();
      }
    } catch (e) { /* fall through to a fresh send */ }
  }

  GmailApp.sendEmail(email, step.subject, plain, options);
  Utilities.sleep(1500);
  var threads = GmailApp.search('in:sent to:' + email + ' subject:"' + step.subject.replace(/"/g, '') + '"', 0, 1);
  return threads.length ? threads[0].getId() : '';
}

function toHtml_(text, token, cfg) {
  var esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  esc = esc.replace(/(https?:\/\/[^\s<]+)/g, function (url) {
    var href = url;
    if (token && cfg.clickBase) {
      href = cfg.clickBase + '?t=' + token + '&u=' + encodeURIComponent(url);
    }
    return '<a href="' + href + '">' + url + '</a>';
  });
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1c1c1a">' +
    esc.replace(/\n/g, '<br>') + '</div>';
}

// ---------- reply detection ----------

function findReply_(email, lastSent, threadId) {
  // Sending to our own address (a self-test): our sent copy would look like a reply.
  var me = String(settings().senderEmail || '').toLowerCase();
  if (String(email).toLowerCase() === me) return null;
  var since = lastSent instanceof Date ? lastSent : new Date(lastSent);
  var after = Utilities.formatDate(new Date(since.getTime() - 86400000), 'GMT', 'yyyy/MM/dd');
  var threads = GmailApp.search('from:' + email + ' after:' + after, 0, 10);
  for (var i = 0; i < threads.length; i++) {
    var msgs = threads[i].getMessages();
    for (var j = 0; j < msgs.length; j++) {
      var m = msgs[j];
      if (m.getFrom().toLowerCase().indexOf(email.toLowerCase()) >= 0 && m.getDate() > since) return m.getDate();
    }
  }
  return null;
}

// ---------- tracking endpoint ----------

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action) return api_(e); // Student Journey app API (Api.gs)
  if (p.sub) return subPage_(p); // "I can cover it" link in a sub request email (Teachers.gs)
  var kind = p.k === 'c' ? 'click' : 'open';
  try {
    var parts = Utilities.newBlob(Utilities.base64DecodeWebSafe(p.t || '')).getDataAsString().split('|');
    var rowNumber = Number(parts[0]);
    var stepNo = Number(parts[1]);
    var email = parts[2] || '';
    var es = sheet_('Enrollments');
    var seqName = es.getRange(rowNumber, ENROLL.SEQUENCE + 1).getValue();
    var col = kind === 'click' ? ENROLL.CLICKS + 1 : ENROLL.OPENS + 1;
    var cell = es.getRange(rowNumber, col);
    cell.setValue(Number(cell.getValue() || 0) + 1);
    log_(email, String(seqName), stepNo, kind, kind === 'click' ? (p.u || '') : (p.ua || ''));
  } catch (err) { /* never block the redirect or the pixel */ }

  if (kind === 'click' && p.u) {
    var safe = String(p.u);
    if (!/^https?:\/\//i.test(safe)) safe = 'https://northstarjazzworkshops.com';
    var js = JSON.stringify(safe);
    return HtmlService.createHtmlOutput(
      '<!doctype html><html><head><meta charset="utf-8"><title>North Star Jazz Workshops</title>' +
      '<script>window.top.location.replace(' + js + ');</script></head>' +
      '<body style="font-family:Arial,sans-serif;padding:24px">Taking you to <a href=' + js + ' target="_top">North Star Jazz Workshops</a>...</body></html>'
    ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  // 1x1 transparent GIF
  var gif = Utilities.base64Decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
  return ContentService.createTextOutput(Utilities.newBlob(gif).getDataAsString()).setMimeType(ContentService.MimeType.TEXT);
}

// ---------- helpers ----------

function loadSequences_() {
  var rows = sheet_('Sequences').getDataRange().getValues();
  var out = {};
  for (var i = 1; i < rows.length; i++) {
    var name = String(rows[i][SEQ.NAME]).trim();
    if (!name) continue;
    (out[name] = out[name] || []).push({
      step: Number(rows[i][SEQ.STEP]),
      delay: Number(rows[i][SEQ.DELAY] || 0),
      subject: String(rows[i][SEQ.SUBJECT]),
      body: String(rows[i][SEQ.BODY]),
      inThread: String(rows[i][SEQ.IN_THREAD]).toLowerCase() === 'yes'
    });
  }
  Object.keys(out).forEach(function (k) { out[k].sort(function (a, b) { return a.step - b.step; }); });
  return out;
}

function log_(email, seqName, stepNo, event, detail) {
  sheet_('Log').appendRow([new Date(), email, seqName, stepNo, event, detail || '']);
}

function installDailyTrigger() {
  var cfg = settings();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDue') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDue').timeBased().everyDays(1).atHour(cfg.sendHour).inTimezone(cfg.tz).create();
  SpreadsheetApp.getActiveSpreadsheet().toast('Daily trigger set for ' + cfg.sendHour + ':00 ' + cfg.tz, 'Sequencer');
}
