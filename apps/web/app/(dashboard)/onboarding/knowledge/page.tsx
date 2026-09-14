"use client";

import { useRef, useState } from "react";
import { Upload, FileText, CheckCircle, Loader2 } from "lucide-react";
import { completeOnboardingKnowledge } from "@/lib/actions/onboarding";
import { uploadKnowledgeDocument } from "@/lib/actions/knowledge";
import { OnboardingLayout } from "@/components/onboarding/onboarding-layout";
import { Button } from "@/components/ui/button";

export default function OnboardingKnowledgePage() {
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError(null);

    for (const file of Array.from(files)) {
      const formData = new FormData();
      formData.set("file", file);
      const result = await uploadKnowledgeDocument(formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setUploaded((prev) => [...prev, file.name]);
      }
    }
    setUploading(false);
  }

  async function handleContinue() {
    setLoading(true);
    await completeOnboardingKnowledge();
  }

  return (
    <OnboardingLayout
      currentStep={2}
      title="Upload your knowledge base"
      description="Help your AI employee answer questions about your business, services, and policies."
    >
      <div className="space-y-6">
        {error && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          className="hidden"
          multiple
          accept=".pdf,.docx,.txt,.md,.html,.epub,.csv"
          onChange={(e) => handleFiles(e.target.files)}
        />

        <div
          className="border-2 border-dashed border-border rounded-xl p-12 text-center cursor-pointer hover:border-indigo-500/50 transition-colors"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFiles(e.dataTransfer.files);
          }}
        >
          {uploading ? (
            <Loader2 className="h-10 w-10 text-indigo-400 mx-auto mb-4 animate-spin" />
          ) : (
            <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
          )}
          <p className="text-sm text-muted-foreground mb-4">
            Drag & drop PDFs, DOCX, TXT, or CSV files here
          </p>
          <Button type="button" variant="outline" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>
            Choose Files
          </Button>
        </div>

        {uploaded.length > 0 && (
          <ul className="space-y-2">
            {uploaded.map((name) => (
              <li key={name} className="flex items-center gap-2 text-sm text-green-400">
                <CheckCircle className="h-4 w-4" />
                {name} — processing
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2">
          <p className="text-sm font-medium">Suggested documents:</p>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-center gap-2">
              <FileText className="h-4 w-4" /> Service menu or price list
            </li>
            <li className="flex items-center gap-2">
              <FileText className="h-4 w-4" /> FAQ document
            </li>
            <li className="flex items-center gap-2">
              <FileText className="h-4 w-4" /> Company policies
            </li>
          </ul>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={handleContinue} disabled={loading || uploading}>
            Skip for now
          </Button>
          <Button variant="gradient" className="flex-1" onClick={handleContinue} disabled={loading || uploading}>
            {loading ? "Saving..." : "Continue"}
          </Button>
        </div>
      </div>
    </OnboardingLayout>
  );
}
