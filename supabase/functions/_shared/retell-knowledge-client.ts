const RETELL_API_BASE = "https://api.retellai.com";

export interface RetellTransportOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export interface RetellKnowledgeFile {
  filename: string;
  type: string;
  bytes: Uint8Array;
}

export interface RetellKnowledgeSource {
  type: "document" | "url" | "text";
  source_id: string;
  filename?: string;
  file_url?: string;
  file_size?: number;
  url?: string;
  title?: string;
  text?: string;
}

export interface RetellKnowledgeBase {
  knowledge_base_id: string;
  knowledge_base_name: string;
  status: "in_progress" | "complete" | "error" | "refreshing_in_progress";
  knowledge_base_sources?: RetellKnowledgeSource[];
  enable_auto_refresh?: boolean;
  last_refreshed_timestamp?: number;
}

export class RetellProviderError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = "RetellProviderError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function environmentApiKey(): string | undefined {
  const runtime = globalThis as typeof globalThis & {
    Deno?: { env: { get(name: string): string | undefined } };
    process?: { env?: Record<string, string | undefined> };
  };
  return runtime.Deno?.env.get("RETELL_API_KEY") ?? runtime.process?.env?.RETELL_API_KEY;
}

function providerError(status: number): RetellProviderError {
  if (status === 401 || status === 403) {
    return new RetellProviderError("Retell authentication is not configured correctly", status, "RETELL_AUTH_ERROR");
  }
  if (status === 402) {
    return new RetellProviderError("Retell billing must be configured before publishing knowledge", status, "RETELL_BILLING_ERROR");
  }
  if (status === 429) {
    return new RetellProviderError("Retell is temporarily unavailable because of a rate limit", status, "RETELL_RATE_LIMITED");
  }
  if (status >= 500) {
    return new RetellProviderError("Retell is temporarily unavailable", status, "RETELL_UNAVAILABLE");
  }
  return new RetellProviderError("Retell rejected the knowledge source", status, "RETELL_REJECTED");
}

async function request<T>(
  path: string,
  init: RequestInit,
  options: RetellTransportOptions = {},
): Promise<T> {
  const apiKey = options.apiKey ?? environmentApiKey();
  if (!apiKey) {
    throw new RetellProviderError("Retell is not configured", 500, "RETELL_CONFIG_ERROR");
  }

  const multipart = init.body instanceof FormData;
  const response = await (options.fetchImpl ?? fetch)(`${RETELL_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(multipart ? {} : { "Content-Type": "application/json" }),
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw providerError(response.status);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

function appendSources(
  form: FormData,
  sources: {
    files?: RetellKnowledgeFile[];
    urls?: string[];
    texts?: Array<{ title: string; text: string }>;
  },
) {
  for (const file of sources.files ?? []) {
    const bytes = new Uint8Array(file.bytes.byteLength);
    bytes.set(file.bytes);
    const blob = new Blob([bytes.buffer], { type: file.type || "application/octet-stream" });
    form.append("knowledge_base_files", blob, file.filename);
  }
  if (sources.urls?.length) {
    form.append("knowledge_base_urls", JSON.stringify(sources.urls));
  }
  if (sources.texts?.length) {
    form.append("knowledge_base_texts", JSON.stringify(sources.texts));
  }
}

export async function createRetellKnowledgeBase(
  config: { name: string; markdown: string; urls?: string[] },
  options: RetellTransportOptions = {},
): Promise<RetellKnowledgeBase> {
  const form = new FormData();
  form.append("knowledge_base_name", config.name.slice(0, 39));
  appendSources(form, {
    texts: [{ title: "Business knowledge policy", text: config.markdown }],
    urls: config.urls,
  });
  form.append("enable_auto_refresh", "true");
  return await request("/create-knowledge-base", { method: "POST", body: form }, options);
}

export async function getRetellKnowledgeBase(
  knowledgeBaseId: string,
  options: RetellTransportOptions = {},
): Promise<RetellKnowledgeBase> {
  return await request(`/get-knowledge-base/${encodeURIComponent(knowledgeBaseId)}`, {
    method: "GET",
  }, options);
}

export async function addRetellKnowledgeSources(
  knowledgeBaseId: string,
  sources: {
    files?: RetellKnowledgeFile[];
    urls?: string[];
    texts?: Array<{ title: string; text: string }>;
  },
  options: RetellTransportOptions = {},
): Promise<RetellKnowledgeBase> {
  const form = new FormData();
  appendSources(form, sources);
  return await request(
    `/add-knowledge-base-sources/${encodeURIComponent(knowledgeBaseId)}`,
    { method: "POST", body: form },
    options,
  );
}

export async function deleteRetellKnowledgeSource(
  knowledgeBaseId: string,
  sourceId: string,
  options: RetellTransportOptions = {},
): Promise<void> {
  await request(
    `/delete-knowledge-base-source/${encodeURIComponent(knowledgeBaseId)}/source/${encodeURIComponent(sourceId)}`,
    { method: "DELETE" },
    options,
  );
}
