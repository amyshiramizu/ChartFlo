import { supabase } from '@/integrations/supabase/client';

// Clinic logo/favicon storage adapter. On Supabase it uses the storage
// bucket directly; on the AWS backend it goes through the logo-storage
// function, which stores files in the private S3 bucket and issues
// presigned URLs.
const USE_AWS = import.meta.env.VITE_BACKEND === 'aws';
const BUCKET = 'clinic-logos';

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.onload = () => {
      const r = String(reader.result || '');
      const c = r.indexOf(',');
      resolve(c >= 0 ? r.slice(c + 1) : r);
    };
    reader.readAsDataURL(file);
  });
}

export async function uploadLogoFile(path: string, file: File): Promise<{ error?: string }> {
  if (!USE_AWS) {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || undefined });
    return { error: error?.message };
  }
  const base64 = await fileToBase64(file);
  const { data, error } = await supabase.functions.invoke('logo-storage', {
    body: { action: 'upload', path, contentType: file.type || 'application/octet-stream', base64 },
  });
  return { error: error?.message || data?.error };
}

export async function signLogoUrl(path: string, expiresIn: number): Promise<string | null> {
  if (!USE_AWS) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn);
    return error || !data ? null : data.signedUrl;
  }
  const { data, error } = await supabase.functions.invoke('logo-storage', {
    body: { action: 'sign', path, expiresIn },
  });
  if (error || data?.error || !data?.signedUrl) return null;
  return data.signedUrl;
}
