import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createServiceClient,
  errorResponse,
  jsonResponse,
} from "../_shared/errors.ts";
import { syncN8nWorkflowsToDb } from "../_shared/n8n.ts";
import { requireServiceRole } from "../_shared/auth.ts";

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

  try {
    requireServiceRole(req);

    const supabase = createServiceClient();
    const results = await syncN8nWorkflowsToDb(supabase);
    const synced = results.filter((r) => r.synced).length;

    return jsonResponse({
      success: true,
      synced,
      total: results.length,
      workflows: results,
    });
  } catch (error) {
    return errorResponse(error);
  }
});
