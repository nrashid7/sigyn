import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  AppError,
  createServiceClient,
  errorResponse,
  jsonResponse,
  parseJsonBody,
} from "../_shared/errors.ts";
import { assertServiceRole } from "../_shared/auth.ts";
import { searchKnowledge, formatKnowledgeContext } from "../_shared/retrieval.ts";

interface SearchRequest {
  query: string;
  business_id: string;
  match_count?: number;
}

interface RetellToolRequest {
  name?: string;
  args?: SearchRequest;
  call?: { call_id?: string };
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

  try {
    assertServiceRole(req);
    const raw = await parseJsonBody<SearchRequest | RetellToolRequest>(req);

    const query = "query" in raw && raw.query
      ? raw.query
      : (raw as RetellToolRequest).args?.query;

    const businessId = "business_id" in raw && raw.business_id
      ? raw.business_id
      : (raw as RetellToolRequest).args?.business_id;

    const matchCount = "match_count" in raw
      ? raw.match_count
      : (raw as RetellToolRequest).args?.match_count ?? 5;

    if (!query || !businessId) {
      throw new AppError("query and business_id are required", 400);
    }

    const supabase = createServiceClient();
    const results = await searchKnowledge(supabase, businessId, query, matchCount ?? 5);
    const context = formatKnowledgeContext(results);

    const response = {
      results: results.map((r) => ({
        content: r.content,
        similarity: r.similarity,
        metadata: r.metadata,
      })),
      context,
      result: context,
    };

    return jsonResponse(response);
  } catch (error) {
    return errorResponse(error);
  }
});
