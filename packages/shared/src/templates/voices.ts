import type { ElevenLabsVoice } from "../types";

export const elevenLabsVoices: ElevenLabsVoice[] = [
  {
    voice_id: "21m00Tcm4TlvDq8ikWAM",
    name: "Rachel",
    category: "Professional",
    is_premium: true,
  },
  {
    voice_id: "EXAVITQu4vr4xnSDxMaL",
    name: "Bella",
    category: "Warm",
    is_premium: true,
  },
  {
    voice_id: "pNInz6obpgDQGcFmaJgB",
    name: "Adam",
    category: "Confident",
    is_premium: true,
  },
  {
    voice_id: "oWAxZDx7w5VEj9dCyTzz",
    name: "Grace",
    category: "Consultative",
    is_premium: true,
  },
];

export const templateSlugMap: Record<string, string> = {
  Dexter: "dexter",
  Zia: "zia",
  Sparky: "sparky",
  Sunny: "sunny",
  Bella: "bella",
};
