# Donor Communication: User Guide

_Ek Tara Communications · November 2026_

## 1. About this guide

This guide explains the **Donor Communication** workspace of the Ek Tara Communications app: what every page, button and field does, the rules the app follows behind the scenes, and what to do and what not to do on each page.

It is written for the Ek Tara team members who look after donors and send updates to them. You do not need any technical knowledge. A short section at the end is for the administrator who installs and updates the app.

### How to read it

- **Chapters 2 and 3** explain the ideas the whole workspace is built on (segments, opt-in, templates, placeholders, statuses). Read them once.
- **Chapters 4 to 9** go through the pages in the order they appear in the menu: Overview, Contacts, Campaigns, Templates, Broadcasts and Queue. Each ends with a green **Do** box and a red **Don’t** box.
- **Chapters 10 to 12** cover email, replies and step-by-step recipes for common jobs.
- **Chapter 13** is a troubleshooting table: find the message you see on screen and what to do about it.
- **Chapter 14** is a one-page list of golden rules. Print it and keep it next to you.

> **Note:** Words in **bold** are the exact names of buttons, fields and pages as they appear in the app. Words in `code style` are column names in the Google Sheet or placeholder labels.

## 2. The workspace at a glance

Donor Communication helps the team keep in touch with donors and potential donors by **WhatsApp** and **email**. It keeps a list of contacts, sends approved messages to groups of them, records every message and reply, and remembers donations and conversations.

### Who can use it

Only people who have been given **Donor Communication** access under **Users and access** (the gear icon, for administrators) can open this workspace. When you sign in, the app shows the workspaces you may open. If you also have Parent Communication access, use **Switch division** at the top to move between them. Parent and donor data are kept in separate Google Sheets; one side cannot see the other’s records.

### The pages

| Page | What it is for |
|---|---|
| **Overview** | A summary: how many contacts are in each segment, what needs attention (drafts to approve, held or failed messages, missing templates), and a button to send waiting messages now. |
| **Contacts** | Everyone you communicate with: add, edit, upload from a CSV file, record donations, log calls and conversations, deactivate. |
| **Campaigns** | An appeal or project that donations and broadcasts can be linked to, with its progress and results texts and the money raised. |
| **Templates** | The WhatsApp message designs. Every message must use a template that Meta (WhatsApp) has approved. |
| **Broadcasts** | A message to one or more segments: choose a template, fill the values, preview, then approve to send. |
| **Queue** | Every donor message the app has created and what happened to it: waiting, held (and why), sent, delivered, read, failed, cancelled, or a reply received. |

### The life of a message

Every message to a donor travels the same road. Understanding it makes every page easier:

`Template → Broadcast → Preview → Approve → Queue → Sent (WhatsApp / email) → Delivered / Read → Replies`

1. A **template** is written and sent to Meta for approval (Templates page). This happens once per message design.
2. A **broadcast** picks an approved template, the segments to send to and the values for the placeholders (Broadcasts page).
3. You **preview** it: who gets it, a sample of the real text, and anything missing.
4. You **approve** it. The app creates one message per person and channel and puts them in the **Queue**.
5. The sender sends them by **WhatsApp** (through Twilio) and/or **email**, straight away or on the **Send on** date.
6. WhatsApp reports back: **sent**, **delivered**, **read** or **failed**. If the donor replies, the reply appears as **Received**.

> **Tip:** Nothing is sent automatically. Every message, including the **“A year ago you helped”** update, goes out only when a person approves a broadcast. (The automatic T7 rule was turned off.)

## 3. Key ideas

### Segments

Every contact belongs to exactly one segment. Broadcasts are sent to segments. A contact’s segment changes over time; every change is recorded in the contact’s **Segment history** with the reason and who made it.

| Code | Name | Use it for |
|---|---|---|
| **P0** | Testing group | The team’s own phones and email addresses. Send every new broadcast to P0 first to see the real message. P0 only gets a broadcast when you tick it. |
| **P1** | Trustee / employee lead | Potential donors introduced by a trustee or an employee. |
| **P2** | Website lead | Potential donors who came through the website (the default for a new contact). |
| **P3** | Donor / partner referral lead | Potential donors referred by an existing donor or partner. |
| **P4** | Last year’s donor | Gave last year. Send them the “A year ago you helped” update as a broadcast (it is no longer automatic). |
| **P5** | Past campaign donor | Gave to an earlier campaign. |
| **D1** | Programme donor | Supports a programme (for example a school or a project) on an ongoing basis. |
| **D2** | Campaign donor | Gave to a current campaign. |

### Opt-in: permission to message

The app only sends to people who have agreed to hear from Ek Tara. WhatsApp and email are separate permissions:

- **WhatsApp opt-in** needs a phone number. Without it, WhatsApp messages wait in the Queue as **Held – No WhatsApp opt-in recorded** (or **No phone number on the contact**).
- **Email opt-in** needs an email address. A contact with email opt-in automatically gets an email copy of every broadcast, unless the broadcast was approved with email switched off.
- A contact with both opt-ins gets both a WhatsApp message and an email.
- If a donor replies **STOP** on WhatsApp (also: stop all, unsubscribe, opt out), the app records that they opted out and cancels their waiting WhatsApp messages. Replying **START** (also: unstop, subscribe) turns WhatsApp opt-in back on.
- Switching **WhatsApp opt-in** on again in the contact form after a STOP records a new opt-in. Only do this when the person has really agreed again.

