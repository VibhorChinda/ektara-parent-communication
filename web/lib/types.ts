export type TemplateStatus = "draft" | "pending_meta" | "approved" | "rejected";

export type Template = {
  id: string;
  name: string;
  language: string;
  category: "UTILITY" | "MARKETING";
  body: string;
  variable_names: string[];
  sample_values: Record<string, string>;
  has_confirm_buttons: boolean;
  status: TemplateStatus;
  rejection_reason: string | null;
  created_at: string;
};

// A template decision the requester has not seen yet.
export type TemplateNotice = Pick<Template, "id" | "name" | "language" | "status" | "rejection_reason">;

export type InstitutionType = "school" | "college";

// One point in the hierarchy. null = "all" at that level.
export type Audience = {
  institution: string;
  class_or_year: string | null;
  section: string | null;
};

// A school class/section or college year, with the parents a campaign would reach.
export type Group = {
  institution: string;
  institution_type: InstitutionType;
  class_or_year: string;
  section: string | null;
  parent_count: number;
  whatsapp_count: number;
  languages: Record<string, number>;
};

export type Counts = Record<string, number>;

export type Campaign = {
  id: string;
  template_id: string;
  audience: string;
  institution: string;
  class_or_year: string | null;
  section: string | null;
  variables: Record<string, string>;
  status: "sending" | "sent" | "failed" | "cancelled";
  created_at: string;
  template_name: string;
  sender: string | null;
  counts: Counts;
};

export type Message = {
  id: string;
  status: string;
  wa_error: string | null;
  call_status: string | null;
  call_digit: string | null;
  call_requested_at: string | null;
  call_due_at: string | null;
  confirmed_via: "whatsapp" | "voice" | "admin" | null;
  reply_text: string | null;
  replied_at: string | null;
  wa_sent_at: string | null;
  updated_at: string;
  parents: {
    parent_name: string;
    child_name: string | null;
    phone_e164: string;
    has_whatsapp: boolean;
    opted_out: boolean;
    language: string;
  };
};

export type MessageEvent = {
  id: number;
  source: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type CampaignDetail = Campaign & {
  template_body: string;
  template_has_buttons: boolean;
  messages: Message[];
};

export type Parent = {
  id: string;
  parent_name: string;
  phone_e164: string;
  child_name: string | null;
  institution: string;
  institution_type: InstitutionType;
  class_or_year: string;
  section: string | null;
  language: string;
  has_whatsapp: boolean;
  opted_out: boolean;
  created_at: string;
  stats: { total: number; responded: number; flagged: number };
};

export type HistoryItem = {
  id: string;
  status: string;
  confirmed_via: Message["confirmed_via"];
  reply_text: string | null;
  updated_at: string;
  campaigns: { id: string; audience: string; created_at: string; templates: { name: string } };
};

export type AppInfo = {
  call_fallback_hours: number;
  call_window_start: string;
  call_window_end: string;
  timezone: string;
  cost_per_whatsapp: number;
  cost_per_call: number;
  currency: string;
};
