// ========================================================================================================
// EK TARA COMMUNICATIONS: SERVER CODE, SHARED (Shared.gs)
// code both sides use: entry points and API router, settings, Google Sheets database, scheduler, Twilio, webhooks, templates, replies, message statuses.
// The project needs all four server files: Shared.gs, Parent.gs, Donor.gs, Admin.gs (any order).
// If you see "Identifier 'ApiError' has already been declared", an old Code.gs is still in the project: delete it.
// ========================================================================================================
// ===== Api.gs =====
var BUILD_Api = '20261107-1230'; // build stamp (see Build.gs)
/**
 * Entry points. The same project is deployed twice (see SETUP.md):
 *  1. "Admin app"  : Execute as = User accessing the web app, Access = Anyone with Google account
 *  2. "Webhooks"   : Execute as = Me, Access = Anyone   (this URL is PUBLIC_BASE_URL, used by Twilio)
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.hook) return handleHook_(e);
  if (p.diag) return diagPage_();
  var email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  if (runsAsOwnerDeployment_(email)) {
    return HtmlService.createHtmlOutput('<div style="font-family:sans-serif;max-width:560px;margin:15vh auto;text-align:center"><h2>This address is for Twilio</h2><p>People do not use this link. Please open the <b>staff app</b> link you were given.</p></div>').setTitle('Ek Tara Communications');
  }
  var user = null, problem = '';
  try { user = email ? permissionsFor_(email) : null; } catch (err) { user = null; problem = String((err && err.message) || err); }
  if (!user) {
    var msg = !email ? 'You are not signed in to Google on this address. If you meant to open the app, use the <b>staff app address</b> (the link that asks you to sign in). This address may be the one reserved for Twilio, which people never use.'
      : problem ? 'The app could not read its Access file for <b>' + htmlEsc_(email) + '</b>:<br><i>' + htmlEsc_(problem) + '</i><br><br>If you own this project, open the Apps Script editor and run <b>diagnoseAccess</b>, then <b>repairOwnerAccess</b>. ' +
        'Everyone else: ask an administrator to check that the Access file is shared with you.'
      : 'The account <b>' + htmlEsc_(email) + '</b> has not been given access. Ask an administrator to add you under Users and access.' + requestAccessLink_(email);
    return HtmlService.createHtmlOutput('<div style="font-family:sans-serif;max-width:560px;margin:15vh auto;text-align:center"><h2>Not authorised</h2><p>' + msg + '</p></div>').setTitle('Ek Tara Communications');
  }
  var t = HtmlService.createTemplateFromFile('Index');
  t.userEmail = email;
  try { t.logo = logoDataUri_(); } catch (err) { t.logo = ''; } // the page works without it
  // A deep link such as ?division=donor only pre-selects; the server still decides what is allowed.
  t.requestedDivision = DIVISION_LABELS[String(p.division || '').toLowerCase()] ? String(p.division).toLowerCase() : '';
  return t.evaluate().setTitle('Ek Tara Communications')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Index.html pastes in its other files with this: Styles, JsCore, JsParent, JsDonor, JsAdmin (scriptlets in them are not run). */
function include_(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }

function doPost(e) {
  var p = (e && e.parameter) || {};
  if (p.hook) return handleHook_(e);
  return textOut_('Not found');
}

/** Plain status page for anyone who opens the app address with ?diag=1: works even when the main screen cannot start. */
function diagPage_() {
  var lines;
  try { lines = diagnoseLines_(true); } catch (e) { lines = ['The diagnosis itself failed: ' + e.message]; }
  return HtmlService.createHtmlOutput('<div style="font-family:system-ui,sans-serif;max-width:760px;margin:6vh auto;padding:0 16px"><h2>Ek Tara Communications: status</h2><pre style="white-space:pre-wrap;background:#f4f4f5;padding:14px;border-radius:8px;line-height:1.5">' +
    htmlEsc_(lines.join('\n')) + '</pre><p style="color:#52525b">Send this to the project owner if something is not working. It contains no donor or parent data.</p></div>').setTitle('Ek Tara status');
}

/** A "Request access" email to the owner (the one contact every install has), with the person's address filled in. */
function requestAccessLink_(email) {
  var owner = ownerEmail_();
  if (!owner) return '';
  var href = 'mailto:' + owner + '?subject=' + encodeURIComponent('Please give me access to Ek Tara Communications') +
    '&body=' + encodeURIComponent('Hello,\n\nPlease give this Google account access to Ek Tara Communications: ' + email + '\n\nThank you');
  return '<p><a href="' + htmlEsc_(href) + '" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#0e5e55;color:#fff;text-decoration:none;font-weight:600">Email an administrator to request access</a></p>';
}

function htmlEsc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * A deployment set to "Execute as: Me" runs with the owner's rights, so Google would not keep the parent and donor sheets apart for the people using it.
 * That is the Twilio address. If someone other than the owner reaches the app through it, refuse.
 */
function runsAsOwnerDeployment_(email) {
  var eff = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  return !!(eff && email && eff !== email);
}

function currentUser_() {
  var email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email) throw new ApiError('Not signed in.', null, 401);
  if (runsAsOwnerDeployment_(email)) throw new ApiError('This address is only for Twilio. Use the staff app link.', null, 403);
  var user = null, problem = '';
  try { user = permissionsFor_(email); } catch (e) { problem = String((e && e.message) || e); } // e.g. no longer shared on the Access file
  // (read fresh on every request: revocations apply immediately)
  if (!user) throw new ApiError(problem ? 'The app could not read its Access file (' + problem + '). Ask an administrator to check your access.' : 'Your account has not been given access, or has been deactivated.', null, 403);
  return user;
}

var API = {
  'session': function (u) { return sessionInfo_(u); },
  'prefs.setDivision': function (u, division) { return setPreferredDivision_(u, division); },
  'overview.summary': function (u) { return overviewSummary_(); },
  'info': function (u) {
    var c = cfg_();
    return { call_fallback_hours: c.CALL_FALLBACK_HOURS, call_window_start: c.CALL_WINDOW_START, call_window_end: c.CALL_WINDOW_END,
      timezone: c.APP_TIMEZONE, cost_per_whatsapp: c.COST_PER_WHATSAPP, cost_per_call: c.COST_PER_CALL,
      currency: c.COST_CURRENCY, voice_enabled: !!c.TWILIO_VOICE_FROM, user: u.email };
  },
  'parents.list': function (u, f) { return listParents_(u, f); },
  'parents.groups': function (u) { return listGroups_(); },
  'parents.upload': function (u, csv) { return uploadParents_(u, csv); },
  'parents.history': function (u, id) { return parentHistory_(u, id); },
  'templates.list': function (u, status) { return listTemplates_(u, status); },
  'templates.create': function (u, body) { return createTemplate_(u, body); },
  'templates.retrySubmit': function (u, id) { return retrySubmit_(u, id); },
  'templates.delete': function (u, id) { return deleteTemplate_(u, id); },
  'templates.import': function (u) { return importTwilioTemplates_(u); },
  'templates.sync': function (u) { return syncPendingTemplates_(); },
  'templates.notifications': function (u) { return templateNotifications_(u); },
  'templates.seen': function (u, id) { return markTemplateSeen_(u, id); },
  'campaigns.list': function (u, f) { return listCampaigns_(u, f); },
  'campaigns.get': function (u, id, status) { return getCampaign_(u, id, status); },
  'campaigns.create': function (u, body) { return createCampaign_(u, body); },
  'campaigns.sendBatch': function (u, id) { return sendCampaignBatch_(id, 40000); },
  'campaigns.export': function (u, id) { return exportCampaign_(id); },
  'campaigns.cancel': function (u, id) { return cancelCampaign_(u, id); },
  'campaigns.delete': function (u, id) { return deleteCampaign_(u, id); },
  'campaigns.retryFailed': function (u, id) { return retryFailed_(u, id); },
  'messages.resolve': function (u, id, outcome) { return resolveMessage_(u, id, outcome); },
  'messages.events': function (u, id) { return eventsForMessage_(id); }
};

/**
 * google.script.run hands the page null (shown as "Request failed") when a reply holds a value it cannot send, such as a
 * date read from a sheet cell. A JSON round trip turns those into plain text first.
 */
function plainData_(v) { return v === undefined ? null : JSON.parse(JSON.stringify(v)); }

/** Single entry point for google.script.run. Always returns {ok, data} or {ok:false, error, errors}. */
function api(method, args) {
  try {
    var user = currentUser_();
    var fn = API[method] || (typeof DONOR_API !== 'undefined' ? DONOR_API[method] : null) || (typeof ADMIN_API !== 'undefined' ? ADMIN_API[method] : null);
    if (!fn) throw new ApiError('Unknown method ' + method, null, 404);
    var division = divisionFor_(method);
    if (division) requireDivision_(user, division); // the server enforces access; hiding UI is not security
    var data = fn.apply(null, [user].concat(args || []));
    if (division === 'donor') data = plainData_(data);   // donor only: dates and other non-plain values become text, so the reply is never lost
    return { ok: true, data: data };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: e.message, errors: e.errors, status: e.status };
    console.error(method + ': ' + (e && e.stack || e));
    return { ok: false, error: 'Unexpected error: ' + (e && e.message || e) };
  }
}

// ===== Branding.gs =====
var BUILD_Branding = '20261107-1230'; // build stamp (see Build.gs)
/**
 * Logo. The logo file lives in the project owner's Google Drive. The owner runs importLogo() once;
 * it copies the image into Script Properties, so every teammate sees it without needing access to the Drive file.
 * Limit: 300 KB (a PNG, JPG, WebP, GIF or SVG; an SVG or a PNG under 100 KB is ideal).
 */
var DEFAULT_LOGO_FILE_ID = '1Qk1sC6kX2Zc5CRUcDi2ybQLJg1579rAE';
var LOGO_MAX_BYTES = 300 * 1024;
var LOGO_CHUNK = 8000; // one Script Property holds at most 9 KB

/** Accepts a plain Drive file ID or a full Drive link. */
function fileIdFrom_(v) {
  var m = /[-\w]{25,}/.exec(String(v || ''));
  return m ? m[0] : '';
}

function clearLogo_(props) {
  var n = Number(props.getProperty('LOGO_CHUNKS') || 0);
  for (var i = 0; i < n; i++) props.deleteProperty('LOGO_' + i);
  props.deleteProperty('LOGO_CHUNKS'); props.deleteProperty('LOGO_MIME');
  try { CacheService.getScriptCache().remove('logo'); } catch (e) { /* cache is optional */ }
}

