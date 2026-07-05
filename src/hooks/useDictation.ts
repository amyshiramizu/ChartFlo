import { useState, useEffect, useRef, useCallback } from 'react';

export interface DictationSegment {
  id: string;
  text: string;
  confidence: number; // 0..1
  isFinal: boolean;
}

interface UseDictationReturn {
  isListening: boolean;
  isPaused: boolean;
  transcript: string;
  segments: DictationSegment[];
  startListening: () => void;
  stopListening: () => void;
  pauseListening: () => void;
  resumeListening: () => void;
  resetTranscript: () => void;
  updateSegment: (id: string, text: string) => void;
  removeSegment: (id: string) => void;
  setSegmentsFromText: (text: string) => void;
  isSupported: boolean;
}

interface SpeechRecognitionType extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionType;
    webkitSpeechRecognition: new () => SpeechRecognitionType;
  }
}

export function useDictation(): UseDictationReturn {
  const [isListening, setIsListening] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  // committed final segments accumulated across pause/resume cycles
  const [finalSegments, setFinalSegments] = useState<DictationSegment[]>([]);
  // interim (in-flight) text from current recognition session
  const [interim, setInterim] = useState<DictationSegment | null>(null);
  const recognitionRef = useRef<SpeechRecognitionType | null>(null);
  const pausingRef = useRef(false);
  const stoppingRef = useRef(false);
  const isSupported =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const buildRecognition = useCallback(() => {
    if (!isSupported) return null;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    (recognition as any).maxAlternatives = 3;


    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const newFinals: DictationSegment[] = [];
      let interimText = '';
      let interimConf = 0;
      let interimCount = 0;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        // Pick the highest-confidence alternative instead of always [0]
        let alt = result[0];
        for (let a = 1; a < result.length; a++) {
          if ((result[a].confidence || 0) > (alt.confidence || 0)) alt = result[a];
        }
        const conf = typeof alt.confidence === 'number' ? alt.confidence : 0.85;
        if (result.isFinal) {
          // Drop very low confidence finals — usually background noise
          if (conf < 0.4) continue;
          newFinals.push({
            id: crypto.randomUUID(),
            text: alt.transcript.trim(),
            confidence: conf,
            isFinal: true,
          });

        } else {
          interimText += alt.transcript;
          interimConf += alt.confidence || 0;
          interimCount += 1;
        }
      }
      if (newFinals.length) {
        setFinalSegments((prev) => [...prev, ...newFinals]);
      }
      setInterim(
        interimText
          ? {
              id: 'interim',
              text: interimText,
              confidence: interimCount ? interimConf / interimCount : 0.5,
              isFinal: false,
            }
          : null
      );
    };

    recognition.onend = () => {
      setInterim(null);
      if (pausingRef.current) {
        pausingRef.current = false;
        setIsListening(false);
        setIsPaused(true);
      } else if (stoppingRef.current) {
        stoppingRef.current = false;
        setIsListening(false);
        setIsPaused(false);
      } else {
        setIsListening(false);
      }
    };
    recognition.onerror = () => {
      setIsListening(false);
    };
    return recognition;
  }, [isSupported]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  const startListening = useCallback(() => {
    if (!isSupported || isListening) return;
    setFinalSegments([]);
    setInterim(null);
    setIsPaused(false);
    // Prime the mic with noise suppression / echo cancellation so the browser's
    // SpeechRecognition picks up cleaner audio and ignores background chatter.
    void navigator.mediaDevices?.getUserMedia?.({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 16000,
      } as MediaTrackConstraints,
    }).catch(() => { /* fall back to default mic */ });
    const rec = buildRecognition();
    if (!rec) return;
    recognitionRef.current = rec;
    rec.start();
    setIsListening(true);
  }, [isSupported, isListening, buildRecognition]);


  const stopListening = useCallback(() => {
    if (recognitionRef.current && isListening) {
      stoppingRef.current = true;
      recognitionRef.current.stop();
    } else {
      setIsPaused(false);
    }
  }, [isListening]);

  const pauseListening = useCallback(() => {
    if (recognitionRef.current && isListening) {
      pausingRef.current = true;
      recognitionRef.current.stop();
    }
  }, [isListening]);

  const resumeListening = useCallback(() => {
    if (!isSupported || isListening) return;
    const rec = buildRecognition();
    if (!rec) return;
    recognitionRef.current = rec;
    rec.start();
    setIsListening(true);
    setIsPaused(false);
  }, [isSupported, isListening, buildRecognition]);

  const resetTranscript = useCallback(() => {
    setFinalSegments([]);
    setInterim(null);
    setIsPaused(false);
  }, []);

  const updateSegment = useCallback((id: string, text: string) => {
    setFinalSegments((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, text, confidence: Math.max(s.confidence, 0.99) } : s
      )
    );
  }, []);

  const removeSegment = useCallback((id: string) => {
    setFinalSegments((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const setSegmentsFromText = useCallback((text: string) => {
    setFinalSegments(
      text
        .split(/(?<=[.!?])\s+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => ({
          id: crypto.randomUUID(),
          text: t,
          confidence: 1,
          isFinal: true,
        }))
    );
    setInterim(null);
  }, []);

  const segments = interim ? [...finalSegments, interim] : finalSegments;
  const transcript = segments.map((s) => s.text).join(' ').trim();

  return {
    isListening,
    isPaused,
    transcript,
    segments,
    startListening,
    stopListening,
    pauseListening,
    resumeListening,
    resetTranscript,
    updateSegment,
    removeSegment,
    setSegmentsFromText,
    isSupported,
  };
}
