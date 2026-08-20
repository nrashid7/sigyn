import Link from "next/link";

export default function TermsPage() {
  return <main className="mx-auto max-w-3xl space-y-6 px-6 py-16 text-slate-800">
    <Link href="/" className="text-sm text-primary">← Sigyn</Link>
    <h1 className="text-4xl font-black text-slate-950">Terms of Service</h1>
    <p>Last updated August 8, 2026.</p>
    <h2 className="text-2xl font-bold">Managed service</h2>
    <p>Sigyn provisions and operates AI voice agents only after business facts, integrations, testing, billing, and launch approval are complete. Service is not a substitute for emergency services, legal, medical, or financial advice.</p>
    <h2 className="text-2xl font-bold">Customer responsibilities</h2>
    <p>Customers must provide accurate approved information, obtain required AI and recording consent, maintain lawful contact lists, and monitor agent performance. Outbound sales campaigns are outside the initial service scope.</p>
    <h2 className="text-2xl font-bold">Usage and billing</h2>
    <p>Plans, setup fees, included minutes, overages, and renewal terms are defined at checkout and in the service order. Live provisioning requires an active subscription unless an administrator records a waiver.</p>
    <h2 className="text-2xl font-bold">Availability and suspension</h2>
    <p>We may pause agents to protect callers, security, billing integrity, or service reliability. Customers can request pause or cancellation through account settings.</p>
  </main>;
}
