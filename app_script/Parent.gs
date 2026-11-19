// ========================================================================================================
// EK TARA COMMUNICATIONS: SERVER CODE, PARENT (Parent.gs)
// Parent Communication: campaigns, Parent Info (CSV upload), sending, fallback calls, Drive archive, call scripts.
// The project needs all four server files: Shared.gs, Parent.gs, Donor.gs, Admin.gs (any order).
// If you see "Identifier 'ApiError' has already been declared", an old Code.gs is still in the project: delete it.
// ========================================================================================================
// ===== Archive.gs =====
var BUILD_Archive = '20261107-1230'; // build stamp (see Build.gs)
/**
 * Campaign archive: after a campaign is finished, copy its data and logs into a NEW Google Sheet in Drive.
 *   Tab "Summary"    campaign, template, values used, who sent it, totals
 *   Tab "Recipients" one row per parent with status, how/when they answered, call result, typed reply
 *   Tab "Timeline"   every webhook / call / admin event for those messages
 * File name: "Campaign 2026-11-04 1030 – Sunrise Public School · Class 7 – ptm_reminder (a1b2c3d4)"
 * Files go to the Drive folder ARCHIVE_FOLDER_ID (created automatically on first use).
 * The cron tick archives finished campaigns by itself; the campaign page also has an "Export to Drive" button.
 */
var ARCHIVE_AFTER_MS = 49 * 3600 * 1000; // the IVR fallback stops acting after 48 h, so nothing more will change

function archiveFolder_() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('ARCHIVE_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); }
    catch (e) { throw new ApiError('Cannot open the Drive archive folder (ARCHIVE_FOLDER_ID). Share it with every admin as Editor.'); }
  }
  var f = DriveApp.createFolder('Parent Communication – Campaign Archive');
  props.setProperty('ARCHIVE_FOLDER_ID', f.getId());
  return f;
}

