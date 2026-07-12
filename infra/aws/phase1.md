# AWS Migration — Phase 1: Core Infrastructure

Created 2026-07-12 in account `557485610536`, region `us-east-2`.

## Resources

| Resource | Identifier |
|---|---|
| Aurora Serverless v2 cluster (PostgreSQL 17.9) | `chartflo` — `arn:aws:rds:us-east-2:557485610536:cluster:chartflo` |
| Cluster endpoint | `chartflo.cluster-cns0yka6kka9.us-east-2.rds.amazonaws.com` |
| DB instance | `chartflo-1` (db.serverless, 0–2 ACU autoscaling) |
| Master credentials | AWS-managed in Secrets Manager: `rds!cluster-52cb2016-c3c0-4247-a32b-0ba3a7d24143` |
| Data API | enabled (`--enable-http-endpoint`) — SQL over HTTPS, no VPC access needed |
| Cognito user pool | `us-east-2_okjZSsixr` (email sign-in, admin-created users only, matching the app's invite-only model) |
| Cognito web client | `7r1hbq8g7kc441b95gmbepcrmo` (no secret; SRP + password + refresh flows) |

Security posture: storage encrypted at rest, cluster not publicly routable
(default-VPC private networking; admin access via the IAM-authenticated Data
API only), master password managed and rotated by Secrets Manager.

## Reproduce

```bash
aws rds create-db-cluster \
  --db-cluster-identifier chartflo \
  --engine aurora-postgresql --engine-version 17.9 \
  --master-username chartflo --manage-master-user-password \
  --database-name chartflo \
  --serverless-v2-scaling-configuration MinCapacity=0,MaxCapacity=2 \
  --enable-http-endpoint --storage-encrypted

aws rds create-db-instance \
  --db-instance-identifier chartflo-1 --db-cluster-identifier chartflo \
  --engine aurora-postgresql --db-instance-class db.serverless

aws cognito-idp create-user-pool \
  --pool-name chartflo --username-attributes email \
  --auto-verified-attributes email \
  --admin-create-user-config AllowAdminCreateUserOnly=true \
  --policies 'PasswordPolicy={MinimumLength=8,...}'

aws cognito-idp create-user-pool-client \
  --user-pool-id <pool-id> --client-name chartflo-web \
  --no-generate-secret \
  --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH
```

## Phase 2 progress

- [x] `auth` schema shim applied (`auth.uid()`, roles, auth.users mirror,
      storage stub) — `infra/aws/schema/000_auth_shim.sql`
- [x] All 45 migration files applied via Data API: 238/248 statements OK.
      The 10 failures are expected Supabase-isms (storage bucket/logo
      policies → replaced by S3 in a later phase; `GRANT ... TO service_role`
      → role is Supabase-internal)
- [x] Verified: 27 application tables, 58 RLS policies on Aurora
- [x] Data migrated via the `chartflo-data-migrate` Lambda (Supabase REST
      export as the clinic user -> Data API import; Supabase dashboard access
      was unavailable because the project is Lovable-managed). App-level
      triggers were disabled during import and re-enabled after.
- [x] Row counts verified on all 27 tables: 516 patients, 352 medications,
      374 time entries, 360 assessments, 42 notes, 73 problems, 26 care
      plans, 26 vitals, 57 enrollments, 3 clinics, 6 members - all MATCH

## Phase 3 progress (auth)

- [x] `custom:legacy_id` attribute added to the user pool
- [x] All 4 users imported into Cognito (email verified, invite emails
      suppressed until cutover; status FORCE_CHANGE_PASSWORD)
- [x] `auth.uid()` on Aurora now resolves Cognito JWTs: prefers the
      `custom:legacy_id` claim (the Supabase-era UUID that keys all data),
      falls back to `sub`
- [x] Data-plane API LIVE: PostgREST v12 on App Runner at
      https://47xzccwrhz.us-east-2.awsapprunner.com — authenticator role
      with least-privilege grants, VPC connector (sg chartflo-app ->
      chartflo-db :5432 only), Cognito JWKS validation, role claim stamped
      by the chartflo-pretoken Lambda
- [x] End-to-end verified: anon request -> 401; Cognito ID token -> 200
      with RLS-scoped rows; Amy's legacy id resolves all 516 patients
      under the policy expression
- [x] GoTrue-compatible auth shim LIVE (chartflo-auth Lambda): password +
      refresh-token grants, /user, /logout, /recover; sessions carry the
      legacy user id so all app code keeps working
- [x] Unified gateway LIVE: https://z7e0ilsrfa.execute-api.us-east-2.amazonaws.com
      routes /auth/v1/* to the shim and /rest/v1/* to PostgREST. Verified:
      login -> session -> RLS-scoped data query -> 200; anon -> 401
- [x] Frontend backend flag: VITE_BACKEND=aws switches supabase-js to the
      gateway (src/integrations/supabase/client.ts); default stays Supabase
- [x] Bedrock verified in-account (Claude Haiku 4.5 / Sonnet 4.6) — AI
      functions run in AWS, PHI never leaves the account
- [x] /functions/v1/{name} route LIVE behind a Cognito JWT authorizer ->
      chartflo-functions router Lambda (source: infra/aws/functions/)
- [x] First port verified end to end: structure-soap (prompt preserved
      verbatim, Bedrock tool-choice replaces the Lovable gateway) returned
      a structured SOAP note with ICD-10 codes through the gateway
- [x] 14 of 25 functions ported and deployed: structure-soap plus the AI
      batch (suggest-icd/cpt/mips, extract-medications/screenings/
      clinical-data, generate-avs, generate-ccm-care-plan,
      summarize-for-family, group-plan-by-dx, ccm-log-assist,
      ccm-batch-parse, code-lookup). Prompts verbatim; router injects
      aiTool/aiText helpers; routing + input validation verified live.
- [ ] USER ACTION: submit the Anthropic use-case form in the Bedrock
      console (Bedrock -> Model access) — the account gated Anthropic
      models after the first verified calls; all AI functions 500 with
      the form message until submitted (instant approval, one time)
- [x] transcribe-audio ported to Amazon Transcribe Medical (PRIMARYCARE
      conversation mode, Provider/Patient speaker mapping, dedicated
      encrypted audio bucket with 1-day auto-delete). Verified live with
      Polly-generated speech: "one fifty over ninety five" -> "150/95",
      "ten milligrams" -> "10 mg". Long recordings return a pending job
      the frontend now polls (AmbientDictation.invokeTranscribe).
- [x] DB/team batch ported and verified live: compute-monthly-superbill
      (empty-scoped result for a no-access user), clinic-member-statuses
      (validation + Cognito-backed statuses), export-fhir (valid Bundle),
      resolve-active-patient, invite-clinic-member (Cognito invite email +
      profiles/clinic_members inserts), resend-clinic-invite (invite resend
      or password-reset email via new cognito.resetPassword helper);
      generate-avs and suggest-icd DB side-writes completed
- [x] Bedrock unlocked after the use-case form — previously gated AI
      functions verified live (suggest-icd coded output, family summary)
- [ ] Deliberately unported (router 501s them): dispatch-sync (feature
      removed from UI), pf-oauth-token + pf-fhir-import (Practice Fusion
      re-auth at cutover), ingest-reading (device vendors will point at a
      dedicated endpoint at cutover)
- [x] Storage (clinic logos) to S3: logo-storage function (upload +
      presigned URLs, verified live) with a frontend adapter
      (src/lib/logoStorage.ts) that keeps the Supabase path by default
- [ ] Password-reset emails to all users at cutover

## Cost note

Aurora Serverless v2 with MinCapacity=0 pauses when idle — near-zero cost
until traffic arrives; scales to 2 ACU (~$0.24/hr) under load.

## Reminder

The IAM access key used for this work was shared in chat — rotate it
(IAM → Users → amyfowers → Security credentials) once the migration completes.
