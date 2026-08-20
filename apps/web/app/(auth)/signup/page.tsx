"use client";

import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { signUp, signInWithGoogle } from "@/lib/actions/auth";
import { trackEvent, AnalyticsEvents } from "@/lib/analytics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Phone } from "lucide-react";

export default function SignupPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    trackEvent(AnalyticsEvents.SIGNUP, { step: "view" });
  }, []);

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    setError(null);
    trackEvent(AnalyticsEvents.SIGNUP, { step: "submit" });
    const result = await signUp(formData);
    if (result?.error) {
      setError(result.error);
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    trackEvent(AnalyticsEvents.SIGNUP, { method: "google" });
    const result = await signInWithGoogle(new FormData(formRef.current ?? undefined));
    if (result?.error) {
      setError(result.error);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-mesh flex items-center justify-center p-4">
      <Card className="w-full max-w-md glow">
        <CardHeader className="text-center">
          <Link href="/" className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-400">
            <Phone className="h-6 w-6 text-white" />
          </Link>
          <CardTitle className="text-2xl">Hire your AI employee</CardTitle>
          <CardDescription>Start your 14-day free trial — no credit card required</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button type="button" variant="outline" className="w-full" onClick={handleGoogle} disabled={loading}>
            Continue with Google
          </Button>
          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">or</span>
            <Separator className="flex-1" />
          </div>
          <form ref={formRef} action={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}
            <div>
              <Label htmlFor="full_name">Full Name</Label>
              <Input id="full_name" name="full_name" required className="mt-1.5" placeholder="Jane Smith" />
            </div>
            <div>
              <Label htmlFor="email">Work Email</Label>
              <Input id="email" name="email" type="email" required className="mt-1.5" placeholder="you@company.com" />
            </div>
            <div>
              <Label htmlFor="invite_code">Controlled beta invitation</Label>
              <Input id="invite_code" name="invite_code" required className="mt-1.5" autoComplete="off" placeholder="Invitation code" />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" required minLength={8} className="mt-1.5" placeholder="Min 8 characters" />
            </div>
            <Button type="submit" variant="gradient" className="w-full" disabled={loading}>
              {loading ? "Creating account..." : "Join Controlled Beta"}
            </Button>
          </form>
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="text-indigo-400 hover:underline">Sign in</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
