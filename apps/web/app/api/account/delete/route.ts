import { NextResponse } from "next/server";
import { getUser } from "@/lib/actions/auth";
import { getBusiness } from "@/lib/actions/business";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const [user, business] = await Promise.all([getUser(), getBusiness()]);
  if (!user || !business) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { confirmation?: string };
  if (body.confirmation !== "DELETE MY ACCOUNT") {
    return NextResponse.json({ error: "Type DELETE MY ACCOUNT to confirm" }, { status: 400 });
  }
  const admin = createAdminClient();
  const { count } = await admin.from("business_members").select("id", { count: "exact", head: true }).eq("business_id", business.id);
  if ((count ?? 0) <= 1) await admin.from("businesses").delete().eq("id", business.id);
  else await admin.from("business_members").delete().eq("business_id", business.id).eq("user_id", user.id);
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return NextResponse.json({ error: "Account deletion could not be completed" }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
