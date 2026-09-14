# BusinessVoice AI

**Hire Your First AI Employee.**

AI receptionist SaaS platform for SMBs. Deploy AI phone receptionists that answer calls, qualify leads, book appointments, and send SMS follow-ups — in minutes.

## Tech Stack

- **Frontend:** Next.js 16, TypeScript, TailwindCSS, shadcn/ui, Framer Motion
- **Backend:** Supabase (Postgres, Auth, Storage, Edge Functions)
- **Voice/AI:** ElevenLabs (ElevenAgents: voice, knowledge base, call analysis)
- **SMS:** Twilio
- **Automation:** n8n (Railway)
- **Billing:** Stripe
- **Analytics:** PostHog

## Quick Start

```bash
npm install
cp .env.example apps/web/.env.local
# Fill in environment variables (see docs/ENVIRONMENT.md)
npm run dev
```

## Project Structure

```
├── apps/web/          # Next.js frontend
├── packages/shared/   # Shared types, schemas, agent templates
├── supabase/          # Migrations, Edge Functions, seed data
├── n8n/workflows/     # Automation workflow exports
└── docs/              # Deployment and environment guides
```

## AI Employees

| Agent | Specialty | Vertical |
|-------|-----------|----------|
| Dexter | General Receptionist | General SMB |
| Zia | Salon & Spa Booking | Salon & Spa |
| Sparky | Home Services Dispatcher | Home Services |
| Sunny | Appointment Coordinator | General SMB |
| Bella | Lead Qualification | General SMB |

## Documentation

- [Environment Variables](docs/ENVIRONMENT.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
- [n8n + Supabase Integration](docs/N8N_SUPABASE_SETUP.md)

## License

Proprietary — BusinessVoice AI
