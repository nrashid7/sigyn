import { NextResponse } from "next/server";
import { getUser } from "@/lib/actions/auth";
import { getBusiness } from "@/lib/actions/business";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const [user, business] = await Promise.all([getUser(), getBusiness()]);
  if (!user || !business) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = await createClient();
  const tables = ["business_facts", "business_sources", "agents", "calls", "appointments", "integrations"] as const;
  const entries = await Promise.all(tables.map(async (table) => {
    const { data } = await supabase.from(table).select("*").eq("business_id", business.id);
    return [table, data ?? []] as const;
  }));
  return new NextResponse(JSON.stringify({ exported_at: new Date().toISOString(), account: { id: user.id, email: user.email }, business, ...Object.fromEntries(entries) }, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="sigyn-export-${business.id}.json"` },
  });
}
