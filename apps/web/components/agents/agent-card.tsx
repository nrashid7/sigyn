"use client";

import { Play, Loader2 } from "lucide-react";
import type { Agent } from "@businessvoice/shared";
import { agentTemplates } from "@businessvoice/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useVoicePreview } from "@/lib/hooks/use-voice-preview";
import { cn } from "@/lib/utils";

interface AgentCardProps {
  agent: Agent;
}

export function DashboardAgentCard({ agent }: AgentCardProps) {
  const template = agentTemplates.find(
    (t) => t.agent_name.toLowerCase() === agent.name.toLowerCase()
  );
  const { playPreview, playing, loading } = useVoicePreview();
  const voiceId = agent.voice_id ?? template?.voice.elevenlabs_voice_id ?? "";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <Avatar className="h-12 w-12">
            <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-violet-600">
              {agent.name[0]}
            </AvatarFallback>
          </Avatar>
          <Badge variant={agent.is_active ? "default" : "secondary"}>
            {agent.is_active ? "Active" : "Inactive"}
          </Badge>
        </div>
        <CardTitle className="mt-3">{agent.name}</CardTitle>
        {template && (
          <p className="text-sm text-muted-foreground">{template.display.specialty}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {agent.provision_status === "failed" ? (
          <Badge variant="destructive" title={agent.provision_error ?? undefined}>
            Setup failed
          </Badge>
        ) : agent.provision_status === "provisioning" ? (
          <Badge variant="warning">Setting up…</Badge>
        ) : (
          agent.phone_number && (
            <p className="text-sm">
              <span className="text-muted-foreground">Phone: </span>
              <span className="font-mono text-indigo-300">{agent.phone_number}</span>
            </p>
          )
        )}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => voiceId && playPreview(voiceId, `Hi, I'm ${agent.name}.`)}
            disabled={loading || !voiceId}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className={cn("h-4 w-4", playing && "text-cyan-400")} />
            )}
            Preview Voice
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
