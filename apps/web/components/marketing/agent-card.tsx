"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { Check, Loader2, Play } from "lucide-react";
import type { AgentTemplateConfig } from "@businessvoice/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useVoicePreview } from "@/lib/hooks/use-voice-preview";
import { cn } from "@/lib/utils";

interface MarketingAgentCardProps {
  template: AgentTemplateConfig;
  index: number;
}

const agentAccent: Record<string, string> = {
  Dexter: "border-t-blue-500 bg-blue-50",
  Zia: "border-t-rose-500 bg-rose-50",
  Sunny: "border-t-amber-500 bg-amber-50",
  Sparky: "border-t-cyan-600 bg-cyan-50",
  Bella: "border-t-fuchsia-500 bg-fuchsia-50",
};

const agentPortraits: Record<string, string> = {
  Dexter: "/agents/dexter.png",
  Zia: "/agents/zia.png",
  Sunny: "/agents/sunny.png",
  Sparky: "/agents/sparky.png",
  Bella: "/agents/bella.png",
};

export function MarketingAgentCard({ template, index }: MarketingAgentCardProps) {
  const { display, agent_name, voice } = template;
  const { playPreview, playing, loading } = useVoicePreview();
  const previewVoiceId = voice.elevenlabs_voice_id;
  const portrait = agentPortraits[agent_name] ?? display.avatar;

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.08 }}
    >
      <Card className={cn("group h-full overflow-hidden border-t-4 transition-transform hover:-translate-y-1", agentAccent[agent_name])}>
        <div className="relative mx-5 mt-5 aspect-[4/3] overflow-hidden rounded-lg bg-white">
          <Image
            src={portrait}
            alt={`${agent_name}, Sigyn ${display.specialty}`}
            fill
            sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
            className="object-cover object-top"
          />
          <Button
            variant="outline"
            size="icon"
            className="absolute right-3 top-3 bg-white/90 shadow-sm"
            onClick={() => playPreview(previewVoiceId, `Hi, I'm ${agent_name}. ${display.tagline}`)}
            disabled={loading}
            aria-label={`Play ${agent_name} voice preview`}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className={cn("h-4 w-4", playing && "text-primary")} />
            )}
          </Button>
        </div>

        <CardContent className="grid gap-4 p-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
              {display.specialty}
            </p>
            <h3 className="mt-1 text-2xl font-black text-slate-950">{agent_name}</h3>
            <p className="mt-2 text-sm font-medium text-slate-700">&ldquo;{display.tagline}&rdquo;</p>
          </div>

          <p className="text-sm leading-6 text-muted-foreground">{display.description}</p>

          <ul className="grid gap-2">
            {display.features.slice(0, 3).map((feature) => (
              <li key={feature} className="flex items-start gap-2 text-sm text-slate-700">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                {feature}
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap gap-1.5 pt-1">
            {display.industries.map((industry) => (
              <Badge key={industry} variant="outline" className="bg-white text-xs">
                {industry}
              </Badge>
            ))}
          </div>

          <Button variant="outline" className="mt-1 w-full" asChild>
            <a href="#demo">Meet {agent_name}</a>
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}