### Active and inactive contacts

A contact can be **deactivated** instead of deleted. An inactive contact keeps all history but receives no messages, is left out of broadcasts, tag counts and segment totals, and any messages still waiting for them are cancelled. Use **Activate again** to bring them back. Contacts are never deleted by the app.

### Tags

Tags are free labels on a contact, such as `csr` or `education` (up to 20 per contact, 40 characters each). On a broadcast, the **Tags in the chosen segments** box lets you leave out people by tag: click **×** on a tag to leave it out, **+** to add it back. A contact stays in if at least one of their tags is still in the box. Contacts with no tag are controlled by the **No tag** chip.

### Templates and message types

WhatsApp only allows business messages that follow a template Meta has approved. Each donor template has a **message type**. A broadcast can use **any** approved template, whatever its type; there is no separate “kind” to choose. The template’s type decides the rule code, the email subject and, for a festive greeting, when it expires:

| Template’s message type | Sent as | Notes |
|---|---|---|
| General update | **T8** | Regular news to the segments you choose. Needs approval. |
| Special update | **T11** | A one-off update written by the team. Needs approval. |
| Festive greeting | **T12** | A greeting for a festival. Dropped if it cannot be sent within 2 days of the festival (see Festival date). |
| “A year ago you helped” update | **T11** | Send it as a broadcast, usually to P4. It goes out as a Special update; the email subject is “A year ago, you helped”. (It used to be the automatic T7 rule, now turned off.) |
| Welcome, Thank-you | – | Nothing sends them automatically any more (T1 and T2 were retired). A template of these types, or with no type set, can still be used in a broadcast and goes out as a Special update (T11). |

### Placeholders and labels

A template body contains numbered placeholders such as `{{1}}` and `{{2}}`. Each placeholder has a **label** that tells the app where its value comes from:

- **Automatic labels** fill themselves for every contact from their own record (table below).
- **Your own labels** (for example `event_date`, `venue`, `message`) are typed once per broadcast under **Values for this send**, and everyone gets the same value.
- For an automatic label you may also type a value on the broadcast. It is used **only** for contacts whose record is empty.
- A media template has one extra placeholder, `media_file`, which holds the Google Drive link of the image or PDF.

| Automatic label | Filled from |
|---|---|
| `donor_name` | The contact’s name |
| `first_name` | The first word of the name |
| `city`, `project`, `core_programme`, `owner_name` | Those fields on the contact |
| `last_donation_date`, `donation_date` | The contact’s last donation date |
| `amount` | The contact’s last donation amount, shown in ₹ (for example ₹5,000). It is set when a donation is recorded in the app, not by the CSV upload. |
| `campaign_name` | The name of the campaign linked to the broadcast |
| `campaign_progress`, `campaign_result` | The **Progress text** and **Results text** of the linked campaign |

### Message statuses

Every message in the Queue has a status. A badge shows it everywhere:

| Status | Meaning |
|---|---|
| **Queued** | Waiting to be sent: now, at the next run, or on its scheduled date (“Scheduled for …”). |
| **Held** | Waiting because something is missing. The reason is shown (no opt-in, no phone, no approved template, a missing value, daily email limit). The app tries again on every run, so fixing the cause is enough. |
| **Sent** | Handed to WhatsApp (or the email was sent). |
| **Delivered** | WhatsApp delivered it to the phone. |
| **Read** | The donor opened it on WhatsApp. |
| **Failed** | WhatsApp or email refused it; the error is shown. Use **Retry** after fixing the cause. |
| **Skipped** | Not sent on purpose: it expired before it could go, or it went by email only because the contact has no WhatsApp opt-in. |
| **Cancelled** | Stopped: by you, by **Cancel unsent**, because the contact was deactivated, replied STOP or lost their opt-in. |
| **Received** | A reply from the donor on WhatsApp, linked to the message it answers. |
| **Logged** | A call or conversation the team recorded by hand (shown on the contact only, never in the Queue). |

### When unsent messages expire

A message that is still waiting after its expiry is not sent; it becomes **Skipped – Expired before it could be sent**. This prevents stale messages going out days late.

- **Festive greetings:** 2 days after the **Festival date** (or after **Send on** when no festival date is given).
- **All other broadcasts:** 14 days after they were approved.

> **Important:** Because of the 14-day rule, do not approve a broadcast with a **Send on** date more than 14 days away. Its messages would expire before the date arrives. Approve it closer to the day instead.

### Archive or delete

Campaigns, broadcasts and templates can be removed from their lists in two ways. The app chooses which one is offered:

`Anything depends on it? No → Delete (gone for good) · Yes → Archive (hidden, can Restore)`

- **Delete** (the red dustbin) is offered only when nothing depends on the item: a campaign with no donations and no broadcasts, a broadcast that is a draft or never sent anything, a template no message or broadcast has used. It is removed for good. Deleting a template also deletes it in Twilio, so WhatsApp can no longer send it.
- **Archive** is offered for everything else. The item disappears from its list and from the dropdowns, but the Queue, contact histories and campaign totals still show it. Turn on **Show archived** and click **Restore** to bring it back.
- A broadcast still sending, or a template used by waiting messages, cannot be archived until those messages are sent or cancelled.

