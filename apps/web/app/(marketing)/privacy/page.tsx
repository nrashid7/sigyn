import Link from "next/link";

export default function PrivacyPage() {
  return <main className="mx-auto max-w-3xl space-y-6 px-6 py-16 text-slate-800">
    <Link href="/" className="text-sm text-primary">← Sigyn</Link>
    <h1 className="text-4xl font-black text-slate-950">Privacy Policy</h1>
    <p>Last updated August 8, 2026.</p>
    <h2 className="text-2xl font-bold">What we process</h2>
    <p>Sigyn processes account and business information, approved knowledge sources, integration data, call metadata, recordings, transcripts, appointments, and usage records to provide managed AI voice services.</p>
    <h2 className="text-2xl font-bold">AI calls and recordings</h2>
    <p>Callers must be told they are interacting with AI and when a call may be recorded or transcribed. Customers are responsible for any additional disclosures or consent required in their jurisdictions.</p>
    <h2 className="text-2xl font-bold">Retention and security</h2>
    <p>Recordings and transcripts are retained for 90 days by default unless a customer selects a shorter period or law requires otherwise. Credentials are encrypted, tenant data is access-controlled, and protected social content is not collected without owner authorization.</p>
    <h2 className="text-2xl font-bold">Your choices</h2>
    <p>Account owners can request a machine-readable export or deletion from account settings. Legal, billing, fraud-prevention, and backup records may be retained when required.</p>
    <h2 className="text-2xl font-bold">Contact</h2>
    <p>Contact the Sigyn team listed in your service agreement for privacy questions or requests.</p>
  </main>;
}
