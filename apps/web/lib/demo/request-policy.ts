export function normalizeUsPhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10 || national.startsWith("0") || national.startsWith("1")) {
    throw new Error("Enter a valid US phone number");
  }
  return `+1${national}`;
}

export function isDemoQuietHour(now: Date, timeZone: string): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone, hour: "numeric", hour12: false,
  }).format(now));
  return hour < 8 || hour >= 20;
}
