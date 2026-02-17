import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { MODEL_NAME, SYSTEM_PROMPT_TEMPLATE, TARGET_LANGUAGE_TO_SPANISH } from '../constants';
import { StudentLevel, TargetLanguage, TranscriptMessage } from '../types';
import { base64ToBytes, pcm16ToAudioBuffer } from '../utils/audioUtils';
import { parseStructuredText } from '../utils/textUtils';
import TranscriptBubble from './TranscriptBubble';
import { diag, preflightChecks } from '../utils/diagnostics';

interface ConversationViewProps {
  targetLanguage: TargetLanguage;
  studentLevel: StudentLevel;
}

function float32ToPcm16Base64(float32: Float32Array): string {
  const len = float32.length;
  const buffer = new ArrayBuffer(len * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < len; i++) {
    let s = float32[i];
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function approxRms(signal: Float32Array, step = 8): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < signal.length; i += step) {
    const v = signal[i];
    sum += v * v;
    count++;
  }
  return Math.sqrt(sum / Math.max(1, count));
}

async function getEphemeralToken(): Promise<string> {
  // En Vercel esto pega a /api/ephemeral-token en el MISMO dominio
  // En local puedes sobreescribir con VITE_TOKEN_URL si quieres
  const url = import.meta.env.VITE_TOKEN_URL || "/api/ephemeral-token";

  const r = await fetch(url, { cache: "no-store" });
  const text = await r.text();

  if (!r.ok) throw new Error(`Token server error (${r.status}): ${text}`);

  const data = JSON.parse(text);
  if (!data?.token) throw new Error(`No token returned: ${text}`);
  return data.token;
}