## 4. Overview page

The first page of the workspace. It is a dashboard: nothing on it changes data except the **Send waiting messages now** button.

### What you see

| Item | Meaning |
|---|---|
| Contacts · WhatsApp opt-in | The number of contacts, and how many can be reached on WhatsApp. |
| **Contacts by segment** tiles | One tile per segment with its count. Click a tile to open Contacts filtered to that segment. |
| **Needs attention** | Broadcast drafts waiting for approval (with a **Review** link), messages **held** (with **See why**), messages that **failed** (with **Retry**), and message types that have no approved template yet. |
| Sent in the last 7 days · waiting | How many messages went out this week and how many are waiting in the Queue. |
| **Send waiting messages now** | Sends everything that is ready right now instead of waiting for the background run (every 5 minutes). Keep the tab open until the window says it is done. |

If the page says the workspace needs a **one-time setup**, or that the **donor Google Sheet’s columns are not in the order the app expects**, ask the administrator (see chapter 15). Nothing can be read or sent until it is fixed.

**Do**

- ✓ Check **Needs attention** every day you work in the app.
- ✓ Click **See why** on held messages and fix the cause (usually an opt-in, a phone number or a missing value).
- ✓ Ignore “No approved template yet for: Welcome, Thank-you” – those types are no longer used.

**Don’t**

- ✗ Don’t click **Send waiting messages now** repeatedly; once is enough, then let it finish.
- ✗ Don’t edit the donor Google Sheet by hand to “fix” the setup or column message.

## 5. Contacts page

The list of everyone you communicate with: donors, potential donors and the test group.

### The list

- **Search** looks in name, organisation, phone, email, city and tags.
- **Segment** filters to one segment. **Active only** (on by default) hides deactivated contacts. **WhatsApp opt-in** and **Email opt-in** switches show only contacts who opted in.
- Columns: Name (with type and tags), Segment, Phone (with the WhatsApp opt-in badge: opt-in, no opt-in, replied STOP or no phone), Email (with the email opt-in badge), City, **Last communicated** (the last message that went out or conversation logged, and when), Org, Reference.
- Use **Rows per page** and **Prev / Next** at the bottom to move through long lists. The app remembers your rows-per-page choice.
- Click the green **pencil** at the end of a row to open the contact.

### Adding or editing a contact

Click **Add contact** for a new person, or the pencil to edit. The window closes only with the **×** in its corner or its **Cancel / Close** button, so a stray click outside it does not lose your typing. Fields marked * are required.

| Field | What to enter |
|---|---|
| **Name** * | Full name of the person, or the contact person of an organisation. |
| **Org** | Company, foundation or trust. |
| **Phone (WhatsApp, optional)** | A 10-digit Indian mobile number (a 0, 91 or +91 in front is fine), or a foreign number with + and the country code, e.g. +44 7911 123456. Two contacts cannot share a phone number. |
| **WhatsApp opt-in** | Switch on only when the person agreed to receive WhatsApp messages. Needs a phone number. |
| **Email** | Email address. |
| **Email opt-in** | Switch on only when the person agreed to receive email. Needs an email address. The date and who recorded it are kept. |
| **Reference** | Who referred them. |
| **Type** | Individual, Corporate CSR, Foundation, Trust, or your own word. |
| **City**, **Language** | Language is a code such as `en` (default) or `hi`; for your records. |
| **Segment** * | See chapter 3. A new contact starts in the segment the list is filtered to, otherwise P2. |
| **How they came to us** / **Reason for a segment change** | For a new contact, the source. When editing, a short reason if you change the segment; it is saved in Segment history. |
| **Tags** | Type a tag and press Enter; suggestions show tags already in use. Click × on a tag to remove it. |
| **Contact owner**, **Owner email** | The Ek Tara team member responsible for this relationship (fills the `owner_name` label). |
| **Last donation date** | Normally set by **Record donation**; you can correct it here. |
| **Project**, **Core programme**, **Notes** | Free text. Project and core programme can be used as placeholders. |

### The contact window

Opening a contact shows, above the form:

- The opt-in badges for WhatsApp and email, with when and how they were recorded.
- **Record donation**: amount (₹, more than zero), date, optional campaign and a note. It updates the contact’s last donation date and amount if it is the newest donation. **No message is sent and the segment does not change** – send a thank-you with a broadcast if you want one.
- **Donations**: every donation with **Edit** and **Delete**. Changing or deleting one recalculates the last donation date and amount.
- **Deactivate / Activate again** (see chapter 3).
- **Segment history**: every segment change with its date and reason.
- **Messages**: the 10 most recent communications (the total is shown) – messages sent, replies **Received**, and conversations **Logged**.
- **+ Log a call or conversation**: choose how (Phone call, In-person meeting, WhatsApp chat, Email, Other), when (not in the future) and what was discussed (up to 2,000 characters). Nothing is sent to the contact; it is for your records and updates **Last communicated**. A logged entry can be deleted from the list.

### Uploading contacts from a CSV file

Use **Upload CSV** to add or update many contacts at once, for example from an Excel sheet saved as CSV (UTF-8). **Sample CSV** downloads an empty file with the right headers and explains each column.

