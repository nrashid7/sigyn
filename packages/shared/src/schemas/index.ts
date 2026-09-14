import { z } from "zod";

export const industrySchema = z.enum([
  "general_smb",
  "salon_spa",
  "home_services",
]);

export const businessDetailsSchema = z.object({
  name: z.string().min(2, "Business name is required"),
  website: z.string().url().optional().or(z.literal("")),
  industry: industrySchema,
  phone: z.string().min(10, "Valid phone number required"),
  timezone: z.string().default("America/New_York"),
  hours: z.record(
    z.object({
      open: z.string(),
      close: z.string(),
      closed: z.boolean().optional(),
    })
  ),
});

export const callPreferencesSchema = z.object({
  transfer_number: z.string().optional(),
  emergency_number: z.string().optional(),
  voicemail_enabled: z.boolean().default(true),
  voicemail_message: z.string().optional(),
  escalation_after_seconds: z.number().min(30).max(600).optional(),
  after_hours_message: z.string().optional(),
});

export const voiceSelectionSchema = z.object({
  voice_provider: z.literal("elevenlabs").default("elevenlabs"),
  voice_id: z.string().min(1, "Select a voice"),
  template_slug: z.string().min(1, "Select an agent"),
});

export const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().min(2),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const integrationConnectSchema = z.object({
  provider: z.enum([
    "google_calendar",
    "calendly",
    "cal_com",
    "hubspot",
    "gohighlevel",
    "google_sheets",
  ]),
  config: z.record(z.unknown()).optional(),
});

export type BusinessDetailsInput = z.infer<typeof businessDetailsSchema>;
export type CallPreferencesInput = z.infer<typeof callPreferencesSchema>;
export type VoiceSelectionInput = z.infer<typeof voiceSelectionSchema>;
