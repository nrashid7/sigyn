"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useState, Suspense } from "react";
import { connectIntegration } from "@/lib/actions/integrations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const providerLabels: Record<string, { title: string; fields: Array<{ key: string; label: string; type?: string }> }> = {
  cal_com: {
    title: "Connect Cal.com",
    fields: [{ key: "api_key", label: "API Key", type: "password" }],
  },
  calendly: {
    title: "Connect Calendly",
    fields: [{ key: "access_token", label: "Personal Access Token", type: "password" }],
  },
  hubspot: {
    title: "Connect HubSpot",
    fields: [{ key: "access_token", label: "Private App Access Token", type: "password" }],
  },
  gohighlevel: {
    title: "Connect GoHighLevel",
    fields: [{ key: "api_key", label: "API Key", type: "password" }],
  },
  google_sheets: {
    title: "Connect Google Sheets",
    fields: [
      { key: "sheet_id", label: "Spreadsheet ID" },
      { key: "access_token", label: "Google OAuth Access Token", type: "password" },
    ],
  },
};

function ConnectForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const provider = searchParams.get("provider") || "";
  const def = providerLabels[provider];
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!def) {
    return (
      <Card className="max-w-md mx-auto">
        <CardContent className="py-8 text-center text-muted-foreground">
          Unknown integration provider.
        </CardContent>
      </Card>
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const formData = new FormData(e.currentTarget);
    const config: Record<string, string> = {};
    def.fields.forEach((f) => {
      config[f.key] = formData.get(f.key) as string;
    });
    const result = await connectIntegration(provider, config);
    if (result?.error) {
      setError(result.error);
      setLoading(false);
    } else {
      router.push("/dashboard/settings?connected=" + provider);
    }
  }

  return (
    <Card className="max-w-md mx-auto glow">
      <CardHeader>
        <CardTitle>{def.title}</CardTitle>
        <CardDescription>Enter your credentials to connect this integration.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}
          {def.fields.map((field) => (
            <div key={field.key}>
              <Label htmlFor={field.key}>{field.label}</Label>
              <Input
                id={field.key}
                name={field.key}
                type={field.type ?? "text"}
                required
                className="mt-1.5"
              />
            </div>
          ))}
          <Button type="submit" variant="gradient" className="w-full" disabled={loading}>
            {loading ? "Connecting..." : "Connect"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function ConnectIntegrationPage() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <Suspense fallback={<div className="text-muted-foreground">Loading...</div>}>
        <ConnectForm />
      </Suspense>
    </div>
  );
}
