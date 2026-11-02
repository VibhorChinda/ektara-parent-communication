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

export type Counts = Record<string, number>;

export type Campaign = {
  id: string;
  template_id: string;
  class_name: string;
  variables: Record<string, string>;
  status: "sending" | "sent" | "failed";
  created_at: string;
  template_name: string;
  counts: Counts;
};

export type Message = {
  id: string;
  status: string;
  wa_error: string | null;
  call_status: string | null;
  call_digit: string | null;
  confirmed_via: "whatsapp" | "voice" | null;
  wa_sent_at: string | null;
  updated_at: string;
  parents: {
    parent_name: string;
    child_name: string | null;
    phone_e164: string;
    has_whatsapp: boolean;
  };
};

export type CampaignDetail = Campaign & {
  template_body: string;
  template_has_buttons: boolean;
  messages: Message[];
};

export type ClassInfo = { class_name: string; parent_count: number };

export type Parent = {
  id: string;
  parent_name: string;
  phone_e164: string;
  child_name: string | null;
  class_name: string;
  language: string;
  has_whatsapp: boolean;
  opted_out: boolean;
  created_at: string;
};