1. Click **Sample CSV**, then **Download empty CSV**, and open it in Excel.
2. Fill one row per contact. **name** and **segment** are required; everything else is optional.
3. Save as **CSV UTF-8**, then click **Upload CSV** and choose the file.
4. Read the result card: how many were **added**, **updated** and **rejected**, with the row number and reason for each rejected row. Fix those rows and upload again.

| Column | What to put | Also accepted as |
|---|---|---|
| **name** * | Full name | donor name, donor |
| **segment** * | P0, P1 … P5, D1 or D2 | – |
| org | Company, foundation or trust | organisation, organization, company |
| contact number | Phone for WhatsApp; used to match an existing contact | phone, contact, mobile, phone number, whatsapp |
| email | Email; matches an existing contact when there is no phone | – |
| whatsapp_opt_in | yes or no (yes needs a phone) | opt in, optin |
| email_opt_in | yes or no (yes needs an email) | email opt-in, email optin |
| contact_status | active or inactive (blank = active) | contact active, active |
| city, language | City; language code (blank = en) | – |
| tags | Several separated by ; e.g. csr; education | tag, labels |
| source | How they came to us | source note, how they came to us |
| reference | Who referred them | referred by, referral |
| donor status | e.g. Individual, Corporate CSR | status |
| owner, owner_email | Ek Tara contact owner and their email | owner name |
| project, core programme | Free text | programme, core program |
| last donation date | e.g. 2026-11-18 or 18/11/2026 | – |
| notes | Free text | note |

- A row is matched to an existing contact by **phone**, or by **email** when it has no phone. Matched contacts are updated; others are added.
- **Blank cells leave existing values unchanged**, so you can upload a file with only a few columns.
- A segment change made by an upload is recorded in Segment history as “CSV import”.
- The same phone (or email) twice in one file: the second row is rejected.
- There is **no donation amount column**. Record donations in the app so `amount` and campaign totals are right.

**Do**

- ✓ Record every opt-in honestly: switch it on only when the person agreed, and only for the channel they agreed to.
- ✓ Put the team’s own phones and emails in **P0** and keep them opted in, so you can test every broadcast.
- ✓ Record donations with **Record donation**, linked to the right campaign.
- ✓ Deactivate people who should no longer be contacted instead of trying to delete them.
- ✓ Log important calls and meetings so colleagues see the full story.

**Don’t**

- ✗ Don’t switch on WhatsApp opt-in for someone who replied STOP unless they clearly asked to hear from you again.
- ✗ Don’t give two contacts the same phone number, and don’t use a shared office number as a donor’s number.
- ✗ Don’t put an amount in the CSV expecting it to fill `amount`; it is ignored.
- ✗ Don’t edit contacts directly in the Google Sheet.

## 6. Campaigns page

A campaign is an appeal or project, such as a school library fund. Donations and broadcasts can be linked to it. Linking a broadcast to a campaign does **not** add the campaign’s donors to the audience; it only fills the campaign placeholders and groups the broadcast with the campaign.

### The list

- Columns: Campaign, Status (Planned, Running, Closed, with a green **Results ready** label when the campaign has a results text), Starts, Ends, **Donors** (how many contacts gave to it), **Raised** (total of linked donations), **Broadcasts** (a button listing every broadcast linked to it, with drafts to approve).
- **Search** by name or status. **Show archived** appears when something is archived. **Rows per page** and **Prev / Next** at the bottom.
- Actions per row: the green **pencil** to edit, and **Delete** (dustbin) or **Archive** / **Restore**.

### Campaign fields

| Field | Meaning |
|---|---|
| **Name** | Required. Shown to donors when a template uses `campaign_name`. |
| **Starts**, **Ends** | Dates of the appeal, for your records. |
| **Status** | Planned, running or closed. |
| **Progress text** | Fills the `campaign_progress` placeholder, e.g. “We have raised ₹3 lakh of ₹5 lakh.” |
| **Results text** | Fills the `campaign_result` placeholder, e.g. “The library opened on 1 December with 400 books.” |

The green **Results ready** label appears by itself as soon as the campaign has a **Results text**; there is no button to press. Nothing is sent: to tell donors, write a broadcast linked to the campaign whose template uses `campaign_result`.

**Do**

- ✓ Create the campaign before recording its donations, so they can be linked.
- ✓ Keep the progress and results texts short, as one paragraph, because they go inside WhatsApp messages.
- ✓ Archive old campaigns to keep the dropdowns short.

**Don’t**

- ✗ Don’t expect a linked campaign to choose who receives a broadcast; choose segments for that.
- ✗ Don’t type line breaks into the progress or results text; a placeholder value must be one paragraph.

## 7. Templates page

Every WhatsApp message uses an approved template. A template is written once, approved by Meta, and then used by many broadcasts with different values.

### The list

- Columns: Name (with an **Image** or **PDF** chip for media templates), Type, Lang, Status (Draft, Pending Meta, Approved, Rejected with the reason), Message.
- The message is **collapsed**: click **Show message** to see the text and its labels. The number of placeholders is shown.
- **Search** looks in name, message text, type, language and status, even while messages are collapsed.
- Buttons: **Import from Twilio**, **Check status now**, **Request template**. Per row: **Type & labels**, **Retry submit** (for drafts), **Delete** (dustbin) or **Archive** / **Restore**.

