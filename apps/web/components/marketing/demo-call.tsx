"use client";

import { motion } from "framer-motion";
import { Building2, CheckCircle2, Mic, PhoneCall, Volume2 } from "lucide-react";
import { useState } from "react";
import { agentTemplates } from "@businessvoice/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function DemoCall() {
  const [phone, setPhone] = useState("");
  const [business, setBusiness] = useState("");
  const [agent, setAgent] = useState(agentTemplates[0].agent_name);
  const [status, setStatus] = useState<"idle" | "calling" | "done">("idle");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDemo = async () => {
    if (!phone) return;
    setError(null);
    setStatus("calling");
    const response = await fetch("/api/demo/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone, business, agent, consent,
        time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      setStatus("idle");
      setError(result.error ?? "Could not start the demo call");
      return;
    }
    setStatus("done");
  };

  return (
    <section id="demo" className="section-shell px-4">
      <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-primary">
            Live proof
          </p>
          <h2 className="mt-3 text-4xl font-black tracking-tight text-slate-950 md:text-5xl">
            Try a Sigyn agent on your own phone.
          </h2>
          <p className="mt-5 text-lg leading-8 text-muted-foreground">
            Choose an agent, enter your number, and hear how a real customer call can be handled. For production, we tailor the script, business rules, calendar, and handoff logic before launch.
          </p>
          <div className="mt-8 grid gap-3">
            {[
              "No hard-sell demo script",
              "Built around your business hours and services",
              "Designed for missed calls, bookings, and lead capture",
            ].map((item) => (
              <div key={item} className="flex items-center gap-3 text-sm font-semibold text-slate-700">
                <CheckCircle2 className="h-5 w-5 text-primary" />
                {item}
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
        >
          <Card className="border-blue-100 shadow-xl shadow-blue-950/10">
            <CardContent className="grid gap-6 p-6 md:p-8">
              <div className="flex items-center gap-4">
                <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-primary text-white shadow-lg shadow-blue-600/25">
                  <PhoneCall className="h-7 w-7" />
                  {status === "calling" && (
                    <motion.div
                      className="absolute inset-0 rounded-full border-2 border-primary"
                      animate={{ scale: [1, 1.45], opacity: [0.9, 0] }}
                      transition={{ repeat: Infinity, duration: 1.3 }}
                    />
                  )}
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-950">Book a demo call</h3>
                  <p className="text-sm text-muted-foreground">A Sigyn specialist can follow up after the live preview.</p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor="business">Business Name</Label>
                  <div className="relative mt-1.5">
                    <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="business"
                      placeholder="Sunrise Salon"
                      value={business}
                      onChange={(e) => setBusiness(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="+1 (555) 000-0000"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label>Agent</Label>
                  <Select value={agent} onValueChange={setAgent}>
                    <SelectTrigger className="mt-1.5 h-11 bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {agentTemplates.filter((template) => ["Dexter", "Zia", "Sparky", "Bella"].includes(template.agent_name)).map((template) => (
                        <SelectItem key={template.agent_name} value={template.agent_name}>
                          {template.agent_name} - {template.display.specialty}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <label className="flex items-start gap-3 text-xs leading-5 text-muted-foreground">
                <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1" />
                <span>I consent to an AI-generated callback that may be recorded and transcribed for this demo. I can end the call at any time.</span>
              </label>
              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button
                size="lg"
                className="w-full"
                onClick={handleDemo}
                disabled={status === "calling" || !phone || !consent}
              >
                {status === "idle" && (
                  <>
                    <Mic className="h-4 w-4" />
                    Try a Live Call
                  </>
                )}
                {status === "calling" && "Calling..."}
                {status === "done" && (
                  <>
                    <Volume2 className="h-4 w-4" />
                    Demo request received
                  </>
                )}
              </Button>

              <p className="text-center text-xs leading-5 text-muted-foreground">
                Demo calls are free. Standard carrier rates may apply. Calls are only placed from 8 AM–8 PM local time.
              </p>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </section>
  );
}
