import { AppError, requireEnv } from "./errors.ts";

const TWILIO_BASE = "https://api.twilio.com/2010-04-01/Accounts";

async function twilioFetch<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "DELETE";
    form?: Record<string, string>;
    query?: Record<string, string>;
  } = {},
): Promise<T> {
  const accountSid = requireEnv("TWILIO_ACCOUNT_SID");
  const authToken = requireEnv("TWILIO_AUTH_TOKEN");

  const url = new URL(`${TWILIO_BASE}/${accountSid}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }

  const headers: Record<string, string> = {
    Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
  };

  let body: string | undefined;
  if (options.form) {
    body = new URLSearchParams(options.form).toString();
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body,
  });

  const text = await response.text();

  let data: { message?: string } & Record<string, unknown> = {};
  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!response.ok) {
    throw new AppError(
      `Twilio API error: ${data.message ?? response.statusText}`,
      response.status,
      "TWILIO_ERROR",
    );
  }

  if (response.status === 204) return undefined as T;

  return data as T;
}

export async function searchAvailableNumbers(
  options: { areaCode?: string; limit?: number },
): Promise<Array<{ phone_number: string; friendly_name: string }>> {
  const data = await twilioFetch<
    { available_phone_numbers?: Array<{ phone_number: string; friendly_name: string }> }
  >("/AvailablePhoneNumbers/US/Local.json", {
    query: {
      ...(options.areaCode ? { AreaCode: options.areaCode } : {}),
      VoiceEnabled: "true",
      SmsEnabled: "true",
      PageSize: String(options.limit ?? 5),
    },
  });

  return data.available_phone_numbers ?? [];
}

export async function purchaseNumber(
  phoneNumber: string,
  friendlyName: string,
): Promise<{ sid: string; phone_number: string }> {
  return await twilioFetch("/IncomingPhoneNumbers.json", {
    method: "POST",
    form: { PhoneNumber: phoneNumber, FriendlyName: friendlyName },
  });
}

export async function listOwnedNumbers(): Promise<
  Array<{ sid: string; phone_number: string; capabilities: { voice: boolean; sms: boolean } }>
> {
  const data = await twilioFetch<
    {
      incoming_phone_numbers?: Array<
        { sid: string; phone_number: string; capabilities: { voice: boolean; sms: boolean } }
      >;
    }
  >("/IncomingPhoneNumbers.json", { query: { PageSize: "50" } });

  return data.incoming_phone_numbers ?? [];
}

export async function releaseNumber(sid: string): Promise<void> {
  await twilioFetch(`/IncomingPhoneNumbers/${sid}.json`, { method: "DELETE" });
}

/** Reuses an idle owned number when there is one, otherwise buys a fresh one. */
export async function acquireNumber(
  options: { areaCode?: string; friendlyName: string; exclude: string[] },
): Promise<{ sid: string; phone_number: string; reused: boolean }> {
  const owned = await listOwnedNumbers();
  // An agent needs both: voice for the call itself, SMS for the missed-call follow-up.
  // Reusing a voice-only number would silently break every SMS side effect, so a number
  // that cannot do both is left alone and a fresh (voice+SMS) one is purchased instead.
  const reusable = owned.find(
    (number) =>
      number.capabilities?.voice && number.capabilities?.sms &&
      !options.exclude.includes(number.phone_number),
  );
  if (reusable) {
    return { sid: reusable.sid, phone_number: reusable.phone_number, reused: true };
  }

  let available = await searchAvailableNumbers({ areaCode: options.areaCode });
  if (available.length === 0 && options.areaCode) {
    available = await searchAvailableNumbers({});
  }
  if (available.length === 0) {
    throw new AppError(
      "No phone numbers available to purchase",
      502,
      "PHONE_PROVISION_FAILED",
    );
  }

  try {
    const purchased = await purchaseNumber(
      available[0].phone_number,
      options.friendlyName,
    );
    return {
      sid: purchased.sid,
      phone_number: purchased.phone_number,
      reused: false,
    };
  } catch (error) {
    if (error instanceof AppError) {
      if (/trial|upgrade/i.test(error.message)) {
        throw new AppError(
          `Twilio refused the purchase: ${error.message}. Upgrade the Twilio account.`,
          402,
          "PHONE_PROVISION_FAILED",
        );
      }
      throw new AppError(error.message, error.statusCode, "PHONE_PROVISION_FAILED");
    }
    throw error;
  }
}
