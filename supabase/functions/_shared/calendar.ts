import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AppError } from "./errors.ts";
import { decryptCredential, encryptCredential } from "./credential-crypto.ts";

export interface TimeSlot {
  start: string;
  end: string;
  available: boolean;
}

export interface AvailabilityRequest {
  businessId: string;
  startDate: string;
  endDate?: string;
  durationMinutes?: number;
}

export interface BookingRequest {
  businessId: string;
  scheduledAt: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  durationMinutes?: number;
  notes?: string;
  callId?: string;
  agentId?: string;
}

interface IntegrationRow {
  id: string;
  provider: string;
  config: Record<string, unknown>;
  access_token: string | null;
  refresh_token: string | null;
  expires_at?: string | null;
}

export async function getCalendarIntegration(
  supabase: SupabaseClient,
  businessId: string,
): Promise<IntegrationRow | null> {
  const { data, error } = await supabase
    .from("integrations")
    .select("id, provider, config, integration_credentials(access_token_encrypted,refresh_token_encrypted,expires_at)")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .in("provider", ["google_calendar", "calendly", "cal_com"])
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new AppError(`Failed to fetch integration: ${error.message}`, 500);
  }

  if (!data) return null;
  const credentials = Array.isArray(data.integration_credentials)
    ? data.integration_credentials[0]
    : data.integration_credentials;
  const integration = {
    id: data.id,
    provider: data.provider,
    config: data.config,
    access_token: await decryptCredential(credentials?.access_token_encrypted),
    refresh_token: await decryptCredential(credentials?.refresh_token_encrypted),
    expires_at: credentials?.expires_at,
  };
  if (integration.provider === "google_calendar" && integration.refresh_token &&
    (!integration.expires_at || new Date(integration.expires_at).getTime() < Date.now() + 60_000)) {
    const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
    if (!clientId || !clientSecret) throw new AppError("Google OAuth refresh is not configured", 500);
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId, client_secret: clientSecret,
        refresh_token: integration.refresh_token, grant_type: "refresh_token",
      }),
    });
    if (!response.ok) {
      await supabase.from("integration_credentials").update({ refresh_status: "failed" }).eq("integration_id", integration.id);
      throw new AppError("Google Calendar authorization has expired; reconnect it", 409, "OAUTH_REFRESH_FAILED");
    }
    const token = await response.json() as { access_token: string; expires_in?: number };
    integration.access_token = token.access_token;
    integration.expires_at = new Date(Date.now() + (token.expires_in ?? 3600) * 1000).toISOString();
    await supabase.from("integration_credentials").update({
      access_token_encrypted: await encryptCredential(token.access_token),
      expires_at: integration.expires_at,
      refresh_status: "valid",
      last_refreshed_at: new Date().toISOString(),
    }).eq("integration_id", integration.id);
  }
  return integration;
}

export async function checkAvailability(
  supabase: SupabaseClient,
  request: AvailabilityRequest,
): Promise<TimeSlot[]> {
  const integration = await getCalendarIntegration(supabase, request.businessId);

  if (!integration) {
    throw new AppError("A real calendar connection is required before checking availability", 409, "CALENDAR_REQUIRED");
  }

  switch (integration.provider) {
    case "google_calendar":
      return await checkGoogleCalendarAvailability(integration, request);
    case "calendly":
      return await checkCalendlyAvailability(integration, request);
    case "cal_com":
      return await checkCalComAvailability(integration, request);
    default:
      throw new AppError("Unsupported calendar integration", 409);
  }
}

export async function createBooking(
  supabase: SupabaseClient,
  request: BookingRequest,
): Promise<{ appointmentId: string; externalId?: string }> {
  const integration = await getCalendarIntegration(supabase, request.businessId);
  let externalId: string | undefined;

  if (!integration) throw new AppError("A real calendar connection is required before booking", 409, "CALENDAR_REQUIRED");
  switch (integration.provider) {
      case "google_calendar":
        externalId = await bookGoogleCalendar(integration, request);
        break;
      case "calendly":
        externalId = await bookCalendly(integration, request);
        break;
      case "cal_com":
        externalId = await bookCalCom(integration, request);
        break;
    default:
      throw new AppError("Unsupported calendar integration", 409);
  }

  const { data, error } = await supabase
    .from("appointments")
    .insert({
      business_id: request.businessId,
      call_id: request.callId ?? null,
      agent_id: request.agentId ?? null,
      customer_name: request.customerName,
      customer_phone: request.customerPhone,
      customer_email: request.customerEmail ?? null,
      scheduled_at: request.scheduledAt,
      duration_minutes: request.durationMinutes ?? 30,
      status: "confirmed",
      external_id: externalId ?? null,
      notes: request.notes ?? null,
    })
    .select("id")
    .single();

  if (error) {
    throw new AppError(`Failed to create appointment: ${error.message}`, 500);
  }

  return { appointmentId: data.id, externalId };
}

function generateDefaultSlots(request: AvailabilityRequest): TimeSlot[] {
  const duration = request.durationMinutes ?? 30;
  const start = new Date(request.startDate);
  const end = new Date(request.endDate ?? request.startDate);
  end.setDate(end.getDate() + (request.endDate ? 0 : 7));

  const slots: TimeSlot[] = [];
  const cursor = new Date(start);
  cursor.setHours(9, 0, 0, 0);

  while (cursor <= end) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      for (let hour = 9; hour < 17; hour++) {
        const slotStart = new Date(cursor);
        slotStart.setHours(hour, 0, 0, 0);
        const slotEnd = new Date(slotStart.getTime() + duration * 60 * 1000);
        slots.push({
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
          available: true,
        });
      }
    }
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(9, 0, 0, 0);
  }

  return slots.slice(0, 20);
}

