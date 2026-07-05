import { supabase } from '@/integrations/supabase/client';

const BUCKET = 'clinic-logos';
const SIGNED_EXPIRY_SECONDS = 60 * 60 * 24 * 7; // 7 days

/**
 * Extract the storage object path from a value that may be:
 *  - a legacy public URL (`.../storage/v1/object/public/clinic-logos/<path>`)
 *  - a signed URL (`.../storage/v1/object/sign/clinic-logos/<path>?token=...`)
 *  - a bare path (`<clinic_id>/logo-...png`)
 *  - an arbitrary external URL (pass-through)
 *  - empty
 */
export function extractClinicLogoPath(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  const marker = `/${BUCKET}/`;
  const idx = v.indexOf(marker);
  if (idx !== -1) {
    return v.substring(idx + marker.length).split('?')[0];
  }
  // External http(s) URLs — not a storage path
  if (/^https?:\/\//i.test(v)) return null;
  // Treat as raw path
  return v;
}

export function isExternalLogoUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value.trim();
  if (!/^https?:\/\//i.test(v)) return false;
  return !v.includes(`/${BUCKET}/`);
}

/**
 * Resolve a stored logo/favicon value to a URL usable by an <img> tag.
 * Returns null when the value cannot be resolved (e.g. user lacks access).
 */
export async function resolveClinicLogoUrl(
  value: string | null | undefined,
): Promise<string | null> {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  if (isExternalLogoUrl(v)) return v;
  const path = extractClinicLogoPath(v);
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_EXPIRY_SECONDS);
  if (error || !data) return null;
  return data.signedUrl;
}
