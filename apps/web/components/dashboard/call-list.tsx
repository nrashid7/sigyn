import Link from "next/link";
import type { Call } from "@businessvoice/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate, formatDuration } from "@/lib/utils";
import { Phone, ArrowRight } from "lucide-react";

interface CallListProps {
  calls: Call[];
}

const statusVariant: Record<string, "success" | "warning" | "destructive" | "secondary"> = {
  completed: "success",
  in_progress: "warning",
  ringing: "warning",
  no_answer: "destructive",
  failed: "destructive",
  transferred: "secondary",
};

const outcomeLabels: Record<string, string> = {
  answered: "Answered",
  booked: "Booked",
  qualified_lead: "Qualified Lead",
  transferred: "Transferred",
  voicemail: "Voicemail",
  missed: "Missed",
  other: "Other",
};

export function CallList({ calls }: CallListProps) {
  if (calls.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Phone className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="font-semibold">No calls yet</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Calls will appear here once your AI employee goes live.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {calls.map((call) => (
        <Link key={call.id} href={`/dashboard/calls/${call.id}`}>
          <Card className="hover:bg-white/5 transition-colors cursor-pointer">
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-500/20">
                  <Phone className="h-4 w-4 text-indigo-400" />
                </div>
                <div>
                  <p className="font-medium">
                    {call.caller_number || "Unknown Caller"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {formatDate(call.started_at ?? call.created_at)}
                    {call.duration_seconds > 0 && ` · ${formatDuration(call.duration_seconds)}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {call.outcome && (
                  <Badge variant="outline">{outcomeLabels[call.outcome] || call.outcome}</Badge>
                )}
                <Badge variant={statusVariant[call.status] || "secondary"}>
                  {call.status.replace("_", " ")}
                </Badge>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
