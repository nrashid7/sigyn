import { scoreGooglePlaceMatch } from "./knowledge.ts";

export interface GooglePlaceCandidate {
  id?: string;
  displayName?: { text?: string };
  websiteUri?: string;
  nationalPhoneNumber?: string;
  formattedAddress?: string;
  regularOpeningHours?: unknown;
  rating?: number;
  userRatingCount?: number;
}

interface BusinessMatchInput {
  name: string;
  website?: string | null;
  phone?: string | null;
  location?: string | null;
}

interface PlacesTextSearchResponse {
  places?: GooglePlaceCandidate[];
}

export async function findMatchingGooglePlace(
  business: BusinessMatchInput,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ place: GooglePlaceCandidate; confidence: number } | null> {
  const query = [business.name, business.location].filter(Boolean).join(" ");
  const response = await fetchImpl("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": [
        "places.id",
        "places.displayName",
        "places.websiteUri",
        "places.nationalPhoneNumber",
        "places.formattedAddress",
        "places.regularOpeningHours",
        "places.rating",
        "places.userRatingCount",
      ].join(","),
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 5 }),
  });

  if (!response.ok) {
    throw new Error(`Google Places search failed (${response.status})`);
  }

  const payload = (await response.json()) as PlacesTextSearchResponse;
  const ranked = (payload.places ?? [])
    .map((place) => ({
      place,
      confidence: scoreGooglePlaceMatch(
        {
          name: business.name,
          website: business.website ?? undefined,
          phone: business.phone ?? undefined,
        },
        {
          name: place.displayName?.text ?? "",
          website: place.websiteUri,
          phone: place.nationalPhoneNumber,
        },
      ),
    }))
    .sort((left, right) => right.confidence - left.confidence);

  const best = ranked[0];
  if (!best || best.confidence < 0.8) return null;

  const runnerUp = ranked[1];
  if (runnerUp && best.confidence - runnerUp.confidence < 0.15) return null;

  return best;
}
