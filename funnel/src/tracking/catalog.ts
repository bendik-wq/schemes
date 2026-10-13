// Event catalog: which events exist, which the browser may send, and how each maps to ad platforms.

export interface EventDef {
  /** Meta standard or custom event name; omitted = not sent to Meta. */
  meta?: string;
  /** GA4 event name; omitted = not sent to GA4. */
  ga4?: string;
  /** Browser may send it via /api/e. */
  client?: boolean;
  /** Stored locally, never forwarded anywhere. */
  micro?: boolean;
}

export const EVENTS: Record<string, EventDef> = {
  // Lifecycle (server)
  page_view: { meta: "PageView", ga4: "page_view" },
  lead_captured: { meta: "Lead", ga4: "generate_lead" },
  app_step: { meta: "StartApplication", ga4: "app_step" }, // Meta: first step per lead only (forward.ts)
  app_submitted: { meta: "SubmitApplication", ga4: "app_submitted" },
  lead_qualified: { meta: "QualifiedLead", ga4: "qualify_lead" },
  booking_scheduled: { meta: "Schedule", ga4: "booking_scheduled" },
  booking_rescheduled: { ga4: "booking_rescheduled" },
  booking_cancelled: { ga4: "booking_cancelled" },
  booking_claimed: { micro: true },
  call_showed: { meta: "CallShowed", ga4: "call_showed" },
  call_no_show: { meta: "NoShow", ga4: "call_no_show" },
  deal_won: { meta: "Purchase", ga4: "purchase" },
  deal_lost: { meta: "DealLost", ga4: "deal_lost" },
  payment_recorded: { meta: "CashCollected", ga4: "payment" }, // Meta: "Refund" when negative (forward.ts)
  lead_status_changed: { ga4: "lead_status_changed" }, // Meta: "Disqualified" only (forward.ts)
  unsubscribed: {},
  consent_set: { micro: true },
  continue_link_sent: { micro: true },

  // Email / WhatsApp / AI calls
  email_sent: { micro: true },
  email_opened: {},
  email_clicked: {},
  whatsapp_click: { ga4: "whatsapp_click", client: false },
  whatsapp_in: {},
  link_click: { ga4: "link_click" },
  ai_call_queued: { micro: true },
  ai_call_started: {},
  ai_call_completed: {},
  ai_call_unanswered: {},
  inbound_call: {},
  trigger_fired: { micro: true },

  // VSL (server-derived from heartbeats)
  vsl_play: { ga4: "video_start" },
  vsl_unmute: { ga4: "vsl_unmute" },
  vsl_25: { meta: "VideoView25", ga4: "video_progress" },
  vsl_50: { meta: "ViewContent", ga4: "video_progress" },
  vsl_75: { ga4: "video_progress" },
  vsl_95: { ga4: "video_progress" },
  vsl_complete: { ga4: "video_complete" },
  vsl_cta_reveal: { meta: "VSLPitchReached", ga4: "vsl_cta_reveal" },
  vsl_cta_click: { ga4: "vsl_cta_click", client: true },
  vsl_rewatch: { micro: true, client: true },
  vsl_skip: { micro: true, client: true },
  vsl_pause: { micro: true, client: true },
  vsl_speed: { micro: true, client: true },
  vsl_volume: { micro: true, client: true },
  vsl_fullscreen: { micro: true, client: true },
  vsl_restart: { micro: true, client: true },

  // Deep on-page (client, local only)
  click: { micro: true, client: true },
  cta_click: { micro: true, client: true },
  cta_hover: { micro: true, client: true },
  field_interaction: { micro: true, client: true },
  tab_return: { micro: true, client: true },
  text_select: { micro: true, client: true },
  text_copy: { micro: true, client: true },
  section_dwell: { micro: true, client: true },
  section_revisit: { micro: true, client: true },
  page_exit: { micro: true, client: true },
  first_interaction: { micro: true, client: true },
  scroll: { micro: true, client: true },
  engaged: { micro: true, client: true },
  rage_click: { micro: true, client: true },
  exit_intent: { micro: true, client: true },
  faq_open: { micro: true, client: true },
  app_back: { micro: true, client: true },
  // Application form analytics (client, local only; never field values)
  app_view: { micro: true, client: true },
  app_step_view: { micro: true, client: true },
  app_step_done: { micro: true, client: true },
  app_error: { micro: true, client: true },
  slot_view: { micro: true, client: true },
  slot_pick: { micro: true, client: true },
  slot_booked: { micro: true, client: true },
  slot_failed: { micro: true, client: true },
  // Page health and engagement (f.js, vsl.js, book.js)
  cwv: { micro: true, client: true },
  js_error: { micro: true, client: true },
  consent_banner_shown: { micro: true, client: true },
  vsl_error: { micro: true, client: true },
  vsl_stall: { micro: true, client: true },
  vsl_soft_cta: { micro: true, client: true },
  booking_embed_failed: { micro: true, client: true },
  attendance_confirmed: { micro: true },
  requalify_started: { micro: true },
  booking_date_selected: { micro: true, client: true },
  booking_page_ready: { micro: true, client: true },
};

export const MICRO_EVENTS = new Set(Object.entries(EVENTS).filter(([, d]) => d.micro).map(([k]) => k));
export const CLIENT_EVENTS = new Set(Object.entries(EVENTS).filter(([, d]) => d.client).map(([k]) => k));

export function isKnownEvent(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(EVENTS, name);
}
