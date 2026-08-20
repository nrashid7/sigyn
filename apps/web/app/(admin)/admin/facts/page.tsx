import { ExternalLink } from "lucide-react";
import { getAdminFacts, reviewBusinessFact } from "@/lib/actions/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function AdminFactsPage() {
  const facts = await getAdminFacts();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Business fact review</h1>
        <p className="mt-1 text-muted-foreground">
          Only approved facts are published to customer voice agents.
        </p>
      </div>
      {facts.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No facts need review.</CardContent></Card>
      ) : facts.map((fact) => {
        const business = Array.isArray(fact.businesses) ? fact.businesses[0] : fact.businesses;
        return (
          <Card key={fact.id}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-4">
                <CardTitle className="text-base">{business?.name ?? fact.business_id}</CardTitle>
                <Badge variant={fact.confidence >= 0.9 ? "success" : "warning"}>
                  {Math.round(Number(fact.confidence) * 100)}% confidence
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{fact.category} / {fact.fact_key}</p>
                <pre className="mt-1 whitespace-pre-wrap text-sm">{typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value, null, 2)}</pre>
              </div>
              <div className="flex items-center justify-between gap-3">
                {fact.source_url ? (
                  <a className="flex items-center gap-1 text-xs text-indigo-400 hover:underline" href={fact.source_url} target="_blank" rel="noreferrer">
                    View source <ExternalLink className="h-3 w-3" />
                  </a>
                ) : <span />}
                <div className="flex gap-2">
                  <form action={reviewBusinessFact}>
                    <input type="hidden" name="fact_id" value={fact.id} />
                    <input type="hidden" name="decision" value="rejected" />
                    <Button type="submit" variant="outline" size="sm">Reject</Button>
                  </form>
                  <form action={reviewBusinessFact}>
                    <input type="hidden" name="fact_id" value={fact.id} />
                    <input type="hidden" name="decision" value="approved" />
                    <Button type="submit" size="sm">Approve</Button>
                  </form>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
