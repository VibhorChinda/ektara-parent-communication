create extension if not exists pgcrypto;

-- Users of the admin app (all have full access; no roles)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text
);

create table parents (
  id uuid primary key default gen_random_uuid(),
  parent_name text not null,
  phone_e164 text not null unique,          -- e.g. +919876543210
  child_name text,
  class_name text not null,                  -- e.g. "7-B"
  language text not null default 'en',       -- 'en','hi','ta',...
  has_whatsapp boolean not null default true,
  opted_out boolean not null default false,
  created_at timestamptz not null default now()
);
create index on parents (class_name);

create table templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,                        -- snake_case, unique per language
  language text not null default 'en',
  category text not null check (category in ('UTILITY','MARKETING')),
  body text not null,                        -- uses {{1}}, {{2}} ...
  variable_names jsonb not null default '[]',-- ["date","time","venue"], index = position
  sample_values jsonb not null default '{}', -- {"1":"12 Nov","2":"10 AM","3":"Hall A"}
  has_confirm_buttons boolean not null default true,
  status text not null default 'draft'
    check (status in ('draft','pending_meta','approved','rejected')),
  twilio_content_sid text unique,            -- HXxxxxxxxx
  rejection_reason text,
  requested_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, language)
);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references templates(id),
  class_name text not null,
  variables jsonb not null,                  -- {"1":"12 Nov","2":"10 AM","3":"Hall A"}
  created_by uuid not null references profiles(id),
  status text not null default 'sending' check (status in ('sending','sent','failed')),
  created_at timestamptz not null default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  parent_id uuid not null references parents(id),
  status text not null default 'queued'
    check (status in ('queued','sent','delivered','read','confirmed','declined','flagged','failed')),
  wa_sid text unique,                        -- Twilio message SID (SMxxxx)
  wa_sent_at timestamptz,
  wa_error text,
  call_sid text unique,                      -- Twilio call SID (CAxxxx)
  call_requested_at timestamptz,
  call_status text,
  call_digit text,
  confirmed_via text check (confirmed_via in ('whatsapp','voice')),
  updated_at timestamptz not null default now(),
  unique (campaign_id, parent_id)
);
create index on messages (status, wa_sent_at);

-- Raw webhook log: invaluable for debugging Twilio payloads
create table message_events (
  id bigserial primary key,
  message_id uuid references messages(id) on delete cascade,
  source text not null,                      -- 'whatsapp_status','whatsapp_inbound','voice_status','voice_gather','cron'
  payload jsonb not null,
  created_at timestamptz not null default now()
);

-- Create a profile row for every new auth user, so campaigns.created_by
-- and templates.requested_by can reference them.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS: any logged-in user can read everything. All writes go through the
-- backend with the service role key, which bypasses RLS.
alter table profiles enable row level security;
alter table parents enable row level security;
alter table templates enable row level security;
alter table campaigns enable row level security;
alter table messages enable row level security;
alter table message_events enable row level security;

create policy "authenticated can read" on profiles for select to authenticated using (true);
create policy "authenticated can read" on parents for select to authenticated using (true);
create policy "authenticated can read" on templates for select to authenticated using (true);
create policy "authenticated can read" on campaigns for select to authenticated using (true);
create policy "authenticated can read" on messages for select to authenticated using (true);
create policy "authenticated can read" on message_events for select to authenticated using (true);
