-- Seed agent templates
INSERT INTO agent_templates (slug, name, industry, config) VALUES
(
  'dexter',
  'Dexter',
  'general_smb',
  '{
    "industry": "general_smb",
    "agent_name": "Dexter",
    "display": {
      "avatar": "/agents/dexter.svg",
      "specialty": "General Receptionist",
      "industries": ["General SMB", "Professional Services", "Retail"],
      "description": "Your friendly front-desk pro. Dexter answers every call with warmth, routes inquiries, and makes sure no customer feels ignored.",
      "features": ["Answer inbound calls 24/7", "Route calls", "Answer FAQs", "SMS follow-ups", "Transfer urgent calls"],
      "tagline": "The receptionist every business wishes they had."
    },
    "voice": {"retell_voice_id": "11labs-Adrian", "elevenlabs_voice_id": "pNInz6obpgDQGcFmaJgB", "default_provider": "retell"},
    "system_prompt": "You are Dexter, a professional AI receptionist for {{business_name}}.",
    "objection_handlers": [],
    "booking_rules": [],
    "escalation_rules": [],
    "faq_rules": [],
    "qualification_questions": [],
    "template_version": 1, "catalog_slug": "general-receptionist",
    "retell_llm_config": {"model": "gpt-4.1-mini", "temperature": 0.2, "tool_call_strict_mode": true}
  }'::jsonb
),
(
  'zia',
  'Zia',
  'salon_spa',
  '{
    "industry": "salon_spa",
    "agent_name": "Zia",
    "display": {
      "avatar": "/agents/zia.svg",
      "specialty": "Salon & Spa Booking Assistant",
      "industries": ["Salons", "Spas", "Beauty Studios"],
      "description": "Zia knows your services, stylists, and availability. She books appointments flawlessly.",
      "features": ["Book appointments", "Recommend services", "Handle reschedules", "SMS confirmations", "Pricing FAQs"],
      "tagline": "Your salon''s always-on booking coordinator."
    },
    "voice": {"retell_voice_id": "retell-Willa", "elevenlabs_voice_id": "21m00Tcm4TlvDq8ikWAM", "default_provider": "retell"},
    "system_prompt": "You are Zia, an AI booking assistant for {{business_name}}, a salon and spa.",
    "objection_handlers": [],
    "booking_rules": [],
    "escalation_rules": [],
    "faq_rules": [],
    "qualification_questions": [],
    "template_version": 1, "catalog_slug": "appointment-booking",
    "retell_llm_config": {"model": "gpt-4.1-mini", "temperature": 0.2, "tool_call_strict_mode": true}
  }'::jsonb
),
(
  'sparky',
  'Sparky',
  'home_services',
  '{
    "industry": "home_services",
    "agent_name": "Sparky",
    "display": {
      "avatar": "/agents/sparky.svg",
      "specialty": "Home Services Dispatcher",
      "industries": ["HVAC", "Plumbing", "Roofing", "Electrical"],
      "description": "Sparky triages service calls, captures job details, and dispatches your crew.",
      "features": ["Triage service calls", "Capture job details", "Schedule appointments", "Emergency dispatch", "Lead qualification"],
      "tagline": "Your 24/7 dispatch desk for home services."
    },
    "voice": {"retell_voice_id": "cartesia-Adam", "elevenlabs_voice_id": "pNInz6obpgDQGcFmaJgB", "default_provider": "retell"},
    "system_prompt": "You are Sparky, an AI dispatcher for {{business_name}}, a home services company.",
    "objection_handlers": [],
    "booking_rules": [],
    "escalation_rules": [],
    "faq_rules": [],
    "qualification_questions": [],
    "template_version": 1, "catalog_slug": "home-services-dispatcher",
    "retell_llm_config": {"model": "gpt-4.1-mini", "temperature": 0.2, "tool_call_strict_mode": true}
  }'::jsonb
),
(
  'sunny',
  'Sunny',
  'general_smb',
  '{
    "industry": "general_smb",
    "agent_name": "Sunny",
    "display": {
      "avatar": "/agents/sunny.svg",
      "specialty": "Appointment Coordinator",
      "industries": ["Medical Offices", "Consulting", "Legal", "General SMB"],
      "description": "Sunny specializes in scheduling. She finds the perfect time slot and sends reminders.",
      "features": ["Check availability", "Book appointments", "SMS reminders", "Handle rescheduling", "Reduce no-shows"],
      "tagline": "Never double-book again."
    },
    "voice": {"retell_voice_id": "11labs-Lily", "elevenlabs_voice_id": "EXAVITQu4vr4xnSDxMaL", "default_provider": "retell"},
    "system_prompt": "You are Sunny, an appointment coordinator for {{business_name}}.",
    "objection_handlers": [],
    "booking_rules": [],
    "escalation_rules": [],
    "faq_rules": [],
    "qualification_questions": [],
    "retell_llm_config": {"model": "gpt-4.1-mini", "temperature": 0.6}
  }'::jsonb
),
(
  'bella',
  'Bella',
  'general_smb',
  '{
    "industry": "general_smb",
    "agent_name": "Bella",
    "display": {
      "avatar": "/agents/bella.svg",
      "specialty": "Lead Qualification Assistant",
      "industries": ["Sales Teams", "Agencies", "B2B Services"],
      "description": "Bella asks the right questions, scores leads, and routes hot prospects to your sales team.",
      "features": ["Qualify leads", "Score leads", "Capture contact details", "CRM sync", "Schedule callbacks"],
      "tagline": "Turn every call into a qualified opportunity."
    },
    "voice": {"retell_voice_id": "11labs-Grace", "elevenlabs_voice_id": "oWAxZDx7w5VEj9dCyTzz", "default_provider": "retell"},
    "system_prompt": "You are Bella, a lead qualification assistant for {{business_name}}.",
    "objection_handlers": [],
    "booking_rules": [],
    "escalation_rules": [],
    "faq_rules": [],
    "qualification_questions": [],
    "template_version": 1, "catalog_slug": "lead-qualification",
    "retell_llm_config": {"model": "gpt-4.1-mini", "temperature": 0.2, "tool_call_strict_mode": true}
  }'::jsonb
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  industry = EXCLUDED.industry,
  config = EXCLUDED.config;

UPDATE agent_templates SET is_active = (slug IN ('dexter', 'zia', 'sparky', 'bella'));

-- Seed n8n workflow webhooks (Railway production)
INSERT INTO workflows (name, webhook_url, is_active, config) VALUES
  ('Call Completed Router', 'https://n8n-production-08c9.up.railway.app/webhook/call-completed', true, '{"type":"router","dispatch_target":true}'::jsonb),
  ('SMS Follow-Up', 'https://n8n-production-08c9.up.railway.app/webhook/sms-follow-up', true, '{"type":"sms"}'::jsonb),
  ('HubSpot Sync', 'https://n8n-production-08c9.up.railway.app/webhook/hubspot-sync', true, '{"type":"crm","provider":"hubspot"}'::jsonb),
  ('GoHighLevel Sync', 'https://n8n-production-08c9.up.railway.app/webhook/ghl-sync', true, '{"type":"crm","provider":"gohighlevel"}'::jsonb),
  ('Google Sheets Log', 'https://n8n-production-08c9.up.railway.app/webhook/sheets-log', true, '{"type":"crm","provider":"google_sheets"}'::jsonb)
ON CONFLICT DO NOTHING;
