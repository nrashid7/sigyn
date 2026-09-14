import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  AppError,
  createServiceClient,
  errorResponse,
  jsonResponse,
  parseJsonBody,
} from "../_shared/errors.ts";
import { requireServiceRole } from "../_shared/auth.ts";
import {
  assignNumberToAgent,
  createAgent,
  importTwilioNumber,
  listPhoneNumbers,
  normalizePhone,
} from "../_shared/elevenlabs.ts";
import { acquireNumber } from "../_shared/twilio.ts";
import {
  type AgentConfigSources,
  type AgentRow,
  buildConfigForAgent,
  includeCalendarOf,
  loadAgentConfigSources,
  type TemplateRow,
} from "../_shared/agent-config.ts";
import { captureBusinessEvent } from "../_shared/analytics.ts";
import {
  areaCodeFrom,
  isProvisioningInProgress,
  isUniqueViolation,
  nextStep,
} from "./steps.ts";

interface ProvisionRequest {
  business_id: string;
  template_id?: string;
  template_slug?: string;
  name?: string;
  type?: string;
  voice_id?: string;
  voice_provider?: string;
  include_calendar?: boolean;
  area_code?: number | string;
}

/** `agents.provision_error` is for the UI, not for a stack trace. */
const PROVISION_ERROR_MAX_CHARS = 500;

/** Shown to the user in place of a raw Postgres message; the real text still goes to
 *  `provision_error` so support/ops can see it. */
const DB_ERROR_USER_MESSAGE = "We couldn't save your agent. Please try again.";

/**
 * The message an `AppError` should show the user: generic for our own database failures,
 * unchanged for every other error code (external-API errors like `TWILIO_ERROR` or
 * `ELEVENLABS_ERROR` are already written to be user-facing).
 */
function userFacingMessage(error: AppError): string {
  return error.code === "DB_ERROR" ? DB_ERROR_USER_MESSAGE : error.message;
}

async function resolveTemplateId(
  supabase: SupabaseClient,
  body: ProvisionRequest,
): Promise<string> {
  if (body.template_id) return body.template_id;

  const { data, error } = await supabase
    .from("agent_templates")
    .select("id")
    .eq("slug", body.template_slug)
    .maybeSingle();

  if (error || !data) {
    throw new AppError("Agent template not found", 404, "NOT_FOUND");
  }
  return data.id as string;
}

/** Writes one checkpoint and returns the row as the database now has it. */
async function patchAgent(
  supabase: SupabaseClient,
  agentId: string,
  patch: Record<string, unknown>,
): Promise<AgentRow> {
  const { data, error } = await supabase
    .from("agents")
    .update(patch)
    .eq("id", agentId)
    .select("*")
    .single();

  if (error || !data) {
    throw new AppError(
      `Failed to update agent: ${error?.message ?? "row not found"}`,
      500,
      "DB_ERROR",
    );
  }
  return data as AgentRow;
}

/**
 * Inserts a fresh agent row, or returns `null` if a concurrent first hire for the same
 * business+template won the race (`agents_business_template_key`) — the caller treats that
 * the same as losing a claim on an existing row.
 */
async function insertAgentRow(
  supabase: SupabaseClient,
  body: ProvisionRequest,
  template: TemplateRow,
  includeCalendar: boolean,
): Promise<AgentRow | null> {
  const { data, error } = await supabase
    .from("agents")
    .insert({
      business_id: body.business_id,
      template_id: template.id,
      name: body.name ?? template.config.agent_name ?? template.name,
      type: body.type ?? "inbound",
      voice_provider: "elevenlabs",
      voice_id: body.voice_id ?? template.config.voice?.elevenlabs_voice_id ?? null,
      config: { ...template.config, include_calendar: includeCalendar },
      is_active: false,
      provision_status: "provisioning",
      provision_error: null,
    })
    .select("*")
    .single();

  if (isUniqueViolation(error)) {
    return null;
  }
  if (error || !data) {
    throw new AppError(
      `Failed to save agent: ${error?.message ?? "insert returned no row"}`,
      500,
      "DB_ERROR",
    );
  }
  return data as AgentRow;
}

/**
 * Claims an existing row for provisioning, conditional on the state we last read it in: the
 * update also matches `provision_status` (and, for a row still `provisioning`, `updated_at`)
 * so a concurrent claim of the same row cannot both win. When nothing matches, `null` means
 * someone else already claimed it — the caller reports that as "provisioning in progress"
 * instead of re-running steps 2-6 and creating a second ElevenLabs agent and phone number.
 */
