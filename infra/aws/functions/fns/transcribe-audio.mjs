// Port of supabase/functions/transcribe-audio — the dictation "ear".
// Engine: Amazon Transcribe Medical (PRIMARYCARE / CONVERSATION) with
// speaker partitioning mapped to Provider/Patient, matching the original
// ElevenLabs diarization heuristic (first speaker = Provider).
//
// Contract in:  { audioBase64, mimeType, languageHint? }         — start
//           or  { jobName }                                       — poll
// Contract out: { transcript }  |  { pending: true, jobName }     — poll again
import {
  TranscribeClient, StartMedicalTranscriptionJobCommand, GetMedicalTranscriptionJobCommand,
} from '@aws-sdk/client-transcribe';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';

const REGION = 'us-east-2';
const BUCKET = 'chartflo-audio-557485610536';
const transcribe = new TranscribeClient({ region: REGION });
const s3 = new S3Client({ region: REGION });

function formatFromMime(mt) {
  const m = (mt || '').toLowerCase();
  if (m.includes('wav')) return 'wav';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('webm')) return 'webm';
  if (m.includes('m4a') || m.includes('mp4') || m.includes('aac')) return 'mp4';
  if (m.includes('flac')) return 'flac';
  return 'mp3';
}

function base64ToBuffer(b64) {
  const clean = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64;
  return Buffer.from(clean, 'base64');
}

/** Build "Provider:/Patient:" diarized text from Transcribe Medical output. */
function diarizedTranscript(result) {
  const items = result?.results?.items || [];
  const hasSpeakers = items.some(i => i.speaker_label);
  if (!hasSpeakers) {
    return (result?.results?.transcripts || []).map(t => t.transcript).join(' ').trim();
  }
  const labelFor = sp => {
    const idx = /\d+/.exec(sp || '')?.[0];
    return idx === '0' ? 'Provider' : idx === '1' ? 'Patient' : `Speaker ${idx ?? '?'}`;
  };
  const lines = [];
  let current = null;
  let buf = [];
  for (const it of items) {
    const word = it.alternatives?.[0]?.content ?? '';
    if (it.type === 'punctuation') {
      if (buf.length) buf[buf.length - 1] += word;
      continue;
    }
    const sp = labelFor(it.speaker_label);
    if (sp !== current) {
      if (buf.length) lines.push(`${current}: ${buf.join(' ')}`);
      current = sp;
      buf = [];
    }
    buf.push(word);
  }
  if (buf.length) lines.push(`${current}: ${buf.join(' ')}`);
  return lines.join('\n');
}

async function checkJob(jobName, ctx) {
  const { MedicalTranscriptionJob: job } = await transcribe.send(
    new GetMedicalTranscriptionJobCommand({ MedicalTranscriptionJobName: jobName }),
  );
  const status = job?.TranscriptionJobStatus;
  if (status === 'FAILED') return ctx.json(500, { error: `Transcription failed: ${job?.FailureReason || 'unknown'}` });
  if (status !== 'COMPLETED') return ctx.json(200, { pending: true, jobName });
  const out = await s3.send(new GetObjectCommand({ Key: `medical/${jobName}.json`, Bucket: BUCKET }));
  const body = JSON.parse(await out.Body.transformToString());
  return ctx.json(200, { transcript: diarizedTranscript(body) });
}

export default async function handler(body, ctx) {
  if (body.jobName) return checkJob(body.jobName, ctx);

  const { audioBase64, mimeType } = body;
  if (!audioBase64) return ctx.json(400, { error: 'No audio provided' });

  const format = formatFromMime(mimeType);
  const jobName = `dictation-${randomUUID()}`;
  const key = `in/${jobName}.${format}`;
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: base64ToBuffer(audioBase64),
    ContentType: mimeType || 'audio/webm',
  }));

  await transcribe.send(new StartMedicalTranscriptionJobCommand({
    MedicalTranscriptionJobName: jobName,
    LanguageCode: 'en-US',
    MediaFormat: format,
    Media: { MediaFileUri: `s3://${BUCKET}/${key}` },
    OutputBucketName: BUCKET,
    OutputKey: `medical/${jobName}.json`,
    Specialty: 'PRIMARYCARE',
    Type: 'CONVERSATION',
    Settings: { ShowSpeakerLabels: true, MaxSpeakerLabels: 2 },
  }));

  // Poll briefly inside this invocation; the API Gateway cap is ~29s, so hand
  // the job back as pending if it isn't done in time and let the client poll.
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2500));
    const { MedicalTranscriptionJob: job } = await transcribe.send(
      new GetMedicalTranscriptionJobCommand({ MedicalTranscriptionJobName: jobName }),
    );
    if (job?.TranscriptionJobStatus === 'COMPLETED') return checkJob(jobName, ctx);
    if (job?.TranscriptionJobStatus === 'FAILED') {
      return ctx.json(500, { error: `Transcription failed: ${job?.FailureReason || 'unknown'}` });
    }
  }
  return ctx.json(200, { pending: true, jobName });
}