/** Run once from the editor as the project owner. Reads the file named by LOGO_FILE_ID (ID or link), or the default below. */
function importLogo() {
  var props = PropertiesService.getScriptProperties();
  var id = fileIdFrom_(props.getProperty('LOGO_FILE_ID')) || DEFAULT_LOGO_FILE_ID, file;
  try { file = DriveApp.getFileById(id); }
  catch (e) {
    if (/permissions are not sufficient|required permissions/i.test(e.message)) {
      throw new Error('This project is not allowed to use Drive yet. Open Project Settings, tick "Show appsscript.json manifest file in editor", ' +
        'add "https://www.googleapis.com/auth/drive" to the oauthScopes list (see SETUP.md, "Permissions"), save, run importLogo again and approve the new permission.');
    }
    throw new Error('Cannot open the logo in Drive (file ID ' + id + '). Run this while signed in as the Google account that owns the file, or share the file with the account you are using. ' + e.message);
  }
  var blob = file.getBlob(), mime = String(blob.getContentType() || '');
  if (!/^image\/(png|jpeg|jpg|gif|webp|svg\+xml)$/.test(mime)) throw new Error('The file is "' + mime + '", not an image. Use a PNG, JPG, WebP, GIF or SVG.');
  var bytes = blob.getBytes();
  if (bytes.length > LOGO_MAX_BYTES) throw new Error('The logo is ' + Math.round(bytes.length / 1024) + ' KB; the limit is ' + (LOGO_MAX_BYTES / 1024) + ' KB. Export a smaller version (for example a 400 pixel wide PNG, or an SVG).');
  var b64 = Utilities.base64Encode(bytes), n = Math.ceil(b64.length / LOGO_CHUNK);
  clearLogo_(props);
  for (var i = 0; i < n; i++) props.setProperty('LOGO_' + i, b64.slice(i * LOGO_CHUNK, (i + 1) * LOGO_CHUNK));
  props.setProperty('LOGO_MIME', mime); props.setProperty('LOGO_CHUNKS', String(n));
  var msg = 'Logo imported (' + Math.max(1, Math.round(bytes.length / 1024)) + ' KB, ' + mime + '). Deploy a new version of the admin app to show it.';
  console.log(msg); toast_(msg);
  return msg;
}

function removeLogo() {
  clearLogo_(PropertiesService.getScriptProperties());
  var msg = 'Logo removed. The built-in Ek Tara mark is used again.';
  console.log(msg); toast_(msg);
  return msg;
}

/** data: URI for the page, or '' when no logo has been imported. */
function logoDataUri_() {
  var cache = null, hit = null;
  try { cache = CacheService.getScriptCache(); hit = cache.get('logo'); } catch (e) { cache = null; }
  if (hit) return hit;
  var props = PropertiesService.getScriptProperties(), n = Number(props.getProperty('LOGO_CHUNKS') || 0), mime = props.getProperty('LOGO_MIME');
  if (!n || !mime) return '';
  var b64 = '';
  for (var i = 0; i < n; i++) b64 += props.getProperty('LOGO_' + i) || '';
  var uri = 'data:' + mime + ';base64,' + b64;
  if (cache && uri.length < 90000) { try { cache.put('logo', uri, 3600); } catch (e) { /* too large to cache: fine */ } }
  return uri;
}

// ===== Build.gs =====
var BUILD_Build = '20261107-1230'; // build stamp
/**
 * Version check. Every .gs file starts with the same build stamp. If someone replaces only some of the files, or the web page and the
 * server code come from different versions, the app shows which file is stale instead of failing in confusing ways.
 */
function buildReport_() {
  var files = [
    ['Admin', typeof BUILD_Admin === 'undefined' ? null : BUILD_Admin],
    ['Api', typeof BUILD_Api === 'undefined' ? null : BUILD_Api],
    ['Archive', typeof BUILD_Archive === 'undefined' ? null : BUILD_Archive],
    ['Branding', typeof BUILD_Branding === 'undefined' ? null : BUILD_Branding],
    ['Build', typeof BUILD_Build === 'undefined' ? null : BUILD_Build],
    ['Campaigns', typeof BUILD_Campaigns === 'undefined' ? null : BUILD_Campaigns],
    ['Config', typeof BUILD_Config === 'undefined' ? null : BUILD_Config],
    ['Cron', typeof BUILD_Cron === 'undefined' ? null : BUILD_Cron],
    ['Db', typeof BUILD_Db === 'undefined' ? null : BUILD_Db],
    ['DonorApi', typeof BUILD_DonorApi === 'undefined' ? null : BUILD_DonorApi],
    ['DonorCore', typeof BUILD_DonorCore === 'undefined' ? null : BUILD_DonorCore],
    ['DonorEngine', typeof BUILD_DonorEngine === 'undefined' ? null : BUILD_DonorEngine],
    ['DonorRules', typeof BUILD_DonorRules === 'undefined' ? null : BUILD_DonorRules],
    ['Fallback', typeof BUILD_Fallback === 'undefined' ? null : BUILD_Fallback],
    ['Parents', typeof BUILD_Parents === 'undefined' ? null : BUILD_Parents],
    ['Permissions', typeof BUILD_Permissions === 'undefined' ? null : BUILD_Permissions],
    ['Replies', typeof BUILD_Replies === 'undefined' ? null : BUILD_Replies],
    ['Sender', typeof BUILD_Sender === 'undefined' ? null : BUILD_Sender],
    ['Setup', typeof BUILD_Setup === 'undefined' ? null : BUILD_Setup],
    ['Status', typeof BUILD_Status === 'undefined' ? null : BUILD_Status],
    ['Templates', typeof BUILD_Templates === 'undefined' ? null : BUILD_Templates],
    ['Twilio', typeof BUILD_Twilio === 'undefined' ? null : BUILD_Twilio],
    ['VoiceScripts', typeof BUILD_VoiceScripts === 'undefined' ? null : BUILD_VoiceScripts],
    ['Webhooks', typeof BUILD_Webhooks === 'undefined' ? null : BUILD_Webhooks]
  ];
  var present = files.filter(function (f) { return f[1]; }).map(function (f) { return f[1]; }).sort();
  var newest = present.length ? present[present.length - 1] : null, problems = [];
  files.forEach(function (f) {
    var where = 'the ' + f[0] + ' part of ' + (BUILD_FILE_OF[f[0]] || 'the server code');   // the old file names are now parts of four files
    if (!f[1]) problems.push(where + ' is missing or out of date');
    else if (f[1] !== newest) problems.push(where + ' is from an older build (' + f[1] + ')');
  });
  return { newest: newest, problems: problems };
}

/** Which of the four server files holds each part. */
var BUILD_FILE_OF = { Api: 'Shared.gs', Branding: 'Shared.gs', Build: 'Shared.gs', Config: 'Shared.gs', Cron: 'Shared.gs', Db: 'Shared.gs', Replies: 'Shared.gs',
  Status: 'Shared.gs', Templates: 'Shared.gs', Twilio: 'Shared.gs', Webhooks: 'Shared.gs', Archive: 'Parent.gs', Campaigns: 'Parent.gs', Fallback: 'Parent.gs',
  Parents: 'Parent.gs', Sender: 'Parent.gs', VoiceScripts: 'Parent.gs', DonorApi: 'Donor.gs', DonorCore: 'Donor.gs', DonorEngine: 'Donor.gs', DonorRules: 'Donor.gs',
  Admin: 'Admin.gs', Permissions: 'Admin.gs', Setup: 'Admin.gs' };

function buildProblems_() { var r = buildReport_(); return r.problems.join('; '); }

// ===== Config.gs =====
var BUILD_Config = '20261107-1230'; // build stamp (see Build.gs)
/**
 * Configuration lives in Script Properties (Project Settings -> Script properties).
 * Never put the Twilio token in the code or in the spreadsheet.
 */
var DEFAULTS = {
  TWILIO_MESSAGING_SERVICE_SID: '',
  CALL_FALLBACK_HOURS: '6',
  CALL_WINDOW_START: '09:00',
  CALL_WINDOW_END: '19:00',
  APP_TIMEZONE: 'Asia/Kolkata',
  SEND_CONCURRENCY: '10',
  COST_PER_WHATSAPP: '0',
  COST_PER_CALL: '0',
  COST_CURRENCY: 'INR'
};

var cfgCache_ = null;

function cfg_() {
  if (cfgCache_) return cfgCache_;
  var p = PropertiesService.getScriptProperties().getProperties();
  function get(k) { return p[k] !== undefined && p[k] !== '' ? p[k] : (DEFAULTS[k] !== undefined ? DEFAULTS[k] : ''); }
  function hhmm(v) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(v).trim());
    return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : '09:00';
  }
  cfgCache_ = {
    TWILIO_ACCOUNT_SID: get('TWILIO_ACCOUNT_SID'),
    TWILIO_AUTH_TOKEN: get('TWILIO_AUTH_TOKEN'),
    TWILIO_WHATSAPP_FROM: get('TWILIO_WHATSAPP_FROM'),
    TWILIO_VOICE_FROM: get('TWILIO_VOICE_FROM'),
    TWILIO_MESSAGING_SERVICE_SID: get('TWILIO_MESSAGING_SERVICE_SID'),
    // URL of the *webhook* deployment (Execute as: Me, Access: Anyone), no trailing slash.
    PUBLIC_BASE_URL: String(get('PUBLIC_BASE_URL')).replace(/\/+$/, ''),
    WEBHOOK_SECRET: get('WEBHOOK_SECRET'),
    CALL_FALLBACK_HOURS: Number(get('CALL_FALLBACK_HOURS')) || 6,
    CALL_WINDOW_START: hhmm(get('CALL_WINDOW_START')),
    CALL_WINDOW_END: hhmm(get('CALL_WINDOW_END')),
    APP_TIMEZONE: get('APP_TIMEZONE'),
    SEND_CONCURRENCY: Math.max(1, Number(get('SEND_CONCURRENCY')) || 10),
    COST_PER_WHATSAPP: Number(get('COST_PER_WHATSAPP')) || 0,
    COST_PER_CALL: Number(get('COST_PER_CALL')) || 0,
    COST_CURRENCY: get('COST_CURRENCY')
  };
  return cfgCache_;
}

function requireConfig_(keys) {
  var c = cfg_();
  var missing = keys.filter(function (k) { return !c[k]; });
  if (missing.length) throw new ApiError('Missing script properties: ' + missing.join(', ') + '. See SETUP.md.');
}

class ApiError extends Error {
  constructor(message, errors, status) {
    super(message);
    this.name = 'ApiError';
    this.errors = errors || null;
    this.status = status || 400;
  }
}

function nowIso_() { return new Date().toISOString(); }