async function checkGoogleCalendarAvailability(
  integration: IntegrationRow,
  request: AvailabilityRequest,
): Promise<TimeSlot[]> {
  const calendarId = (integration.config.calendar_id as string) ?? "primary";
  const token = integration.access_token;
  if (!token) throw new AppError("Google Calendar credentials are unavailable", 409);

  const timeMin = new Date(request.startDate).toISOString();
  const timeMax = new Date(
    request.endDate ?? new Date(Date.now() + 7 * 86400000).toISOString(),
  ).toISOString();

  const url = new URL("https://www.googleapis.com/calendar/v3/freeBusy");
  const response = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin,
      timeMax,
      items: [{ id: calendarId }],
    }),
  });

  if (!response.ok) {
    throw new AppError(`Google Calendar availability failed (${response.status})`, 502);
  }

  const data = await response.json();
  const busy = data.calendars?.[calendarId]?.busy ?? [];
  const allSlots = generateDefaultSlots(request);

  return allSlots.map((slot) => ({
    ...slot,
    available: !busy.some((b: { start: string; end: string }) =>
      slot.start < b.end && slot.end > b.start
    ),
  })).filter((s) => s.available);
}

async function checkCalendlyAvailability(
  integration: IntegrationRow,
  request: AvailabilityRequest,
): Promise<TimeSlot[]> {
  const token = integration.access_token;
  const eventTypeUri = integration.config.event_type_uri as string;
  if (!token || !eventTypeUri) throw new AppError("Calendly is not fully configured", 409);

  const params = new URLSearchParams({
    event_type: eventTypeUri,
    start_time: new Date(request.startDate).toISOString(),
    end_time: new Date(
      request.endDate ?? new Date(Date.now() + 7 * 86400000).toISOString(),
    ).toISOString(),
  });

  const response = await fetch(
    `https://api.calendly.com/event_type_available_times?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!response.ok) throw new AppError(`Calendly availability failed (${response.status})`, 502);

  const data = await response.json();
  const duration = request.durationMinutes ?? 30;

  return (data.collection ?? []).map((item: { start_time: string }) => ({
    start: item.start_time,
    end: new Date(new Date(item.start_time).getTime() + duration * 60000).toISOString(),
    available: true,
  }));
}

async function checkCalComAvailability(
  integration: IntegrationRow,
  request: AvailabilityRequest,
): Promise<TimeSlot[]> {
  const apiKey = integration.access_token ?? (integration.config.api_key as string);
  const eventTypeId = integration.config.event_type_id as string;
  if (!apiKey || !eventTypeId) throw new AppError("Cal.com is not fully configured", 409);

  const params = new URLSearchParams({
    startTime: new Date(request.startDate).toISOString(),
    endTime: new Date(
      request.endDate ?? new Date(Date.now() + 7 * 86400000).toISOString(),
    ).toISOString(),
    eventTypeId: String(eventTypeId),
  });

  const response = await fetch(
    `https://api.cal.com/v1/availability?${params}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );

  if (!response.ok) throw new AppError(`Cal.com availability failed (${response.status})`, 502);

  const data = await response.json();
  const duration = request.durationMinutes ?? 30;

  return (data.slots ?? []).map((start: string) => ({
    start,
    end: new Date(new Date(start).getTime() + duration * 60000).toISOString(),
    available: true,
  }));
}

async function bookGoogleCalendar(
  integration: IntegrationRow,
  request: BookingRequest,
): Promise<string> {
  const calendarId = (integration.config.calendar_id as string) ?? "primary";
  const token = integration.access_token;
  if (!token) throw new AppError("Google Calendar not connected", 400);

  const duration = request.durationMinutes ?? 30;
  const end = new Date(new Date(request.scheduledAt).getTime() + duration * 60000);

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: `Appointment: ${request.customerName}`,
        description: request.notes ?? `Phone: ${request.customerPhone}`,
        start: { dateTime: request.scheduledAt },
        end: { dateTime: end.toISOString() },
        attendees: request.customerEmail
          ? [{ email: request.customerEmail }]
          : undefined,
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new AppError(`Google Calendar booking failed: ${text}`, 502);
  }

  const data = await response.json();
  return data.id as string;
}

async function bookCalendly(
  integration: IntegrationRow,
  request: BookingRequest,
): Promise<string> {
  const token = integration.access_token;
  const eventTypeUri = integration.config.event_type_uri as string;
  if (!token || !eventTypeUri) {
    throw new AppError("Calendly not configured", 400);
  }

  const response = await fetch("https://api.calendly.com/scheduling_links", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      max_event_count: 1,
      owner: eventTypeUri,
      owner_type: "EventType",
    }),
  });

  if (!response.ok) {
    throw new AppError("Calendly booking link creation failed", 502);
  }

  const data = await response.json();
  return data.resource?.booking_url ?? data.resource?.uri ?? "calendly_pending";
}

async function bookCalCom(
  integration: IntegrationRow,
  request: BookingRequest,
): Promise<string> {
  const apiKey = integration.access_token ?? (integration.config.api_key as string);
  const eventTypeId = integration.config.event_type_id as number;
  if (!apiKey || !eventTypeId) {
    throw new AppError("Cal.com not configured", 400);
  }

  const response = await fetch("https://api.cal.com/v1/bookings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      eventTypeId,
      start: request.scheduledAt,
      responses: {
        name: request.customerName,
        email: request.customerEmail ?? `${request.customerPhone}@placeholder.local`,
        notes: request.notes,
      },
      timeZone: "UTC",
      language: "en",
      metadata: { phone: request.customerPhone },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new AppError(`Cal.com booking failed: ${text}`, 502);
  }

  const data = await response.json();
  return String(data.id ?? data.uid ?? "calcom_pending");
}