function localTime_(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : Utilities.formatDate(d, cfg_().APP_TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

function cleanFileName_(s) { return String(s).replace(/[\\\/:*?"<>|\[\]#]/g, '-').replace(/\s+/g, ' ').trim(); }

function archiveName_(c, t) {
  var when = Utilities.formatDate(new Date(c.created_at), cfg_().APP_TIMEZONE, 'yyyy-MM-dd HHmm');
  return cleanFileName_('Campaign ' + when + ' – ' + (c.name ? c.name + ' – ' : '') + c.audience + ' – ' + (t.name || 'template') + ' (' + String(c.id).slice(0, 8) + ')').slice(0, 150);
}

function eventSummary_(e) {
  var p = e.payload || {};
  switch (e.source) {
    case 'whatsapp_status': return 'WhatsApp: ' + (p.MessageStatus || '?') + (p.ErrorCode ? ' (error ' + p.ErrorCode + ')' : '');
    case 'whatsapp_inbound': return (p.ButtonPayload ? 'Tapped' : 'Replied') + ' "' + (p.Body || '') + '"' + (p.recovered ? ' (recovered)' : '');
    case 'voice_gather': return 'Pressed ' + (p.Digits || 'nothing');
    case 'voice_status': return 'Call ' + (p.CallStatus || '?') + (p.CallDuration ? ', ' + p.CallDuration + ' s' : '');
    case 'admin': return 'Marked ' + p.outcome + ' by ' + p.by;
    case 'cron': return p.error ? 'Error: ' + p.error : p.recheck_status ? 'Status re-checked with Twilio: ' + p.recheck_status : 'Background job';
    default: return e.source;
  }
}

var STATUS_LABELS_ = { queued: 'Queued (not sent)', sent: 'Sent', delivered: 'Delivered', read: 'Read, no answer', confirmed: 'Confirmed',
  declined: 'Declined', flagged: 'Needs follow-up', failed: 'Failed', cancelled: 'Cancelled' };

function buildArchive_(c, t) {
  var parents = {}; loadTable_('Parents').forEach(function (p) { parents[p.id] = p; });
  var tpls = {}; loadTable_('Templates').forEach(function (x) { tpls[x.id] = x; });
  var msgs = loadTable_('Messages').filter(function (m) { return m.campaign_id === c.id; });
  var byMsg = {}; msgs.forEach(function (m) { byMsg[m.id] = m; });

  var recipients = msgs.map(function (m) {
    var p = parentForDisplay_(m, parents);
    return { sort: [p.institution, p.class_or_year, p.section || '', p.parent_name], row: [
      p.parent_name, p.child_name || '', parents[m.parent_id] ? m.parent_id : '', p.phone_e164, p.institution, p.class_or_year, p.section || '',
      p.beneficiary_type || '', p.beneficiary_status || '',
      STATUS_LABELS_[m.status] || m.status, m.confirmed_via || '', localTime_(m.wa_sent_at), m.wa_error || '',
      localTime_(m.call_requested_at), m.call_status || '', m.call_digit || '', m.reply_text || '', localTime_(m.replied_at),
      m.resolved_by || '', localTime_(m.updated_at)] };
  }).sort(function (a, b) {
    for (var i = 0; i < 4; i++) { var r = String(a.sort[i]).localeCompare(String(b.sort[i]), undefined, { numeric: true, sensitivity: 'base' }); if (r) return r; }
    return 0;
  }).map(function (x) { return x.row; });

  var timeline = loadTable_('Events').filter(function (e) { return e.message_id && byMsg[e.message_id]; })
    .sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); })
    .map(function (e) {
      var p = parentForDisplay_(byMsg[e.message_id], parents);
      return [localTime_(e.created_at), p.parent_name, p.phone_e164, e.source, eventSummary_(e), JSON.stringify(e.payload || {})];
    });

  var counts = countByStatus_(msgs), vars = c.variables || {};
  var text = t.body || '';
  Object.keys(vars).forEach(function (k) { text = text.split('{{' + k + '}}').join(vars[k]); });
  var via = { whatsapp: 0, voice: 0, admin: 0 }, typed = 0, calls = 0;
  msgs.forEach(function (m) {
    if ((m.status === 'confirmed' || m.status === 'declined') && via[m.confirmed_via] !== undefined) via[m.confirmed_via]++;
    if (m.reply_text) typed++;
    if (m.call_requested_at) calls++;
  });
  var answered = counts.confirmed + counts.declined;
  var summary = [
    ['Campaign', archiveName_(c, t)], ['Campaign ID', c.id], ['Campaign name', c.name || ''], ['Audience', c.audience], ['School', c.institution || 'Several or all (see Audience)'],
    ['Grade', campaignGroups_(c).length > 1 ? 'See Audience' : c.class_or_year || 'All'], ['Section / stream', campaignGroups_(c).length > 1 ? 'See Audience' : c.section || 'All'],
    ['Type of beneficiary', (c.beneficiary_types || []).join(', ') || 'All'],
    ['Template', (t.name || '') + ' (' + (t.language || '') + ')'], ['Message text sent', text], ['Template body (raw)', t.body || ''],
    ['Values used', Object.keys(vars).sort(function (a, b) { return a - b; }).map(function (k) { return '{{' + k + '}} = ' + vars[k]; }).join('; ')],
    ['Sent by', senderName_(c.created_by) || ''], ['Created', localTime_(c.created_at)], ['Campaign status', c.status],
    ['Exported', localTime_(nowIso_())], ['', ''], ['Recipients', counts.total]
  ];
  STATUSES.forEach(function (s) { if (counts[s]) summary.push([STATUS_LABELS_[s], counts[s]]); });
  summary.push(['Answered (confirmed + declined)', answered + (counts.total ? ' (' + Math.round(answered / counts.total * 100) + '%)' : '')],
    ['  answered on WhatsApp', via.whatsapp], ['  answered on the phone call', via.voice], ['  recorded by an admin', via.admin],
    ['Typed WhatsApp replies', typed], ['Fallback calls placed', calls]);
  return {
    Summary: { header: ['Item', 'Value'], rows: summary },
    Recipients: { header: ['Parent', 'Child', 'New Child ID', 'Phone', 'School', 'Grade', 'Section / stream',
      'Type of beneficiary', 'Status of beneficiary', 'Status', 'Answered via', 'WhatsApp sent at', 'WhatsApp error', 'Call requested at', 'Call status',
      'Key pressed', 'Typed reply', 'Replied at', 'Recorded by', 'Last update'], rows: recipients },
    Timeline: { header: ['Time', 'Parent', 'Phone', 'Source', 'What happened', 'Raw payload'], rows: timeline }
  };
}

function writeArchiveSheet_(sh, tab) {
  sh.clear();
  var all = [tab.header].concat(tab.rows.map(function (r) { return r.map(function (v) { return v === null || v === undefined ? '' : String(v); }); }));
  var rng = sh.getRange(1, 1, all.length, tab.header.length);
  rng.setNumberFormat('@'); // plain text: phone numbers stay intact and nothing is run as a formula
  rng.setValues(all);
  sh.getRange(1, 1, 1, tab.header.length).setFontWeight('bold');
  sh.setFrozenRows(1);
  try { sh.autoResizeColumns(1, tab.header.length); } catch (e) { /* cosmetic */ }
}

/** Create (or refresh) the Drive sheet for one campaign. Returns {url, name}. */
function exportCampaign_(campaignId) {
  var c = findOne_('Campaigns', 'id', campaignId);
  if (!c) throw new ApiError('Campaign not found', null, 404);
  var t = campaignTemplate_(c, findOne_('Templates', 'id', c.template_id));
  var data = buildArchive_(c, t), name = archiveName_(c, t), ss;

  if (c.archive_url) {
    try { ss = SpreadsheetApp.openByUrl(c.archive_url); } catch (e) { ss = null; } // deleted or no access: make a new one
  }
  if (!ss) {
    var folder = archiveFolder_();
    ss = SpreadsheetApp.create(name);
    DriveApp.getFileById(ss.getId()).moveTo(folder);
    ss.getSheets()[0].setName('Summary');
  }
  Object.keys(data).forEach(function (tab) {
    writeArchiveSheet_(ss.getSheetByName(tab) || ss.insertSheet(tab), data[tab]);
  });

  var url = ss.getUrl();
  withLock_(function () {
    var fresh = findOne_('Campaigns', 'id', campaignId);
    fresh.archive_url = url; fresh.archived_at = nowIso_();
    saveRows_('Campaigns', [fresh]);
  });
  return { url: url, name: ss.getName() };
}

/** A campaign is finished when it was sent (or stopped) and nobody is still waiting, or it is old enough that nothing will change. */
function campaignFinished_(c, msgs, nowMs) {
  if (c.status !== 'sent' && c.status !== 'cancelled') return false;
  var waiting = msgs.some(function (m) { return ['queued', 'sent', 'delivered', 'read'].indexOf(m.status) >= 0; });
  return !waiting || nowMs - Date.parse(c.created_at) > ARCHIVE_AFTER_MS;
}

/** Cron: archive every finished campaign that has not been archived yet. */
function archiveFinishedCampaigns_(deadline) {
  var camps = loadTable_('Campaigns').filter(function (c) { return !c.archive_url && (c.status === 'sent' || c.status === 'cancelled'); });
  if (!camps.length) return { archived: 0 };
  var byCamp = {}; camps.forEach(function (c) { byCamp[c.id] = []; });
  loadTable_('Messages').forEach(function (m) { if (byCamp[m.campaign_id]) byCamp[m.campaign_id].push(m); });
  var now = Date.now(), done = 0, errors = 0;
  for (var i = 0; i < camps.length && Date.now() < deadline - 60000; i++) {
    if (!campaignFinished_(camps[i], byCamp[camps[i].id], now)) continue;
    try { exportCampaign_(camps[i].id); done++; }
    catch (e) { errors++; console.error('Archiving campaign ' + camps[i].id + ' failed: ' + e.message); }
  }
  return { archived: done, errors: errors };
}

// ===== Campaigns.gs =====
var BUILD_Campaigns = '20261107-1230'; // build stamp (see Build.gs)
/** Campaigns: create, list, detail, cancel, retry. */
var CAMPAIGN_PAGE_SIZE = 50;

function countByStatus_(msgs) {
  var out = { total: msgs.length };
  STATUSES.forEach(function (s) { out[s] = 0; });
  msgs.forEach(function (m) { out[m.status] = (out[m.status] || 0) + 1; });
  return out;
}

function audienceLabel_(institution, classOrYear, section) {
  var parts = [institution];
  if (classOrYear) parts.push('Grade ' + classOrYear);
  if (section) parts.push(section);
  return parts.join(' · ');
}

/** The audience as one line: the groups (or "All schools") plus the beneficiary types, if any were picked. */
function campaignAudienceLabel_(groups, types) {
  var where = !groups.length ? 'All schools' : groups.length === 1 ? audienceLabel_(groups[0].institution, groups[0].class_or_year, groups[0].section) : groupsLabel_(groups);
  return where + (types.length ? ' \u00b7 ' + types.join(', ') : '');
}

/** The beneficiary types picked on the page (none = every type). */
function cleanTypes_(list) {
  var seen = {}, out = [];
  (list || []).forEach(function (t) { var v = cleanText_(t); if (v && !seen[v]) { seen[v] = true; out.push(v); } });
  return out;
}

/** The template of a campaign for display: the current row, or the copy saved on the campaign if it was deleted. */
function campaignTemplate_(c, t) {
  return t || { name: c.template_name || '(deleted template)', language: c.template_language || '', body: c.template_body || '', has_confirm_buttons: !!c.template_has_buttons };
}

/** The parent of a message for display: the current row, or the copy saved on the message if the parent was deleted. */
function parentForDisplay_(m, parents) {
  return parents[m.parent_id] || { parent_name: m.parent_name || '(deleted)', child_name: m.child_name || '', phone_e164: m.phone_e164 || '',
    institution: '', class_or_year: '', section: '', beneficiary_type: '', beneficiary_status: '' };
}

/** The groups a campaign went to. Older campaigns have one group in institution / class_or_year / section. */
function campaignGroups_(c) {
  if (c.groups && c.groups.length) return c.groups;
  return [{ institution: c.institution, class_or_year: c.class_or_year || null, section: c.section || null }];
}

/** Clean the groups picked on the page: each needs a school, and a section only counts inside a grade. May be empty (send by type only). */
function cleanGroups_(list) {
  var seen = {}, out = [];
  (list || []).forEach(function (g) {
    var inst = String((g && g.institution) || '').trim();
    if (!inst) throw new ApiError('Choose a school.');
    var cy = String(g.class_or_year || '').trim() || null;
    var sec = cy ? (String(g.section || '').trim() || null) : null;
    var key = [inst, cy || '', sec || ''].join('\u0001');
    if (!seen[key]) { seen[key] = true; out.push({ institution: inst, class_or_year: cy, section: sec }); }
  });
  return out;
}

/** "School A: Grade 7 (A, B), Grade 8 \u00b7 School B" */
function groupsLabel_(groups) {
  var insts = [], byInst = {};
  groups.forEach(function (g) {
    if (!byInst[g.institution]) { byInst[g.institution] = []; insts.push(g.institution); }
    byInst[g.institution].push(g);
  });
  return insts.map(function (inst) {
    var gs = byInst[inst];
    if (gs.some(function (g) { return !g.class_or_year; })) return inst; // the whole school
    var word = 'Grade ', classes = [], secs = {};
    gs.forEach(function (g) {
      if (!secs[g.class_or_year]) { secs[g.class_or_year] = []; classes.push(g.class_or_year); }
      secs[g.class_or_year].push(g.section);
    });
    return inst + ': ' + classes.map(function (cy) {
      var list = secs[cy];
      return word + cy + (list.indexOf(null) >= 0 ? '' : ' (' + list.join(', ') + ')');
    }).join(', ');
  }).join(' \u00b7 ');
}

function senderName_(email) {
  if (!email) return null;
  var a = findOne_('Admins', 'email', email);
  return (a && a.full_name) || email;
}

function createCampaign_(user, body) {
  requireNewParentsTab_();
  return withLock_(function () {
    var template = findOne_('Templates', 'id', body.template_id);
    if (!template) throw new ApiError('Template not found', null, 404);
    if (template.status !== 'approved') throw new ApiError('This template is not approved by WhatsApp yet.');

    var variables = {};
    placeholderNumbers_(template.body).forEach(function (n) {
      var v = String((body.variables || {})[String(n)] || '').trim();
      if (!v) throw new ApiError('Please fill in a value for {{' + n + '}}.');
      if (v.indexOf('\n') >= 0) throw new ApiError('The value for {{' + n + '}} must not contain line breaks.');
      variables[String(n)] = v;
    });

    // Audience: picked groups (school / grade / section) and/or picked beneficiary types. An empty list means "any".
    var groups = cleanGroups_(body.groups), types = cleanTypes_(body.beneficiary_types);
    if (!groups.length && !types.length) throw new ApiError('Choose at least one school or one type of beneficiary.');
    // One message per child (siblings sharing a phone each get their own). Discontinued children get none.
    var parents = loadTable_('Parents').filter(function (p) {
      if (isDiscontinued_(p)) return false;
      if (types.length && types.indexOf(p.beneficiary_type) < 0) return false;
      return !groups.length || groups.some(function (g) { return inGroup_(p, g.institution, g.class_or_year, g.section); });
    });
    if (!parents.length) throw new ApiError('No children found for this audience.');
    var one = groups.length === 1 ? groups[0] : null;
    var sameInst = groups.length > 0 && groups.every(function (g) { return g.institution === groups[0].institution; });

    var cid = newId_(), now = nowIso_();
    insertRows_('Campaigns', [{
      id: cid, template_id: template.id,
      audience: campaignAudienceLabel_(groups, types),
      // The single-group columns stay filled when they still describe the whole campaign.
      institution: sameInst ? groups[0].institution : null, class_or_year: one ? one.class_or_year : null, section: one ? one.section : null,
      groups: groups, beneficiary_types: types.length ? types : null, variables: variables, created_by: user.email, status: 'sending', created_at: now,
      name: String(body.name || '').trim().slice(0, 100) || null, // optional; the audience is shown when empty
      // A copy for display only, so the campaign still shows its template after the template is deleted.
      template_name: template.name, template_language: template.language, template_body: template.body, template_has_buttons: template.has_confirm_buttons
    }]);
    // Everyone gets the campaign's template, in that template's language.
    insertRows_('Messages', parents.map(function (p) {
      return { id: newId_(), campaign_id: cid, parent_id: p.id, template_id: template.id,
        status: 'queued', updated_at: now,
        // A copy for display only, so past campaigns still show who it went to after a parent is deleted.
        parent_name: p.parent_name, child_name: p.child_name || null, phone_e164: p.phone_e164 };
    }));
    return { id: cid, message_count: parents.length };
  });
}

function listCampaigns_(user, f) {
  f = f || {};
  var offset = Number(f.offset) || 0;
  var rows = loadTable_('Campaigns').filter(function (c) {
    return campaignGroups_(c).some(function (g) {
      if (f.institution && g.institution && g.institution !== f.institution) return false;   // no school = sent by type to every school
      // A filter also matches campaigns sent to a wider group (class 7 shows whole-school sends).
      if (f.class_or_year && g.class_or_year && g.class_or_year !== f.class_or_year) return false;
      if (f.section && g.section && g.section !== f.section) return false;
      return true;
    });
  }).sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  var page = rows.slice(offset, offset + CAMPAIGN_PAGE_SIZE);
  if (!page.length) return [];
  var ids = {}; page.forEach(function (c) { ids[c.id] = []; });
  loadTable_('Messages').forEach(function (m) { if (ids[m.campaign_id]) ids[m.campaign_id].push(m); });
  var tpls = {}; loadTable_('Templates').forEach(function (t) { tpls[t.id] = t; });
  var admins = {}; loadTable_('Admins').forEach(function (a) { admins[a.email] = a; });
  return page.map(function (c) {
    delete c._row;
    c.template_name = campaignTemplate_(c, tpls[c.template_id]).name;
    c.sender = ((admins[c.created_by] || {}).full_name) || c.created_by;
    c.counts = countByStatus_(ids[c.id]);
    return c;
  });
}

function getCampaign_(user, id, status) {
  var c = findOne_('Campaigns', 'id', id);
  if (!c) throw new ApiError('Campaign not found', null, 404);
  var t = campaignTemplate_(c, findOne_('Templates', 'id', c.template_id));
  var parents = {}; loadTable_('Parents').forEach(function (p) { parents[p.id] = p; });
  var all = loadTable_('Messages').filter(function (m) { return m.campaign_id === id; });
  var counts = countByStatus_(all);
  var msgs = status ? all.filter(function (m) { return m.status === status; }) : all;
  var now = Date.now();
  msgs = msgs.map(function (m) {
    var p = parentForDisplay_(m, parents);
    m.parents = { parent_name: p.parent_name, child_name: p.child_name, phone_e164: p.phone_e164,
      beneficiary_type: p.beneficiary_type, beneficiary_status: p.beneficiary_status, deleted: !parents[m.parent_id] };
    m.call_due_at = parents[m.parent_id] ? nextCallTime_(m, p, c.status, now) : null; // no calls to a deleted parent
    delete m._row;
    return m;
  });
  msgs.sort(function (a, b) { return a.parents.parent_name.localeCompare(b.parents.parent_name); });
  delete c._row;
  c.template_name = t.name; c.template_body = t.body; c.template_has_buttons = t.has_confirm_buttons;
  c.sender = senderName_(c.created_by); c.counts = counts; c.messages = msgs;
  return c;
}

/** Stop: unsent messages are cancelled and no more fallback calls are placed. */
function cancelCampaign_(user, id) {
  return withLock_(function () {
    var c = findOne_('Campaigns', 'id', id);
    if (!c) throw new ApiError('Campaign not found', null, 404);
    c.status = 'cancelled'; saveRows_('Campaigns', [c]);
    var stopped = loadTable_('Messages').filter(function (m) { return m.campaign_id === id && m.status === 'queued'; });
    stopped.forEach(function (m) { m.status = 'cancelled'; m.updated_at = m.status_at = nowIso_(); });
    saveRows_('Messages', stopped);
    return { stopped: stopped.length };
  });
}

/** Delete a campaign's rows (Campaigns, Messages, Events). A Drive export, if any, is kept. Stop a sending campaign first. */
function deleteCampaign_(user, id) {
  return withLock_(function () {
    var c = findOne_('Campaigns', 'id', id);
    if (!c) throw new ApiError('Campaign not found', null, 404);
    if (c.status === 'sending') throw new ApiError('This campaign is still sending. Stop it first, then delete it.');
    var msgs = loadTable_('Messages'), ids = {};
    msgs.forEach(function (m) { if (m.campaign_id === id) ids[m.id] = true; });
    replaceTable_('Messages', msgs.filter(function (m) { return !ids[m.id]; }));
    deleteEventRows_(function (ev) { return ids[ev.message_id]; });
    deleteRow_('Campaigns', c);
    return { deleted: 1, messages: Object.keys(ids).length };
  });
}

/** Resend WhatsApp to failed messages that have not been called yet. */
function retryFailed_(user, id) {
  return withLock_(function () {
    var c = findOne_('Campaigns', 'id', id);
    if (!c) throw new ApiError('Campaign not found', null, 404);
    if (c.status === 'cancelled') throw new ApiError('This campaign was stopped.');
    var failed = loadTable_('Messages').filter(function (m) {
      return m.campaign_id === id && m.status === 'failed' && !m.call_requested_at;
    });
    failed.forEach(function (m) {
      m.status = 'queued'; m.wa_sid = null; m.wa_sent_at = null; m.wa_error = null; m.send_claimed_at = null; m.updated_at = m.status_at = nowIso_();
    });
    saveRows_('Messages', failed);
    if (failed.length) { c.status = 'sending'; saveRows_('Campaigns', [c]); }
    return { retried: failed.length };
  });
}

function resolveMessage_(user, messageId, outcome) {
  if (outcome !== 'confirmed' && outcome !== 'declined') throw new ApiError('Outcome must be confirmed or declined.');
  var ok = withLock_(function () { return setAdminOutcome_(messageId, outcome, user.email); });
  if (!ok) throw new ApiError("This message can't be changed (it was cancelled or doesn't exist).");
  logEvent_(messageId, 'admin', { outcome: outcome, by: user.email });
  return { ok: true };
}

// ===== Fallback.gs =====
var BUILD_Fallback = '20261107-1230'; // build stamp (see Build.gs)
/** The IVR fallback: call parents who have not confirmed. Run by the cron tick. */
var MAX_AGE_MS = 48 * 3600 * 1000;
var CALL_BATCH = 20;

/** Voice fallback is optional: it only runs when TWILIO_VOICE_FROM is set. */
function voiceEnabled_() { return !!cfg_().TWILIO_VOICE_FROM; }

function hmNow_(d) { return Utilities.formatDate(d || new Date(), cfg_().APP_TIMEZONE, 'HH:mm'); }

function inCallWindow_() {
  var c = cfg_(), hm = hmNow_();
  return c.CALL_WINDOW_START <= hm && hm < c.CALL_WINDOW_END;
}

/** First moment at or after `d` that is inside the call window (in APP_TIMEZONE). */
function intoCallWindow_(d) {
  var c = cfg_(), tz = c.APP_TIMEZONE;
  var day = Utilities.formatDate(d, tz, 'yyyy-MM-dd'), hm = Utilities.formatDate(d, tz, 'HH:mm');
  if (hm < c.CALL_WINDOW_START) return Utilities.parseDate(day + ' ' + c.CALL_WINDOW_START, tz, 'yyyy-MM-dd HH:mm');
  if (hm >= c.CALL_WINDOW_END) {
    var next = Utilities.formatDate(new Date(d.getTime() + 24 * 3600 * 1000), tz, 'yyyy-MM-dd');
    return Utilities.parseDate(next + ' ' + c.CALL_WINDOW_START, tz, 'yyyy-MM-dd HH:mm');
  }
  return d;
}

/** Roughly when the fallback will call this parent (for the UI). null if no call is planned. */
function nextCallTime_(m, parent, campaignStatus, nowMs) {
  if (!voiceEnabled_()) return null; // WhatsApp-only mode: no calls are planned
  if (campaignStatus === 'cancelled' || isDiscontinued_(parent) || m.call_requested_at) return null;
  var due;
  if (['sent', 'delivered', 'read'].indexOf(m.status) >= 0 && m.wa_sent_at) {
    var sent = Date.parse(m.wa_sent_at);
    if (nowMs - sent > MAX_AGE_MS) return null;
    due = sent + cfg_().CALL_FALLBACK_HOURS * 3600 * 1000;
  } else if (m.status === 'failed') {
    due = nowMs;
  } else return null;
  return intoCallWindow_(new Date(Math.max(due, nowMs))).toISOString();
}

function findCandidates_() {
  var now = Date.now(), cutoff = now - cfg_().CALL_FALLBACK_HOURS * 3600 * 1000, oldest = now - MAX_AGE_MS;
  var parents = {}; loadTable_('Parents').forEach(function (p) { parents[p.id] = p; });
  var camps = {}; loadTable_('Campaigns').forEach(function (c) { camps[c.id] = c; });
  return loadTable_('Messages').filter(function (m) {
    if (m.call_requested_at) return false;
    var p = parents[m.parent_id], c = camps[m.campaign_id];
    if (!p || !c || isDiscontinued_(p) || c.status === 'cancelled') return false;
    if (['sent', 'delivered', 'read'].indexOf(m.status) >= 0) {
      var t = m.wa_sent_at ? Date.parse(m.wa_sent_at) : NaN;
      return t < cutoff && t > oldest; // WhatsApp delivered but no answer after CALL_FALLBACK_HOURS
    }
    if (m.status === 'failed') return Date.parse(m.updated_at) > oldest; // WhatsApp failed: call now
    return false;
  }).map(function (m) { return { id: m.id, phone: parents[m.parent_id].phone_e164 }; });
}

/** Under lock: claim up to `max` candidates that nobody else claimed first. */
function claimCalls_(candidates, max) {
  return withLock_(function () {
    var ids = {}; candidates.forEach(function (c) { ids[c.id] = c; });
    var picked = [], dirty = [];
    loadTable_('Messages').forEach(function (m) {
      if (!ids[m.id] || m.call_requested_at || picked.length >= max) return;
      m.call_requested_at = nowIso_(); dirty.push(m); picked.push(ids[m.id]);
    });
    saveRows_('Messages', dirty);
    return picked;
  });
}

function runFallback_(deadline) {
  if (!voiceEnabled_()) return { skipped: 'voice not configured (WhatsApp only)' };
  if (!inCallWindow_()) return { skipped: 'outside call window' };
  if (!instantUpdates_()) return { skipped: 'phone calls need the Twilio address (PUBLIC_BASE_URL)' };
  requireConfig_(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'PUBLIC_BASE_URL', 'WEBHOOK_SECRET']);
  var candidates = findCandidates_(), called = 0, failed = 0;
  while (candidates.length && Date.now() < deadline) {
    var batch = claimCalls_(candidates, CALL_BATCH);
    if (!batch.length) break;
    var taken = {}; batch.forEach(function (b) { taken[b.id] = true; });
    candidates = candidates.filter(function (c) { return !taken[c.id]; });
    var results = batch.map(function (b) {
      try { return { id: b.id, sid: placeCall_(b.phone, b.id) }; }
      catch (e) { console.warn('Call for message ' + b.id + ' failed: ' + e.message); return { id: b.id, error: e.message }; }
    });
    withLock_(function () {
      results.forEach(function (r) {
        if (r.sid) {
          // call_status is left to the status webhook, which may already have run.
          var m = findOne_('Messages', 'id', r.id);
          if (m) { m.call_sid = r.sid; m.updated_at = nowIso_(); saveRows_('Messages', [m]); }
          called++;
        } else {
          applyStatus_(r.id, 'flagged', { call_status: 'failed: ' + r.error });
          failed++;
        }
      });
    });
    results.forEach(function (r) { if (r.error) logEvent_(r.id, 'cron', { action: 'place_call', error: r.error }); });
  }
  return { called: called, call_failed: failed };
}

// ===== Parents.gs =====
var BUILD_Parents = '20261107-1230'; // build stamp (see Build.gs)
/**
 * Parents: one row per child, filled only by CSV upload (no editing in the app).
 * The CSV comes from Ek Tara. All ten columns are required; headers match ignoring case, spaces and punctuation.
 * A row is matched on New Child ID: new IDs are added, known IDs are updated, nothing is ever deleted.
 */
var PARENT_COLUMNS = [   // [CSV header as Ek Tara writes it, field in the Parents sheet]
  ['File Number', 'file_number'], ['New Child ID', 'id'], ['Father/Mother', 'parent_name'], ['Phone(Mobile)', 'phone'],
  ['Name', 'child_name'], ['School Name', 'institution'], ['Type of Beneficiary', 'beneficiary_type'],
  ['Status of Beneficiary', 'beneficiary_status'], ['Current Grade', 'class_or_year'], ['Current Section/Stream', 'section']
];

/** E.164 (default region India). Returns null if invalid. (The donor side uses this too.) */
function normalizePhone_(raw) {
  var s = String(raw || '').trim();
  var plus = s.charAt(0) === '+';
  var d = s.replace(/\D/g, '');
  if (!d) return null;
  if (plus) {
    if (d.length < 8 || d.length > 15 || d.charAt(0) === '0') return null;
    if (d.indexOf('91') === 0) return /^91[2-9]\d{9}$/.test(d) ? '+' + d : null;
    return '+' + d;
  }
  if (/^[2-9]\d{9}$/.test(d)) return '+91' + d;
  if (/^0[2-9]\d{9}$/.test(d)) return '+91' + d.slice(1);
  if (/^91[2-9]\d{9}$/.test(d)) return '+' + d;
  return null;
}

var PHONE_RULES = 'use a 10-digit Indian number that does not start with 0 or 1 (a 0, 91 or +91 in front is fine), ' +
  'or a foreign number written with + and the country code, e.g. +44 7911 123456';

/** "Phone (Mobile) " -> "phonemobile", so small differences in the CSV headers still match. */
function headerKey_(h) { return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

function cleanText_(v) { return String(v || '').trim().split(/\s+/).join(' '); }

/** Children with this status get no messages. */
function isDiscontinued_(p) { return cleanText_(p && p.beneficiary_status).toLowerCase() === 'discontinued'; }

/** Validate and normalise one CSV row. Returns {row} or {error}. */
function cleanParent_(rec) {
  var row = {};
  for (var i = 0; i < PARENT_COLUMNS.length; i++) {
    var v = cleanText_(rec[PARENT_COLUMNS[i][1]]);
    if (!v) return { error: PARENT_COLUMNS[i][0] + ' is empty' };
    row[PARENT_COLUMNS[i][1]] = v;
  }
  var phone = normalizePhone_(row.phone);
  if (!phone) return { error: "invalid phone number '" + row.phone + "': " + PHONE_RULES };
  row.phone_e164 = phone;
  delete row.phone;
  return { row: row };
}

/** Is this child in the group? An empty institution / class / section means "any". */
function inGroup_(r, institution, classOrYear, section) {
  if (institution && r.institution !== institution) return false;
  if (classOrYear && r.class_or_year !== classOrYear) return false;
  if (section && r.section !== section) return false;
  return true;
}

function sortBy_(rows, keys) {
  return rows.sort(function (a, b) {
    for (var i = 0; i < keys.length; i++) {
      var x = String(a[keys[i]] || ''), y = String(b[keys[i]] || '');
      var c = x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' });
      if (c) return c;
    }
    return 0;
  });
}

function uploadParents_(user, csvText) {
  requireNewParentsTab_();
  var text = String(csvText || '').replace(/^\uFEFF/, '');
  var table;
  try { table = Utilities.parseCsv(text); } catch (e) { throw new ApiError('File must be a UTF-8 CSV'); }
  if (!table.length) throw new ApiError('The file is empty.');
  var keys = table[0].map(headerKey_), col = {};
  PARENT_COLUMNS.forEach(function (c) { col[c[1]] = keys.indexOf(headerKey_(c[0])); });
  var missing = PARENT_COLUMNS.filter(function (c) { return col[c[1]] < 0; }).map(function (c) { return c[0]; });
  if (missing.length) throw new ApiError('Missing columns: ' + missing.join(', '));

  var byId = {}, firstRow = {}, rejected = [];
  for (var i = 1; i < table.length; i++) {
    var cells = table[i], rowNumber = i + 1;
    if (cells.join('').trim() === '') continue; // blank line
    var rec = {};
    PARENT_COLUMNS.forEach(function (c) { rec[c[1]] = cells[col[c[1]]] === undefined ? '' : String(cells[col[c[1]]]); });
    var bad = { row: rowNumber, parent_name: cleanText_(rec.parent_name) || null, phone: cleanText_(rec.phone) || null };
    var res = cleanParent_(rec);
    if (res.error) { bad.reason = res.error; rejected.push(bad); continue; }
    var p = res.row;
    if (byId[p.id]) { bad.reason = 'New Child ID ' + p.id + ' is already in row ' + firstRow[p.id]; rejected.push(bad); continue; }
    byId[p.id] = p; firstRow[p.id] = rowNumber;
  }

  return withLock_(function () {
    var existing = {};
    loadTable_('Parents').forEach(function (r) { existing[r.id] = r; });
    var toUpdate = [], toInsert = [], rows = [], now = nowIso_();
    Object.keys(byId).forEach(function (id) {
      var p = byId[id], old = existing[id];
      if (old) {
        Object.keys(p).forEach(function (k) { old[k] = p[k]; });
        old.updated_at = now;
        toUpdate.push(old);
      } else {
        p.created_at = now; p.updated_at = now;
        toInsert.push(p);
      }
      rows.push({ row: firstRow[id], parent_name: p.parent_name, phone: p.phone_e164, status: old ? 'updated' : 'added' });
    });
    saveRows_('Parents', toUpdate);
    insertRows_('Parents', toInsert);
    rows.sort(function (a, b) { return a.row - b.row; });
    return { inserted: toInsert.length, updated: toUpdate.length, rejected: rejected.length, errors: rejected, rows: rows };
  });
}

/** Children who can be messaged, counted per school / grade / section / type (for the campaign page). */
function listGroups_() {
  requireNewParentsTab_();
  var groups = {};
  loadTable_('Parents').forEach(function (r) {
    if (isDiscontinued_(r)) return;
    var key = [r.institution, r.class_or_year, r.section || '', r.beneficiary_type || ''].join('\u0001');
    var g = groups[key] || (groups[key] = {
      institution: r.institution, class_or_year: r.class_or_year, section: r.section, beneficiary_type: r.beneficiary_type, parent_count: 0
    });
    g.parent_count++;
  });
  return sortBy_(Object.keys(groups).map(function (k) { return groups[k]; }), ['institution', 'class_or_year', 'section', 'beneficiary_type']);
}

function listParents_(user, f) {
  requireNewParentsTab_();
  f = f || {};
  var parents = loadTable_('Parents').filter(function (r) { return inGroup_(r, f.institution, f.class_or_year, f.section); });
  var stats = {};
  loadTable_('Messages').forEach(function (m) {
    var s = stats[m.parent_id] || (stats[m.parent_id] = { total: 0, responded: 0, flagged: 0 });
    if (m.status !== 'cancelled') s.total++;
    if (m.status === 'confirmed' || m.status === 'declined') s.responded++;
    if (m.status === 'flagged') s.flagged++;
  });
  sortBy_(parents, ['institution', 'class_or_year', 'parent_name', 'id']);
  // Most recently added or updated first (the sort is stable, so each upload keeps the order above).
  parents.sort(function (a, b) { return String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')); });
  return parents.map(function (p) {
    p.stats = stats[p.id] || { total: 0, responded: 0, flagged: 0 };
    delete p._row;
    return p;
  });
}

function parentHistory_(user, id) {
  var camps = {}, tpls = {};
  loadTable_('Campaigns').forEach(function (c) { camps[c.id] = c; });
  loadTable_('Templates').forEach(function (t) { tpls[t.id] = t; });
  var rows = findBy_('Messages', 'parent_id', id);
  rows.sort(function (a, b) { return String(b.updated_at).localeCompare(String(a.updated_at)); });
  return rows.slice(0, 50).map(function (m) {
    var c = camps[m.campaign_id] || {}, t = campaignTemplate_(c, tpls[c.template_id]);
    return {
      id: m.id, status: m.status, confirmed_via: m.confirmed_via, reply_text: m.reply_text, updated_at: m.updated_at,
      campaigns: { id: c.id, name: c.name, audience: c.audience, created_at: c.created_at, templates: { name: t.name } }
    };
  });
}

// ===== Sender.gs =====
var BUILD_Sender = '20261107-1230'; // build stamp (see Build.gs)
/**
 * Fan out a campaign: one WhatsApp message per parent.
 * Apps Script has no background tasks, so the web app calls sendCampaignBatch_ repeatedly until nothing
 * is left, and the cron tick finishes any campaign whose browser was closed. A message is "claimed" (under
 * the lock) before it is sent, so two runs never send the same message twice.
 */
var CLAIM_EXPIRES_MS = 7 * 60 * 1000; // longer than Apps Script's 6-minute limit, so a running batch never loses its claim
var RESUME_AFTER_MS = 3 * 60 * 1000;
var RESUME_MAX_AGE_MS = 48 * 3600 * 1000;
var STUCK_AFTER_MS = 30 * 60 * 1000;
var RECHECK_MAX_AGE_MS = 24 * 3600 * 1000;
var BATCH_SIZE = 50;

function eligibleToSend_(m, parentsById, nowMs) {
  var p = parentsById[m.parent_id];
  if (m.status !== 'queued' || !p) return false;
  var claimed = m.send_claimed_at ? Date.parse(m.send_claimed_at) : 0;
  return !claimed || nowMs - claimed > CLAIM_EXPIRES_MS;
}

/** Under lock: pick up to `max` messages, cancel those of children marked Discontinued since, mark the rest claimed. */
function claimBatch_(campaignId, max) {
  return withLock_(function () {
    var campaign = findOne_('Campaigns', 'id', campaignId);
    if (!campaign || campaign.status === 'cancelled') return { campaign: campaign, items: [], remaining: 0 };
    var parents = {}; loadTable_('Parents').forEach(function (p) { parents[p.id] = p; });
    var now = Date.now(), dirty = [], items = [], remaining = 0;
    loadTable_('Messages').forEach(function (m) {
      if (m.campaign_id !== campaignId || m.status !== 'queued') return;
      var p = parents[m.parent_id];
      if (p && isDiscontinued_(p)) { transition_(m, 'cancelled'); dirty.push(m); return; }
      if (!eligibleToSend_(m, parents, now)) return;
      if (items.length >= max) { remaining++; return; }
      m.send_claimed_at = nowIso_();
      dirty.push(m);
      items.push({ id: m.id, template_id: m.template_id || campaign.template_id, phone: p.phone_e164 });
    });
    saveRows_('Messages', dirty);
    return { campaign: campaign, items: items, remaining: remaining };
  });
}

function sendItems_(campaign, items) {
  var c = cfg_();
  var sids = {};
  loadTable_('Templates').forEach(function (t) { sids[t.id] = t.twilio_content_sid; });
  var results = [];
  for (var i = 0; i < items.length; i += c.SEND_CONCURRENCY) {
    var chunk = items.slice(i, i + c.SEND_CONCURRENCY);
    var reqs = chunk.map(function (it) {
      return { phone: it.phone, contentSid: sids[it.template_id], variables: campaign.variables, messageId: it.id };
    });
    var out;
    try { out = sendWhatsappMany_(reqs); }
    catch (e) {
      // A network error fails the whole chunk; try once more before marking it failed.
      // Twilio did not answer, so these were most likely not sent.
      Utilities.sleep(2000);
      try { out = sendWhatsappMany_(reqs); }
      catch (e2) { out = chunk.map(function () { return { error: 'Unexpected error while sending: ' + e2.message }; }); }
    }
    chunk.forEach(function (it, j) { results.push({ id: it.id, res: out[j] }); });
  }
  return results;
}

function saveSendResults_(results) {
  withLock_(function () {
    var byId = {}; results.forEach(function (r) { byId[r.id] = r.res; });
    var dirty = [];
    loadTable_('Messages').forEach(function (m) {
      var res = byId[m.id]; if (!res) return;
      if (res.sid) {
        m.wa_sid = res.sid; m.wa_sent_at = nowIso_(); m.updated_at = nowIso_();
        transition_(m, 'sent'); // no-op if a status callback already moved it further
      } else {
        transition_(m, 'failed', { wa_error: res.error });
      }
      dirty.push(m);
    });
    saveRows_('Messages', dirty);
  });
}

function finishCampaignIfDone_(campaignId, remaining) {
  if (remaining > 0) return 'sending';
  return withLock_(function () {
    var c = findOne_('Campaigns', 'id', campaignId);
    if (!c) return null;
    if (c.status === 'sending' || c.status === 'failed') { c.status = 'sent'; saveRows_('Campaigns', [c]); }
    return c.status;
  });
}

/** Send for up to budgetMs. Returns {status, remaining}. Safe to call repeatedly and concurrently. */
function sendCampaignBatch_(campaignId, budgetMs) {
  requireConfig_(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN']);   // the Twilio address is optional (see instantUpdates_)
  if (!cfg_().TWILIO_WHATSAPP_FROM && !cfg_().TWILIO_MESSAGING_SERVICE_SID)
    throw new ApiError('Set TWILIO_WHATSAPP_FROM (or TWILIO_MESSAGING_SERVICE_SID) in Script properties.');
  var started = Date.now(), remaining = 0, campaign = null;
  while (true) {
    var claim = claimBatch_(campaignId, BATCH_SIZE);
    campaign = claim.campaign;
    remaining = claim.remaining;
    if (!claim.items.length) break;
    saveSendResults_(sendItems_(claim.campaign, claim.items));
    if (Date.now() - started > budgetMs) break;
  }
  if (!campaign) throw new ApiError('Campaign not found', null, 404);
  if (campaign.status === 'cancelled') return { status: 'cancelled', remaining: 0 };
  return { status: finishCampaignIfDone_(campaignId, remaining), remaining: remaining };
}

/** Cron: finish campaigns whose send was interrupted (browser closed, quota hit). */
function resumeStuckCampaigns_(deadline) {
  var now = Date.now(), resumed = 0;
  var camps = loadTable_('Campaigns').filter(function (c) {
    var age = now - Date.parse(c.created_at);
    return (c.status === 'sending' || c.status === 'failed') && age > RESUME_AFTER_MS && age < RESUME_MAX_AGE_MS;
  });
  for (var i = 0; i < camps.length && Date.now() < deadline; i++) {
    try { sendCampaignBatch_(camps[i].id, Math.max(10000, deadline - Date.now() - 20000)); resumed++; }
    catch (e) { console.error('Campaign ' + camps[i].id + ' failed: ' + e.message); }
  }
  return { resumed: resumed };
}

/** Cron: Twilio does not retry lost status callbacks, so ask Twilio about messages still on 'sent'. */
function recheckStuckMessages_(deadline) {
  var now = Date.now();
  var stuck = loadTable_('Messages').filter(function (m) {
    if (m.status !== 'sent' || !m.wa_sid || !m.wa_sent_at) return false;
    var age = now - Date.parse(m.wa_sent_at);
    return age > STUCK_AFTER_MS && age < RECHECK_MAX_AGE_MS;
  }).slice(0, 150);
  var updates = [];
  for (var i = 0; i < stuck.length && Date.now() < deadline; i++) {
    var m = stuck[i];
    try {
      var s = fetchWhatsappStatus_(m.wa_sid);
      var ns = WHATSAPP_STATUS_MAP[s.status];
      if (ns && ns !== 'sent') updates.push({ id: m.id, status: ns, error: s.error, twilio: s.status });
    } catch (e) { console.warn('Could not fetch status of ' + m.wa_sid + ': ' + e.message); }
  }
  var changed = 0;
  if (updates.length) {
    withLock_(function () {
      updates.forEach(function (u) {
        if (applyStatus_(u.id, u.status, u.status === 'failed' ? { wa_error: u.error } : {})) changed++;
      });
    });
    updates.forEach(function (u) { logEvent_(u.id, 'cron', { recheck_status: u.twilio, error: u.error }); });
  }
  return { checked: stuck.length, updated: changed };
}

/**
 * Single-address mode: no Twilio callbacks, so ask Twilio how our recent messages are doing (delivered, read, failed) and update
 * the parent and donor message rows in one pass. Statuses still only move forward.
 */
function pollMessageStatuses_() {
  var cutoff = Date.now() - 3 * 86400000, wanted = {}, any = false;
  function consider(table) {
    loadTable_(table).forEach(function (m) {
      if (m.wa_sid && (m.status === 'sent' || m.status === 'delivered') && m.wa_sent_at && Date.parse(m.wa_sent_at) > cutoff) { wanted[m.wa_sid] = true; any = true; }
    });
  }
  consider('Messages'); if (donorReady_()) consider('DonorMessages');
  if (!any) return { checked: 0, updated: 0 };
  var list = listOutboundStatuses_(new Date(cutoff)), status = {};
  list.forEach(function (x) { if (wanted[x.sid]) status[x.sid] = x; });
  var updated = 0;
  withLock_(function () {
    var dirty = [];
    loadTable_('Messages').forEach(function (m) {
      var x = m.wa_sid && status[m.wa_sid]; if (!x) return;
      var ns = WHATSAPP_STATUS_MAP[x.status];
      if (ns && transition_(m, ns, ns === 'failed' ? { wa_error: x.error || 'WhatsApp could not deliver the message' } : {})) dirty.push(m);
    });
    saveRows_('Messages', dirty); updated += dirty.length;
    if (donorReady_()) {
      var dd = [];
      loadTable_('DonorMessages').forEach(function (m) {
        var x = m.wa_sid && status[m.wa_sid]; if (!x) return;
        var ns = WHATSAPP_STATUS_MAP[x.status];
        if (ns && (DONOR_STATUS_ALLOWED[ns] || []).indexOf(m.status) >= 0) { m.status = ns; if (ns === 'failed') m.wa_error = x.error || 'WhatsApp could not deliver the message'; m.updated_at = nowIso_(); dd.push(m); }
      });
      saveRows_('DonorMessages', dd); updated += dd.length;
    }
  });
  return { checked: Object.keys(wanted).length, updated: updated };
}

// ===== VoiceScripts.gs =====
var BUILD_VoiceScripts = '20261107-1230'; // build stamp (see Build.gs)
/** IVR call scripts per parent language. {details} = campaign values in order. */
var VOICE_SCRIPTS = {
  en: {
    voice: 'Google.en-IN-Standard-A', language: 'en-IN',
    prompt: "Hello, this is a message from your child's school about {details}. Press 1 to confirm. Press 2 if you cannot attend.",
    invalid: 'Sorry, that is not a valid choice.',
    confirmed: 'Thank you. Your attendance is confirmed. Goodbye.',
    declined: 'Thank you. We have noted that you cannot attend. Goodbye.',
    goodbye: 'We did not receive your response. Goodbye.'
  },
  hi: {
    voice: 'Google.hi-IN-Standard-A', language: 'hi-IN',
    prompt: 'नमस्ते, यह आपके बच्चे के स्कूल से संदेश है: {details}. पुष्टि करने के लिए 1 दबाएँ। अगर आप नहीं आ सकते, तो 2 दबाएँ।',
    invalid: 'माफ़ कीजिए, यह सही विकल्प नहीं है।',
    confirmed: 'धन्यवाद। आपकी उपस्थिति की पुष्टि हो गई है।',
    declined: 'धन्यवाद। हमने नोट कर लिया है कि आप नहीं आ पाएँगे।',
    goodbye: 'हमें आपका जवाब नहीं मिला। धन्यवाद।'
  },
  ta: {
    voice: 'Google.ta-IN-Standard-C', language: 'ta-IN',
    prompt: 'வணக்கம், இது உங்கள் குழந்தையின் பள்ளியிலிருந்து வரும் செய்தி: {details}. உறுதிப்படுத்த 1 ஐ அழுத்தவும். வர முடியாவிட்டால் 2 ஐ அழுத்தவும்.',
    invalid: 'மன்னிக்கவும், அது சரியான தேர்வு அல்ல.',
    confirmed: 'நன்றி. உங்கள் வருகை உறுதிசெய்யப்பட்டது.',
    declined: 'நன்றி. நீங்கள் வர முடியாது என்பதை குறித்துக்கொண்டோம்.',
    goodbye: 'உங்கள் பதில் கிடைக்கவில்லை. நன்றி.'
  }
};

function getVoiceScript_(language) { return VOICE_SCRIPTS[language] || VOICE_SCRIPTS.en; }
