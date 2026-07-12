# Supabase → AWS Migration Plan

**Goal:** move ChartFlo's backend (database, auth, server functions) from
Supabase to AWS-native services, primarily to obtain HIPAA coverage under
AWS's no-cost BAA instead of Supabase's ~$800–950/mo compliant tier.

**Ground rules for the migration:**
- The app stays fully working on Supabase until the final cutover.
- Each phase lands as its own PR, deployable and revertible.
- No data is deleted from Supabase until the parallel-run phase confirms AWS
  is complete and correct.

## Current footprint (audited)

- **~220 Supabase client call sites** in the frontend
- **26 database tables**, heaviest traffic: `patients` (21 call sites),
  `ccm_time_entries` (21), `patient_problems` (18), `clinical_notes` (18),
  `medications` (17), `patient_assessments` (13)
- **Auth usage:** email/password sign-in, password reset, session handling,
  and 20 `getUser()` call sites; RLS policies scope every table by owner or
  clinic membership
- **25 edge functions** (AI note structuring, transcription, Practice Fusion
  OAuth/FHIR, superbills, invites, readings ingestion, etc.)
- **Realtime/storage:** storage used for clinic logos only; no realtime
  subscriptions found

## Target architecture

| Supabase piece | AWS replacement | Notes |
|---|---|---|
| Postgres | **Aurora Serverless v2 (PostgreSQL)** | Schema ports as-is; RLS policies keep working since Aurora is real Postgres |
| Auth | **Cognito user pool** | Email/password + reset flows; JWT claims carry clinic membership |
| Client data access (PostgREST) | **PostgREST on App Runner** pointed at Aurora | Keeps the `supabase-js` query style workable via a thin adapter, avoiding a rewrite of all 220 call sites in one go |
| Edge functions | **Lambda + API Gateway (HTTP API)** | Deno → Node handlers; secrets to SSM Parameter Store |
| Storage (clinic logos) | **S3 + CloudFront** | Small, one bucket |
| Hosting | **Amplify** (already done) | Unchanged |

The PostgREST-adapter choice is the key de-risking decision: it preserves the
app's query layer semantics (including RLS via JWT), so the frontend change is
concentrated in one client file instead of hundreds of call sites.

## Phases

1. **Infrastructure (IaC)** — CloudFormation/CDK for VPC, Aurora, Cognito,
   App Runner, API Gateway, S3. *Needs working AWS credentials.*
2. **Schema + data migration** — apply the 40+ SQL migrations to Aurora;
   `pg_dump` from Supabase (needs the Supabase service key / db password) and
   restore; checksum row counts per table.
3. **Auth cutover prep** — Cognito pool + user import (password reset email
   flow for existing users, since password hashes can't be exported), JWT
   claim mapping for `is_clinic_member`.
4. **Functions port** — 25 edge functions → Lambda, one PR per batch of ~5,
   each verified against staging.
5. **Client adapter** — swap `src/integrations/supabase/client.ts` to the
   AWS endpoints behind an env flag (`VITE_BACKEND=aws|supabase`).
6. **Parallel run & cutover** — staging URL on AWS backend; verify every
   page; flip the env flag on main; keep Supabase read-only for 30 days as
   rollback.

## Blockers (user-side, one-time)

1. **Working AWS credentials** in this Claude environment
   (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` for an IAM user with
   admin or CloudFormation+RDS+Cognito+Lambda+APIGW+S3+IAM permissions).
   Current keys are rejected by AWS (`InvalidClientTokenId`).
2. **Supabase database password or service role key** (dashboard → Settings)
   for the data export in phase 2.
3. **Accept the AWS BAA** in AWS Artifact (console → AWS Artifact →
   Agreements) before real patient data lands in Aurora.

## Cost estimate (steady state)

Aurora Serverless v2 at minimum capacity ~$45/mo, App Runner ~$5–15/mo,
Lambda/API Gateway ~$1–5/mo at current volume, S3/CloudFront <$1/mo —
**roughly $50–70/month**, vs ~$900/month for Supabase's HIPAA tier.