### Requesting a template

| Field | What to enter |
|---|---|
| **Name** | Lowercase letters, digits and underscores, e.g. `donor_diwali_2026`. `donor_` is added if you leave it out. It cannot be changed after submitting, and must be unique per language. |
| **Language** | The language the message is written in. |
| **Message type** | General update, Special update, Festive greeting, “A year ago you helped” … It sets the rule code and email subject of the broadcasts that use it (see chapter 3). Any approved template can be used in any broadcast. |
| **Category** | Utility is the default. Meta treats **Utility** as messages about something the person did or asked for (a receipt, a donation confirmation). General updates, greetings and appeals are **Marketing** to Meta, which may reject or re-classify a Utility template with that content. |
| **Attachment** | None (text only), **Image** (PNG or JPG, up to 5 MB) or **PDF** (up to 16 MB). For a media template, paste the Google Drive link of a **sample file**; WhatsApp reviews it. Each broadcast can attach a different file of the same kind. |
| **Message body** | Up to 1,024 characters. Use `{{1}}`, `{{2}}` … for values. Don’t start or end the message with a placeholder, and don’t put two placeholders next to each other. |
| **Placeholders** | For each placeholder, a **label** (pick an automatic one from the suggestions or type your own) and a **sample value** that Meta sees during review (it is never sent to donors). |

**Submit to WhatsApp** sends it to Meta through Twilio. The status becomes **Pending Meta**; approval usually takes minutes to a day. The app checks automatically; **Check status now** asks immediately. After 48 hours a note suggests checking in Twilio. A **Rejected** template shows Meta’s reason: fix the text and request a new template (with a new name). **Draft** means the submission itself failed; use **Retry submit**.

### Other template actions

- **Import from Twilio** brings in templates that already exist in the Twilio account (text, quick-reply, and image/PDF templates whose file address matches the app’s Drive address). Imported media templates are marked as Image; change it to PDF if needed. After importing, set each template’s **Type & labels**.
- **Type & labels** changes only how the app uses the template: its message type, the placeholder labels, and Image ↔ PDF. Nothing is sent to Twilio or WhatsApp, and the wording cannot be changed (that needs a new template).
- **Delete** removes an unused template here **and in Twilio**. A template that has been used can only be archived; an archived template is not offered in broadcasts.

### Attachments from Google Drive

- In Google Drive, open the file’s **Share** settings, set **General access** to **Anyone with the link** (Viewer) and copy the link.
- The app checks the file the same way WhatsApp will fetch it: it must open without signing in, be the right kind, and be within the size limit.
- Keep the file shared for as long as the broadcast is sending; emails download it again when they go out.

> **Important:** Known limitation: Google Drive delivers some PDF files with a generic file type (`application/octet-stream`) instead of PDF. The app then refuses the file with “The file must be a PDF (this one is application/octet-stream)”, even when the file really is a PDF. Images are not affected. Until this is handled in the app, use an image or ask the administrator.

**Do**

- ✓ Write one good template per purpose and reuse it with different values, e.g. a general update with a `message` label.
- ✓ Choose labels carefully before submitting; automatic labels save typing on every broadcast.
- ✓ Choose **Marketing** for updates, appeals and greetings.
- ✓ Archive templates you no longer use.

**Don’t**

- ✗ Don’t put names, amounts or dates that change into the fixed text – use placeholders.
- ✗ Don’t delete a template that broadcasts may still need; deleting also removes it from Twilio.
- ✗ Don’t use a Drive file that is shared only with specific people; WhatsApp cannot open it.

## 8. Broadcasts page

A broadcast sends one approved template to the contacts of one or more segments. Nothing goes out until someone approves it.

### The list

- Columns: Name (with the template), Campaign, Send on, Status (**Needs approval**, Approved, Cancelled), **Progress** (sent, waiting, failed, replies) with a **View messages** button.
- Actions per row: **Review & approve** (drafts), **Cancel unsent** (approved broadcasts with messages still waiting), **Delete** (dustbin) or **Archive** / **Restore**.
- **Search** by name, campaign or status; **Show archived**; **Rows per page** and **Prev / Next**.
- **View messages** shows, under its title, the template, the campaign, **who created** the broadcast and **who approved** it, with the dates. It lists every message of the broadcast: the contact (segment first, then the name), channel, status and time, sent time, and the reason, error or reply. Filter with the **All / Sent / Waiting / Failed / Replies** chips or search by name; **Open in Queue** shows them in the Queue.

### Writing a broadcast

Click **New broadcast** (or **Review & approve** on a draft) and fill the form:

