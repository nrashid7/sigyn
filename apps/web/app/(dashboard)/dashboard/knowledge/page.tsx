"use client";

import { useCallback, useEffect, useState } from "react";
import { Upload, FileText, Trash2, Loader2, Globe2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  getKnowledgeDocuments,
  uploadKnowledgeDocument,
  deleteKnowledgeDocument,
  getIngestionOverview,
  retryKnowledgeDocument,
  retryKnowledgeUrl,
  deleteKnowledgeUrl,
  reconcileBusinessKnowledge,
} from "@/lib/actions/knowledge";
import { Input } from "@/components/ui/input";
import type { KnowledgeDocument } from "@businessvoice/shared";
import { knowledgeVoiceStatus } from "@/lib/knowledge/presentation";

type WebsiteSource = {
  id: string;
  url: string;
  retell_status: string;
  retell_last_error: string | null;
  retell_synced_at: string | null;
};

type IngestionOverview = {
  jobs: Array<{ id: string; status: string; error_message?: string | null }>;
  sources: WebsiteSource[];
  proposedFacts: number;
  approvedFacts: number;
};

const emptyOverview: IngestionOverview = { jobs: [], sources: [], proposedFacts: 0, approvedFacts: 0 };

async function loadKnowledgeData() {
  return await Promise.all([getKnowledgeDocuments(), getIngestionOverview()]);
}

export default function KnowledgePage() {
  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [website, setWebsite] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const [overview, setOverview] = useState<IngestionOverview>(emptyOverview);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const hasPublishing = docs.some((doc) => !knowledgeVoiceStatus(doc.retell_status, doc.retell_last_error).terminal) ||
    overview.sources.some((source) => !knowledgeVoiceStatus(source.retell_status, source.retell_last_error).terminal);

  const refresh = useCallback(async () => {
    const [documents, ingestion] = await loadKnowledgeData();
    setDocs(documents as KnowledgeDocument[]);
    setOverview(ingestion as IngestionOverview);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadKnowledgeData().then(([documents, ingestion]) => {
      if (cancelled) return;
      setDocs(documents as KnowledgeDocument[]);
      setOverview(ingestion as IngestionOverview);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!hasPublishing) return;
    const timer = window.setInterval(async () => {
      await reconcileBusinessKnowledge();
      await refresh();
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [hasPublishing, refresh]);

  async function handleWebsiteIngestion(event: React.FormEvent) {
    event.preventDefault();
    setIngesting(true);
    setMessage(null);
    const response = await fetch("/api/ingestion", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ website }),
    });
    if (response.ok) {
      setWebsite("");
      await refresh();
    } else {
      const body = await response.json().catch(() => ({})) as { error?: string };
      setMessage(body.error ?? "Could not import that website.");
    }
    setIngesting(false);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setMessage(null);
    const formData = new FormData();
    formData.append("file", file);
    const result = await uploadKnowledgeDocument(formData);
    if (result?.error) setMessage(result.error);
    else if (result?.warning) setMessage(result.warning);
    await refresh();
    setUploading(false);
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Remove this source from live calls? Callers will no longer be able to use it.")) return;
    setBusyId(id);
    setMessage(null);
    const result = await deleteKnowledgeDocument(id);
    if (result.error) setMessage(result.error);
    await refresh();
    setBusyId(null);
  }

  async function handleRetryDocument(id: string) {
    setBusyId(id);
    setMessage(null);
    const result = await retryKnowledgeDocument(id);
    if (result.error) setMessage(result.error);
    await refresh();
    setBusyId(null);
  }

  async function handleRetryUrl(id: string) {
    setBusyId(id);
    setMessage(null);
    const result = await retryKnowledgeUrl(id);
    if (result.error) setMessage(result.error);
    await refresh();
    setBusyId(null);
  }

  async function handleDeleteUrl(id: string) {
    if (!window.confirm("Remove this website from live calls?")) return;
    setBusyId(id);
    setMessage(null);
    const result = await deleteKnowledgeUrl(id);
    if (result.error) setMessage(result.error);
    await refresh();
    setBusyId(null);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Knowledge Base</h1>
        <p className="text-muted-foreground mt-1">
          Files and websites publish directly to Retell so your AI employees can use them during calls.
        </p>
      </div>

      {message && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {message}
        </div>
      )}

      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Upload className="h-10 w-10 text-muted-foreground mb-4" />
          <p className="text-sm text-muted-foreground mb-4">
            Upload PDF, DOC, DOCX, TXT, or Markdown files (max 10MB). Do not upload secrets or regulated data callers should not access.
          </p>
          <label>
            <input
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.txt,.md"
              onChange={handleUpload}
              disabled={uploading}
            />
            <Button variant="gradient" disabled={uploading} asChild>
              <span>
                {uploading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  "Upload Document"
                )}
              </span>
            </Button>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="flex items-center gap-3">
            <Globe2 className="h-5 w-5 text-indigo-400" />
            <div>
              <p className="font-medium">Automatic website ingestion</p>
              <p className="text-sm text-muted-foreground">The URL is published to Retell immediately and also analyzed for structured business details.</p>
            </div>
          </div>
          <form className="flex gap-2" onSubmit={handleWebsiteIngestion}>
            <Input type="text" inputMode="url" placeholder="https://yourbusiness.com" value={website} onChange={(event) => setWebsite(event.target.value)} required />
            <Button disabled={ingesting}>{ingesting ? "Starting…" : "Import"}</Button>
          </form>
          <div className="flex gap-2 text-sm">
            <Badge variant="warning">{overview.proposedFacts} awaiting review</Badge>
            <Badge variant="success">{overview.approvedFacts} approved</Badge>
          </div>
          {overview.sources.map((source) => {
            const voice = knowledgeVoiceStatus(source.retell_status, source.retell_last_error);
            return (
              <div key={source.id} className="flex items-center justify-between gap-4 border-t pt-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{source.url}</p>
                  <p className="text-xs text-muted-foreground">{voice.detail}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={voice.variant}>{voice.label}</Badge>
                  {voice.retryable && (
                    <Button variant="outline" size="sm" disabled={busyId === source.id} onClick={() => handleRetryUrl(source.id)}>
                      <RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" disabled={busyId === source.id} onClick={() => handleDeleteUrl(source.id)} aria-label={`Remove ${source.url}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : docs.length > 0 ? (
        <div className="space-y-3">
          {docs.map((doc) => {
            const voice = knowledgeVoiceStatus(doc.retell_status, doc.retell_last_error);
            return <Card key={doc.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-indigo-400" />
                  <div>
                    <p className="font-medium">{doc.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      {doc.file_type} · {voice.detail}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={voice.variant}>{voice.label}</Badge>
                  {voice.retryable && (
                    <Button variant="outline" size="sm" disabled={busyId === doc.id} onClick={() => handleRetryDocument(doc.id)}>
                      <RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={busyId === doc.id}
                    onClick={() => handleDelete(doc.id)}
                    aria-label={`Remove ${doc.filename}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>;
          })}
        </div>
      ) : (
        <p className="text-center text-muted-foreground py-8">
          No documents uploaded yet.
        </p>
      )}
    </div>
  );
}
