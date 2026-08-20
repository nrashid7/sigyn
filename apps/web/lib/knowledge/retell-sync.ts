export type RetellKnowledgeSyncRequest =
  | { operation: "upload_document" | "delete_document"; document_id: string }
  | { operation: "add_url" | "delete_url"; source_id: string }
  | { operation: "reconcile"; knowledge_base_record_id: string }
  | { operation: "ensure" | "attach_agents"; agent_id: string };

export interface RetellKnowledgeSyncOptions {
  supabaseUrl?: string;
  serviceRoleKey?: string;
  fetchImpl?: typeof fetch;
}

function runtimeValue(name: string): string | undefined {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  return runtime.process?.env?.[name];
}

export async function invokeRetellKnowledgeSync(
  request: RetellKnowledgeSyncRequest,
  options: RetellKnowledgeSyncOptions = {},
): Promise<Record<string, unknown>> {
  const supabaseUrl = options.supabaseUrl ?? runtimeValue("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = options.serviceRoleKey ?? runtimeValue("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Retell knowledge synchronization is not configured");
  }

  const response = await (options.fetchImpl ?? fetch)(
    `${supabaseUrl.replace(/\/$/, "")}/functions/v1/retell-knowledge-sync`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify(request),
    },
  );
  const body = await response.json().catch(() => ({})) as { error?: unknown } & Record<string, unknown>;
  if (!response.ok) {
    const providerMessage = typeof body.error === "string"
      ? body.error.slice(0, 500)
      : "Retell knowledge synchronization failed";
    throw new Error(providerMessage);
  }
  return body;
}