async function claimExistingRow(
  supabase: SupabaseClient,
  existing: AgentRow,
  includeCalendar: boolean,
): Promise<AgentRow | null> {
  const patch = {
    provision_status: "provisioning",
    provision_error: null,
    config: { ...existing.config, include_calendar: includeCalendar },
  };

  const base = supabase
    .from("agents")
    .update(patch)
    .eq("id", existing.id)
    .eq("provision_status", existing.provision_status);

  const { data, error } = existing.provision_status === "provisioning"
    ? await base.eq("updated_at", existing.updated_at).select("*").maybeSingle()
    : await base.select("*").maybeSingle();

  if (error) {
    throw new AppError(
      `Failed to update agent: ${error.message}`,
      500,
      "DB_ERROR",
    );
  }
  return data as AgentRow | null;
}

/** Numbers already spoken for, so Twilio's idle-number reuse never steals another agent's line. */
async function takenPhoneNumbers(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase
    .from("agents")
    .select("phone_number")
    .not("phone_number", "is", null);

  if (error) {
    throw new AppError(
      `Failed to load agent phone numbers: ${error.message}`,
      500,
      "DB_ERROR",
    );
  }
  return (data ?? []).map((agent: { phone_number: string }) => agent.phone_number);
}

/**
 * Records the failure on the row so a re-run resumes from here, and answers with both the
 * error and the row — the UI needs the row to show how far the hire got. External objects
 * are deliberately left in place: they are the checkpoints the next run reuses.
 */
