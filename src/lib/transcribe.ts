import { supabase } from '@/integrations/supabase/client';

/** Read a Blob/File into raw base64 (no data: prefix). */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.onload = () => {
      const r = String(reader.result || '');
      const c = r.indexOf(',');
      resolve(c >= 0 ? r.slice(c + 1) : r);
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Invoke transcribe-audio and poll while the backend reports a pending job.
 * Short clips return inline; long recordings are transcribed asynchronously
 * by Amazon Transcribe Medical and hand back a jobName to poll.
 */
export async function invokeTranscribe(body: { audioBase64: string; mimeType: string }) {
  let { data, error } = await supabase.functions.invoke('transcribe-audio', { body });
  const deadline = Date.now() + 180_000;
  while (!error && data?.pending && data?.jobName && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000));
    ({ data, error } = await supabase.functions.invoke('transcribe-audio', {
      body: { jobName: data.jobName },
    }));
  }
  if (!error && data?.pending) error = new Error('Transcription timed out') as any;
  return { data, error };
}
