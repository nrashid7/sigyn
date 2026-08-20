import { NextResponse } from "next/server";
import { integrationConnectSchema } from "@businessvoice/shared";
import { connectIntegration } from "@/lib/actions/integrations";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = integrationConnectSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message || "Invalid input" },
        { status: 400 }
      );
    }

    const result = await connectIntegration(parsed.data.provider, parsed.data.config || {});
    if (result.error) {
      const status = result.error === "No business found" ? 404 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("Integration connect error:", error);
    return NextResponse.json({ error: "Connection failed" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider");

  if (!provider) {
    return NextResponse.json({ error: "Provider required" }, { status: 400 });
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;

  const apiKeyProviders = ["cal_com", "calendly", "hubspot", "gohighlevel", "google_sheets"];
  if (apiKeyProviders.includes(provider)) {
    return NextResponse.redirect(`${origin}/dashboard/settings/connect?provider=${provider}`);
  }

  return NextResponse.redirect(
    `${origin}/dashboard/settings?connect=${provider}`
  );
}