// ===== Cron.gs =====
var BUILD_Cron = '20261107-1230'; // build stamp (see Build.gs)
/** Scheduler. Install with installTriggers() (menu: Parent Comm -> Install triggers). */
var TICK_BUDGET_MS = 4.5 * 60 * 1000;
var REPLAY_SOURCES = ['whatsapp_status', 'whatsapp_inbound', 'voice_gather', 'voice_status'];

/** Replay events that arrived while the lock was busy (last 24 h). */
function replayEvents_() {
  var cutoff = Date.now() - 24 * 3600 * 1000, done = 0;
  (donorReady_() ? ['Events', 'DonorEvents'] : ['Events']).forEach(function (tbl) {
    lastEvents_(500, tbl).filter(function (ev) {
      return !ev.processed && REPLAY_SOURCES.indexOf(ev.source) >= 0 && Date.parse(ev.created_at) > cutoff;
    }).forEach(function (ev) {
      if (processEvent_(ev.id, ev.source, ev.payload || {}, ev.message_id)) done++;
    });
  });
  return { replayed: done };
}

function cronTick() { return tick_(); }

function tick_() {
  var cache = CacheService.getScriptCache();
  if (cache.get('tick_running')) return { skipped: 'previous tick still running' };
  cache.put('tick_running', '1', 330);
  var deadline = Date.now() + TICK_BUDGET_MS;
  var result = {};
  // Replays first, then resends and re-checks so new failures get their fallback call in the same tick,
  // and recovered replies come before the fallback so a parent who answered is not called.
  var jobs = [
    ['replay_events', function () { return replayEvents_(); }],
    ['resume_campaigns', function () { return resumeStuckCampaigns_(deadline - 90000); }],
    ['whatsapp_recheck', function () { return recheckStuckMessages_(deadline - 60000); }],
    ['poll_status', function () { return instantUpdates_() ? { skipped: 'Twilio calls the app back (webhooks on)' } : pollMessageStatuses_(); }],
    ['recover_replies', function () { return recoverMissedReplies_(); }],
    ['fallback', function () { return runFallback_(deadline); }],
    ['donor_triggers', function () { return runDonorTriggers_(); }],
    ['donor_dispatch', function () { return dispatchDonorBatch_(Math.max(10000, deadline - Date.now() - 60000)); }],
    ['access_expiry', function () { return expireAccess_(); }],
    ['overview', function () { return refreshOverviewSnapshot_(); }],
    ['archive', function () { return archiveFinishedCampaigns_(deadline); }],
    ['templates', function () { return syncPendingTemplates_(donorReady_() ? ['Templates', 'DonorTemplates'] : ['Templates']); }]
  ];
  try {
    jobs.forEach(function (j) {
      try { result[j[0]] = j[1](); }
      catch (e) { console.error('Cron job ' + j[0] + ' failed: ' + e.message); result[j[0]] = { error: e.message }; }
    });
  } finally { cache.remove('tick_running'); }
  return result;
}

/** Every 5 minutes, so missed updates and unfinished campaigns are picked up quickly. */
function defaultTriggerMinutes_() { return 5; }

function installTriggers(minutes) {
  removeTriggers();
  var m = [1, 5, 10, 15, 30].indexOf(minutes) >= 0 ? minutes : defaultTriggerMinutes_();
  ScriptApp.newTrigger('cronTick').timeBased().everyMinutes(m).create();
  return 'Installed: cronTick every ' + m + ' minutes.';
}

function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'cronTick') ScriptApp.deleteTrigger(t);
  });
}

// ===== Db.gs =====
var BUILD_Db = '20261107-1230'; // build stamp (see Build.gs)
/**
 * Google Sheets as the database. One tab per table, row 1 = headers. Donor tabs are matched by header name;
 * parent and access tabs by column position.
 * Types: s=string, b=boolean, j=json, n=number. Everything is stored as plain text
 * so phone numbers like +9198... are never turned into numbers by Sheets.
 *
 * Functions ending in "_" that change data must run inside withLock_().
 */
var SCHEMA = {
  Admins: [['email', 's'], ['full_name', 's'], ['active', 'b'], ['parent_access', 's'], ['donor_access', 's'],
    ['org_overview', 's'], ['role', 's'], ['admin_caps', 's'], ['expires_on', 's']],
  // One row per child. id is Ek Tara's "New Child ID" from the upload (the app does not generate it).
  Parents: [['id', 's'], ['file_number', 's'], ['parent_name', 's'], ['phone_e164', 's'], ['child_name', 's'],
    ['institution', 's'], ['beneficiary_type', 's'], ['beneficiary_status', 's'], ['class_or_year', 's'], ['section', 's'],
    ['created_at', 's'], ['updated_at', 's']],
  Templates: [['id', 's'], ['name', 's'], ['language', 's'], ['category', 's'], ['body', 's'],
    ['variable_names', 'j'], ['sample_values', 'j'], ['has_confirm_buttons', 'b'], ['status', 's'],
    ['twilio_content_sid', 's'], ['rejection_reason', 's'], ['requested_by', 's'], ['decision_seen', 'b'],
    ['created_at', 's'], ['updated_at', 's'], ['division', 's'], ['message_type', 's'], ['source_code', 's'],
    ['meta_status', 's'], ['meta_checked_at', 's']],
  Campaigns: [['id', 's'], ['template_id', 's'], ['audience', 's'], ['institution', 's'], ['class_or_year', 's'],
    ['section', 's'], ['variables', 'j'], ['created_by', 's'], ['status', 's'], ['created_at', 's'],
    ['archive_url', 's'], ['archived_at', 's'], ['groups', 'j'], ['name', 's'],
    ['template_name', 's'], ['template_language', 's'], ['template_body', 's'], ['template_has_buttons', 'b'],
    ['beneficiary_types', 'j']],
  Messages: [['id', 's'], ['campaign_id', 's'], ['parent_id', 's'], ['template_id', 's'], ['status', 's'],
    ['wa_sid', 's'], ['wa_sent_at', 's'], ['wa_error', 's'], ['call_sid', 's'], ['call_requested_at', 's'],
    ['call_status', 's'], ['call_digit', 's'], ['confirmed_via', 's'], ['send_claimed_at', 's'],
    ['reply_text', 's'], ['replied_at', 's'], ['resolved_by', 's'], ['updated_at', 's'],
    ['parent_name', 's'], ['child_name', 's'], ['phone_e164', 's'], ['status_at', 's']],
  Events: [['id', 's'], ['message_id', 's'], ['source', 's'], ['payload', 'j'], ['created_at', 's'],
    ['processed', 'b']],

  // ---- Donor Communication ----
  Donors: [['id', 's'], ['name', 's'], ['contact_type', 's'], ['phone_e164', 's'], ['email', 's'], ['city', 's'], ['language', 's'],
    ['segment', 's'], ['source_note', 's'], ['whatsapp_opt_in', 'b'], ['opt_in_at', 's'], ['opt_in_source', 's'], ['opted_out', 'b'],
    ['status', 's'], ['project', 's'], ['core_programme', 's'],
    ['owner_name', 's'], ['owner_email', 's'], ['last_donation_date', 's'], ['last_donation_amount', 's'],
    ['last_message_at', 's'], ['last_message_type', 's'],
    ['notes', 's'], ['created_at', 's'], ['updated_at', 's'],
    // added later: new donor fields go at the END of the list (columns are read by position; setup adds the header)
    ['org', 's'], ['reference', 's'], ['email_opt_in', 'b'], ['email_opt_in_at', 's'], ['email_opt_in_source', 's'], ['tags', 'j'], ['contact_status', 's']],   // contact_status: ACTIVE / INACTIVE (blank = ACTIVE)
  SegmentHistory: [['id', 's'], ['donor_id', 's'], ['from_segment', 's'], ['to_segment', 's'], ['reason', 's'], ['changed_by', 's'], ['changed_at', 's']],
  Donations: [['id', 's'], ['donor_id', 's'], ['campaign_id', 's'], ['amount', 's'], ['donated_on', 's'], ['note', 's'],
    ['recorded_by', 's'], ['recorded_at', 's']],
  DonorCampaigns: [['id', 's'], ['name', 's'], ['start_date', 's'], ['end_date', 's'], ['status', 's'],
    ['progress_text', 's'], ['results_text', 's'], ['results_ready_at', 's'], ['notes', 's'], ['created_at', 's']],
  DonorBroadcasts: [['id', 's'], ['trigger', 's'], ['kind', 's'], ['name', 's'], ['template_id', 's'], ['campaign_id', 's'],
    ['segments', 'j'], ['values', 'j'], ['send_on', 's'], ['event_date', 's'],
    ['status', 's'], ['created_by', 's'], ['approved_by', 's'], ['approved_at', 's'], ['message_count', 'n'],
    ['created_at', 's'], ['excluded_tags', 'j'], ['channels', 'j']],   // channels: set on approval
  DonorMessages: [['id', 's'], ['donor_id', 's'], ['channel', 's'], ['to_email', 's'], ['template_id', 's'], ['message_type', 's'],
    ['trigger', 's'], ['broadcast_id', 's'], ['campaign_id', 's'], ['donation_id', 's'], ['ref', 's'], ['variables', 'j'],
    ['dedupe_key', 's'], ['status', 's'], ['hold_reason', 's'], ['not_before', 's'], ['expires_at', 's'],
    ['send_claimed_at', 's'], ['wa_sid', 's'], ['wa_sent_at', 's'], ['wa_error', 's'], ['reply_text', 's'], ['replied_at', 's'],
    ['created_at', 's'], ['updated_at', 's']],

  // ---- Access file: who may use the app (readable by every staff member) ----
  AccessLog: [['id', 's'], ['at', 's'], ['by', 's'], ['action', 's'], ['email', 's'], ['details', 's']],
  Overview: [['key', 's'], ['value', 'j'], ['updated_at', 's']]
};
// Donor templates and donor events have the same shape as the parent ones, but live in the donor file.
SCHEMA.DonorTemplates = SCHEMA.Templates.concat([['media_type', 's']]);   // donor only: '' | image | document (a WhatsApp media template)
SCHEMA.DonorEvents = SCHEMA.Events.slice();

/**
 * Three Google Sheets keep the departments apart at the file level:
 *   access  Admins (who may do what), AccessLog, Overview totals. Everyone signed in can read it.
 *   parent  parents, parent templates, parent campaigns and messages.
 *   donor   donors, donations, donor campaigns, broadcasts, messages, templates.
 * A person who is not shared on a file cannot open it, in the app or in Google Drive.
 */
