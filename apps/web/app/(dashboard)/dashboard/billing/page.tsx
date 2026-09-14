import Link from "next/link";
import { CreditCard, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSubscription, getUsageStats } from "@/lib/actions/billing";

interface BillingPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function BillingPage({ searchParams }: BillingPageProps) {
  const { error } = await searchParams;
  const [subscription, usage] = await Promise.all([
    getSubscription(),
    getUsageStats(),
  ]);

  const plan = subscription?.plan || "starter";
  const status = subscription?.status || "trialing";
  const isActivePro = status === "active" && plan === "pro";
  const isActiveStarter = status === "active" && plan === "starter";
  const showSubscribeStarter = !isActiveStarter && !isActivePro;
  const showUpgradeToPro = !isActivePro;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Billing</h1>
        <p className="text-muted-foreground mt-1">
          Manage your subscription and view usage.
        </p>
      </div>

      {error === "no_subscription" && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-red-400">
          No active subscription yet.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Current Plan</CardTitle>
              <Badge variant={status === "active" ? "success" : "warning"}>
                {status}
              </Badge>
            </div>
            <CardDescription>
              You&apos;re on the <span className="capitalize font-medium text-foreground">{plan}</span> plan
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-400" />
                {usage.included} minutes included
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-400" />
                Call transcripts & analytics
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-400" />
                Knowledge base access
              </li>
            </ul>
            <div className="flex flex-wrap gap-3 pt-2">
              {showSubscribeStarter && (
                <Button variant="gradient" asChild>
                  <Link href="/api/stripe/checkout?plan=starter">Subscribe to Starter</Link>
                </Button>
              )}
              {showUpgradeToPro && (
                <Button variant="gradient" asChild>
                  <Link href="/api/stripe/checkout?plan=pro">Upgrade to Pro</Link>
                </Button>
              )}
              {subscription?.stripe_customer_id && (
                <form action="/api/stripe/portal" method="POST">
                  <Button variant="outline" type="submit">
                    <CreditCard className="mr-2 h-4 w-4" />
                    Manage billing
                  </Button>
                </form>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Usage This Period</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between mb-2">
                  <span className="text-2xl font-bold">{usage.used}</span>
                  <span className="text-muted-foreground">/ {usage.included} min</span>
                </div>
                <div className="h-3 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400"
                    style={{ width: `${usage.percent}%` }}
                  />
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                {usage.percent >= 80
                  ? "You're approaching your minute limit. Consider upgrading."
                  : "You have plenty of minutes remaining this period."}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
