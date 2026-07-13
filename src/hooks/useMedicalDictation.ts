import { useCallback, useEffect, useRef, useState } from 'react';
import { blobToBase64, invokeTranscribe } from '@/lib/transcribe';

// Resilient record -> medical-transcription dictation, mirroring the chart
// notes (AmbientDictation) machinery so recording survives screen lock and
// tab switches:
//  - screen wake lock, re-acquired whenever the tab becomes visible again
//  - near-silent audio loop on mobile so iOS keeps the page alive
//  - the recorder rotates every 20s and each chunk is transcribed
//    immediately, so audio already spoken is never lost to a later failure
//  - a watchdog re-acquires the mic and restarts the recorder if the OS
//    kills the track (screen lock, backgrounding, Bluetooth hiccup)

const isMobileBrowser = (() => {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const touchMac = navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1;
  return /Android|webOS|iP(hone|ad|od)|BlackBerry|IEMobile|Opera Mini/i.test(ua) || touchMac;
})();

function pickRecorderMime() {
  const MR: any = (window as any).MediaRecorder;
  if (!MR?.isTypeSupported) return '';
  const candidates = ['audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  for (const c of candidates) { if (MR.isTypeSupported(c)) return c; }
  return '';
}

export function useMedicalDictation(onTranscript: (text: string) => void) {
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const recordingRef = useRef(false);
  const onTextRef = useRef(onTranscript);
  useEffect(() => { onTextRef.current = onTranscript; }, [onTranscript]);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const rotateRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wakeLockRef = useRef<any>(null);
  const keepAwakeRef = useRef<{ ctx: AudioContext; oscillator: OscillatorNode } | null>(null);
  const lastDataAtRef = useRef(0);
  const startRecorderRef = useRef<() => void>(() => {});

  const isSupported = typeof window !== 'undefined'
    && typeof (window as any).MediaRecorder !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia;

  const transcribeChunk = useCallback(async (blob: Blob) => {
    if (!blob || blob.size < 2000) return; // skip near-empty chunks
    setPending(n => n + 1);
    try {
      const base64 = await blobToBase64(blob);
      const { data, error } = await invokeTranscribe({ audioBase64: base64, mimeType: blob.type || 'audio/webm' });
      if (error || data?.error) return;
      const text = String(data?.transcript || '').trim();
      if (text) onTextRef.current(text);
    } catch (e) {
      console.error('chunk transcription failed', e);
    } finally {
      setPending(n => Math.max(0, n - 1));
    }
  }, []);

  const startMobileKeepAwake = useCallback(async () => {
    if (!isMobileBrowser || keepAwakeRef.current) return;
    try {
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextCtor) return;
      const ctx = new AudioContextCtor();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.00001;
      oscillator.frequency.value = 20;
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      if (ctx.state === 'suspended') await ctx.resume();
      keepAwakeRef.current = { ctx, oscillator };
    } catch { /* noop — mobile browsers may block this */ }
  }, []);

  const stopMobileKeepAwake = useCallback(() => {
    const keepAwake = keepAwakeRef.current;
    keepAwakeRef.current = null;
    if (!keepAwake) return;
    try { keepAwake.oscillator.stop(); } catch { /* noop */ }
    try { keepAwake.ctx.close(); } catch { /* noop */ }
  }, []);

  const acquireWakeLock = useCallback(async () => {
    try {
      if ('wakeLock' in navigator && !wakeLockRef.current) {
        const lock = await (navigator as any).wakeLock.request('screen');
        wakeLockRef.current = lock;
        try { lock.addEventListener?.('release', () => { wakeLockRef.current = null; }); } catch { /* noop */ }
      }
    } catch { /* noop */ }
  }, []);

  // Re-acquire the mic if the OS killed the track (screen lock, backgrounding)
  const reacquireStream = useCallback(async (): Promise<boolean> => {
    try {
      if (streamRef.current) {
        try { streamRef.current.getTracks().forEach(t => t.stop()); } catch { /* noop */ }
        streamRef.current = null;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 16000 },
      });
      streamRef.current = stream;
      stream.getTracks().forEach(t => {
        t.onended = () => {
          if (!recordingRef.current) return;
          void reacquireStream().then(ok => { if (ok && recordingRef.current) startRecorderRef.current(); });
        };
      });
      return true;
    } catch (e) {
      console.error('mic re-acquire failed', e);
      return false;
    }
  }, []);

  const startRecorder = useCallback(() => {
    if (rotateRef.current) { clearTimeout(rotateRef.current); rotateRef.current = null; }
    if (!streamRef.current || !streamRef.current.getTracks().some(t => t.readyState === 'live')) {
      if (recordingRef.current) {
        void reacquireStream().then(ok => { if (ok && recordingRef.current) startRecorder(); });
      }
      return;
    }
    if (recorderRef.current) {
      try { recorderRef.current.stop(); } catch { /* noop */ }
      recorderRef.current = null;
    }
    const mime = pickRecorderMime();
    let recorder: MediaRecorder;
    try {
      recorder = mime ? new MediaRecorder(streamRef.current, { mimeType: mime }) : new MediaRecorder(streamRef.current);
    } catch (e) {
      console.error('MediaRecorder init failed', e);
      if (recordingRef.current) rotateRef.current = setTimeout(() => { if (recordingRef.current) startRecorder(); }, 1000);
      return;
    }
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (ev: BlobEvent) => {
      if (ev.data && ev.data.size > 0) { chunks.push(ev.data); lastDataAtRef.current = Date.now(); }
    };
    recorder.onstop = () => {
      void transcribeChunk(new Blob(chunks, { type: mime || 'audio/webm' }));
      // Immediately start the next segment so recording is continuous
      if (recordingRef.current) {
        rotateRef.current = setTimeout(() => { if (recordingRef.current) startRecorder(); }, 50);
      }
    };
    recorderRef.current = recorder;
    try {
      if (isMobileBrowser) recorder.start(5000);
      else recorder.start();
      lastDataAtRef.current = Date.now();
      // Rotate every 20s so chunks stay small and transcription is near-live
      rotateRef.current = setTimeout(() => {
        try { if (recorder.state === 'recording') recorder.requestData(); } catch { /* noop */ }
        try { if (recorder.state === 'recording') recorder.stop(); } catch { /* noop */ }
      }, 20000);
    } catch (e) {
      console.error('MediaRecorder start failed', e);
      if (recordingRef.current) rotateRef.current = setTimeout(() => { if (recordingRef.current) startRecorder(); }, 1000);
    }
  }, [reacquireStream, transcribeChunk]);

  useEffect(() => { startRecorderRef.current = startRecorder; }, [startRecorder]);

  const start = useCallback(async (): Promise<boolean> => {
    if (recordingRef.current) return true;
    const ok = await reacquireStream();
    if (!ok) return false;
    recordingRef.current = true;
    setRecording(true);
    setElapsed(0);
    void acquireWakeLock();
    void startMobileKeepAwake();
    startRecorder();
    timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
    watchdogRef.current = setInterval(() => {
      if (!recordingRef.current) return;
      const rec = recorderRef.current;
      const streamLive = streamRef.current?.getTracks().some(t => t.readyState === 'live');
      if (!streamLive) {
        void reacquireStream().then(ok2 => { if (ok2 && recordingRef.current) startRecorder(); });
        return;
      }
      const dataStale = isMobileBrowser && Date.now() - lastDataAtRef.current > 12000;
      if (dataStale && rec?.state === 'recording') {
        try { rec.requestData(); } catch { /* noop */ }
        try { rec.stop(); } catch { /* noop */ }
        return;
      }
      if (!rec || rec.state !== 'recording') startRecorder();
    }, isMobileBrowser ? 3000 : 5000);
    return true;
  }, [reacquireStream, acquireWakeLock, startMobileKeepAwake, startRecorder]);

  const stop = useCallback(() => {
    recordingRef.current = false;
    setRecording(false);
    if (rotateRef.current) { clearTimeout(rotateRef.current); rotateRef.current = null; }
    if (watchdogRef.current) { clearInterval(watchdogRef.current); watchdogRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (recorderRef.current) {
      // onstop transcribes the final chunk
      try { if (recorderRef.current.state === 'recording') recorderRef.current.stop(); } catch { /* noop */ }
      recorderRef.current = null;
    }
    if (streamRef.current) {
      try { streamRef.current.getTracks().forEach(t => t.stop()); } catch { /* noop */ }
      streamRef.current = null;
    }
    if (wakeLockRef.current) { try { wakeLockRef.current.release(); } catch { /* noop */ } wakeLockRef.current = null; }
    stopMobileKeepAwake();
  }, [stopMobileKeepAwake]);

  // Re-acquire the wake lock and restart the recorder when the tab returns
  useEffect(() => {
    const onVisibility = async () => {
      if (document.visibilityState === 'visible' && recordingRef.current) {
        void acquireWakeLock();
        void startMobileKeepAwake();
        const ok = await reacquireStream();
        if (ok && recordingRef.current) startRecorder();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [acquireWakeLock, startMobileKeepAwake, reacquireStream, startRecorder]);

  // Full cleanup on unmount
  useEffect(() => () => {
    recordingRef.current = false;
    if (rotateRef.current) clearTimeout(rotateRef.current);
    if (watchdogRef.current) clearInterval(watchdogRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    try { if (recorderRef.current?.state === 'recording') recorderRef.current.stop(); } catch { /* noop */ }
    try { streamRef.current?.getTracks().forEach(t => t.stop()); } catch { /* noop */ }
    if (wakeLockRef.current) { try { wakeLockRef.current.release(); } catch { /* noop */ } }
    const keepAwake = keepAwakeRef.current;
    if (keepAwake) {
      try { keepAwake.oscillator.stop(); } catch { /* noop */ }
      try { keepAwake.ctx.close(); } catch { /* noop */ }
    }
  }, []);

  return { recording, pending, elapsed, isSupported, start, stop };
}