| Field | What it does |
|---|---|
| **Name** | For the team only; donors never see it. Needed to save or approve. |
| **Template** | Every approved template is offered, grouped by message type. Archived templates are not. The template’s type decides how it is sent: General update → T8, Festive greeting → T12, anything else → Special update (T11). |
| **Send on** | Empty: messages go out as soon as it is approved. A date: they wait in the Queue and go out on that day. Keep it within 14 days (see chapter 3). |
| **Festival date** | Shown only for a Festive greeting template. It does not decide when the greeting is sent; it is the expiry: anything not sent within 2 days after the festival is dropped as **Skipped**. Empty: Send on + 2 days. |
| **Campaign** | Optional. Fills `campaign_name`, `campaign_progress` and `campaign_result`, and groups the broadcast under the campaign. It does **not** add donors. |
| **Also send to these segments** | Tick the segments that should receive it. Only active contacts who can be reached are included. |
| **Tags in the chosen segments** | Leave contacts out by tag (see chapter 3). The number on each chip is how many contacts have that tag. |
| **Values for this send** | One box per placeholder, numbered `{{1}}`, `{{2}}` … Type your own labels’ values here. Boxes marked “from each contact’s record” fill themselves; type there only as a fallback for contacts whose record is empty. For a media template, paste the Drive link of the image or PDF under **Attachment**. |

### Preview, Save draft and Approve

| Button | What happens |
|---|---|
| **Preview** | Shows the check (below) without saving anything. Close the window and nothing is left behind. |
| **Save draft** | Saves the broadcast to the Broadcasts list as **Needs approval** and shows the preview. Use it to hand over to a colleague or finish later. |
| **Approve and send now** / **Approve and schedule for …** | Saves exactly what was previewed and approves it. The messages are created in the Queue and, unless scheduled, sent straight away while a window shows the progress. |

The preview card, **Check before approving**, shows:

- How many people get it: by WhatsApp, by email, and how many in the chosen segments are left out because they have neither opt-in or because of the tag filter. Someone with both opt-ins gets both.
- A **sample** of the real message for the first person, with the image or a link to the PDF for media templates.
- Anything **missing**, in red, for example “{{2}} (amount) is empty for 3 donor(s)”. Approval is blocked until it is fixed.
- The **Recipients** per segment (for example “P1 4/20”: 4 of the 20 in P1 get it) and, under **Details**, every name with their WhatsApp and email status.
- The **WhatsApp** and **Email** switches: turn a channel off to send by the other only. At least one must be on.

> **Note:** If you change anything in the form after previewing, the Approve button locks with “Changed since the preview: click Preview again before approving.” This makes sure you always approve exactly what you checked.

### After approval

- Keep the tab open while the sending window is shown. If you close it, the background job sends the rest within a few minutes.
- Watch **Progress** and **View messages**. Delivery and read statuses arrive over the following minutes.
- **Cancel unsent** stops the messages that have not gone yet; messages already sent stay sent.
- Emails from a staff member’s session go from the project owner’s account with the next background run (within about 5 minutes).

### Testing with P0 first

1. Write the broadcast and tick **only P0**. Preview, then approve.
2. Check the WhatsApp message and the email on the test phones: text, values, image or PDF.
3. Open the broadcast again or write it again with the real segments, preview and approve.

A sent test broadcast can be **archived** to tidy the list (it cannot be deleted, because messages went out).

**Do**

- ✓ Always test a new template on P0 first.
- ✓ Read the sample text in the preview carefully, including names and amounts.
- ✓ Fix every red “missing” line before approving: record donations or type a fallback value.
- ✓ Use **Send on** for a specific day, and set the **Festival date** for festive greetings.
- ✓ Use the tag filter to leave out people who should not receive a particular message.

**Don’t**

- ✗ Don’t approve a broadcast you have not previewed in its final form.
- ✗ Don’t schedule more than 14 days ahead; the messages would expire.
- ✗ Don’t expect the campaign link to choose recipients.
- ✗ Don’t send the same message twice by approving a copy; check **View messages** first.
- ✗ Don’t close the browser while the sending window is open unless you have to.

## 9. Queue page

The Queue shows the newest 1,000 donor messages of every kind and what happened to each one. It is the place to check delivery, find out why something did not go, and see replies.

### Columns

| Column | Shows |
|---|---|
| **Contact** | The segment (P0, P1 …) and the name. |
| **Message** | The message type, then the rule code (T8, T11 …) and the channel (WhatsApp, or Email to the address). For a reply: “↩ Reply on WhatsApp to <broadcast>”. |
| **Campaign**, **Broadcast** | The campaign and broadcast the message belongs to, or “—”. |
| **Status** | See the status table in chapter 3. |
| **Why / details** | The hold reason, the WhatsApp or email error, “Scheduled for …”, and the reply text in quotes. |
| **Updated** | When the message last changed. |
| Actions | **Cancel** for queued or held messages; **Retry** for failed ones. |

### Why a message is held, cancelled or skipped

| Reason shown | What to do |
|---|---|
| Held – No WhatsApp opt-in recorded | Record the opt-in on the contact if they agreed; otherwise leave it or cancel it. |
| Held – No phone number on the contact | Add the phone number. |
| Held – No approved <type> template | Request (or wait for approval of) a template of that type. |
| Held – Missing {{n}} (label) | Fill the missing value (e.g. record the donation) – the app retries on its own. |
| Held – Daily email limit of this Google account reached | Nothing; it tries again later. |
| Skipped – Expired before it could be sent | It waited too long. Write a new broadcast if it is still relevant. |
| Skipped – No WhatsApp opt-in: sent by email only | Nothing; the email copy went. |
| Cancelled – Contact is inactive / Donor opted out of WhatsApp / Donor replied STOP / Email opt-in removed | Expected; the person should not be messaged on that channel. |

