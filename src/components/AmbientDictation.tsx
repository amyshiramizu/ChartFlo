import { useState, useEffect, useRef, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Mic, MicOff, Wand2, RotateCcw, Copy, Loader2, FileText, Sparkles, Plus, Upload, Headphones, Pause, Play, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { usePatientStore } from '@/store/patientStore';
import { invokeTranscribe } from '@/lib/transcribe';
import type { ClinicalNote, NoteTemplate } from '@/types/patient';


interface ExtractedScreening {
  assessment_type: string;
  score?: string;
  severity?: string;
  findings: string;
  completed: boolean;
  partial?: boolean;
}

export interface ExtractedMedication {
  name: string;
  dosage?: string;
  frequency?: string;
  route?: string;
  action: 'start' | 'change' | 'stop' | 'continue';
  instructions?: string;
}

interface AmbientDictationProps {
  onApplyNote: (note: Pick<ClinicalNote, 'subjective' | 'objective' | 'assessment' | 'plan'> & { chiefComplaint?: string }) => void;
  lastNote: ClinicalNote | null;
  templateId?: string;
  onTemplateChange?: (id: string) => void;
  onScreeningsExtracted?: (screenings: ExtractedScreening[]) => void;
  onMedicationsExtracted?: (meds: ExtractedMedication[]) => void;
  existingMedications?: Array<{ name: string; dosage?: string; frequency?: string; route?: string }>;
}

interface SpeechRecognitionType extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: Event) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

