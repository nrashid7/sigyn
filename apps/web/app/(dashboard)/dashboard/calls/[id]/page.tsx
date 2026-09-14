import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Phone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TranscriptViewer } from "@/components/dashboard/transcript-viewer";
import { getCall, getCallTranscript } from "@/lib/actions/calls";
import { formatDate, formatDuration } from "@/lib/utils";

interface CallDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function CallDetailPage({ params }: CallDetailPageProps) {
  const { id } = await params;
  const [call, transcript] = await Promise.all([
    getCall(id),
    getCallTranscript(id),
  ]);

  if (!call) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/calls">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Phone className="h-5 w-5 text-indigo-400" />
            {call.caller_number || "Unknown Caller"}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {formatDate(call.started_at ?? call.created_at)}
            {call.duration_seconds > 0 && ` · ${formatDuration(call.duration_seconds)}`}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{call.status.replace("_", " ")}</Badge>
        {call.outcome && <Badge variant="success">{call.outcome.replace("_", " ")}</Badge>}
        {call.sentiment && <Badge variant="secondary">{call.sentiment}</Badge>}
        {call.lead_score !== null && (
          <Badge variant="default">Lead Score: {call.lead_score}</Badge>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {transcript ? (
            <TranscriptViewer transcript={transcript} />
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                Transcript not available for this call.
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {call.recording_url && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Recording</CardTitle>
              </CardHeader>
              <CardContent>
                <audio controls className="w-full" src={call.recording_url}>
                  Your browser does not support audio playback.
                </audio>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