### Search and buttons

- **Search** matches the contact, campaign, broadcast and status (for example “held”, “failed”, “received”).
- **Send waiting messages now** sends what is ready.
- **Retry** puts a failed message back in the queue and sends it. Fix the cause first (number, file sharing, template).

**Do**

- ✓ Check failed messages and read the error before retrying.
- ✓ Search “received” to see recent replies, and answer important ones personally.
- ✓ Cancel messages that should no longer go out.

**Don’t**

- ✗ Don’t retry the same failed message many times without changing anything.
- ✗ Don’t worry about logged conversations: they are on the contact, not in the Queue.

## 10. Email

- Contacts with **email opt-in** and an address get an email copy of each broadcast message, unless the broadcast was approved with **Email** switched off.
- The email has the same text as the WhatsApp message (bold and italics kept, links clickable) and a short footer saying why they receive it and how to stop.
- The subject depends on the type: “An update from Ek Tara”, “A special update from Ek Tara”, “Warm wishes from Ek Tara”, “A year ago, you helped”.
- For media templates, an **image** appears inside the email above the text, and a **PDF** is attached with its file name. If the file cannot be downloaded from Drive when the email goes, that email **fails** with the reason instead of going without it.
- Emails are always sent from the **project owner’s Google account** (sender name “Ek Tara”). When someone else approves, the emails go with the next background run.
- Google limits how many emails an account can send per day. When the limit is reached, emails wait as held and go later.

## 11. Replies, STOP and START

- When a donor replies on WhatsApp, the reply is saved as its own **Received** entry linked to the message it answers (the one they replied to, or otherwise their latest WhatsApp message from the last 7 days). Every reply is kept.
- Replies appear in the **Queue**, in the contact’s **Messages** and under **Replies** in a broadcast’s View messages. The broadcast’s Progress counts them (“2 replies”).
- A reply never changes the status of the message that was sent and does not change “Last communicated”.
- **STOP** words (stop, stop all, unsubscribe, opt out) mark the donor as opted out of WhatsApp and cancel their waiting WhatsApp messages. Email is not affected.
- **START** words (start, unstop, subscribe) turn WhatsApp opt-in back on.
- The app does not answer replies automatically. Reply personally from WhatsApp when needed, and use **Log a call or conversation** to record it.

## 12. Step-by-step recipes

#### Send a festive greeting

1. Templates: make sure there is an approved **Festive greeting** template (for example with `donor_name`).
2. Broadcasts → **New broadcast**: choose the festive template (the **Festival date** box then appears).
3. Set **Send on** to the day you want it to go and **Festival date** to the festival.
4. Tick **P0**, **Preview**, approve, and check the test phones.
5. Repeat with the real segments, use the tag filter if needed, preview and approve.

#### Tell donors a campaign’s results

1. Campaigns: edit the campaign, write the **Results text** and save. The **Results ready** label appears.
2. Broadcasts → **New broadcast**: a template whose labels include `campaign_result` (and perhaps `donor_name`), and choose the campaign in **Campaign**.
3. Tick the segments of the people who gave (for example D2 and P5), preview, test on P0, approve.

#### Send the “A year ago you helped” update

1. Templates: make sure there is an approved template with the type **“A year ago you helped” update**, using labels that fill themselves (for example `donor_name`, `amount`, `last_donation_date`).
2. Broadcasts → **New broadcast**: choose that template and tick **P4** (or the segments you want). Use the tag filter to narrow it down.
3. Unlike the old automatic T7 rule, the broadcast goes to everyone in the chosen segments, not only to those whose donation was 11 months ago. Check the list under **Details** in the preview.
4. Test on P0, preview and approve.

#### Thank recent donors

1. Record each donation with **Record donation** on the contact (this fills `amount` and `last_donation_date`).
2. Use a Special update template with `donor_name` and `amount`, and send it to the right segment, filtered by tag if needed.
3. If the preview says `amount` is empty for some donors, record their donation, or type a fallback such as “your gift” under Values for this send.

#### Send a PDF or an image

1. Request a template with **Attachment** set to Image or PDF and a sample file link; wait for approval.
2. Share the file to send as **Anyone with the link** and copy the link.
3. In the broadcast, paste the link under **Attachment** in Values for this send, preview (the image or a PDF link appears in the sample) and test on P0.

#### Add donors from Excel

1. Contacts → **Sample CSV** → **Download empty CSV**.
2. Copy your data into the matching columns; set **segment** for every row and **whatsapp_opt_in** / **email_opt_in** only for people who agreed.
3. Save as CSV UTF-8 and **Upload CSV**. Fix and re-upload rejected rows.

#### A donor asks to stop

1. If they replied STOP on WhatsApp, the app has already recorded it.
2. If they asked in another way, open the contact and switch **WhatsApp opt-in** and/or **Email opt-in** off, or **Deactivate** them to stop everything.
3. Use **Log a call or conversation** to note the request.

#### Fix a held message

1. Queue → search “held” and read the reason.
2. Fix the cause on the contact, template or broadcast.
3. Wait for the next run (about 5 minutes) or click **Send waiting messages now**.

## 13. Troubleshooting

