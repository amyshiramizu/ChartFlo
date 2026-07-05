# ChartFlo

CCM (Chronic Care Management) and RPM (Remote Patient Monitoring) platform for
medical practices: patient dashboards, care plans, billing (CPT/ICD coding
assistance, monthly superbills), ambient dictation with SOAP notes, and a
Practice Fusion integration (including a browser extension).

Built with Vite, React, TypeScript, Tailwind, and shadcn/ui. Backend (database,
auth, edge functions) runs on Supabase.

## Local development

```bash
npm install
npm run dev      # http://localhost:8080
```

Other scripts:

```bash
npm run build    # production build → dist/
npm test         # vitest
npm run lint     # eslint
```

## Deploying to AWS

See [docs/AWS_DEPLOYMENT.md](docs/AWS_DEPLOYMENT.md). Supported paths:

- **AWS Amplify Hosting** — managed CI/CD from GitHub (`amplify.yml` included)
- **S3 + CloudFront** — static hosting (`scripts/deploy-s3.sh` included)
- **Docker on ECS Fargate / App Runner** — multi-stage `Dockerfile` + nginx included

## Project structure

- `src/pages/` — routed pages (CCM/RPM dashboards, billing, notes, settings…)
- `src/components/` — feature components and shadcn/ui primitives
- `src/lib/` — billing engine, code catalogs, CMS checklist logic
- `supabase/migrations/` — database schema
- `supabase/functions/` — edge functions (AI assist, PF integration, exports)
- `extension/` — Practice Fusion browser extension