const ConversationView: React.FC<ConversationViewProps> = ({ targetLanguage, studentLevel }) => {
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Click start to begin');
  const [transcripts, setTranscripts] = useState<TranscriptMessage[]>([]);

  const [showDebug, setShowDebug] = useState(false);
  const [liveInput, setLiveInput] = useState('');
  const [liveOutput, setLiveOutput] = useState('');

  const sessionRef = useRef<any | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const currentInputTranscriptionRef = useRef('');
  const currentOutputTranscriptionRef = useRef('');
  const nextAudioStartTimeRef = useRef(0);
  const audioPlaybackSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const transcriptContainerRef = useRef<HTMLDivElement>(null);

  const sendBusyRef = useRef(false);

  useEffect(() => {
    if (!transcriptContainerRef.current) return;
    transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
  }, [transcripts, liveInput, liveOutput]);

  const stopSession = useCallback(() => {
    diag.push('warn', 'Stopping session');

    try {
      if (sessionRef.current) {
        sessionRef.current.close();
        sessionRef.current = null;
      }
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
      }
      if (scriptProcessorRef.current) {
        scriptProcessorRef.current.disconnect();
        scriptProcessorRef.current = null;
      }
      if (mediaStreamSourceRef.current) {
        mediaStreamSourceRef.current.disconnect();
        mediaStreamSourceRef.current = null;
      }
      if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
        inputAudioContextRef.current.close();
        inputAudioContextRef.current = null;
      }
      if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
        outputAudioContextRef.current.close();
        outputAudioContextRef.current = null;
      }

      audioPlaybackSourcesRef.current.forEach((s) => s.stop());
      audioPlaybackSourcesRef.current.clear();
      nextAudioStartTimeRef.current = 0;

      currentInputTranscriptionRef.current = '';
      currentOutputTranscriptionRef.current = '';
      setLiveInput('');
      setLiveOutput('');

      sendBusyRef.current = false;
      setIsSessionActive(false);
      setIsStarting(false);
      setStatusMessage('Session ended. Click start to begin again.');
    } catch (e: any) {
      diag.push('error', 'Error while stopping session', { message: e?.message });
      setIsSessionActive(false);
      setIsStarting(false);
      setStatusMessage('Session ended.');
    }
  }, []);

  useEffect(() => () => stopSession(), [stopSession]);

  const handleStartStop = async () => {
    if (isStarting) return;

    if (isSessionActive) {
      stopSession();
      return;
    }

    setIsStarting(true);

    try {
      diag.push('info', 'Start pressed');

      const pre = await preflightChecks();
      pre.report.forEach((line) => diag.push(line.startsWith('❌') ? 'error' : 'info', line));
      if (!pre.ok) {
        setStatusMessage('Preflight falló. Abre debug y revisa los ❌.');
        setShowDebug(true);
        setIsStarting(false);
        return;
      }

      setStatusMessage('Requesting microphone access...');
      micStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      diag.push('info', 'Microphone granted');

      setStatusMessage('Getting ephemeral token...');
      const token = await getEphemeralToken();
      diag.push('info', 'Ephemeral token received');

      setStatusMessage('Connecting to Gemini Live...');

      const targetLangEs = TARGET_LANGUAGE_TO_SPANISH[targetLanguage];
      const systemInstruction = SYSTEM_PROMPT_TEMPLATE
        .replace(/\[TARGET_LANGUAGE\]/g, targetLangEs)
        .replace(/\[STUDENT_LEVEL\]/g, studentLevel);

      // Nota: el SDK usa "apiKey" como credencial; aquí le pasamos el token efímero
      const ai = new GoogleGenAI({
        apiKey: token,
        httpOptions: { apiVersion: 'v1alpha' },
      });
      

      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
          systemInstruction,
        },
        callbacks: {
          onopen: () => {
            diag.push('info', 'Live session opened');

            inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
              sampleRate: 16000,
            });
            outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
              sampleRate: 24000,
            });

            setStatusMessage('Connected! Speak normally. (Use headphones 👀)');
            setIsSessionActive(true);
            setIsStarting(false);

            if (!micStreamRef.current || !inputAudioContextRef.current) return;

            mediaStreamSourceRef.current = inputAudioContextRef.current.createMediaStreamSource(micStreamRef.current);
            scriptProcessorRef.current = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);

            scriptProcessorRef.current.onaudioprocess = (evt) => {
              const session = sessionRef.current;
              const inCtx = inputAudioContextRef.current;
              if (!session || !inCtx) return;

              const inputData = evt.inputBuffer.getChannelData(0);

              const rms = approxRms(inputData, 8);
              if (rms > 0.03 && audioPlaybackSourcesRef.current.size > 0) {
                audioPlaybackSourcesRef.current.forEach((s) => s.stop());
                audioPlaybackSourcesRef.current.clear();
                if (outputAudioContextRef.current) {
                  nextAudioStartTimeRef.current = outputAudioContextRef.current.currentTime;
                }
              }

              if (sendBusyRef.current) return;
              sendBusyRef.current = true;

              const inRate = inCtx.sampleRate || 16000;
              const base64Audio = float32ToPcm16Base64(inputData);

              try {
                session.sendRealtimeInput({
                  audio: {
                    data: base64Audio,
                    mimeType: `audio/pcm;rate=${inRate}`,
                  },
                });
              } catch (err: any) {
                diag.push('error', 'sendRealtimeInput failed', { message: err?.message || String(err) });
              } finally {
                sendBusyRef.current = false;
              }
            };

            mediaStreamSourceRef.current.connect(scriptProcessorRef.current);
            scriptProcessorRef.current.connect(inputAudioContextRef.current.destination);
          },

          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription?.text) {
              currentInputTranscriptionRef.current += message.serverContent.inputTranscription.text;
              setLiveInput(currentInputTranscriptionRef.current);
            }

            if (message.serverContent?.outputTranscription?.text) {
              currentOutputTranscriptionRef.current += message.serverContent.outputTranscription.text;
              setLiveOutput(currentOutputTranscriptionRef.current);
            }

            const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData && outputAudioContextRef.current) {
              const audioContext = outputAudioContextRef.current;
              nextAudioStartTimeRef.current = Math.max(nextAudioStartTimeRef.current, audioContext.currentTime);

              const bytes = base64ToBytes(audioData);
              const audioBuffer = await pcm16ToAudioBuffer(bytes, audioContext, 24000, 1);

              const source = audioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(audioContext.destination);

              source.addEventListener('ended', () => {
                audioPlaybackSourcesRef.current.delete(source);
              });

              source.start(nextAudioStartTimeRef.current);
              nextAudioStartTimeRef.current += audioBuffer.duration;
              audioPlaybackSourcesRef.current.add(source);
            }

            if (message.serverContent?.turnComplete) {
              const fullInput = currentInputTranscriptionRef.current.trim();
              const fullOutput = currentOutputTranscriptionRef.current.trim();

              if (fullInput) {
                setTranscripts((prev) => [
                  ...prev,
                  { id: Date.now() + Math.random(), speaker: 'user', text: fullInput },
                ]);
              }

              if (fullOutput) {
                const parsed = parseStructuredText(fullOutput);
                setTranscripts((prev) => [
                  ...prev,
                  { id: Date.now() + Math.random(), speaker: 'model', text: parsed },
                ]);
              }

              currentInputTranscriptionRef.current = '';
              currentOutputTranscriptionRef.current = '';
              setLiveInput('');
              setLiveOutput('');
            }
          },

          onclose: (e: any) => {
            const ce = e as CloseEvent | undefined;
            const code = ce?.code;
            const reason = ce?.reason;

            diag.push('warn', 'Live session closed', { code, reason, wasClean: ce?.wasClean });

            // Mensaje UX si detecta la misma razón de key quemada
            if (reason?.includes('reported as leaked')) {
              setStatusMessage('Tu API key real está bloqueada por “leak”. Crea una nueva en el server y reinicia.');
              setShowDebug(true);
            }

            stopSession();
          },

          onerror: (e: ErrorEvent) => {
            diag.push('error', 'Live session error', { message: e.message });
            setStatusMessage(`Error: ${e.message}`);
            setShowDebug(true);
            stopSession();
          },
        },
      });

      sessionRef.current = await sessionPromise;
      diag.push('info', 'SessionRef set');
    } catch (error: any) {
      const msg = error?.message || String(error);
      diag.push('error', 'Failed to start', { msg });
      setStatusMessage(`Failed to start: ${msg}`);
      setShowDebug(true);
      setIsStarting(false);
      stopSession();
    }
  };

  const BACKGROUND_IMAGE_URL = 'https://i.imgur.com/7D6xHcH.jpeg';
  const AVATAR_IMAGE_URL = 'https://i.imgur.com/AdAn43v.png';

  return (
    <div className="flex flex-col h-full bg-gray-800 rounded-lg overflow-hidden relative">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url('${BACKGROUND_IMAGE_URL}')`, opacity: 0.15, zIndex: 0 }}
      />
      <div className="relative z-10 flex flex-col h-full">
        <header className="p-4 flex items-center gap-4 bg-gray-900/50 backdrop-blur-sm">
          <img
            src={AVATAR_IMAGE_URL}
            alt="Miss Laura"
            className="w-16 h-16 rounded-full border-2 border-indigo-400 object-cover"
          />
          <div>
            <h1 className="text-2xl font-bold">Miss Laura</h1>
            <p className="text-indigo-300">{`Practicing: ${targetLanguage} (${studentLevel})`}</p>
          </div>
        </header>

        <main ref={transcriptContainerRef} className="flex-1 p-4 overflow-y-auto space-y-4">
          {transcripts.map((msg) => (
            <div
              key={msg.id}
              className={`flex items-start gap-3 ${msg.speaker === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.speaker === 'model' && (
                <img
                  src={AVATAR_IMAGE_URL}
                  alt="Miss Laura avatar"
                  className="w-8 h-8 rounded-full flex-shrink-0 object-cover"
                />
              )}

              <div
                className={`max-w-xs md:max-w-md lg:max-w-lg px-4 py-3 rounded-2xl ${
                  msg.speaker === 'user' ? 'bg-green-600 rounded-br-none' : 'bg-gray-700 rounded-bl-none'
                }`}
              >
                {typeof msg.text === 'string' ? (
                  <p className="whitespace-pre-wrap">{msg.text}</p>
                ) : (
                  <TranscriptBubble content={msg.text} targetLanguage={targetLanguage} />
                )}
              </div>
            </div>
          ))}

          {liveInput && (
            <div className="flex items-start gap-3 justify-end opacity-80">
              <div className="max-w-xs md:max-w-md lg:max-w-lg px-4 py-3 rounded-2xl bg-green-700 rounded-br-none">
                <p className="whitespace-pre-wrap">{liveInput}</p>
              </div>
            </div>
          )}

          {liveOutput && (
            <div className="flex items-start gap-3 justify-start opacity-80">
              <img
                src={AVATAR_IMAGE_URL}
                alt="Miss Laura avatar"
                className="w-8 h-8 rounded-full flex-shrink-0 object-cover"
              />
              <div className="max-w-xs md:max-w-md lg:max-w-lg px-4 py-3 rounded-2xl bg-gray-700 rounded-bl-none">
                <p className="text-gray-300 whitespace-pre-wrap">{liveOutput}</p>
              </div>
            </div>
          )}
        </main>

        <footer className="p-4 bg-gray-900/50 backdrop-blur-sm flex flex-col items-center gap-3">
          <p className="text-sm text-gray-400 h-5 text-center">{statusMessage}</p>

          <button
            onClick={handleStartStop}
            disabled={isStarting}
            aria-label={isSessionActive ? 'Stop session' : 'Start session'}
            className={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 focus:outline-none focus:ring-4 ${
              isStarting
                ? 'bg-gray-500 cursor-not-allowed'
                : isSessionActive
                ? 'bg-red-500 hover:bg-red-600 focus:ring-red-400'
                : 'bg-green-500 hover:bg-green-600 focus:ring-green-400'
            }`}
          >
            {isSessionActive ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM7 7a1 1 0 012 0v6a1 1 0 11-2 0V7zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V7z"
                  clipRule="evenodd"
                />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white" viewBox="0 0 20 20" fill="currentColor">
                <path d="M7 4a3 3 0 016 0v6a3 3 0 11-6 0V4z" />
                <path d="M5.5 8.5a.5.5 0 01.5.5v1.5a4 4 0 004 4h0a4 4 0 004-4V9a.5.5 0 011 0v1.5a5 5 0 01-4.5 4.975V17h3a.5.5 0 010 1h-7a.5.5 0 010-1h3v-1.525A5 5 0 014.5 10.5V9a.5.5 0 01.5-.5z" />
              </svg>
            )}
          </button>

          <div className="w-full max-w-2xl">
            <button
              onClick={() => setShowDebug((v) => !v)}
              className="text-xs text-indigo-300 underline"
              type="button"
            >
              {showDebug ? 'Hide debug' : 'Show debug'}
            </button>

            {showDebug && (
              <pre className="mt-2 text-xs bg-black/40 p-3 rounded-lg overflow-auto max-h-56 whitespace-pre-wrap">
                {diag
                  .last(60)
                  .map((ev) => `${ev.ts} [${ev.level}] ${ev.event}${ev.data ? ' ' + JSON.stringify(ev.data) : ''}`)
                  .join('\n')}
              </pre>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
};

export default ConversationView;