| You see | It means | What to do |
|---|---|---|
| “{{2}} (amount) is empty for N donor(s). Type it under Values for this send…” | Those contacts have no value for that label. | Record the data (e.g. the donation) or type a fallback value, then Preview again. |
| “No approved template yet” in the Template list | No template is approved (or every approved one is archived). | Request one, check its status, or restore an archived one. |
| A template is missing from the broadcast’s Template list | It is not approved yet, or it is archived; or the app in use is an older version. | Check its status on the Templates page; ask the administrator to deploy the latest files. |
| “WhatsApp cannot open this file…” | The Drive file is not shared publicly. | Share it as Anyone with the link (Viewer) and paste the link again. |
| “The file must be a PDF (this one is application/octet-stream)” | Google Drive gives the PDF a generic type (see chapter 7). | Use an image, or ask the administrator. |
| “The file is X MB; WhatsApp allows up to …” | Too large (image 5 MB, PDF 16 MB). | Compress the file or use a smaller one. |
| “Changed since the preview: click Preview again before approving.” | The form changed after the preview. | Click Preview, check, then approve. |
| “Nobody in the audience has a WhatsApp or email opt-in.” | Everyone chosen is unreachable. | Check the segments, tags and opt-ins. |
| “This campaign cannot be deleted. It has 3 donations…” | It has history. | Archive it instead. |
| Many messages Failed with a Twilio error | WhatsApp refused them (number not on WhatsApp, template issue, file not reachable). | Read the error in Why / details, fix, then Retry. |
| Emails waiting after approval | Emails go from the owner’s account. | Wait about 5 minutes for the background run. |
| “The donor Google Sheet’s columns are not in the order the app expects.” | The sheet was edited by hand or the app was updated. | Ask the administrator to run setup. |
| “Some files in the project are out of date” | The app’s files are from different versions. | Ask the administrator to update all files. |

## 14. Golden rules

**Do**

- ✓ Test every new message on **P0** before sending it to donors.
- ✓ Message only people who agreed, on the channel they agreed to.
- ✓ Always **Preview** and read the sample before approving.
- ✓ Record donations in the app, linked to their campaign.
- ✓ Share attachment files as **Anyone with the link** and keep them shared.
- ✓ Choose **Marketing** for updates, appeals and greetings.
- ✓ Archive old campaigns, broadcasts and templates instead of letting lists grow.
- ✓ Log important calls and meetings on the contact.
- ✓ Check **Needs attention** and the Queue for held and failed messages.

**Don’t**

- ✗ Never edit, move or delete columns in the donor Google Sheet.
- ✗ Never switch on an opt-in that the person did not give.
- ✗ Don’t schedule a broadcast more than 14 days ahead.
- ✗ Don’t approve twice to “make sure”; check View messages instead.
- ✗ Don’t delete templates that may still be needed – it also deletes them in Twilio.
- ✗ Don’t share the app or the Google Sheets with people outside the team.

## 15. For the administrator

### The app’s files

The Apps Script project has four server files – **Shared.gs**, **Parent.gs**, **Donor.gs**, **Admin.gs** – and six page files – **Index**, **Styles**, **JsCore**, **JsParent**, **JsDonor**, **JsAdmin**. Donor Communication lives in **Donor.gs** and **JsDonor**; the donor sheet columns are listed in **Shared.gs** (`SCHEMA`).

### After an update

1. Paste the changed files into the Apps Script editor (names must match exactly). Never keep an old **Code.gs** next to the new files.
2. If the update added or changed donor sheet columns, run **setup()** from the editor straight away. It adds the new columns; if a tab’s columns are out of order it rearranges them by header name, keeps a backup copy of the tab named “… (before reorder <date>)”, and keeps columns the app no longer uses on the right.
3. Deploy a **new version** on every web address in use (the staff app, and the Twilio address if used).
4. Hard-refresh the browser (Ctrl+Shift+R) and open the donor Overview.

### Good to know

- The background job (**cronTick**) runs every 5 minutes: it sends waiting messages and fetches delivery statuses and replies. No rule creates messages on its own (T7 was turned off).
- Donor emails are sent from the project owner’s account.
- If the page and server come from different versions, administrators see a warning naming the file that is out of date.
- The backup tabs created by setup can be deleted once everything works.
- Access is managed under **Users and access**; saving a person also shares or unshares the Google Sheets.

## 16. Glossary

| Word | Meaning |
|---|---|
| Broadcast | One message (template + values) sent to the contacts of chosen segments after approval. |
| Campaign | An appeal or project that donations and broadcasts are linked to. |
| Opt-in | The contact’s permission to receive WhatsApp or email. |
| Placeholder | A numbered gap in a template, such as {{1}}, filled with a value for each contact. |
| Label | The name of a placeholder; it decides where the value comes from. |
| Segment | The group a contact belongs to (P0–P5, D1, D2). |
| Template | A message design approved by Meta for WhatsApp. |
| Meta | The company behind WhatsApp, which approves templates. |
| Twilio | The service the app uses to send WhatsApp messages. |
| Queue | The list of all donor messages and their statuses. |
| Archive | Hide an item that has history; it can be restored. |
| T8, T11, T12 | Rule codes: T8 general, T11 special and T12 festive broadcasts. T7 (the old automatic year-ago update) is turned off; older messages may still show it. |
