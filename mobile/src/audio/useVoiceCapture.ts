import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { File } from 'expo-file-system';

export type CaptureState = 'idle' | 'listening' | 'thinking';

/**
 * Metering is dBFS: roughly -160 (silence) to 0 (clipping).
 *
 * Ambient level is sampled for this long before speech detection begins. A
 * fixed absolute gate cannot work in both a quiet room (~-55 dB ambient) and a
 * moving car with music (~-25 dB) — in the car everything reads as "speech",
 * silence never arrives, and recording runs until the user stops it.
 */
const CALIBRATION_MS = 400;
/**
 * How far above measured ambient counts as the user talking. The phone is far
 * closer to their mouth than to any background noise, so their voice clears the
 * room by a wide margin even when the room is loud.
 */
const SPEECH_MARGIN_DB = 12;
/** Never gate lower than this, so a silent room does not trigger on nothing. */
const MIN_SPEECH_DB = -50;
/** Nor higher than this, or a soft voice in a loud car is never heard at all. */
const MAX_SPEECH_DB = -15;
/** Silence this long after speech ends the recording (architecture doc §6: ~1-1.5s). */
const SILENCE_HOLD_MS = 1200;
/** If no speech at all by now, the user tapped by accident. */
const NO_SPEECH_TIMEOUT_MS = 4_000;
/** Metering poll interval. Fast enough to drive the pulsing ring smoothly. */
const POLL_MS = 100;

/** Map dBFS onto 0-1 for the UI ring. */
const toLevel = (db: number | undefined): number => {
  if (db === undefined || !Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(1, (db + 60) / 60));
};

interface Options {
  onResult: (audioUri: string) => Promise<void> | void;
  onError: (message: string) => void;
}

export function useVoiceCapture({ onResult, onError }: Options) {
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });
  const recorderState = useAudioRecorderState(recorder, POLL_MS);

  const [state, setState] = useState<CaptureState>('idle');
  const [level, setLevel] = useState(0);

  // Refs, not state: these change every 100ms and must not re-render.
  const heardSpeech = useRef(false);
  const lastLoudAt = useRef(0);
  const startedAt = useRef(0);
  const stopping = useRef(false);
  const ambientSamples = useRef<number[]>([]);
  const speechThreshold = useRef<number | null>(null);

  const finish = useCallback(
    async (reason: 'silence' | 'no-speech' | 'manual') => {
      if (stopping.current) return;
      stopping.current = true;

      console.log('[capture] stopping, reason:', reason);
      setState(reason === 'no-speech' ? 'idle' : 'thinking');
      setLevel(0);

      try {
        await recorder.stop();
      } catch {
        // Recorder already torn down; the URI check below handles it.
      }

      const uri = recorder.uri;
      console.log('[capture] recorded uri:', uri);

      if (reason === 'no-speech') {
        if (uri) { try { new File(uri).delete(); } catch {} }
        onError("Didn't hear anything — tap and speak.");
        stopping.current = false;
        return;
      }
      if (!uri) {
        setState('idle');
        onError('Recording failed. Try again.');
        stopping.current = false;
        return;
      }

      try {
        await onResult(uri);
      } finally {
        setState('idle');
        stopping.current = false;
      }
    },
    [onError, onResult, recorder],
  );

  // Silence detection. Runs on every metering tick while listening.
  useEffect(() => {
    if (state !== 'listening' || !recorderState.isRecording) return;

    const now = Date.now();
    const db = recorderState.metering;
    const elapsed = now - startedAt.current;
    setLevel(toLevel(db));

    // Phase 1: listen to the room before judging anything as speech.
    if (elapsed < CALIBRATION_MS) {
      if (db !== undefined && Number.isFinite(db)) ambientSamples.current.push(db);
      return;
    }

    // Phase 2: set the gate once, relative to whatever the room turned out to be.
    if (speechThreshold.current === null) {
      const samples = ambientSamples.current;
      const ambient = samples.length
        ? samples.reduce((a, b) => a + b, 0) / samples.length
        : MIN_SPEECH_DB;
      speechThreshold.current = Math.min(
        MAX_SPEECH_DB,
        Math.max(MIN_SPEECH_DB, ambient + SPEECH_MARGIN_DB),
      );
      console.log(
        `[capture] ambient ${ambient.toFixed(1)} dB -> speech gate ${speechThreshold.current.toFixed(1)} dB`,
      );
      // Calibration is not silence; do not let it count toward the hold window.
      lastLoudAt.current = now;
    }

    if (db !== undefined && db > speechThreshold.current) {
      heardSpeech.current = true;
      lastLoudAt.current = now;
    }

    if (!heardSpeech.current) {
      if (elapsed > NO_SPEECH_TIMEOUT_MS) void finish('no-speech');
      return;
    }
    if (now - lastLoudAt.current > SILENCE_HOLD_MS) void finish('silence');
  }, [recorderState.metering, recorderState.isRecording, state, finish]);

  const start = useCallback(async () => {
    if (state !== 'idle') return;

    const { granted } = await requestRecordingPermissionsAsync();
    if (!granted) {
      onError('Microphone access is needed to speak a reminder.');
      return;
    }

    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });

    heardSpeech.current = false;
    ambientSamples.current = [];
    speechThreshold.current = null;
    startedAt.current = Date.now();
    lastLoudAt.current = Date.now();
    stopping.current = false;

    await recorder.prepareToRecordAsync();
    recorder.record();
    console.log('[capture] recording started');
    setState('listening');
  }, [onError, recorder, state]);

  const stop = useCallback(() => finish('manual'), [finish]);

  return { state, level, start, stop, isRecording: recorderState.isRecording };
}