var FILE_OF = {
  Admins: 'access', AccessLog: 'access', Overview: 'access',
  Parents: 'parent', Templates: 'parent', Campaigns: 'parent', Messages: 'parent', Events: 'parent',
  Donors: 'donor', SegmentHistory: 'donor', Donations: 'donor', DonorCampaigns: 'donor', DonorBroadcasts: 'donor',
  DonorMessages: 'donor', DonorTemplates: 'donor', DonorEvents: 'donor'
};
var FILE_TITLES = { parent: 'Ek Tara \u2013 Parent Database', donor: 'Ek Tara \u2013 Donor Database', access: 'Ek Tara \u2013 Access' };
var FILE_PROP = { parent: 'SPREADSHEET_ID', donor: 'DONOR_SPREADSHEET_ID', access: 'ACCESS_SPREADSHEET_ID' };

var sheetCache_ = {};

function ss_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  var active = SpreadsheetApp.getActiveSpreadsheet(); // only set when the script is attached to a sheet
  if (active) return active;
  throw new Error('No database sheet yet. Run setup() once from the Apps Script editor.');
}

/** The spreadsheet that holds a file. Until setup() has created the donor and access files, everything is in the original one. */
function ssFor_(file) {
  if (file === 'parent') return ss_();
  var id = PropertiesService.getScriptProperties().getProperty(FILE_PROP[file]);
  return id ? SpreadsheetApp.openById(id) : ss_();
}

function fileIdOf_(file) {
  var id = PropertiesService.getScriptProperties().getProperty(FILE_PROP[file]);
  if (id) return id;
  try { return ss_().getId(); } catch (e) { return null; }   // before setup(): the one original file
}

/**
 * Every tab (parent, donor, access) is read and written by column position, in SCHEMA order.
 * Donor tabs are checked once per run: if their columns are not in SCHEMA order the app refuses to read or write them,
 * so a moved or inserted column can never put values in the wrong place. The fix is to move the columns back into SCHEMA order
 * in the sheet. Columns the team adds to the right of the app's columns are left alone.
 */
function sheet_(name) {
  if (!sheetCache_[name]) {
    var s = ssFor_(FILE_OF[name] || 'parent').getSheetByName(name);
    if (!s) throw new Error('Sheet "' + name + '" is missing. Run Setup (see SETUP.md).');
    if (FILE_OF[name] === 'donor') {
      var bad = donorLayoutProblem_(s, name, false);
      if (bad) throw new ApiError(bad + ' Nothing was read or saved. Move the columns back into the app’s order in the donor Google Sheet (the donor Overview screen lists the order).');
    }
    sheetCache_[name] = s;
  }
  return sheetCache_[name];
}

/** True when the Parents tab has the current header row (or no header yet). */
function parentsHeaderOk_(sh) {
  var want = fieldNames_('Parents');
  if (sh.getLastRow() === 0) return true;
  if (sh.getMaxColumns() < want.length) return false;
  var have = sh.getRange(1, 1, 1, want.length).getValues()[0];
  return want.every(function (w, i) { return String(have[i]) === w; });
}

/** Parent pages refuse to read or write an old-style Parents tab until setup() has replaced it. */
function requireNewParentsTab_() {
  if (!parentsHeaderOk_(sheet_('Parents'))) throw new ApiError('The Parents tab still has the old columns. Ask the project owner to run setup() once from the Apps Script editor: it keeps the old tab as a backup and creates the new one.');
}

function colLetter_(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

/**
 * '' when a donor tab's first columns are exactly the app's columns, in SCHEMA order; otherwise what is wrong, in plain words.
 * missingTailOk: blank headers at the end are accepted (setup then writes them, e.g. for a column added to SCHEMA later).
 */
function donorLayoutProblem_(s, name, missingTailOk) {
  var cols = fieldNames_(name), width = Math.min(s.getLastColumn(), cols.length);
  var raw = width ? s.getRange(1, 1, 1, width).getValues()[0] : [];
  for (var i = 0; i < cols.length; i++) {
    var h = donorHeaderKey_(raw[i]);
    if (h === cols[i]) continue;
    if (missingTailOk && !h && raw.slice(i).every(function (x) { return !donorHeaderKey_(x); })) return '';
    return 'The "' + name + '" tab of the donor sheet is not in the app’s column order: column ' + colLetter_(i + 1) + ' should be "' + cols[i] + '" but is ' +
      (h ? '"' + String(raw[i]).trim() + '"' : 'empty') + '.';
  }
  return '';
}

/** The column order each donor tab must have: [{ tab, columns: [names] }] (shown on the donor Overview when a tab is out of order). */
function donorExpectedColumns_() {
  return Object.keys(FILE_OF).filter(function (n) { return FILE_OF[n] === 'donor'; }).map(function (n) { return { tab: n, columns: fieldNames_(n) }; });
}

/** Every donor tab whose columns are out of order (for the donor Overview). */
function donorLayoutProblems_() {
  var ss = ssFor_('donor'), out = [];
  Object.keys(FILE_OF).filter(function (n) { return FILE_OF[n] === 'donor'; }).forEach(function (name) {
    var sh = ss.getSheetByName(name); if (!sh) return;
    var bad = donorLayoutProblem_(sh, name, false); if (bad) out.push(bad);
  });
  return out;
}

/** "Email Opt-In " and "email_opt_in" are the same header. */
function donorHeaderKey_(h) { return String(h === null || h === undefined ? '' : h).trim().toLowerCase().replace(/[\s\-]+/g, '_'); }

/** Column number (1-based) of a field. */
function colOf_(name, field) { return fieldNames_(name).indexOf(field) + 1; }
/** How many columns to read for a whole row. */
function widthOf_(name) { return SCHEMA[name].length; }

function newId_() { return Utilities.getUuid(); }

function fromCell_(v, type) {
  if (type === 'b') return v === true || String(v).toUpperCase() === 'TRUE';
  if (v === '' || v === null || v === undefined) return null;
  if (type === 'j') { try { return JSON.parse(v); } catch (e) { return null; } }
  if (type === 'n') return Number(v);
  return String(v);
}

function toCell_(v, type) {
  if (type === 'b') return v ? 'TRUE' : 'FALSE';
  if (v === null || v === undefined) return '';
  if (type === 'j') return JSON.stringify(v);
  return String(v);
}

function fieldNames_(name) { return SCHEMA[name].map(function (c) { return c[0]; }); }

/** One sheet row (its cells, in SCHEMA order) as an object. */
function rowFromValues_(name, vals, rowNumber) {
  var cols = SCHEMA[name], o = { _row: rowNumber };
  for (var j = 0; j < cols.length; j++) o[cols[j][0]] = fromCell_(vals[j], cols[j][1]);
  return o;
}

function loadTable_(name) {
  var sh = sheet_(name), last = sh.getLastRow(), n = widthOf_(name), idCol = colOf_(name, SCHEMA[name][0][0]) - 1, rows = [];
  if (last < 2) return rows;
  var vals = sh.getRange(2, 1, last - 1, n).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (vals[i][idCol] === '' || vals[i][idCol] === null) continue;   // a row without an id is not a record
    rows.push(rowFromValues_(name, vals[i], i + 2));
  }
  return rows;
}

function loadRowAt_(name, rowNumber) {
  var vals = sheet_(name).getRange(rowNumber, 1, 1, widthOf_(name)).getValues()[0];
  return rowFromValues_(name, vals, rowNumber);
}

/** Exact-match lookup on one column using the Sheets text finder (fast, no full load). */
function findBy_(name, field, value) {
  if (value === null || value === undefined || value === '') return [];
  var sh = sheet_(name), last = sh.getLastRow();
  if (last < 2) return [];
  var cells = sh.getRange(2, colOf_(name, field), last - 1, 1).createTextFinder(String(value))
    .matchEntireCell(true).matchCase(true).findAll();
  return cells.map(function (c) { return loadRowAt_(name, c.getRow()); });
}

function findOne_(name, field, value) {
  var r = findBy_(name, field, value);
  return r.length ? r[0] : null;
}

function rowToValues_(name, obj) {
  return SCHEMA[name].map(function (c) { return toCell_(obj[c[0]], c[1]); });
}

/** Write changed rows back (rows must carry _row). Contiguous rows go in one call. */
function saveRows_(name, rows) {
  if (!rows.length) return;
  var sh = sheet_(name), n = SCHEMA[name].length;
  var sorted = rows.slice().sort(function (a, b) { return a._row - b._row; });
  var i = 0;
  while (i < sorted.length) {
    var j = i;
    while (j + 1 < sorted.length && sorted[j + 1]._row === sorted[j]._row + 1) j++;
    var block = sorted.slice(i, j + 1).map(function (r) { return rowToValues_(name, r); });
    sh.getRange(sorted[i]._row, 1, block.length, n).setValues(block);
    i = j + 1;
  }
}

function insertRows_(name, objs) {
  if (!objs.length) return;
  var sh = sheet_(name), n = SCHEMA[name].length, CHUNK = 2000;
  for (var i = 0; i < objs.length; i += CHUNK) {
    var chunk = objs.slice(i, i + CHUNK).map(function (o) { return rowToValues_(name, o); });
    var start = sh.getLastRow() + 1, end = start + chunk.length - 1;
    if (end > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), end - sh.getMaxRows() + 100);
    var rng = sh.getRange(start, 1, chunk.length, n);
    rng.setNumberFormat('@');
    rng.setValues(chunk);
  }
}

/** Replace all data rows (used for bulk deletes). */
function replaceTable_(name, objs) {
  var sh = sheet_(name), last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, SCHEMA[name].length).clearContent();
  insertRows_(name, objs);
}

function deleteRow_(name, row) { sheet_(name).deleteRow(row._row); }

