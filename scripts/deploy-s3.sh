#!/usr/bin/env bash
# Deploy the ChartFlo frontend to S3 + CloudFront.
#
# Usage:
#   S3_BUCKET=my-chartflo-bucket [CLOUDFRONT_DISTRIBUTION_ID=E123ABC] ./scripts/deploy-s3.sh
#
# Requires: aws CLI v2 configured with credentials that can write to the
# bucket (and create CloudFront invalidations, if a distribution is set).
set -euo pipefail

: "${S3_BUCKET:?Set S3_BUCKET to the target bucket name}"

cd "$(dirname "$0")/.."

echo "==> Building production bundle"
npm run build

echo "==> Syncing dist/ to s3://${S3_BUCKET}"
# Hashed assets are immutable — cache for a year
aws s3 sync dist/ "s3://${S3_BUCKET}" \
  --delete \
  --exclude "index.html" \
  --cache-control "public, max-age=31536000, immutable"

# index.html must always be revalidated so new deploys take effect
aws s3 cp dist/index.html "s3://${S3_BUCKET}/index.html" \
  --cache-control "no-cache"

if [[ -n "${CLOUDFRONT_DISTRIBUTION_ID:-}" ]]; then
  echo "==> Invalidating CloudFront distribution ${CLOUDFRONT_DISTRIBUTION_ID}"
  aws cloudfront create-invalidation \
    --distribution-id "${CLOUDFRONT_DISTRIBUTION_ID}" \
    --paths "/index.html" >/dev/null
fi

echo "==> Done"
