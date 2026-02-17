type DiagLevel = 'info' | 'warn' | 'error';

export type DiagEvent = {
  ts: string;
  level: DiagLevel;
  event: string;
  data?: unknown;
};

const MAX_EVENTS = 200;

export const diag = {
  events: [] as DiagEvent[],
  push(level: DiagLevel, event: string, data?: unknown) {
    const ts = new Date().toISOString();
    this.events.push({ ts, level, event, data });
    if (this.events.length > MAX_EVENTS) this.events.shift();

    const tag = `[LIVE_DIAG:${level.toUpperCase()}]`;
    if (level === 'error') console.error(tag, event, data ?? '');
    else if (level === 'warn') console.warn(tag, event, data ?? '');
    else console.log(tag, event, data ?? '');
  },
  last(n = 30) {
    return this.events.slice(-n);
  },
};

(globalThis as any).__diag = diag;

// Solo para DEV rápido (si quieres probar key directa).
// PERO: no recomendado en producción.
export function getApiKeyOrThrow(): string {
  const anyImportMeta = import.meta as any;
  const fromVite = anyImportMeta?.env?.VITE_GEMINI_API_KEY || anyImportMeta?.env?.VITE_API_KEY;
  if (!fromVite) throw new Error('No API key found in VITE_GEMINI_API_KEY.');
  return String(fromVite).trim();
}

export async function preflightChecks(): Promise<{ ok: boolean; report: string[] }> {
  const report: string[] = [];

  const isSecure =
    location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!isSecure) report.push('❌ La app NO está en HTTPS/localhost. getUserMedia puede fallar.');

  if (!('mediaDevices' in navigator) || !navigator.mediaDevices.getUserMedia) {
    report.push('❌ navigator.mediaDevices.getUserMedia no disponible.');
  } else {
    report.push('✅ getUserMedia disponible.');
  }

  if (!('WebSocket' in window)) report.push('❌ WebSocket no disponible.');
  else report.push('✅ WebSocket disponible.');

  report.push(`ℹ️ UA: ${navigator.userAgent}`);

  // Nota: aquí NO validamos API key porque en PROD usaremos token server.
  return { ok: report.every((x) => !x.startsWith('❌')), report };
}
