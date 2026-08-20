export interface BusinessCreationInput {
  name: string;
  website?: string;
  industry: string;
  phone: string;
  timezone: string;
  hours: Record<string, unknown>;
}

interface RpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export async function createBusinessForCurrentUser(
  client: RpcClient,
  input: BusinessCreationInput,
) {
  const { data, error } = await client.rpc("create_business_for_current_user", {
    business_name: input.name,
    business_website: input.website ?? "",
    business_industry: input.industry,
    business_phone: input.phone,
    business_timezone: input.timezone,
    business_hours: input.hours,
  });

  if (error) throw new Error(error.message);
  return data;
}
