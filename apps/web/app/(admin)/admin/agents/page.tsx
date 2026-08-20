import { activateAgent, getAdminAgentDeployments, pauseAgent, provisionAgent, recordAgentLaunchTests, rollbackAgent } from "@/lib/actions/admin";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function AdminAgentsPage() {
  const agents = await getAdminAgentDeployments();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Managed agent launches</h1>
        <p className="mt-1 text-muted-foreground">Provision only after fact review and billing checks are complete.</p>
      </div>
      {agents.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No agent requests yet.</CardContent></Card>
      ) : agents.map((agent) => {
        const business = Array.isArray(agent.businesses) ? agent.businesses[0] : agent.businesses;
        const template = Array.isArray(agent.agent_templates) ? agent.agent_templates[0] : agent.agent_templates;
        const deployments = [...(agent.agent_deployments ?? [])].sort((a, b) => b.deployment_version - a.deployment_version);
        const latest = deployments[0];
        return (
          <Card key={agent.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-4">
                <CardTitle className="text-lg">{agent.name}</CardTitle>
                <Badge variant={agent.lifecycle_status === "live" ? "success" : agent.lifecycle_status === "failed" ? "destructive" : "secondary"}>
                  {agent.lifecycle_status.replaceAll("_", " ")}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex items-end justify-between gap-4 text-sm">
              <div className="space-y-1 text-muted-foreground">
                <p>Business: {business?.name ?? agent.business_id}</p>
                <p>Template: {template?.name ?? template?.slug ?? "Unknown"}</p>
                <p>Retell: {agent.retell_agent_id ?? "not provisioned"}</p>
                {latest && <p>Deployment: v{latest.deployment_version} · tests {JSON.stringify(latest.test_result)}</p>}
                {agent.last_error && <p className="text-destructive">{agent.last_error}</p>}
              </div>
              {(["draft", "failed", "needs_review"] as string[]).includes(agent.lifecycle_status) && (
                <form action={provisionAgent}>
                  <input type="hidden" name="agent_id" value={agent.id} />
                  <Button type="submit">Provision for testing</Button>
                </form>
              )}
              {agent.lifecycle_status === "testing" && (
                <form action={recordAgentLaunchTests} className="space-y-2">
                  <input type="hidden" name="agent_id" value={agent.id} />
                  <Input name="overall_success" type="number" min="0.95" max="1" step="0.01" placeholder="Success rate (0.95-1)" required />
                  <label className="block"><input name="critical_passed" type="checkbox" required /> All critical simulations passed</label>
                  <label className="block"><input name="staff_test_passed" type="checkbox" required /> Staff test call passed</label>
                  <Button type="submit">Approve tests</Button>
                </form>
              )}
              {agent.lifecycle_status === "ready" && (
                <form action={activateAgent} className="flex gap-2">
                  <input type="hidden" name="agent_id" value={agent.id} />
                  <Input name="phone_number" placeholder="+16125550123" required />
                  <Button type="submit">Assign & launch</Button>
                </form>
              )}
              {agent.lifecycle_status === "live" && (
                <form action={pauseAgent}><input type="hidden" name="agent_id" value={agent.id} /><Button variant="destructive" type="submit">Pause</Button></form>
              )}
              {deployments.length > 1 && (
                <form action={rollbackAgent}><input type="hidden" name="agent_id" value={agent.id} /><Button variant="outline" type="submit">Rollback</Button></form>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
