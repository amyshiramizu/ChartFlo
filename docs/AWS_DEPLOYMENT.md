# Deploying ChartFlo on AWS

ChartFlo's frontend is a static single-page app (Vite + React). All backend
functionality lives in Supabase (database, auth, edge functions), so "running
in AWS" means hosting the built frontend. Three supported paths, easiest first.

> **Note on environment variables:** Vite bakes `VITE_*` variables into the
> bundle **at build time**. The committed `.env` holds the Supabase URL and
> publishable (anon) key — these are safe client-side values. To point at a
> different Supabase project, override them at build time; changing them after
> the build has no effect.

---

## Option 1 — AWS Amplify Hosting (easiest, recommended)

Fully managed static hosting with CI/CD from GitHub. The repo already includes
`amplify.yml`.

1. AWS Console → **Amplify** → **Create new app** → **GitHub**, and pick this
   repo + branch (`main`).
2. Amplify auto-detects `amplify.yml`. No changes needed.
3. Under **App settings → Rewrites and redirects**, add the SPA fallback so
   React Router routes work on refresh:
   - Source: `</^[^.]+$|\.(?!(css|js|json|png|jpg|svg|webp|ico|txt|map|woff2?)$)([^.]+$)/>`
   - Target: `/index.html`
   - Type: `200 (Rewrite)`
4. Save & deploy. Every push to `main` redeploys automatically.

## Option 2 — S3 + CloudFront (cheapest at scale)

Classic static hosting. The repo includes `scripts/deploy-s3.sh`.

**One-time setup:**

1. Create a private S3 bucket (e.g. `chartflo-web`). Keep "Block all public
   access" ON — CloudFront will access it via OAC.
2. Create a CloudFront distribution:
   - Origin: the S3 bucket, with **Origin Access Control (OAC)** enabled
     (CloudFront offers to update the bucket policy for you).
   - Default root object: `index.html`.
   - Viewer protocol policy: Redirect HTTP → HTTPS.
   - **Custom error responses** (SPA fallback): map both `403` and `404` to
     `/index.html` with response code `200`.
3. (Optional) Attach an ACM certificate + Route 53 alias for a custom domain.

**Each deploy:**

```bash
S3_BUCKET=chartflo-web CLOUDFRONT_DISTRIBUTION_ID=E123ABC ./scripts/deploy-s3.sh
```

## Option 3 — Docker on ECS Fargate / App Runner / EC2

For teams that standardize on containers. The repo includes a multi-stage
`Dockerfile` (Node build → nginx serve) and `nginx.conf` with SPA fallback,
asset caching, and a `/healthz` endpoint.

**Build and test locally:**

```bash
docker build -t chartflo .
docker run -p 8080:80 chartflo
# open http://localhost:8080
```

**Push to ECR:**

```bash
aws ecr create-repository --repository-name chartflo
aws ecr get-login-password | docker login --username AWS \
  --password-stdin <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com
docker tag chartflo:latest <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/chartflo:latest
docker push <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/chartflo:latest
```

**Then run it on:**

- **App Runner** (simplest container option): create a service from the ECR
  image, port `80`, health check path `/healthz`. App Runner gives you HTTPS
  and autoscaling out of the box.
- **ECS Fargate**: task definition with the ECR image (port 80, 0.25 vCPU /
  512 MB is plenty), behind an ALB with health check path `/healthz`.

To build against a different Supabase project:

```bash
docker build \
  --build-arg VITE_SUPABASE_URL=https://<project>.supabase.co \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY=<anon-key> \
  --build-arg VITE_SUPABASE_PROJECT_ID=<project> \
  -t chartflo .
```

---

## Supabase backend

The frontend talks directly to Supabase — nothing to deploy in AWS for it.
When standing up a fresh Supabase project:

```bash
supabase link --project-ref <project>
supabase db push          # applies supabase/migrations/
supabase functions deploy # deploys supabase/functions/
```

Then rebuild the frontend with the new project's URL/key (see the note at the
top).