export function AmbientDictation({ onApplyNote, lastNote, templateId, onTemplateChange, onScreeningsExtracted, onMedicationsExtracted, existingMedications }: AmbientDictationProps) {
  const { templates } = usePatientStore();
  const [localTemplateId, setLocalTemplateId] = useState(templateId || templates[0]?.id || '');
  const effectiveTemplateId = templateId ?? localTemplateId;
  const selectedTemplate: NoteTemplate | undefined = templates.find((t) => t.id === effectiveTemplateId);

  const handleTemplateChange = (id: string) => {
    setLocalTemplateId(id);
    onTemplateChange?.(id);
  };

  const BUFFER_KEY = 'chartscribe.ambient.buffer.v1';
  const SAVE_INTERVAL_MS = 3000;
  const BUFFER_TTL_MS = 12 * 60 * 60 * 1000; // 12h

  // Hydrate from session buffer (survives accidental reloads during a visit)
  const initialBuffer = (() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = sessionStorage.getItem(BUFFER_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { transcript: string; duration: number; savedAt: number; wasListening?: boolean };
      if (!parsed?.transcript) return null;
      if (Date.now() - (parsed.savedAt || 0) > BUFFER_TTL_MS) {
        sessionStorage.removeItem(BUFFER_KEY);
        return null;
      }
      return parsed;
    } catch { return null; }
  })();

  const [isListening, setIsListening] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [rawTranscript, setRawTranscript] = useState(initialBuffer?.transcript || '');
  const [structuredNote, setStructuredNote] = useState<{
    chiefComplaint: string;
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
  } | null>(null);
  const [isStructuring, setIsStructuring] = useState(false);
  const [icdLoading, setIcdLoading] = useState(false);
  const [icdSuggestions, setIcdSuggestions] = useState<
    Array<{ code: string; description: string; confidence: string; rationale: string }>
  >([]);
  const [duration, setDuration] = useState(initialBuffer?.duration || 0);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(initialBuffer?.savedAt || null);
  const MIC_KEY = 'chartscribe.ambient.micDeviceId';
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>(() => {
    if (typeof window === 'undefined') return 'default';
    return localStorage.getItem(MIC_KEY) || 'default';
  });
  const [isUploading, setIsUploading] = useState(false);
  const [pendingChunks, setPendingChunks] = useState(0);
  const [isScreenAwake, setIsScreenAwake] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionType | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autosaveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeLockRef = useRef<any>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recorderRestartRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepAwakeAudioRef = useRef<{ ctx: AudioContext; oscillator: OscillatorNode } | null>(null);
  const accumulatedRef = useRef(initialBuffer?.transcript || '');
  const isListeningRef = useRef(false);
  const lastResultAtRef = useRef<number>(0);
  const lastRecorderDataAtRef = useRef<number>(0);
  const scheduleRestartRef = useRef<(delay?: number) => void>(() => {});
  const durationRef = useRef<number>(initialBuffer?.duration || 0);
  const rawTranscriptRef = useRef<string>(initialBuffer?.transcript || '');

  // iOS/Safari plays a loud system "ding" every time the Web Speech API
  // starts or restarts. Use chunked MediaRecorder + server transcription there
  // instead so the recording is completely silent.
  // We ALSO use the silent recorder whenever the user picks a specific microphone,
  // because the Web Speech API always uses the system default mic and ignores
  // getUserMedia device selection.
  const isAppleWebSpeechIssue = (() => {
    if (typeof window === 'undefined') return false;
    const ua = navigator.userAgent || '';
    const isIOS = /iP(ad|hone|od)/.test(ua) ||
      (navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1);
    const isSafari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(ua);
    return isIOS || isSafari;
  })();
  const isMobileBrowser = (() => {
    if (typeof window === 'undefined') return false;
    const ua = navigator.userAgent || '';
    const touchMac = navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1;
    return /Android|webOS|iP(hone|ad|od)|BlackBerry|IEMobile|Opera Mini/i.test(ua) || touchMac;
  })();
  const hasCustomMic = selectedMicId && selectedMicId !== 'default';
  // Always use the silent recorder + server transcription (ElevenLabs Scribe v2,
  // medical-grade STT). The browser's Web Speech API drops/garbles medical terms
  // and was the source of "inaccurate dictation" reports — Scribe is Dragon-class.
  const useSilentRecorder = true;
  void isAppleWebSpeechIssue; void isMobileBrowser; void hasCustomMic;

  // Enumerate input devices (after permission is granted, labels populate)
  const refreshAudioInputs = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioInputs(devices.filter((d) => d.kind === 'audioinput'));
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    refreshAudioInputs();
    if (!navigator.mediaDevices?.addEventListener) return;
    const handler = () => refreshAudioInputs();
    navigator.mediaDevices.addEventListener('devicechange', handler);
    return () => navigator.mediaDevices.removeEventListener('devicechange', handler);
  }, [refreshAudioInputs]);

  const handleSelectMic = useCallback((id: string) => {
    setSelectedMicId(id);
    try { localStorage.setItem(MIC_KEY, id); } catch { /* noop */ }
  }, []);

  // Keep refs in sync for use inside intervals without re-creating them
  useEffect(() => { durationRef.current = duration; }, [duration]);
  useEffect(() => { rawTranscriptRef.current = rawTranscript; }, [rawTranscript]);
  useEffect(() => { isListeningRef.current = isListening; }, [isListening]);

  // Persist the current buffer to sessionStorage
  const flushBuffer = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      // Save the FULL displayed transcript (incl. interim) so refreshes never lose words
      const text = rawTranscriptRef.current || accumulatedRef.current || '';
      if (!text) {
        sessionStorage.removeItem(BUFFER_KEY);
        return;
      }
      const savedAt = Date.now();
      sessionStorage.setItem(BUFFER_KEY, JSON.stringify({
        transcript: text,
        duration: durationRef.current,
        savedAt,
        wasListening: isListeningRef.current,
      }));
      setLastSavedAt(savedAt);
    } catch { /* quota or disabled — ignore */ }
  }, []);

  const startMobileKeepAwake = useCallback(async () => {
    if (!isMobileBrowser || keepAwakeAudioRef.current) return;
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
      keepAwakeAudioRef.current = { ctx, oscillator };
    } catch { /* noop — mobile browsers may block this */ }
  }, [isMobileBrowser]);

  const stopMobileKeepAwake = useCallback(() => {
    const keepAwake = keepAwakeAudioRef.current;
    keepAwakeAudioRef.current = null;
    if (!keepAwake) return;
    try { keepAwake.oscillator.stop(); } catch { /* noop */ }
    try { keepAwake.ctx.close(); } catch { /* noop */ }
  }, []);

  // Flush on tab hide / before unload so nothing is lost
  useEffect(() => {
    const onHide = () => flushBuffer();
    window.addEventListener('beforeunload', onHide);
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('beforeunload', onHide);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [flushBuffer]);


  const isSupported = typeof window !== 'undefined' &&
    (useSilentRecorder
      ? typeof (window as any).MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
      : ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window));


  const startRecognition = useCallback(() => {
    if (!isSupported || !isListeningRef.current) return;
    // Tear down any prior instance — reusing a stopped recognizer throws InvalidStateError on many browsers
    if (recognitionRef.current) {
      try { recognitionRef.current.onend = null; } catch { /* noop */ }
      try { recognitionRef.current.onerror = null; } catch { /* noop */ }
      try { recognitionRef.current.onresult = null; } catch { /* noop */ }
      try { recognitionRef.current.abort(); } catch { /* noop */ }
      recognitionRef.current = null;
    }

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SR() as SpeechRecognitionType;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      lastResultAtRef.current = Date.now();
      let interim = '';
      let final = '';
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript + ' ';
        } else {
          interim += result[0].transcript;
        }
      }
      if (final) {
        accumulatedRef.current += final;
      }
      setRawTranscript(accumulatedRef.current + interim);
    };

    recognition.onend = () => {
      if (isListeningRef.current) scheduleRestartRef.current(150);
    };

    recognition.onerror = (event: any) => {
      const err = event?.error;
      if (err === 'not-allowed' || err === 'service-not-allowed' || err === 'audio-capture') {
        // Don't kill the session — the user wants recording to keep trying
        // until they explicitly press Stop or Pause. Show a hint and retry.
        toast.error('Microphone hiccup — retrying. Press Stop if you want to end.');
        if (isListeningRef.current) scheduleRestartRef.current(1500);
        return;
      }
      if (isListeningRef.current) scheduleRestartRef.current(400);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      lastResultAtRef.current = Date.now();
    } catch {
      scheduleRestartRef.current(500);
    }
  }, [isSupported]);

  const scheduleRestart = useCallback((delay = 250) => {
    if (!isListeningRef.current) return;
    if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
    restartTimeoutRef.current = setTimeout(() => {
      if (!isListeningRef.current) return;
      startRecognition();
    }, delay);
  }, [startRecognition]);

  // Keep ref in sync so recognition handlers always call the latest scheduler
  useEffect(() => { scheduleRestartRef.current = scheduleRestart; }, [scheduleRestart]);

  // --- Silent recorder mode (iOS/Safari): chunked MediaRecorder + server transcription ---
  const transcribeChunk = useCallback(async (blob: Blob) => {
    if (!blob || blob.size < 2000) return; // skip near-empty chunks
    setPendingChunks((n) => n + 1);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error || new Error('read failed'));
        reader.onload = () => {
          const r = String(reader.result || '');
          const c = r.indexOf(',');
          resolve(c >= 0 ? r.slice(c + 1) : r);
        };
        reader.readAsDataURL(blob);
      });
      const { data, error } = await invokeTranscribe({ audioBase64: base64, mimeType: blob.type || 'audio/webm' });
      if (error || data?.error) return;
      const text: string = (data?.transcript || '').trim();
      if (!text) return;
      const prev = accumulatedRef.current;
      const next = prev && !prev.endsWith(' ') && !prev.endsWith('\n') ? `${prev} ${text}` : `${prev}${text}`;
      accumulatedRef.current = next + ' ';
      rawTranscriptRef.current = accumulatedRef.current;
      setRawTranscript(accumulatedRef.current);
      lastResultAtRef.current = Date.now();
      flushBuffer();
    } catch (e) {
      console.error('chunk transcription failed', e);
    } finally {
      setPendingChunks((n) => Math.max(0, n - 1));
    }
  }, [flushBuffer]);

  const pickRecorderMime = useCallback(() => {
    const MR: any = (window as any).MediaRecorder;
    if (!MR || !MR.isTypeSupported) return '';
    const candidates = ['audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
    for (const c of candidates) { if (MR.isTypeSupported(c)) return c; }
    return '';
  }, []);

  // Re-acquire mic if the OS killed the track (tab backgrounded, BT hiccup, screen lock)
  const reacquireMicStream = useCallback(async (): Promise<boolean> => {
    try {
      if (micStreamRef.current) {
        try { micStreamRef.current.getTracks().forEach(t => t.stop()); } catch { /* noop */ }
        micStreamRef.current = null;
      }
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 16000,
        // Chrome-specific hints for stronger noise/voice processing
        ...({
          googEchoCancellation: true,
          googNoiseSuppression: true,
          googAutoGainControl: true,
          googHighpassFilter: true,
          googTypingNoiseDetection: true,
          googAudioMirroring: false,
        } as any),
      };
      if (selectedMicId && selectedMicId !== 'default') {
        (audioConstraints as any).deviceId = { exact: selectedMicId };
      }
      const constraints: MediaStreamConstraints = { audio: audioConstraints };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      micStreamRef.current = stream;
      stream.getTracks().forEach((t) => {
        t.onended = () => {
          if (!isListeningRef.current) return;
          void (async () => {
            const ok = await reacquireMicStream();
            if (ok) {
              if (useSilentRecorder) startSilentRecorderRef.current?.();
              else scheduleRestartRef.current(200);
            }
          })();
        };
      });
      return true;
    } catch (e) {
      console.error('reacquireMicStream failed', e);
      return false;
    }
  }, [selectedMicId, useSilentRecorder]);

  const startSilentRecorderRef = useRef<() => void>(() => {});

  const startSilentRecorder = useCallback(() => {
    if (recorderRestartRef.current) { clearTimeout(recorderRestartRef.current); recorderRestartRef.current = null; }
    if (!micStreamRef.current || !micStreamRef.current.getTracks().some(t => t.readyState === 'live')) {
      // Stream is dead — re-acquire then retry
      if (isListeningRef.current) {
        void reacquireMicStream().then((ok) => {
          if (ok && isListeningRef.current) startSilentRecorder();
        });
      }
      return;
    }
    if (mediaRecorderRef.current) {
      try { mediaRecorderRef.current.stop(); } catch { /* noop */ }
      mediaRecorderRef.current = null;
    }
    const mime = pickRecorderMime();
    let recorder: MediaRecorder;
    try {
      recorder = mime
        ? new MediaRecorder(micStreamRef.current, { mimeType: mime })
        : new MediaRecorder(micStreamRef.current);
    } catch (e) {
      console.error('MediaRecorder init failed', e);
      // Keep trying — only an explicit Stop/Pause should end recording.
      if (isListeningRef.current) {
        recorderRestartRef.current = setTimeout(() => {
          if (isListeningRef.current) startSilentRecorder();
        }, 1000);
      }
      return;
    }
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (ev: BlobEvent) => {
      if (ev.data && ev.data.size > 0) {
        chunks.push(ev.data);
        lastRecorderDataAtRef.current = Date.now();
        flushBuffer();
      }
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mime || 'audio/webm' });
      void transcribeChunk(blob);
      // Immediately start the next segment so recording is continuous
      if (isListeningRef.current) {
        recorderRestartRef.current = setTimeout(() => {
          if (isListeningRef.current) startSilentRecorder();
        }, 50);
      }
    };
    mediaRecorderRef.current = recorder;
    try {
      if (isMobileBrowser) recorder.start(5000);
      else recorder.start();
      lastResultAtRef.current = Date.now();
      lastRecorderDataAtRef.current = Date.now();
      // Rotate every 20s so chunks stay small and transcription is near-live
      recorderRestartRef.current = setTimeout(() => {
        try { if (recorder.state === 'recording') recorder.requestData(); } catch { /* noop */ }
        try { if (recorder.state === 'recording') recorder.stop(); } catch { /* noop */ }
      }, 20000);
    } catch (e) {
      console.error('MediaRecorder start failed', e);
      if (isListeningRef.current) {
        recorderRestartRef.current = setTimeout(() => {
          if (isListeningRef.current) startSilentRecorder();
        }, 1000);
      }
    }
  }, [pickRecorderMime, transcribeChunk, reacquireMicStream, flushBuffer, isMobileBrowser]);

  // Keep ref in sync so reacquireMicStream's onended handler can restart the latest recorder
  useEffect(() => { startSilentRecorderRef.current = startSilentRecorder; }, [startSilentRecorder]);

  const handleStart = useCallback(async () => {
    // Preserve any recovered transcript so a refresh / tab switch never erases the visit.
    // Only Start when not already running.
    if (isListeningRef.current) return;
    setStructuredNote(null);
    isListeningRef.current = true;
    setIsListening(true);

    void startMobileKeepAwake();
    try {
      if ('wakeLock' in navigator && !wakeLockRef.current) {
        const lock = await (navigator as any).wakeLock.request('screen');
        wakeLockRef.current = lock;
        setIsScreenAwake(true);
        try { lock.addEventListener?.('release', () => setIsScreenAwake(false)); } catch { /* noop */ }
        toast.success('Screen will stay awake for this visit', {
          description: 'Recording stops if the iPad is locked manually.',
          duration: 4000,
        });
      } else if (keepAwakeAudioRef.current) {
        setIsScreenAwake(true);
      }
    } catch { /* noop */ }

    // Hold an explicit mic stream so the OS keeps the input warm for the whole visit
    try {
      if (!micStreamRef.current && navigator.mediaDevices?.getUserMedia) {
        const ok = await reacquireMicStream();
        if (!ok) throw new Error('mic denied');
        refreshAudioInputs();
      } else if (micStreamRef.current) {
        // Re-attach onended handlers on existing tracks
        micStreamRef.current.getTracks().forEach((t) => {
          t.onended = () => {
            if (!isListeningRef.current) return;
            void reacquireMicStream().then((ok) => {
              if (ok && isListeningRef.current) {
                if (useSilentRecorder) startSilentRecorder();
                else scheduleRestart(200);
              }
            });
          };
        });
      }
    } catch {
      toast.error('Microphone access denied');
      isListeningRef.current = false;
      setIsListening(false);
      return;
    }

    if (useSilentRecorder) {
      startSilentRecorder();
      // Watchdog: if the recorder isn't actively recording, kick it back on
      if (watchdogRef.current) clearInterval(watchdogRef.current);
      watchdogRef.current = setInterval(() => {
        if (!isListeningRef.current) return;
        const rec = mediaRecorderRef.current;
        const streamLive = micStreamRef.current?.getTracks().some(t => t.readyState === 'live');
        if (!streamLive) {
          void reacquireMicStream().then((ok) => {
            if (ok && isListeningRef.current) startSilentRecorder();
          });
          return;
        }
        const dataStale = isMobileBrowser && Date.now() - lastRecorderDataAtRef.current > 12000;
        if (dataStale && rec?.state === 'recording') {
          try { rec.requestData(); } catch { /* noop */ }
          try { rec.stop(); } catch { /* noop */ }
          return;
        }
        if (!rec || rec.state !== 'recording') {
          startSilentRecorder();
        }
      }, isMobileBrowser ? 3000 : 5000);
    } else {
      startRecognition();
      watchdogRef.current = setInterval(() => {
        if (!isListeningRef.current) return;
        const silentFor = Date.now() - lastResultAtRef.current;
        if (silentFor > 15000) {
          scheduleRestart(200);
          lastResultAtRef.current = Date.now();
        }
      }, 5000);
    }
    timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);

    // Auto-save the visit transcript every few seconds so the buffer always survives
    autosaveRef.current = setInterval(() => flushBuffer(), SAVE_INTERVAL_MS);
    flushBuffer();

  }, [startRecognition, scheduleRestart, flushBuffer, startSilentRecorder, reacquireMicStream, refreshAudioInputs, selectedMicId, useSilentRecorder, isMobileBrowser, startMobileKeepAwake]);


  const handleNewVisit = useCallback(() => {
    accumulatedRef.current = '';
    rawTranscriptRef.current = '';
    setRawTranscript('');
    setStructuredNote(null);
    setDuration(0);
    setLastSavedAt(null);
    try { sessionStorage.removeItem(BUFFER_KEY); } catch { /* noop */ }
  }, []);

  const handleAudioFileUpload = useCallback(async (file: File) => {
    if (!file) return;
    const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
    if (file.size > MAX_BYTES) {
      toast.error(`File is ${(file.size / 1024 / 1024).toFixed(1)} MB. Max upload size is 20 MB. Trim or export a shorter clip from your recorder.`);
      return;
    }
    if (isListeningRef.current) {
      toast.error('Stop the live recording before uploading an audio file');
      return;
    }
    setIsUploading(true);
    try {
      // Read as base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error || new Error('File read failed'));
        reader.onload = () => {
          const result = String(reader.result || '');
          const comma = result.indexOf(',');
          resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.readAsDataURL(file);
      });

      toast.message('Transcribing audio… this can take up to a minute for long visits.');
      const { data, error } = await invokeTranscribe({ audioBase64: base64, mimeType: file.type || 'audio/mpeg' });
      if (error) throw new Error(error.message || 'Transcription failed');
      if (data?.error) throw new Error(data.error);
      const transcript: string = (data?.transcript || '').trim();
      if (!transcript) {
        toast.error('No speech detected in the uploaded file');
        return;
      }
      const prefix = accumulatedRef.current.trim();
      const combined = prefix ? `${prefix}\n\n${transcript}\n` : `${transcript}\n`;
      accumulatedRef.current = combined;
      rawTranscriptRef.current = combined;
      setRawTranscript(combined);
      flushBuffer();
      toast.success('Audio transcribed and added to the transcript');
    } catch (err: any) {
      console.error('audio upload error:', err);
      toast.error('Audio transcription failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [flushBuffer]);

  const handleStop = useCallback(() => {
    setIsListening(false);
    isListeningRef.current = false;
    if (restartTimeoutRef.current) { clearTimeout(restartTimeoutRef.current); restartTimeoutRef.current = null; }
    if (recorderRestartRef.current) { clearTimeout(recorderRestartRef.current); recorderRestartRef.current = null; }
    if (recognitionRef.current) {
      try { recognitionRef.current.onend = null; } catch { /* noop */ }
      try { recognitionRef.current.abort(); } catch { /* noop */ }
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current) {
      // isListeningRef is already false, so onstop will flush the final chunk
      // via transcribeChunk and skip the auto-restart branch.
      try { if (mediaRecorderRef.current.state === 'recording') mediaRecorderRef.current.stop(); } catch { /* noop */ }
      mediaRecorderRef.current = null;
    }

    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (watchdogRef.current) { clearInterval(watchdogRef.current); watchdogRef.current = null; }
    if (autosaveRef.current) { clearInterval(autosaveRef.current); autosaveRef.current = null; }
    if (wakeLockRef.current) {
      try { wakeLockRef.current.release(); } catch { /* noop */ }
      wakeLockRef.current = null;
    }
    setIsScreenAwake(false);
    stopMobileKeepAwake();
    if (micStreamRef.current) {
      try { micStreamRef.current.getTracks().forEach(t => t.stop()); } catch { /* noop */ }
      micStreamRef.current = null;
    }
    setIsPaused(false);
    setRawTranscript(accumulatedRef.current);
    flushBuffer();
  }, [flushBuffer, stopMobileKeepAwake]);

  // Pause: stop capturing audio but keep transcript, duration, and mic stream alive.
  const handlePause = useCallback(() => {
    if (!isListeningRef.current) return;
    isListeningRef.current = false;
    setIsListening(false);
    setIsPaused(true);
    if (restartTimeoutRef.current) { clearTimeout(restartTimeoutRef.current); restartTimeoutRef.current = null; }
    if (recorderRestartRef.current) { clearTimeout(recorderRestartRef.current); recorderRestartRef.current = null; }
    if (recognitionRef.current) {
      try { recognitionRef.current.onend = null; } catch { /* noop */ }
      try { recognitionRef.current.abort(); } catch { /* noop */ }
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current) {
      try { if (mediaRecorderRef.current.state === 'recording') mediaRecorderRef.current.stop(); } catch { /* noop */ }
      mediaRecorderRef.current = null;
    }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (watchdogRef.current) { clearInterval(watchdogRef.current); watchdogRef.current = null; }
    stopMobileKeepAwake();
    setRawTranscript(accumulatedRef.current);
    flushBuffer();
  }, [flushBuffer, stopMobileKeepAwake]);

  const handleResume = useCallback(async () => {
    if (isListeningRef.current) return;
    setIsPaused(false);
    isListeningRef.current = true;
    setIsListening(true);
    void startMobileKeepAwake();
    try {
      if ('wakeLock' in navigator && !wakeLockRef.current) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      }
    } catch { /* noop */ }
    if (!micStreamRef.current || !micStreamRef.current.getTracks().some(t => t.readyState === 'live')) {
      await reacquireMicStream();
    }
    if (useSilentRecorder) {
      startSilentRecorder();
      if (watchdogRef.current) clearInterval(watchdogRef.current);
      watchdogRef.current = setInterval(() => {
        if (!isListeningRef.current) return;
        const rec = mediaRecorderRef.current;
        const streamLive = micStreamRef.current?.getTracks().some(t => t.readyState === 'live');
        if (!streamLive) {
          void reacquireMicStream().then((ok) => {
            if (ok && isListeningRef.current) startSilentRecorder();
          });
          return;
        }
        const dataStale = isMobileBrowser && Date.now() - lastRecorderDataAtRef.current > 12000;
        if (dataStale && rec?.state === 'recording') {
          try { rec.requestData(); } catch { /* noop */ }
          try { rec.stop(); } catch { /* noop */ }
          return;
        }
        if (!rec || rec.state !== 'recording') startSilentRecorder();
      }, isMobileBrowser ? 3000 : 5000);
    } else {
      startRecognition();
      watchdogRef.current = setInterval(() => {
        if (!isListeningRef.current) return;
        const silentFor = Date.now() - lastResultAtRef.current;
        if (silentFor > 15000) {
          scheduleRestart(200);
          lastResultAtRef.current = Date.now();
        }
      }, 5000);
    }
    timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
  }, [useSilentRecorder, startSilentRecorder, startRecognition, scheduleRestart, reacquireMicStream, isMobileBrowser, startMobileKeepAwake]);


  // One-time notice if we recovered a transcript from a prior session/reload.
  // If recording was active before the refresh, automatically resume it.
  useEffect(() => {
    if (initialBuffer?.transcript) {
      const mins = Math.round((Date.now() - initialBuffer.savedAt) / 60000);
      toast.success(`Recovered visit transcript (auto-saved ${mins < 1 ? 'just now' : `${mins}m ago`})`);
      if (initialBuffer.wasListening) {
        // Defer so component is fully mounted before requesting mic
        const t = setTimeout(() => { handleStart(); }, 250);
        return () => clearTimeout(t);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // Re-acquire wake lock & nudge recognition when tab becomes visible again
  useEffect(() => {
    const onVisibility = async () => {
      if (document.visibilityState === 'visible' && isListeningRef.current) {
        try {
          if ('wakeLock' in navigator && !wakeLockRef.current) {
            const lock = await (navigator as any).wakeLock.request('screen');
            wakeLockRef.current = lock;
            setIsScreenAwake(true);
            try { lock.addEventListener?.('release', () => setIsScreenAwake(false)); } catch { /* noop */ }
          }
        } catch { /* noop */ }
        void startMobileKeepAwake();
        if (useSilentRecorder) {
          const ok = await reacquireMicStream();
          if (ok) startSilentRecorder();
        } else {
          scheduleRestart(200);
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [scheduleRestart, useSilentRecorder, reacquireMicStream, startSilentRecorder, startMobileKeepAwake]);

  useEffect(() => {
    return () => {
      const wasListening = isListeningRef.current;
      isListeningRef.current = false;
      try { recognitionRef.current?.abort(); } catch { /* noop */ }
      try { if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop(); } catch { /* noop */ }
      if (timerRef.current) clearInterval(timerRef.current);
      if (watchdogRef.current) clearInterval(watchdogRef.current);
      if (autosaveRef.current) clearInterval(autosaveRef.current);
      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
      if (recorderRestartRef.current) clearTimeout(recorderRestartRef.current);
      if (wakeLockRef.current) { try { wakeLockRef.current.release(); } catch { /* noop */ } }
      stopMobileKeepAwake();
      if (micStreamRef.current) { try { micStreamRef.current.getTracks().forEach(t => t.stop()); } catch { /* noop */ } }

      // Final flush so an unmount mid-visit never loses the buffer
      try {
        const text = rawTranscriptRef.current || accumulatedRef.current || '';
        if (text) {
          sessionStorage.setItem(BUFFER_KEY, JSON.stringify({
            transcript: text,
            duration: durationRef.current,
            savedAt: Date.now(),
            wasListening,
          }));
        }
      } catch { /* noop */ }
    };
  }, [stopMobileKeepAwake]);

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const mm = m.toString().padStart(2, '0');
    const ss = sec.toString().padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  };

  // Derive live/reconnecting status from time since last speech result
  const silentFor = isListening ? Math.max(0, Date.now() - (lastResultAtRef.current || Date.now())) : 0;
  const isReconnecting = isListening && !useSilentRecorder && silentFor > 8000;


  const autoStructure = useCallback(async () => {
    const text = rawTranscript.trim();
    if (!text) {
      toast.error('No transcript to structure');
      return;
    }

    setIsStructuring(true);
    setIcdLoading(true);
    try {
      const [structureRes, screeningsRes, medsRes, icdRes] = await Promise.all([
        supabase.functions.invoke('structure-soap', {
          body: {
            transcript: text,
            lastAssessment: lastNote?.assessment || null,
            template: selectedTemplate
              ? {
                  name: selectedTemplate.name,
                  type: selectedTemplate.type,
                  subjectivePrompt: selectedTemplate.subjectivePrompt,
                  objectivePrompt: selectedTemplate.objectivePrompt,
                  assessmentPrompt: selectedTemplate.assessmentPrompt,
                  planPrompt: selectedTemplate.planPrompt,
                }
              : null,
          },
        }),
        supabase.functions.invoke('extract-screenings', { body: { transcript: text } }),
        supabase.functions.invoke('extract-medications', {
          body: { transcript: text, existingMedications: existingMedications || [] },
        }),
        supabase.functions.invoke('suggest-icd', {
          body: { subjective: '', objective: '', assessment: '', plan: text },
        }),
      ]);

      const { data, error } = structureRes;
      if (error) throw new Error(error.message || 'Failed to structure note');
      if (data?.error) {
        toast.error(data.error);
        return;
      }

      // Prefer the AI's dedicated chief_complaint field; fall back to regex if absent.
      const rawSubjective: string = data.subjective || '';
      let chiefComplaint: string = (data.chief_complaint || '').trim();
      let cleanSubjective = rawSubjective;
      if (!chiefComplaint) {
        const ccMatch = rawSubjective.match(/^\s*(?:CC|Chief Complaint)\s*[:\-]\s*([^\n]+)\n*([\s\S]*)$/i);
        if (ccMatch) {
          chiefComplaint = ccMatch[1].trim();
          cleanSubjective = ccMatch[2].trim();
        }
      } else {
        // Defensive: if AI also left a CC line in subjective, strip it.
        cleanSubjective = rawSubjective.replace(/^\s*(?:CC|Chief Complaint)\s*[:\-][^\n]*\n+/i, '').trim();
      }
      if (/^not documented$/i.test(chiefComplaint)) chiefComplaint = '';

      // ICD suggestions
      const codes = (icdRes?.data?.codes || []) as Array<{ code: string; description: string; confidence: string; rationale: string }>;
      setIcdSuggestions(codes);

      // Append ICD codes to assessment automatically
      let assessmentWithIcd = data.assessment || '';
      if (codes.length) {
        const icdBlock = codes.map(c => `${c.code} — ${c.description}`).join('\n');
        assessmentWithIcd = assessmentWithIcd
          ? `${assessmentWithIcd.trim()}\n\nRecommended ICD-10:\n${icdBlock}`
          : `Recommended ICD-10:\n${icdBlock}`;
      }

      // Reorganize the plan by recommended diagnosis
      let planByDx = data.plan || '';
      if (codes.length && planByDx.trim()) {
        try {
          const { data: groupData } = await supabase.functions.invoke('group-plan-by-dx', {
            body: { plan: planByDx, assessment: data.assessment || '', codes },
          });
          if (groupData?.plan) planByDx = groupData.plan;
        } catch (e) {
          console.error('plan grouping failed', e);
        }
      }

      const result = {
        chiefComplaint,
        subjective: cleanSubjective,
        objective: data.objective || '',
        assessment: assessmentWithIcd,
        plan: planByDx,
      };
      setStructuredNote(result);
      toast.success('AI structured your note with ICD-10 codes and plan by diagnosis');

      const screenings = (screeningsRes?.data?.screenings || []) as ExtractedScreening[];
      // Forward both completed and partial; NoteEditor decides status. Skip empties.
      const relevant = screenings.filter(s => s.completed || s.partial);
      if (relevant.length && onScreeningsExtracted) {
        onScreeningsExtracted(relevant);
      }

      const meds = (medsRes?.data?.medications || []) as ExtractedMedication[];
      if (meds.length && onMedicationsExtracted) {
        onMedicationsExtracted(meds);
      }
    } catch (err) {
      console.error('AI structuring error:', err);
      toast.error('Failed to structure note with AI. Please try again.');
    } finally {
      setIsStructuring(false);
      setIcdLoading(false);
    }
  }, [rawTranscript, lastNote, selectedTemplate, onScreeningsExtracted, onMedicationsExtracted, existingMedications]);


  const DICTATION_DISCLAIMER =
    'This note was dictated using Chart Flo AI-assisted transcription. Content has been reviewed by the provider; however, transcription or formatting errors may be present.';

  const appendDisclaimer = (plan: string) => {
    const trimmed = (plan || '').trimEnd();
    if (trimmed.includes('Chart Flo')) return trimmed; // avoid duplicates
    return trimmed ? `${trimmed}\n\n${DICTATION_DISCLAIMER}` : DICTATION_DISCLAIMER;
  };

  const handleApply = () => {
    if (structuredNote) {
      const { chiefComplaint, subjective, objective, assessment, plan } = structuredNote;
      onApplyNote({
        chiefComplaint,
        subjective,
        objective,
        assessment,
        plan: appendDisclaimer(plan),
      });
      toast.success('Ambient note applied to editor');
    }
  };

  const handleSuggestICD = async () => {
    if (!structuredNote) return;
    const { chiefComplaint, subjective, objective, assessment, plan } = structuredNote;
    const subjectiveForAI = chiefComplaint
      ? `Chief Complaint: ${chiefComplaint}\n${subjective}`
      : subjective;
    if (!subjectiveForAI.trim() && !objective.trim() && !assessment.trim() && !plan.trim()) {
      toast.error('No visit content to analyze');
      return;
    }
    setIcdLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('suggest-icd', {
        body: { subjective: subjectiveForAI, objective, assessment, plan },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const codes = data?.codes || [];
      setIcdSuggestions(codes);
      if (!codes.length) toast.message('No diagnosis codes suggested');
      else toast.success(`Suggested ${codes.length} ICD-10 code${codes.length === 1 ? '' : 's'}`);
    } catch (err: any) {
      toast.error('Diagnosis suggestion failed: ' + (err.message || 'Unknown error'));
    } finally {
      setIcdLoading(false);
    }
  };

  const appendIcdToAssessment = (code: string, description: string) => {
    if (!structuredNote) return;
    const line = `${code} — ${description}`;
    const current = structuredNote.assessment?.trim() || '';
    if (current.includes(code)) {
      toast.message(`${code} already in assessment`);
      return;
    }
    const next = current ? `${current}\n${line}` : line;
    setStructuredNote({ ...structuredNote, assessment: next });
    toast.success(`Added ${code} to assessment`);
  };



  if (!isSupported) {
    return (
      <Card className="p-4 bg-muted/50">
        <p className="text-sm text-muted-foreground">
          Ambient dictation requires a browser that supports the Web Speech API (Chrome, Edge).
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Template picker — visible BEFORE recording so the right SOAP structure is applied at transcription */}
      <Card className={`p-3 border-primary/30 ${isListening ? 'bg-muted/30' : 'bg-primary/5'}`}>
        <div className="flex items-start gap-2 flex-wrap">
          <FileText className="w-4 h-4 text-primary mt-1 shrink-0" />
          <div className="flex-1 min-w-[200px]">
            <Label className="text-xs font-semibold text-foreground">
              Note template {isListening ? '(locked while recording)' : '— pick before you record'}
            </Label>
            <p className="text-[11px] text-muted-foreground mb-1.5">
              The AI structures your transcript using this template's Subjective / Objective / Assessment / Plan prompts.
            </p>
            <Select value={effectiveTemplateId} onValueChange={handleTemplateChange} disabled={isListening}>
              <SelectTrigger className="h-9 text-sm w-full">
                <SelectValue placeholder="Select template" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedTemplate && (
              <p className="text-[11px] text-muted-foreground mt-1.5 italic truncate">
                Using <span className="font-medium not-italic text-foreground">{selectedTemplate.name}</span>
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* Controls */}
      <Card className={`p-4 ${isListening ? 'border-destructive/40 bg-destructive/5' : ''}`}>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h3 className="text-sm font-semibold text-foreground">Ambient Dictation</h3>
            {isListening && (
              <>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-destructive/10 border border-destructive/30">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive" />
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-destructive">Recording</span>
                  <span className="font-mono text-sm font-semibold tabular-nums text-foreground" aria-label="Visit length">
                    {formatTime(duration)}
                  </span>
                </div>
                <Badge
                  variant={isReconnecting ? 'secondary' : 'outline'}
                  className={`gap-1.5 ${isReconnecting ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${isReconnecting ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
                  {isReconnecting ? 'Reconnecting…' : 'Live'}
                </Badge>
                {isScreenAwake && (
                  <Badge variant="outline" className="gap-1.5 border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400" title="Screen kept awake to prevent auto-lock during this visit">
                    <Sun className="w-3 h-3" />
                    Screen awake
                  </Badge>
                )}
              </>
            )}
            {!isListening && duration > 0 && (
              <Badge variant="outline" className="gap-1.5">
                <span className="font-mono tabular-nums">{formatTime(duration)}</span>
                <span className="text-muted-foreground">visit length</span>
              </Badge>
            )}
            {lastSavedAt && (
              <Badge variant="outline" className="gap-1.5 text-xs text-muted-foreground" title={new Date(lastSavedAt).toLocaleTimeString()}>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Auto-saved
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!isListening && !isPaused ? (
              <>
                <Button onClick={handleStart} className="gap-2" disabled={!effectiveTemplateId}>
                  <Mic className="w-4 h-4" />
                  Start Visit
                </Button>
                {rawTranscript && (
                  <Button onClick={autoStructure} variant="secondary" className="gap-2" disabled={isStructuring}>
                    {isStructuring ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                    {isStructuring ? 'Transcribing…' : 'Transcribe'}
                  </Button>
                )}
              </>
            ) : (
              <>
                {isPaused ? (
                  <Button onClick={handleResume} className="gap-2">
                    <Play className="w-4 h-4" />
                    Resume
                  </Button>
                ) : (
                  <Button variant="outline" onClick={handlePause} className="gap-2">
                    <Pause className="w-4 h-4" />
                    Pause
                  </Button>
                )}
                <Button variant="destructive" onClick={handleStop} className="gap-2">
                  <MicOff className="w-4 h-4" />
                  Stop
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Headphones className="w-3.5 h-3.5 text-muted-foreground" />
          <Label className="text-xs text-muted-foreground whitespace-nowrap">Microphone:</Label>
          <Select value={selectedMicId} onValueChange={handleSelectMic} disabled={isListening}>
            <SelectTrigger className="h-8 text-xs flex-1 min-w-[160px] max-w-xs">
              <SelectValue placeholder="System default" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">System default</SelectItem>
              {audioInputs
                .filter((d) => d.deviceId && d.deviceId !== 'default')
                .map((d) => (
                  <SelectItem key={d.deviceId} value={d.deviceId}>
                    {d.label || `Microphone (${d.deviceId.slice(0, 6)}…)`}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm,.flac"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleAudioFileUpload(f);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading || isListening}
            title="Upload an audio file from phone or any recorder"
          >
            {isUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {isUploading ? 'Transcribing…' : 'Upload audio'}
          </Button>
        </div>
      </Card>

      {/* Live Transcript */}
      {(isListening || rawTranscript) && (
        <Card className={`p-4 ${isListening ? 'border-destructive/30 bg-destructive/5' : ''}`}>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {isListening ? 'Live Transcript' : 'Captured Transcript'}
            </h4>
            <div className="flex gap-1.5">
              {!isListening && rawTranscript && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => {
                      navigator.clipboard.writeText(rawTranscript);
                      toast.success('Transcript copied');
                    }}
                  >
                    <Copy className="w-3 h-3" />
                    Copy
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={handleNewVisit}
                  >
                    <RotateCcw className="w-3 h-3" />
                    New Visit
                  </Button>
                </>
              )}
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto">
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
              {rawTranscript || <span className="text-muted-foreground italic">Listening for conversation...</span>}
            </p>
          </div>
        </Card>
      )}

      {/* Auto-Structure Button */}
      {!isListening && rawTranscript && !structuredNote && (
        <Button
          onClick={autoStructure}
          className="w-full gap-2"
          disabled={isStructuring}
        >
          {isStructuring ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Transcribing — pulling the visit into your note...
            </>
          ) : (
            <>
              <Wand2 className="w-4 h-4" />
              Transcribe — pull the visit into the note
            </>
          )}
        </Button>
      )}

      {/* Structured Preview */}
      {structuredNote && (
        <Card className="p-4 space-y-3 border-primary/20 bg-accent/30">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-foreground">AI-Structured Note Preview</h4>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={autoStructure}
                className="gap-1.5 text-xs"
                disabled={isStructuring}
              >
                {isStructuring ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                Re-structure
              </Button>
              <Button size="sm" onClick={handleApply} className="gap-1.5 text-xs">
                Apply to Note
              </Button>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-primary uppercase tracking-wider mb-1 block">
              Chief Complaint
            </label>
            <Textarea
              value={structuredNote.chiefComplaint}
              onChange={(e) => setStructuredNote({ ...structuredNote, chiefComplaint: e.target.value })}
              placeholder="e.g., chest pain x 2 days"
              className="min-h-[40px] text-sm resize-none"
            />
          </div>
          {(['subjective', 'objective', 'assessment', 'plan'] as const).map((section) => (
            <div key={section}>
              <label className="text-xs font-semibold text-primary uppercase tracking-wider mb-1 block">
                {section.charAt(0).toUpperCase() + section.slice(1)}
              </label>
              <Textarea
                value={structuredNote[section]}
                onChange={(e) => setStructuredNote({ ...structuredNote, [section]: e.target.value })}
                className="min-h-[60px] text-sm resize-none"
              />
            </div>
          ))}

          {/* ICD-10 diagnosis recommendations */}
          <div className="pt-2 border-t border-border/60">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-primary uppercase tracking-wider">
                Recommended ICD-10 Diagnoses
              </label>
              <div className="flex gap-2">
                {icdSuggestions.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIcdSuggestions([])}
                    className="h-7 text-xs"
                  >
                    Clear
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSuggestICD}
                  disabled={icdLoading}
                  className="gap-1.5 h-7 text-xs"
                >
                  {icdLoading ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Sparkles className="w-3 h-3" />
                  )}
                  {icdLoading ? 'Analyzing…' : icdSuggestions.length ? 'Re-suggest' : 'Suggest ICD-10 Codes'}
                </Button>
              </div>
            </div>

            {icdSuggestions.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Click “Suggest ICD-10 Codes” to recommend diagnosis codes from this visit.
              </p>
            ) : (
              <div className="space-y-2">
                {icdSuggestions.map((s, i) => (
                  <div
                    key={`${s.code}-${i}`}
                    className="flex items-start gap-3 p-2.5 rounded-md border border-border bg-background"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="text-sm font-semibold text-primary">{s.code}</code>
                        <span className="text-sm text-foreground">{s.description}</span>
                        <Badge
                          variant={
                            s.confidence === 'high'
                              ? 'default'
                              : s.confidence === 'medium'
                              ? 'secondary'
                              : 'outline'
                          }
                          className="text-[10px] uppercase"
                        >
                          {s.confidence}
                        </Badge>
                      </div>
                      {s.rationale && (
                        <p className="text-xs text-muted-foreground mt-1">{s.rationale}</p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 shrink-0 h-7 text-xs"
                      onClick={() => appendIcdToAssessment(s.code, s.description)}
                    >
                      <Plus className="w-3 h-3" />
                      Add
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
