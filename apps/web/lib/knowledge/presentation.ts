export type KnowledgeVoiceStatus = "pending" | "syncing" | "ready" | "failed" | "deleting";

export function knowledgeVoiceStatus(status: string, error: string | null | undefined) {
  switch (status as KnowledgeVoiceStatus) {
    case "ready":
      return {
        label: "Available to calls",
        variant: "success" as const,
        retryable: false,
        terminal: true,
        detail: "Retell can use this source during calls.",
      };
    case "failed":
      return {
        label: "Publish failed",
        variant: "destructive" as const,
        retryable: true,
        terminal: true,
        detail: (error?.trim() || "Retell could not publish this source. Try again.").slice(0, 240),
      };
    case "deleting":
      return {
        label: "Removing",
        variant: "secondary" as const,
        retryable: false,
        terminal: false,
        detail: "Retell is removing this source from calls.",
      };
    case "pending":
    case "syncing":
    default:
      return {
        label: "Publishing",
        variant: "warning" as const,
        retryable: false,
        terminal: false,
        detail: "Retell is preparing this source for calls.",
      };
  }
}
