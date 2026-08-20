"use client";

import { motion } from "framer-motion";
import type { AgentTemplateConfig } from "@businessvoice/shared";
import { MarketingAgentCard } from "./agent-card";

interface AgentShowcaseProps {
  templates: AgentTemplateConfig[];
}

export function AgentShowcase({ templates }: AgentShowcaseProps) {
  return (
    <section id="agents" className="section-shell relative px-4">
      <div className="mx-auto max-w-7xl px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-14 text-center"
        >
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-primary">
            Prebuilt voice agents
          </p>
          <h2 className="mt-3 text-4xl font-black tracking-tight text-slate-950 md:text-5xl">
            Hire the agent your phones need first.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Each Sigyn agent starts with a proven call role, then gets tailored to your hours, services, scripts, and handoff rules.
          </p>
        </motion.div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {templates.filter((template) => ["Dexter", "Zia", "Sparky", "Bella"].includes(template.agent_name)).map((template, i) => (
            <MarketingAgentCard key={template.agent_name} template={template} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
