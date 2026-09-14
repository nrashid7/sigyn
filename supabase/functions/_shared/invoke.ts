/** Fire-and-forget call into another edge function. Never throws. */
export async function invokeFunction(
  name: string,
  body: Record<string, unknown>,
): Promise<Response | null> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      console.error(`[invoke] Missing Supabase configuration, skipped ${name}`);
      return null;
    }

    const response = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // Read a clone so the caller still gets a readable body.
      console.error(`[invoke] Failed to invoke ${name}: ${await response.clone().text()}`);
    }

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[invoke] Failed to invoke ${name}: ${message}`);
    return null;
  }
}