function withLock_(fn, waitMs) {
  var lock = LockService.getScriptLock();
  lock.waitLock(waitMs || 30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ---------- Events (raw webhook / cron / admin log) ----------

/** Donor events live in the donor file and their ids start with "d-". */
function evTable_(id) { return String(id).indexOf('d-') === 0 ? 'DonorEvents' : 'Events'; }
function isDonorId_(id) { return String(id || '').indexOf('d-') === 0; }

/** Append-only; safe without the lock. Returns the event id. division: 'donor' writes to the donor file, anything else to the parent file. */
function logEvent_(messageId, source, payload, division) {
  var donor = division === 'donor', id = (donor ? 'd-' : '') + newId_(), tbl = donor ? 'DonorEvents' : 'Events';
  var row = [id, messageId || '', source, JSON.stringify(payload || {}), nowIso_(), 'FALSE'];   // DonorEvents has the same columns as Events
  sheet_(tbl).appendRow(row);   // appendRow is atomic, so this stays safe without the lock
  return id;
}

function eventRowNumber_(id) {
  var tbl = evTable_(id), sh = sheet_(tbl), last = sh.getLastRow();
  if (last < 2) return null;
  var c = sh.getRange(2, colOf_(tbl, 'id'), last - 1, 1).createTextFinder(id).matchEntireCell(true).matchCase(true).findNext();
  return c ? c.getRow() : null;
}

function markEventProcessed_(id) {
  var r = eventRowNumber_(id);
  if (r) sheet_(evTable_(id)).getRange(r, colOf_(evTable_(id), 'processed')).setValue('TRUE');
}

function isEventProcessed_(id) {
  var r = eventRowNumber_(id);
  return r ? String(sheet_(evTable_(id)).getRange(r, colOf_(evTable_(id), 'processed')).getValue()).toUpperCase() === 'TRUE' : true;
}

function setEventMessageId_(id, messageId) {
  var r = eventRowNumber_(id);
  if (r) sheet_(evTable_(id)).getRange(r, colOf_(evTable_(id), 'message_id')).setValue(messageId);
}

/** Delete parent events that match pred, bottom up so row numbers stay valid; runs of rows go in one call. */
function deleteEventRows_(pred) {
  var rows = loadTable_('Events').filter(pred).map(function (ev) { return ev._row; }).sort(function (a, b) { return b - a; });
  var sh = sheet_('Events');
  for (var i = 0; i < rows.length;) {
    var j = i;
    while (j + 1 < rows.length && rows[j + 1] === rows[j] - 1) j++;
    sh.deleteRows(rows[j], i === j ? 1 : rows[i] - rows[j] + 1);
    i = j + 1;
  }
}

/** The newest `n` events of a table ('Events' or 'DonorEvents'). */
function lastEvents_(n, table) {
  table = table || 'Events';
  var sh = sheet_(table), last = sh.getLastRow();
  if (last < 2) return [];
  var first = Math.max(2, last - n + 1);
  var vals = sh.getRange(first, 1, last - first + 1, widthOf_(table)).getValues();
  return vals.map(function (v, i) { return rowFromValues_(table, v, first + i); });
}

function eventsForMessage_(messageId) {
  var rows = findBy_('Events', 'message_id', messageId);
  rows.sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
  return rows.slice(0, 200).map(function (e) {
    return { id: e.id, source: e.source, payload: e.payload || {}, created_at: e.created_at };
  });
}

/** Which department a message belongs to (donor message ids start with "d-"; older ones are looked up). */
function divisionOfMessageId_(id) {
  if (!id) return 'parent';
  if (isDonorId_(id)) return 'donor';
  if (findOne_('Messages', 'id', id)) return 'parent';
  return donorReady_() && findOne_('DonorMessages', 'id', id) ? 'donor' : 'parent';
}

/** Which department a phone number belongs to (parent wins if it is in both). */
function divisionOfPhone_(phone) {
  if (findBy_('Parents', 'phone_e164', phone).length) return 'parent';
  return donorReady_() && findBy_('Donors', 'phone_e164', phone).length ? 'donor' : 'parent';
}

// ===== Replies.gs =====
var BUILD_Replies = '20261107-1230'; // build stamp (see Build.gs)
/** What to do when a parent writes to us on WhatsApp: confirm/decline, opt out, or keep the text. */
var CONFIRM_WORDS = ['yes', 'confirm', '1'];
var DECLINE_WORDS = ['no', 'decline', '2', "can't attend", 'can\u2019t attend', 'cant attend'];
var STOP_WORDS = ['stop', 'stop all', 'stopall', 'unsubscribe', 'opt out', 'optout'];
var START_WORDS = ['start', 'unstop', 'subscribe'];
var REPLY_WINDOW_MS = 7 * 24 * 3600 * 1000;
var RECOVER_WINDOW_MS = 3 * 3600 * 1000;
var MAX_REPLY_LENGTH = 1000;

function normalizeText_(t) { return String(t || '').trim().toLowerCase().replace(/[.!]+$/, ''); }

/** 'confirmed', 'declined' or null (any other text). */
function parseReply_(params) {
  var button = String(params.ButtonPayload || '').trim().toLowerCase();
  var text = normalizeText_(params.Body);
  if (button === 'confirm' || CONFIRM_WORDS.indexOf(text) >= 0) return 'confirmed';
  if (button === 'decline' || DECLINE_WORDS.indexOf(text) >= 0) return 'declined';
  return null;
}

/** true for STOP, false for START, null for anything else. */
function optOutChoice_(params) {
  var text = normalizeText_(params.Body);
  if (STOP_WORDS.indexOf(text) >= 0) return true;
  if (START_WORDS.indexOf(text) >= 0) return false;
  return null;
}

function phoneOf_(params) { return String(params.From || '').replace(/^whatsapp:/, ''); }

function findRepliedMessageId_(params) {
  // Best match: the message the parent replied to (Twilio sends this for replies within 7 days).
  if (params.OriginalRepliedMessageSid) {
    var m = findOne_('Messages', 'wa_sid', params.OriginalRepliedMessageSid);
    if (m) return m.id;
  }
  // Otherwise (typed reply): the most recent open message from the last 7 days to any child on this phone.
  var children = findBy_('Parents', 'phone_e164', phoneOf_(params));
  if (!children.length) return null;
  var since = Date.now() - REPLY_WINDOW_MS, msgs = [];
  children.forEach(function (c) { msgs = msgs.concat(findBy_('Messages', 'parent_id', c.id)); });
  var open = msgs.filter(function (m) {
    return ['sent', 'delivered', 'read', 'flagged'].indexOf(m.status) >= 0 && m.wa_sent_at && Date.parse(m.wa_sent_at) >= since;
  }).sort(function (a, b) { return String(b.wa_sent_at).localeCompare(String(a.wa_sent_at)); });
  return open.length ? open[0].id : null;
}

/** Apply one inbound WhatsApp message (inside the lock). Safe to run twice for the same message. */
function handleInbound_(params, eventId) {
  var optOut = optOutChoice_(params);
  if (optOut !== null) {
    // STOP / START only changes donors; parents have no opt-out.
    if (donorReady_()) donorOptOutChoice_(params, optOut);
    return;
  }
  var messageId = findRepliedMessageId_(params);
  if (!messageId) { if (donorReady_()) handleDonorReply_(params, eventId); return; }
  if (eventId) setEventMessageId_(eventId, messageId);

  var decision = parseReply_(params);
  if (decision) { applyStatus_(messageId, decision, { confirmed_via: 'whatsapp' }); return; }

  var text = String(params.Body || '').trim(); // any other text: keep it for the campaign page
  if (text) updateMessage_(messageId, { reply_text: text.slice(0, MAX_REPLY_LENGTH), replied_at: nowIso_() });
}

/** Cron: handle inbound messages whose webhook never arrived. */
function recoverMissedReplies_() {
  var inbound;
  try { inbound = listInboundWhatsapp_(new Date(Date.now() - RECOVER_WINDOW_MS)); }
  catch (e) { console.warn('Could not list inbound WhatsApp messages: ' + e.message); return { error: e.message }; }
  var handled = {};
  (donorReady_() ? ['Events', 'DonorEvents'] : ['Events']).forEach(function (tbl) {
    lastEvents_(3000, tbl).forEach(function (ev) {
      if (ev.source === 'whatsapp_inbound' && ev.payload && ev.payload.MessageSid) handled[ev.payload.MessageSid] = true;
    });
  });
  var recovered = 0;
  inbound.forEach(function (params) {
    if (handled[params.MessageSid]) return;
    var payload = {}; Object.keys(params).forEach(function (k) { payload[k] = params[k]; }); payload.recovered = 'true';
    var eventId = logEvent_(null, 'whatsapp_inbound', payload, divisionOfPhone_(phoneOf_(params)));
    withLock_(function () { handleInbound_(params, eventId); markEventProcessed_(eventId); });
    recovered++;
  });
  return { checked: inbound.length, recovered: recovered };
}

// ===== Status.gs =====
var BUILD_Status = '20261107-1230'; // build stamp (see Build.gs)
/**
 * Message status rules. Statuses only move forward: queued < sent < delivered < read < confirmed/declined.
 * failed and flagged are side states that a later confirm/decline still overrides. cancelled is final.
 */
var ALLOWED_FROM = {
  sent: ['queued'],
  delivered: ['queued', 'sent'],
  read: ['queued', 'sent', 'delivered'],
  failed: ['queued', 'sent', 'delivered'],
  confirmed: ['queued', 'sent', 'delivered', 'read', 'failed', 'flagged'],
  declined: ['queued', 'sent', 'delivered', 'read', 'failed', 'flagged'],
  flagged: ['queued', 'sent', 'delivered', 'read', 'failed'],
  cancelled: ['queued']
};
var ADMIN_OUTCOME_FROM = ['queued', 'sent', 'delivered', 'read', 'failed', 'flagged', 'confirmed', 'declined'];
var WHATSAPP_STATUS_MAP = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed', undelivered: 'failed' };
var STATUSES = ['queued', 'sent', 'delivered', 'read', 'confirmed', 'declined', 'flagged', 'failed', 'cancelled'];

/** In-memory transition on a loaded row. Returns true if it changed (caller saves). */
function transition_(msg, newStatus, extra) {
  if (ALLOWED_FROM[newStatus].indexOf(msg.status) < 0) return false;
  Object.keys(extra || {}).forEach(function (k) { msg[k] = extra[k]; });
  msg.status = newStatus;
  msg.updated_at = msg.status_at = nowIso_(); // status_at: when the status last changed (shown in the UI)
  return true;
}

/** Load one message, apply the transition, save. Run inside the lock. */
function applyStatus_(messageId, newStatus, extra) {
  var msg = findOne_('Messages', 'id', messageId);
  if (!msg) return false;
  if (!transition_(msg, newStatus, extra)) return false;
  saveRows_('Messages', [msg]);
  return true;
}

function updateMessage_(messageId, fields) {
  var msg = findOne_('Messages', 'id', messageId);
  if (!msg) return null;
  Object.keys(fields).forEach(function (k) { msg[k] = fields[k]; });
  msg.updated_at = nowIso_();
  saveRows_('Messages', [msg]);
  return msg;
}

function setAdminOutcome_(messageId, outcome, userEmail) {
  var msg = findOne_('Messages', 'id', messageId);
  if (!msg || ADMIN_OUTCOME_FROM.indexOf(msg.status) < 0) return false;
  msg.status = outcome;
  msg.status_at = nowIso_();
  msg.confirmed_via = 'admin';
  msg.resolved_by = userEmail;
  msg.updated_at = nowIso_();
  saveRows_('Messages', [msg]);
  return true;
}

// ===== Templates.gs =====
var BUILD_Templates = '20261107-1230'; // build stamp (see Build.gs)
/** WhatsApp templates: validate, submit to Meta via Twilio, sync decisions. */
var MAX_BODY_LENGTH = 1024;

function placeholderNumbers_(body) {
  var seen = {}, out = [], m, re = /\{\{(\d+)\}\}/g;
  while ((m = re.exec(body)) !== null) { var n = parseInt(m[1], 10); if (!seen[n]) { seen[n] = true; out.push(n); } }
  return out.sort(function (a, b) { return a - b; });
}

function stripVersion_(name) { return String(name).replace(/_v\d+$/, ''); }

function validateName_(name, language) {
  var errors = [];
  if (!/^[a-z0-9_]+$/.test(name || '')) errors.push('Name may only contain lowercase letters, digits and underscores.');
  if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(language || '')) errors.push("Language must be a code like 'en', 'hi' or 'en_US'.");
  return errors;
}

function validateContent_(t) {
  var errors = [], body = String(t.body || '').trim();
  if (!body) return ['Body is required.'];
  if (body.length > MAX_BODY_LENGTH) errors.push('Body must be at most ' + MAX_BODY_LENGTH + ' characters.');
  var found = body.match(/\{\{(\d+)\}\}/g) || [];
  var numbers = placeholderNumbers_(body);
  if ((body.match(/\{\{/g) || []).length !== found.length) errors.push('Placeholders must look exactly like {{1}}, {{2}} ...');
  var gaps = numbers.some(function (n, i) { return n !== i + 1; });
  if (gaps) errors.push('Placeholders must be numbered {{1}}, {{2}} ... with no gaps.');
  if (/^\s*\{\{\d+\}\}/.test(body)) errors.push('Body must not start with a placeholder.');
  if (/\{\{\d+\}\}[\s.,!?:;]*$/.test(body)) errors.push('Body must not end with a placeholder.');
  if (/\}\}\s*\{\{/.test(body)) errors.push('Two placeholders must not be next to each other; put words between them.');
  var count = numbers.length, names = t.variable_names || [], samples = t.sample_values || {};
  if (names.length !== count || names.some(function (v) { return !String(v).trim(); }))
    errors.push('Give a label for each of the ' + count + ' placeholders.');
  for (var i = 1; i <= count; i++) {
    var s = String(samples[String(i)] || '').trim();
    if (!s) errors.push('A sample value is required for {{' + i + '}}.');
    else if (s.indexOf('\n') >= 0) errors.push('The sample value for {{' + i + '}} must not contain line breaks.');
  }
  if (t.category === 'UTILITY' && /\b(offer|offers|discount|discounts|sale|sales)\b/i.test(body))
    errors.push('UTILITY templates must not contain promotional words like offer, discount or sale.');
  if (t.category !== 'UTILITY' && t.category !== 'MARKETING') errors.push('Category must be UTILITY or MARKETING.');
  return errors;
}

function nameTaken_(name, language, tbl) {
  return findBy_(tbl || 'Templates', 'name', name).some(function (t) { return t.language === language; });
}

function publicTemplate_(t) { var c = {}; Object.keys(t).forEach(function (k) { if (k !== '_row') c[k] = t[k]; }); return c; }

/** Create the content in Twilio (once) and submit it for approval. On failure the template stays 'draft'. */
function submitToMeta_(templateId, tbl) {
  tbl = tbl || 'Templates';
  var t = findOne_(tbl, 'id', templateId);
  if (!t) throw new ApiError('Template not found', null, 404);
  requireConfig_(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN']);
  try {
    var sid = t.twilio_content_sid;
    if (!sid) {
      sid = createContent_(t);
      // Save at once so a retry reuses this content instead of creating another.
      withLock_(function () {
        var fresh = findOne_(tbl, 'id', templateId);
        fresh.twilio_content_sid = sid; fresh.updated_at = nowIso_();
        saveRows_(tbl, [fresh]);
      });
    }
    submitWhatsappApproval_(sid, t.name, tbl === 'Templates' ? 'UTILITY' : t.category); // parent templates are always UTILITY
  } catch (e) {
    throw new ApiError('Saved as draft, but submitting to WhatsApp failed: ' + e.message + '. Use Retry submit.', null, 502);
  }
  return withLock_(function () {
    var fresh = findOne_(tbl, 'id', templateId);
    fresh.status = 'pending_meta'; fresh.rejection_reason = null; fresh.updated_at = nowIso_();
    saveRows_(tbl, [fresh]);
    return publicTemplate_(fresh);
  });
}

function insertTemplate_(user, f, tbl) {
  var id = newId_(), now = nowIso_();
  insertRows_(tbl || 'Templates', [{
    id: id, name: f.name, language: f.language, category: f.category, body: String(f.body).trim(),
    variable_names: f.variable_names, sample_values: f.sample_values, has_confirm_buttons: f.has_confirm_buttons !== false,
    status: 'draft', twilio_content_sid: null, rejection_reason: null, requested_by: user.email,
    decision_seen: true, created_at: now, updated_at: now
  }]);
  return id;
}

function listTemplates_(user, status) {
  var rows = loadTable_('Templates').filter(function (t) { return !status || t.status === status; });
  rows.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  return rows.map(publicTemplate_);
}

function createTemplate_(user, body) {
  body.category = 'UTILITY'; // parent templates are only ever requested as UTILITY
  if (/^donor_/.test(String(body.name || ''))) throw new ApiError('Names starting with donor_ are reserved for the donor department.');
  var errors = validateName_(body.name, body.language || 'en').concat(validateContent_(body));
  if (errors.length) throw new ApiError(errors[0], errors);
  var id = withLock_(function () {
    if (nameTaken_(body.name, body.language || 'en'))
      throw new ApiError("A template named '" + body.name + "' already exists for this language.", ["A template named '" + body.name + "' already exists for this language."]);
    return insertTemplate_(user, { name: body.name, language: body.language || 'en', category: body.category, body: body.body,
      variable_names: body.variable_names, sample_values: body.sample_values, has_confirm_buttons: body.has_confirm_buttons });
  });
  return submitToMeta_(id);
}

function retrySubmit_(user, id) {
  var t = findOne_('Templates', 'id', id);
  if (!t) throw new ApiError('Template not found', null, 404);
  if (t.status !== 'draft') throw new ApiError('Only draft templates can be submitted.');
  return submitToMeta_(id);
}

/**
 * Delete a parent template in the app and in Twilio. Past campaigns keep their results and show the copy saved on them.
 * Not allowed while a campaign still has messages waiting to be sent with it.
 */
function deleteTemplate_(user, id) {
  var t = findOne_('Templates', 'id', id);
  if (!t) throw new ApiError('Template not found', null, 404);
  var busy = loadTable_('Messages').some(function (m) { return m.template_id === id && m.status === 'queued'; });
  if (busy) throw new ApiError('A campaign is still sending with this template. Wait for it to finish, or stop it, then delete.');
  if (t.twilio_content_sid) {
    requireConfig_(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN']);
    try { deleteContent_(t.twilio_content_sid); }
    catch (e) { throw new ApiError('Could not delete it in Twilio: ' + e.message + '. Nothing was deleted; try again.', null, 502); }
  }
  withLock_(function () {
    var fresh = findOne_('Templates', 'id', id);
    if (fresh) deleteRow_('Templates', fresh);
  });
  return { deleted: 1 };
}

/** Cron + "Check status now": ask Twilio for Meta's decision on every pending template. */
function syncPendingTemplates_(tables) {
  var total = { checked: 0, approved: 0, rejected: 0, waiting: [] };
  (tables || ['Templates']).forEach(function (tbl) {
    var pending = loadTable_(tbl).filter(function (t) { return t.status === 'pending_meta' && t.twilio_content_sid; });
    total.checked += pending.length;
    pending.forEach(function (t) {
      var wa;
      try { wa = fetchWhatsappApproval_(t.twilio_content_sid); }
      catch (e) { console.warn('Checking template ' + t.name + ' failed: ' + e.message); total.waiting.push({ name: t.name, status: 'could not check: ' + e.message }); return; }
      var status = String(wa.status || '').toLowerCase(), update = null;
      if (status === 'approved') { update = { status: 'approved', rejection_reason: null }; total.approved++; }
      else if (status === 'rejected') { update = { status: 'rejected', rejection_reason: wa.rejection_reason || 'Rejected by WhatsApp' }; total.rejected++; }
      else total.waiting.push({ name: t.name, status: status || 'unknown' }); // received (Twilio has it), pending (WhatsApp is reviewing), paused ...
      withLock_(function () {
        var fresh = findOne_(tbl, 'id', t.id);
        if (!fresh || fresh.status !== 'pending_meta') return;
        fresh.meta_status = status || null; fresh.meta_checked_at = nowIso_();
        if (update) { Object.keys(update).forEach(function (k) { fresh[k] = update[k]; }); fresh.decision_seen = false; fresh.updated_at = nowIso_(); }
        saveRows_(tbl, [fresh]);
      });
    });
  });
  return total;
}

function templateNotifications_(user) {
  return loadTable_('Templates')
    .filter(function (t) { return t.requested_by === user.email && t.decision_seen === false; })
    .sort(function (a, b) { return String(b.updated_at).localeCompare(String(a.updated_at)); })
    .map(function (t) { return { id: t.id, name: t.name, language: t.language, status: t.status, rejection_reason: t.rejection_reason }; });
}

function markTemplateSeen_(user, id) {
  withLock_(function () {
    var t = findOne_('Templates', 'id', id);
    if (t) { t.decision_seen = true; saveRows_('Templates', [t]); }
  });
  return { ok: true };
}

/**
 * Import templates that already exist in the Twilio account (created in the console or elsewhere).
 * Only text and quick-reply templates are imported. Labels for the placeholders default to "value 1", "value 2"...
 * Templates already in the app (same Content SID) are left alone; "Check status now" keeps their status current.
 */
function importTwilioTemplates_(user, opts) {
  opts = opts || {};
  var tbl = opts.table || 'Templates';
  requireConfig_(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN']);
  var contents;
  try { contents = listContentAndApprovals_(); } catch (e) { throw new ApiError('Could not read templates from Twilio: ' + e.message, null, 502); }
  return withLock_(function () {
    var existing = loadTable_(tbl), bySid = {}, taken = {};
    existing.forEach(function (t) { if (t.twilio_content_sid) bySid[t.twilio_content_sid] = true; taken[t.name + '|' + t.language] = true; });
    var toInsert = [], skipped = [], now = nowIso_();
    contents.forEach(function (c) {
      var ar = c.approval_requests || {}, label = ar.name || c.friendly_name || c.sid;
      if (bySid[c.sid]) { skipped.push({ name: label, reason: 'already in the app' }); return; }
      var types = c.types || {}, kind = types['twilio/text'] ? 'twilio/text' : types['twilio/quick-reply'] ? 'twilio/quick-reply' :
        (tbl === 'DonorTemplates' && types['twilio/media']) ? 'twilio/media' : null;   // media templates: donor side only
      if (!kind || !types[kind].body) { skipped.push({ name: label, reason: 'unsupported type (only text and quick-reply templates' + (tbl === 'DonorTemplates' ? ', and image/PDF templates,' : '') + ' are imported)' }); return; }
      var name = String(ar.name || c.friendly_name || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
      var language = c.language || '';
      if (!name) { skipped.push({ name: label, reason: 'no usable name' }); return; }
      // The Twilio account is shared, so names keep the two departments apart: donor templates start with donor_.
      if (tbl === 'DonorTemplates' && !/^donor_/.test(name)) { skipped.push({ name: label, reason: 'not a donor template (donor template names start with donor_)' }); return; }
      if (tbl === 'Templates' && /^donor_/.test(name)) { skipped.push({ name: label, reason: 'belongs to the donor department' }); return; }
      if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(language)) { skipped.push({ name: label, reason: "unsupported language code '" + language + "'" }); return; }
      if (taken[name + '|' + language]) { skipped.push({ name: label, reason: 'a template named ' + name + ' (' + language + ') already exists' }); return; }
      var cat = String(ar.category || 'UTILITY').toUpperCase();
      if (cat === 'TRANSACTIONAL') cat = 'UTILITY';
      if (cat !== 'UTILITY' && cat !== 'MARKETING') { skipped.push({ name: label, reason: 'category ' + cat + ' is not supported' }); return; }
      var st = String(ar.status || 'unsubmitted').toLowerCase(), status;
      if (st === 'approved') status = 'approved';
      else if (st === 'rejected') status = 'rejected';
      else if (st === 'pending' || st === 'received') status = 'pending_meta';
      else if (st === 'unsubmitted') status = 'draft';
      else { skipped.push({ name: label, reason: 'WhatsApp status is ' + st }); return; }

      var body = String(types[kind].body), nums = placeholderNumbers_(body), vars = c.variables || {};
      var names = nums.map(function (n) { return 'value ' + n; }), samples = {};
      nums.forEach(function (n) { samples[String(n)] = String(vars[String(n)] || 'sample'); });
      var mediaType = null;
      if (kind === 'twilio/media') {   // the address must be the app's Drive address with the file's placeholder at the end
        var murl = String((types[kind].media || [])[0] || ''), mm = /\{\{(\d+)\}\}\s*$/.exec(murl);
        if (!mm || murl.slice(0, murl.lastIndexOf('{{')) !== DRIVE_MEDIA_URL || Number(mm[1]) !== nums.length + 1) {
          skipped.push({ name: label, reason: 'its file address is not ' + DRIVE_MEDIA_URL + '{{' + (nums.length + 1) + '}}, so the app cannot fill in the file' }); return;
        }
        names.push(MEDIA_LABEL); samples[mm[1]] = String(vars[mm[1]] || 'sample');
        mediaType = 'image';   // Twilio does not say which; correct it under Type & labels if it is a PDF
      }
      var ids = (types[kind].actions || []).map(function (a) { return String(a.id || '').toLowerCase(); });
      var confirmButtons = kind === 'twilio/quick-reply' && ids.indexOf('confirm') >= 0 && ids.indexOf('decline') >= 0;
      taken[name + '|' + language] = true;
      toInsert.push({ id: newId_(), name: name, language: language, category: cat, body: body, variable_names: names, sample_values: samples,
        has_confirm_buttons: confirmButtons, status: status, twilio_content_sid: c.sid,
        rejection_reason: status === 'rejected' ? (ar.rejection_reason || 'Rejected by WhatsApp') : null,
        requested_by: user.email, decision_seen: true, created_at: now, updated_at: now, division: tbl === 'DonorTemplates' ? 'donor' : 'parent', media_type: mediaType });
      if (mediaType) skipped.push({ name: label, reason: 'imported as an Image template; if it sends a PDF, change it under Type & labels' });
      if (kind === 'twilio/quick-reply' && !confirmButtons)
        skipped.push({ name: label, reason: 'imported, but its buttons are not Confirm/Decline (ids "confirm" and "decline"), so taps will not be recorded as answers' });
    });
    insertRows_(tbl, toInsert);
    return { imported: toInsert.length, found: contents.length, skipped: skipped };
  });
}

// ===== Twilio.gs =====
var BUILD_Twilio = '20261107-1230'; // build stamp (see Build.gs)
/** All Twilio calls (Messaging, Voice, Content API). Swap this file to change provider. */
var TW_API = 'https://api.twilio.com/2010-04-01/Accounts/';
var TW_CONTENT = 'https://content.twilio.com/v1';

function twAuth_() {
  var c = cfg_();
  return 'Basic ' + Utilities.base64Encode(c.TWILIO_ACCOUNT_SID + ':' + c.TWILIO_AUTH_TOKEN);
}

function twError_(resp) {
  var text = resp.getContentText();
  try { var j = JSON.parse(text); return (j.code ? j.code + ': ' : '') + (j.message || text); }
  catch (e) { return text.slice(0, 200); }
}

/** fetch with back-off on 429 (1s, 2s, 4s). */
function httpRetry_(url, params) {
  params.muteHttpExceptions = true;
  for (var a = 0; a <= 3; a++) {
    var r = UrlFetchApp.fetch(url, params);
    if (r.getResponseCode() === 429 && a < 3) { Utilities.sleep(1000 * Math.pow(2, a)); continue; }
    return r;
  }
}

function twFormRequest_(method, url, form) {
  var p = { method: method, headers: { Authorization: twAuth_() } };
  if (form) p.payload = form;
  var r = httpRetry_(url, p);
  if (r.getResponseCode() >= 400) throw new Error(twError_(r));
  return JSON.parse(r.getContentText());
}

/** True when the Twilio address (PUBLIC_BASE_URL and its secret) is set, so Twilio can call the app back instantly.
 *  Without it the app asks Twilio for news every few minutes (single-address mode). */
function instantUpdates_() { var c = cfg_(); return !!(c.PUBLIC_BASE_URL && c.WEBHOOK_SECRET); }

/** Outbound WhatsApp messages sent since a date, with their current status. Used when there is no Twilio address. */
function listOutboundStatuses_(since) {
  var c = cfg_(), out = [];
  var url = TW_API + c.TWILIO_ACCOUNT_SID + '/Messages.json?PageSize=1000&DateSent%3E=' + Utilities.formatDate(since, 'UTC', 'yyyy-MM-dd') +
    (c.TWILIO_WHATSAPP_FROM ? '&From=' + encodeURIComponent(c.TWILIO_WHATSAPP_FROM) : '');
  for (var page = 0; page < 6 && url; page++) {
    var data = twFormRequest_('get', url);
    (data.messages || []).forEach(function (m) {
      if (String(m.direction || '').indexOf('outbound') !== 0) return;
      out.push({ sid: m.sid, status: m.status, error: m.error_code ? m.error_code + ': ' + (m.error_message || 'WhatsApp could not deliver the message') : '' });
    });
    url = data.next_page_uri ? 'https://api.twilio.com' + data.next_page_uri : null;
  }
  return out;
}

/** Public URL Twilio calls back. Apps Script cannot read headers, so a secret in the URL replaces the signature. */
function webhookUrl_(hook, params) {
  var c = cfg_();
  var q = ['hook=' + encodeURIComponent(hook), 'k=' + encodeURIComponent(c.WEBHOOK_SECRET)];
  Object.keys(params || {}).forEach(function (k) { q.push(k + '=' + encodeURIComponent(params[k])); });
  return c.PUBLIC_BASE_URL + '?' + q.join('&');
}

// ---------- WhatsApp ----------

function whatsappRequest_(phone, contentSid, variables, messageId) {
  var c = cfg_();
  var form = {
    To: 'whatsapp:' + phone,
    ContentSid: contentSid,
    ContentVariables: JSON.stringify(variables),
  };
  if (instantUpdates_()) form.StatusCallback = webhookUrl_('whatsapp_status', { message_id: messageId }); // without the Twilio address, statuses are fetched instead
  if (c.TWILIO_MESSAGING_SERVICE_SID) form.MessagingServiceSid = c.TWILIO_MESSAGING_SERVICE_SID;
  else form.From = c.TWILIO_WHATSAPP_FROM;
  return {
    url: TW_API + c.TWILIO_ACCOUNT_SID + '/Messages.json',
    method: 'post', headers: { Authorization: twAuth_() }, payload: form, muteHttpExceptions: true
  };
}

/** Parse a send response into {sid} or {error, rateLimited}. */
function parseSendResponse_(resp) {
  var code = resp.getResponseCode();
  if (code >= 200 && code < 300) return { sid: JSON.parse(resp.getContentText()).sid };
  return { error: twError_(resp), rateLimited: code === 429 };
}

/** Send many messages in parallel. items: [{phone, contentSid, variables, messageId}] -> results in order. */
function sendWhatsappMany_(items) {
  if (!items.length) return [];
  var reqs = items.map(function (it) { return whatsappRequest_(it.phone, it.contentSid, it.variables, it.messageId); });
  var resps = UrlFetchApp.fetchAll(reqs);
  return resps.map(function (resp, i) {
    var res = parseSendResponse_(resp);
    // Rate limited: retry this one message alone with back-off.
    for (var a = 0; res.rateLimited && a < 3; a++) {
      Utilities.sleep(1000 * Math.pow(2, a));
      res = parseSendResponse_(UrlFetchApp.fetch(reqs[i].url, reqs[i]));
    }
    return res;
  });
}

function fetchWhatsappStatus_(sid) {
  var c = cfg_();
  var m = twFormRequest_('get', TW_API + c.TWILIO_ACCOUNT_SID + '/Messages/' + sid + '.json');
  var error = '';
  if (m.error_code) error = m.error_code + ': ' + (m.error_message || 'WhatsApp could not deliver the message');
  return { status: m.status, error: error };
}

/** Inbound WhatsApp messages since `since`, shaped like the inbound webhook params. */
function listInboundWhatsapp_(since) {
  var c = cfg_();
  var url = TW_API + c.TWILIO_ACCOUNT_SID + '/Messages.json?PageSize=500&To=' + encodeURIComponent(c.TWILIO_WHATSAPP_FROM) +
    '&DateSent%3E=' + Utilities.formatDate(since, 'UTC', 'yyyy-MM-dd');
  var data = twFormRequest_('get', url);
  return (data.messages || []).filter(function (m) {
    return m.direction === 'inbound' && Date.parse(m.date_sent) >= since.getTime();
  }).map(function (m) { return { MessageSid: m.sid, From: m.from || '', Body: m.body || '' }; });
}

// ---------- Voice ----------

function placeCall_(phone, messageId) {
  var c = cfg_();
  var r = twFormRequest_('post', TW_API + c.TWILIO_ACCOUNT_SID + '/Calls.json', {
    To: phone,
    From: c.TWILIO_VOICE_FROM,
    Url: webhookUrl_('voice_twiml', { message_id: messageId }),
    StatusCallback: webhookUrl_('voice_status', { message_id: messageId }),
    StatusCallbackEvent: 'completed',
    Timeout: '25'
  });
  return r.sid;
}

// ---------- Content API (templates) ----------

function contentRequest_(method, path, json) {
  var c = cfg_();
  var p = { method: method, headers: { Authorization: twAuth_() }, contentType: 'application/json' };
  if (json) p.payload = JSON.stringify(json);
  var r = httpRetry_(TW_CONTENT + path, p);
  if (r.getResponseCode() >= 400) throw new Error('Twilio error ' + r.getResponseCode() + ': ' + twError_(r));
  return JSON.parse(r.getContentText());
}

function createContent_(t) {
  if (MEDIA_TYPES[t.media_type]) {   // donor media template: the file address ends with its placeholder
    return contentRequest_('post', '/Content', { friendly_name: t.name, language: t.language, variables: t.sample_values,
      types: { 'twilio/media': { body: t.body, media: [DRIVE_MEDIA_URL + '{{' + mediaVarNumber_(t) + '}}'] } } }).sid;
  }
  var types = t.has_confirm_buttons
    ? { 'twilio/quick-reply': { body: t.body, actions: [{ title: 'Confirm', id: 'confirm' }, { title: "Can't attend", id: 'decline' }] } }
    : { 'twilio/text': { body: t.body } };
  return contentRequest_('post', '/Content', {
    friendly_name: t.name, language: t.language, variables: t.sample_values, types: types
  }).sid;
}

/** DELETE /v1/Content/{sid}. Already gone (404) counts as deleted. */
function deleteContent_(sid) {
  var r = httpRetry_(TW_CONTENT + '/Content/' + encodeURIComponent(sid), { method: 'delete', headers: { Authorization: twAuth_() } });
  var code = r.getResponseCode();
  if (code >= 400 && code !== 404) throw new Error('Twilio error ' + code + ': ' + twError_(r));
}

function submitWhatsappApproval_(contentSid, name, category) {
  contentRequest_('post', '/Content/' + contentSid + '/ApprovalRequests/whatsapp', { name: name, category: category });
}

/** Every Content template in the account with its approval status (follows pagination, max 20 pages). */
function listContentAndApprovals_() {
  var out = [], path = '/ContentAndApprovals?PageSize=100';
  for (var i = 0; i < 20 && path; i++) {
    var d = contentRequest_('get', path);
    out = out.concat(d.contents || []);
    var next = d.meta && d.meta.next_page_url;
    path = next ? String(next).replace(/^https:\/\/content\.twilio\.com\/v1/, '') : null;
  }
  return out;
}

function fetchWhatsappApproval_(contentSid) {
  var d = contentRequest_('get', '/Content/' + contentSid + '/ApprovalRequests');
  return d.whatsapp || {};
}

// ===== Webhooks.gs =====
var BUILD_Webhooks = '20261107-1230'; // build stamp (see Build.gs)
/**
 * Twilio webhooks. Apps Script cannot read request headers, so Twilio's X-Twilio-Signature cannot be
 * checked. Instead every URL we give Twilio carries a secret (?k=WEBHOOK_SECRET) that is verified here.
 * Each webhook: check secret, log the payload, apply it. If the lock is busy the event stays unprocessed
 * and the cron tick replays it, so nothing is lost.
 */
var CALL_ENDED = ['completed', 'busy', 'no-answer', 'failed', 'canceled'];
var RESERVED_PARAMS = ['hook', 'k', 'message_id', 'attempt'];

function safeEqual_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function textOut_(s) { return ContentService.createTextOutput(s || ''); }

function twiml_(inner) {
  return ContentService.createTextOutput('<?xml version="1.0" encoding="UTF-8"?><Response>' + inner + '</Response>')
    .setMimeType(ContentService.MimeType.XML);
}

function xmlEsc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function say_(script, text) {
  return '<Say voice="' + xmlEsc_(script.voice) + '" language="' + xmlEsc_(script.language) + '">' + xmlEsc_(text) + '</Say>';
}

/** Apply one logged event (inside the lock). Used by webhooks and by the cron replay. */
function applyEvent_(source, params, messageId, eventId) {
  if (source === 'whatsapp_status') {
    if (!messageId) return;
    var ns = WHATSAPP_STATUS_MAP[params.MessageStatus || ''];
    if (!ns) return; // queued, sending, accepted ...
    var extra = {};
    if (ns === 'failed') extra.wa_error = (params.ErrorCode || '') + ': ' + (params.ChannelStatusMessage || 'WhatsApp could not deliver the message');
    if (isDonorId_(messageId)) applyDonorStatus_(messageId, ns, extra);
    else if (!applyStatus_(messageId, ns, extra) && donorReady_()) applyDonorStatus_(messageId, ns, extra);   // older donor messages have plain ids
  } else if (source === 'whatsapp_inbound') {
    handleInbound_(params, eventId);
  } else if (source === 'voice_gather') {
    if (!messageId) return;
    var digit = params.Digits || '';
    updateMessage_(messageId, { call_digit: digit });
    if (digit === '1') applyStatus_(messageId, 'confirmed', { confirmed_via: 'voice' });
    else if (digit === '2') applyStatus_(messageId, 'declined', { confirmed_via: 'voice' });
  } else if (source === 'voice_status') {
    if (!messageId) return;
    var f = { call_status: params.CallStatus || '' };
    if (params.CallSid) f.call_sid = params.CallSid;
    updateMessage_(messageId, f);
    // Ended without a 1 or 2: flag for personal follow-up (never overwrites confirmed/declined).
    if (CALL_ENDED.indexOf(params.CallStatus) >= 0) applyStatus_(messageId, 'flagged', {});
  }
}

/** Try to apply an event now; if the lock is busy, leave it for the cron replay. */
function processEvent_(eventId, source, params, messageId) {
  try {
    withLock_(function () {
      if (isEventProcessed_(eventId)) return;
      applyEvent_(source, params, messageId, eventId);
      markEventProcessed_(eventId);
    }, 20000);
    return true;
  } catch (e) {
    console.warn('Event ' + eventId + ' left for the cron replay: ' + e.message);
    return false;
  }
}

function loadCallContext_(messageId) {
  var m = messageId ? findOne_('Messages', 'id', messageId) : null;
  if (!m) return { script: getVoiceScript_('en'), details: '' };
  var camp = findOne_('Campaigns', 'id', m.campaign_id);
  var vars = (camp && camp.variables) || {};
  var details = Object.keys(vars).sort(function (a, b) { return Number(a) - Number(b); }).map(function (k) { return vars[k]; }).join(', ');
  return { script: getVoiceScript_('en'), details: details };   // parents no longer have a language
}

function gatherTwiml_(messageId, script, details, attempt, prefix) {
  var action = webhookUrl_('voice_gather', { message_id: messageId, attempt: attempt });
  var prompt = (prefix ? prefix + ' ' : '') + script.prompt.replace('{details}', details);
  return twiml_('<Gather input="dtmf" numDigits="1" timeout="8" action="' + xmlEsc_(action) + '" method="POST">' +
    say_(script, prompt) + '</Gather>' + say_(script, script.goodbye));
}

function handleHook_(e) {
  var p = e.parameter || {}, c = cfg_();
  if (p.hook === 'ping') { var br = buildReport_(); return textOut_('webhook ok, build ' + (br.newest || '?') + (br.problems.length ? ', PROBLEM: ' + br.problems.join('; ') : '') + '. (This check answers on both of your addresses; it only proves the code is running.)'); } // health check: no secret, no data
  if (!c.WEBHOOK_SECRET || !safeEqual_(p.k || '', c.WEBHOOK_SECRET)) return textOut_('Forbidden');
  var hook = p.hook, messageId = p.message_id || null;
  var params = {};
  Object.keys(p).forEach(function (k) { if (RESERVED_PARAMS.indexOf(k) < 0) params[k] = String(p[k]); });

  if (hook === 'cron') return textOut_(JSON.stringify(tick_())).setMimeType(ContentService.MimeType.JSON);
  if (hook === 'donor_dispatch') { runDonorTriggers_(); return textOut_(JSON.stringify(dispatchDonorBatch_(25000))).setMimeType(ContentService.MimeType.JSON); }   // donor emails from the owner's account

  if (hook === 'whatsapp_status') {
    if (!messageId && params.MessageSid) {
      var m = findOne_('Messages', 'wa_sid', params.MessageSid);
      if (!m && donorReady_()) m = findOne_('DonorMessages', 'wa_sid', params.MessageSid);
      messageId = m ? m.id : null;
    }
    var id1 = logEvent_(messageId, 'whatsapp_status', params, divisionOfMessageId_(messageId));
    processEvent_(id1, 'whatsapp_status', params, messageId);
    return textOut_('');
  }
  if (hook === 'whatsapp_inbound') {
    var id2 = logEvent_(null, 'whatsapp_inbound', params, divisionOfPhone_(phoneOf_(params)));
    processEvent_(id2, 'whatsapp_inbound', params, null);
    return twiml_(''); // empty TwiML: never auto-reply with free text
  }
  if (hook === 'voice_twiml') {
    var ctx = loadCallContext_(messageId);
    return gatherTwiml_(messageId, ctx.script, ctx.details, 1, '');
  }
  if (hook === 'voice_gather') {
    var attempt = Number(p.attempt) || 1, digit = params.Digits || '';
    var id3 = logEvent_(messageId, 'voice_gather', params);
    processEvent_(id3, 'voice_gather', params, messageId);
    var cx = loadCallContext_(messageId);
    if (digit === '1') return twiml_(say_(cx.script, cx.script.confirmed));
    if (digit === '2') return twiml_(say_(cx.script, cx.script.declined));
    // Wrong key: replay once, then leave it to the status callback (-> flagged).
    if (attempt < 2) return gatherTwiml_(messageId, cx.script, cx.details, 2, cx.script.invalid);
    return twiml_(say_(cx.script, cx.script.goodbye));
  }
  if (hook === 'voice_status') {
    var id4 = logEvent_(messageId, 'voice_status', params);
    processEvent_(id4, 'voice_status', params, messageId);
    return textOut_('');
  }
  return textOut_('Unknown hook');
}
