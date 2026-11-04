/**
 * One-time builder for the Google Forms that replace the form-fed Monday boards.
 * Run buildAllForms() once from the Apps Script editor. It creates three forms,
 * links each to a response Sheet, and logs the URLs. Safe to re-run: it skips
 * any form whose name already exists in Drive.
 *
 * Wording is copied from the Monday forms Ben wrote.
 */

function buildAllForms() {
  var out = [];
  out.push(buildCancellationForm_());
  out.push(buildSubRequestForm_());
  out.push(buildUnavailableDatesForm_());
  Logger.log(out.join('\n'));
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) ss.toast('Forms built. See Execution log for links.', 'Forms');
  return out;
}

function existingForm_(name) {
  var it = DriveApp.getFilesByName(name);
  while (it.hasNext()) {
    var f = it.next();
    if (f.getMimeType() === 'application/vnd.google-apps.form') return f;
  }
  return null;
}

function finish_(form, name) {
  form.setCollectEmail(false).setLimitOneResponsePerUser(false).setShowLinkToRespondAgain(false);
  var ss = SpreadsheetApp.create(name + ' (responses)');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  return name + '\n  edit: ' + form.getEditUrl() + '\n  share: ' + form.getPublishedUrl() + '\n  responses: ' + ss.getUrl();
}

// ---------------------------------------------------------------------------

function buildCancellationForm_() {
  var name = 'North Star: ending or pausing your membership';
  if (existingForm_(name)) return name + ': already exists, skipped';
  var f = FormApp.create(name);
  f.setDescription('We ask for 30 days\' notice, so billing continues for 30 days from the date you submit this form. If you\'d rather talk it through first, just reply to any email from us.');

  f.addTextItem().setTitle('Your name').setRequired(true);
  f.addTextItem().setTitle('Email address')
    .setHelpText('The address on your North Star account, so we can find you.')
    .setRequired(true)
    .setValidation(FormApp.createTextValidation().requireTextIsEmail().build());

  f.addMultipleChoiceItem().setTitle('What are you ending?').setRequired(true)
    .setChoiceValues(['Private lessons', 'Ensemble', 'A class or course', 'Everything — all North Star programs']);

  f.addDateItem().setTitle('Last date you\'d like to attend')
    .setHelpText('We ask for 30 days\' notice, so billing continues for 30 days from the date you submit this form.')
    .setRequired(true);

  f.addMultipleChoiceItem().setTitle('What\'s the main reason?')
    .setHelpText('Pick the closest one. It genuinely helps us improve.')
    .setRequired(true)
    .setChoiceValues(['Cost', 'Schedule conflict', 'Moving away', 'Time commitment is too much right now',
      'Not the right fit — teacher or group', 'Health or personal reasons', 'I got what I came for',
      'Taking a break, but I plan to return', 'Something else']);

  f.addMultipleChoiceItem().setTitle('Would a pause work instead?')
    .setHelpText('We can hold your spot rather than close things out. No pressure either way.')
    .setRequired(true)
    .setChoiceValues(['Yes — pause me for about a month', 'Yes — pause me for two or three months',
      'No, I\'d like to cancel', 'Not sure — let\'s talk about it']);

  f.addCheckboxItem().setTitle('Keep me on the list for jam sessions and events')
    .setHelpText('You\'d hear from us occasionally about jams, concerts and clinics — nothing about billing.')
    .setChoiceValues(['Yes, keep me on the list']);

  f.addParagraphTextItem().setTitle('Anything we could have done better?')
    .setHelpText('Optional, and we read every one of these.');

  f.setConfirmationMessage('Got it. We\'ll confirm your last date and billing end by email within two business days.');
  return finish_(f, name);
}

// ---------------------------------------------------------------------------

var GROUPS_ = ['Group 1', 'Group 2', 'Group 3', 'Group 4', 'Group 5', 'Group 6', 'Group 7', 'Group 8', 'Group 9',
  'Group 10', 'Group 11', 'Group 12', 'Group 14', 'Group 15', 'Group 16', 'Group 17', 'Group 18', 'Group 19',
  'Group 20', 'Group 21', 'Vocal Ensemble (Sun)', 'Vocal Ensemble (Mon)', 'Foundations of Jazz 1',
  'Foundations of Jazz 2', 'Jazz Guitar Foundations', 'Jazz Singer\'s Playground', 'Jam Session Skills for Singers', 'Other'];

var TEACHERS_ = ['Joe Hartnett', 'Chris Bates', 'Anthony Cox', 'Jake Baldwin', 'Mary Louise Knutson',
  'Tommy Boynton', 'Anya Menk', 'Chris Graham', 'Chris Olson', 'Pete James Johnson', 'Ian Duerr', 'Other'];

function buildSubRequestForm_() {
  var name = 'North Star: member sub request';
  if (existingForm_(name)) return name + ': already exists, skipped';
  var f = FormApp.create(name);
  f.setDescription('Going to miss a rehearsal? Tell us here and we\'ll line up a sub so the band is whole.');

  f.addTextItem().setTitle('Your name').setRequired(true);
  f.addTextItem().setTitle('Email address').setRequired(true)
    .setValidation(FormApp.createTextValidation().requireTextIsEmail().build());
  f.addListItem().setTitle('Which group are you in?').setRequired(true).setChoiceValues(GROUPS_);
  f.addTextItem().setTitle('Your instrument').setRequired(true);
  f.addDateItem().setTitle('Rehearsal date you\'ll miss').setRequired(true);
  f.addParagraphTextItem().setTitle('Anything we should know?')
    .setHelpText('A sub you\'d suggest, a tune the group is working on, anything that helps.');

  f.setConfirmationMessage('Thanks. We\'ll let you and your group know once a sub is confirmed.');
  return finish_(f, name);
}

// ---------------------------------------------------------------------------

function buildUnavailableDatesForm_() {
  var name = 'North Star: teacher unavailable dates';
  if (existingForm_(name)) return name + ': already exists, skipped';
  var f = FormApp.create(name);
  f.setDescription('Let us know when you can\'t teach and whether you want a sub or a rehearsal swap.');

  f.addListItem().setTitle('Your name').setRequired(true).setChoiceValues(TEACHERS_);
  f.addListItem().setTitle('Group or program').setRequired(true).setChoiceValues(GROUPS_);
  f.addDateItem().setTitle('Date you\'re unavailable').setRequired(true);
  f.addMultipleChoiceItem().setTitle('What would you like to do?').setRequired(true)
    .setChoiceValues(['Find a sub', 'Rehearsal swap (move it to another date)', 'Cancel this rehearsal', 'Not sure yet']);
  f.addParagraphTextItem().setTitle('Notes')
    .setHelpText('A sub you\'d suggest, a swap date that works, anything else.');

  f.setConfirmationMessage('Thanks. We\'ll confirm the plan with you and the group.');
  return finish_(f, name);
}
