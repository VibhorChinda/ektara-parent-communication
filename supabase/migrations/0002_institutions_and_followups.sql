-- 0002: institutions (school -> class -> section, college -> year), opt-out and
-- admin follow-up, stored replies, cancel/resume, per-language sending,
-- template notifications and per-parent response stats.

-- ---------- Parents: institution / class_or_year / section ----------

alter table parents
  add column institution text,                -- school or college name
  add column institution_type text not null default 'school'
    check (institution_type in ('school', 'college')),
  add column class_or_year text,              -- school: class ("7", "LKG"); college: year ("1".."4")
  add column section text;                    -- school only, e.g. "B"; null if the class has one section

-- Existing rows: "7-B" becomes class "7", section "B" in a placeholder school.
-- Rename it later from the Parents page (Move) or by re-uploading the CSV.
update parents set
  institution = 'My school',
  class_or_year = split_part(class_name, '-', 1),
  section = nullif(split_part(class_name, '-', 2), '');

alter table parents
  alter column institution set not null,
  alter column class_or_year set not null,
  drop column class_name;

create index on parents (institution, class_or_year, section);

-- Deleting a parent also deletes their message history.
alter table messages
  drop constraint messages_parent_id_fkey,
  add constraint messages_parent_id_fkey
    foreign key (parent_id) references parents(id) on delete cascade;

-- ---------- Campaigns: target any level of the hierarchy ----------

alter table campaigns rename column class_name to audience;  -- display label, e.g. "Sunrise School · Class 7 · Section B"
alter table campaigns
  add column institution text,
  add column class_or_year text,              -- null = every class/year
  add column section text;                    -- null = every section

update campaigns set
  institution = 'My school',
  class_or_year = split_part(audience, '-', 1),
  section = nullif(split_part(audience, '-', 2), ''),
  audience = 'My school · Class ' || audience;

alter table campaigns alter column institution set not null;

alter table campaigns
  drop constraint campaigns_status_check,
  add constraint campaigns_status_check
    check (status in ('sending', 'sent', 'failed', 'cancelled'));

-- ---------- Messages ----------

alter table messages
  drop constraint messages_status_check,
  add constraint messages_status_check
    check (status in ('queued','sent','delivered','read','confirmed','declined','flagged','failed','cancelled'));

alter table messages
  drop constraint messages_confirmed_via_check,
  add constraint messages_confirmed_via_check
    check (confirmed_via in ('whatsapp', 'voice', 'admin'));

alter table messages
  add column template_id uuid references templates(id),  -- language version actually sent
  add column send_claimed_at timestamptz,                -- set just before sending, so a resumed campaign never sends twice
  add column reply_text text,                            -- last free-text WhatsApp reply
  add column replied_at timestamptz,
  add column resolved_by uuid references profiles(id);   -- admin who recorded the outcome after a personal call

update messages m set template_id = c.template_id from campaigns c where c.id = m.campaign_id;

create index on messages (parent_id);
create index on messages (campaign_id, status);
create index on message_events (message_id);
create index on message_events ((payload ->> 'MessageSid'));  -- dedupe recovered WhatsApp replies

-- ---------- Templates: "your template is ready" notice ----------

-- false = the requester has not seen Meta's decision yet.
alter table templates add column decision_seen boolean not null default true;

-- ---------- Profiles: email, to show who sent a campaign ----------

alter table profiles add column email text;
update profiles p set email = u.email from auth.users u where u.id = p.id;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.email);
  return new;
end;
$$;

-- ---------- Per-parent response stats ----------

-- security_invoker: the view respects the RLS policies of messages.
create view parent_response_stats with (security_invoker = true) as
select
  parent_id,
  count(*) filter (where status <> 'cancelled') as total,
  count(*) filter (where status in ('confirmed', 'declined')) as responded,
  count(*) filter (where status = 'flagged') as flagged
from messages
group by parent_id;
