/**
 * Pure checkpoint logic for the hire flow. No env reads, no network, no database:
 * `index.ts` owns every side effect, this module only decides what is left to do.
 */

/** The checkpoint a provisioning run should resume from. */
export type ProvisionStep =
  | "create_agent"
  | "acquire_number"
  | "import_number"
  | "assign_and_finish"
  | "done";

/** The `agents` columns that record how far a provisioning run got. */
export interface ProvisionCheckpointRow {
  provision_status: string;
  elevenlabs_agent_id: string | null;
  phone_number: string | null;
  elevenlabs_phone_number_id: string | null;
}

/** The `agents` columns that say whether another run is still working on this row. */
export interface ProvisioningHeartbeatRow {
  provision_status: string;
  updated_at: string | null;
}

/** A run that has not touched its row for this long is treated as dead and resumable. */
const PROVISIONING_HEARTBEAT_MS = 2 * 60 * 1000;

/**
 * The US area code to search Twilio with, taken from an explicit `area_code` or the
 * business's own number. `undefined` means "any area code".
 */
export function areaCodeFrom(
  value: string | number | null | undefined,
): string | undefined {
  if (value === null || value === undefined) return undefined;

  const digits = String(value).replace(/\D/g, "");

  if (digits.length === 3) return digits;
  if (digits.length === 10) return digits.slice(0, 3);
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1, 4);

  return undefined;
}

/**
 * Where to resume. Every external id is persisted the moment it is known, so the ids
 * on the row are the whole record of progress — a `failed` row resumes at its first
 * incomplete step rather than starting over.
 */
export function nextStep(row: ProvisionCheckpointRow): ProvisionStep {
  if (row.provision_status === "ready") return "done";
  if (!row.elevenlabs_agent_id) return "create_agent";
  if (!row.phone_number) return "acquire_number";
  if (!row.elevenlabs_phone_number_id) return "import_number";
  return "assign_and_finish";
}

/**
 * True while another run is plausibly still mid-flight, so a concurrent Hire should be
 * told to wait instead of racing it. A row left `provisioning` by a crashed run goes
 * stale after the heartbeat window and becomes resumable.
 */
export function isProvisioningInProgress(
  row: ProvisioningHeartbeatRow,
  now: Date,
): boolean {
  if (row.provision_status !== "provisioning") return false;
  if (!row.updated_at) return false;

  const updatedAt = Date.parse(row.updated_at);
  if (Number.isNaN(updatedAt)) return false;

  // NaN-safe by construction: an unparseable timestamp already returned above.
  return now.getTime() - updatedAt < PROVISIONING_HEARTBEAT_MS;
}