async function failProvisioning(
  supabase: SupabaseClient,
  row: AgentRow,
  error: unknown,
): Promise<Response> {
  const message = error instanceof Error ? error.message : String(error);

  let agent = row;
  try {
    agent = await patchAgent(supabase, row.id, {
      provision_status: "failed",
      provision_error: message.slice(0, PROVISION_ERROR_MAX_CHARS),
    });
  } catch (updateError) {
    console.error("[agent-provision] Could not record the failure:", updateError);
  }

  if (error instanceof AppError) {
    return jsonResponse(
      { error: userFacingMessage(error), code: error.code, agent },
      error.statusCode,
    );
  }

  console.error("[agent-provision]", error);
  return jsonResponse({ error: message, agent }, 500);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let supabase: SupabaseClient | undefined;
  // Set once the row exists: from here on a failure is recorded on the row, not just returned.
  let row: AgentRow | undefined;

  try {
    requireServiceRole(req);

    const body = await parseJsonBody<ProvisionRequest>(req);

    if (!body.business_id || (!body.template_id && !body.template_slug)) {
      throw new AppError(
        "business_id and template_id or template_slug are required",
        400,
        "INVALID_REQUEST",
      );
    }
    if (body.voice_provider && body.voice_provider !== "elevenlabs") {
      throw new AppError(
        "Only the elevenlabs voice provider is supported",
        400,
        "INVALID_REQUEST",
      );
    }

    supabase = createServiceClient();
    const templateId = await resolveTemplateId(supabase, body);

    const { data: existingData, error: existingError } = await supabase
      .from("agents")
      .select("*")
      .eq("business_id", body.business_id)
      .eq("template_id", templateId)
      .maybeSingle();

    if (existingError) {
      throw new AppError(
        `Failed to load agent: ${existingError.message}`,
        500,
        "DB_ERROR",
      );
    }
    const existing = existingData as AgentRow | null;

    // 0. Already hired — hand back the same agent instead of provisioning a second one.
    if (existing?.provision_status === "ready") {
      return jsonResponse({ agent: existing, already_provisioned: true }, 200);
    }

    // 0b. Another run is still mid-flight; racing it would double-buy a phone number.
    if (existing && isProvisioningInProgress(existing, new Date())) {
      return jsonResponse(
        { error: "Provisioning in progress", code: "PROVISIONING" },
        409,
      );
    }

    // The row must agree with what we push, so agent-sync rebuilds an identical config.
    const includeCalendar = body.include_calendar ??
      (existing ? includeCalendarOf(existing.config) : true);

    let sources: AgentConfigSources;

    // 1. Claim the row. A failed or abandoned hire resumes on the row it already has. The
    //    claim is conditional on the exact state we just read (existing branch) or protected
    //    by the row's own unique constraint (insert branch), so two concurrent retries of the
    //    same row — or two concurrent first hires — cannot both win: the loser is told
    //    provisioning is in progress instead of re-running steps 2-6 a second time. Done
    //    before `loadAgentConfigSources` so the window between our read and our claim is as
    //    small as possible.
    if (existing) {
      const claimed = await claimExistingRow(supabase, existing, includeCalendar);
      if (!claimed) {
        return jsonResponse(
          { error: "Provisioning in progress", code: "PROVISIONING" },
          409,
        );
      }
      row = claimed;
      sources = await loadAgentConfigSources(supabase, body.business_id, templateId);
    } else {
      sources = await loadAgentConfigSources(supabase, body.business_id, templateId);
      const inserted = await insertAgentRow(supabase, body, sources.template, includeCalendar);
      if (!inserted) {
        return jsonResponse(
          { error: "Provisioning in progress", code: "PROVISIONING" },
          409,
        );
      }
      row = inserted;
    }

    // 2. Create the ElevenLabs agent.
    if (nextStep(row) === "create_agent") {
      const config = buildConfigForAgent(row, sources, includeCalendar);
      const { agent_id } = await createAgent(config);
      row = await patchAgent(supabase, row.id, { elevenlabs_agent_id: agent_id });
    }

    // 3. Reuse an idle owned Twilio number, or buy one near the business.
    if (nextStep(row) === "acquire_number") {
      const number = await acquireNumber({
        areaCode: areaCodeFrom(body.area_code ?? sources.business.phone),
        friendlyName: sources.business.name,
        exclude: await takenPhoneNumbers(supabase),
      });
      row = await patchAgent(supabase, row.id, {
        phone_number: number.phone_number,
        twilio_phone_sid: number.sid,
      });
    }

    // 4. Import the number into ElevenLabs, reusing an earlier import of the same number.
    let assignedAgentId: string | null = null;
    if (nextStep(row) === "import_number") {
      // Both ids are set: that is what "import_number" means.
      const phoneNumber = row.phone_number!;
      const elevenlabsAgentId = row.elevenlabs_agent_id!;

      const wanted = normalizePhone(phoneNumber) ?? phoneNumber;
      const alreadyImported = (await listPhoneNumbers()).find(
        (candidate) =>
          (normalizePhone(candidate.phone_number) ?? candidate.phone_number) === wanted,
      );

      let phoneNumberId: string;
      if (alreadyImported) {
        phoneNumberId = alreadyImported.phone_number_id;
        assignedAgentId = alreadyImported.assigned_agent?.agent_id ?? null;
      } else {
        // Importing with an agent id assigns the number in the same call.
        const imported = await importTwilioNumber({
          phoneNumber,
          label: sources.business.name,
          agentId: elevenlabsAgentId,
        });
        phoneNumberId = imported.phone_number_id;
        assignedAgentId = elevenlabsAgentId;
      }

      row = await patchAgent(supabase, row.id, {
        elevenlabs_phone_number_id: phoneNumberId,
      });
    }

    // 5. Point the number at the agent unless the import already does. A resumed run that
    //    skipped step 4 has no idea who the number points at, so it re-sends the assignment.
    if (assignedAgentId !== row.elevenlabs_agent_id) {
      // Steps 2 to 4 must have run or been skipped because they already had — verify instead
      // of trusting the two non-null assertions below to a state that turned out inconsistent.
      if (nextStep(row) !== "assign_and_finish") {
        throw new AppError(
          "Provisioning state is inconsistent",
          500,
          "PROVISION_STATE_ERROR",
        );
      }
      await assignNumberToAgent(row.elevenlabs_phone_number_id!, row.elevenlabs_agent_id!);
    }

    // 6. The agent can take calls.
    row = await patchAgent(supabase, row.id, {
      provision_status: "ready",
      is_active: true,
      provision_error: null,
    });

    try {
      await captureBusinessEvent(body.business_id, "agent_created", {
        agent_id: row.id,
        template_id: row.template_id,
        elevenlabs_agent_id: row.elevenlabs_agent_id,
      });
    } catch (analyticsError) {
      // A provisioned agent must never be reported as failed because PostHog was down.
      console.warn("[agent-provision] Analytics capture failed:", analyticsError);
    }

    return jsonResponse({ agent: row }, 201);
  } catch (error) {
    if (supabase && row) {
      return await failProvisioning(supabase, row, error);
    }
    // No row to record the failure on yet (it failed at or before the claim): still mask a
    // raw Postgres message the same way `failProvisioning` would have.
    if (error instanceof AppError) {
      return jsonResponse(
        { error: userFacingMessage(error), code: error.code },
        error.statusCode,
      );
    }
    return errorResponse(error);
  }
});
