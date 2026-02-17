import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";

/**
 * ✅ Carga SIEMPRE server/.env aunque ejecutes node desde otra carpeta.
 * ✅ override:true evita que Windows/PowerShell “claven” una key vieja por encima del .env
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, ".env"), override: true });

const app = express();
const PORT = Number(process.env.PORT || 8787);

app.use(express.json({ limit: "1mb" }));

/** -----------------------------
 * CORS (dev-friendly)
 * ---------------------------- */
const extraOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const allowList = new Set([
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  ...extraOrigins,
]);

function isLocalhostLike(origin) {
  return (
    typeof origin === "string" &&
    (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:"))
  );
}

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // curl/postman
      if (isLocalhostLike(origin)) return cb(null, true);
      if (allowList.has(origin)) return cb(null, true);
      return cb(new Error(`Not allowed by CORS: ${origin}`), false);
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

/** -----------------------------
 * Utilidades de Key
 * ---------------------------- */

// Prioridad (elige 1 naming y no te vuelvas loco):
// 1) GEMINI_API_KEY_SERVER (server/.env)
// 2) GEMINI_API_KEY
// 3) GOOGLE_API_KEY
const KEY_CANDIDATES = ["GEMINI_API_KEY_SERVER", "GEMINI_API_KEY", "GOOGLE_API_KEY"];

function pickApiKey() {
  for (const name of KEY_CANDIDATES) {
    const v = (process.env[name] || "").trim();
    if (v) return { key: v, source: name };
  }
  return { key: "", source: "missing" };
}

function mustKey() {
  const { key, source } = pickApiKey();
  if (!key) throw new Error(`Missing API key. Set one of: ${KEY_CANDIDATES.join(", ")} in server/.env`);
  return { key, source };
}

function keyFingerprint(k) {
  // fingerprint corto, no reversible
  return crypto.createHash("sha256").update(k).digest("hex").slice(0, 12);
}

function getClient() {
  const { key } = mustKey();
  // Nota: para ephemeral tokens el SDK te pide v1alpha
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: { apiVersion: "v1alpha" },
  });
}

/** -----------------------------
 * Parseo de errores (muy importante)
 * ---------------------------- */
function errPayload(err) {
  const status = Number(err?.status || err?.code) || 500;
  const message = String(err?.message || err);

  // intenta extraer JSON embebido si viene algo tipo: ApiError: { ...json... }
  let parsed = null;
  const match = message.match(/\{[\s\S]*\}$/);
  if (match) {
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      parsed = null;
    }
  }

  const details = parsed?.error || parsed || null;

  return {
    status,
    message: message.slice(0, 3000),
    details,
  };
}

/** -----------------------------
 * Endpoints de auditoría
 * ---------------------------- */

// ✅ ver qué key está usando el server (sin exponerla)
app.get("/api/whoami", (_req, res) => {
  const { key, source } = pickApiKey();
  res.json({
    ok: !!key,
    source,
    envPath: path.join(__dirname, ".env"),
    starts: key ? key.slice(0, 4) : null,
    last4: key ? key.slice(-4) : null,
    fp: key ? keyFingerprint(key) : null,
  });
});

// ✅ ping real: si esto falla, la key NO sirve o no tiene cuota/billing/restricciones
app.get("/api/health", async (_req, res) => {
  try {
    const { key, source } = mustKey();
    const client = getClient();

    const out = await client.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ role: "user", parts: [{ text: "ping" }] }],
    });

    res.json({
      ok: true,
      source,
      starts: key.slice(0, 4),
      last4: key.slice(-4),
      fp: keyFingerprint(key),
      text: out?.text ?? null,
    });
  } catch (e) {
    const p = errPayload(e);
    console.error("[/api/health] error:", e);
    res.status(p.status).json({ ok: false, ...p });
  }
});

// ✅ lista modelos desde el server: auditoría real del “proyecto” detrás de esa key
app.get("/api/models", async (_req, res) => {
  try {
    const { key, source } = mustKey();

    // El endpoint /v1beta/models es el más simple para validar key
    // pero aquí lo hacemos vía fetch para ver exactamente el error de Google
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
    const r = await fetch(url);
    const txt = await r.text();
    let data = null;
    try { data = JSON.parse(txt); } catch { data = { raw: txt }; }

    if (!r.ok) {
      return res.status(r.status).json({
        ok: false,
        source,
        starts: key.slice(0, 4),
        last4: key.slice(-4),
        fp: keyFingerprint(key),
        googleStatus: r.status,
        googleBody: data,
      });
    }

    res.json({
      ok: true,
      source,
      starts: key.slice(0, 4),
      last4: key.slice(-4),
      fp: keyFingerprint(key),
      modelCount: Array.isArray(data?.models) ? data.models.length : null,
      models: data?.models?.slice(0, 10) || [], // no te spammeo toda la lista
    });
  } catch (e) {
    const p = errPayload(e);
    console.error("[/api/models] error:", e);
    res.status(p.status).json({ ok: false, ...p });
  }
});

// ✅ ephemeral token para el front (Live)
app.get("/api/ephemeral-token", async (_req, res) => {
  try {
    const { key, source } = mustKey();
    const client = getClient();

    const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const newSessionExpireTime = new Date(Date.now() + 60 * 1000).toISOString();

    const token = await client.authTokens.create({
      config: {
        uses: 1,
        expireTime,
        newSessionExpireTime,
        httpOptions: { apiVersion: "v1alpha" },
      },
    });

    res.json({
      ok: true,
      source,
      keyLast4: key.slice(-4),
      fp: keyFingerprint(key),
      token: token.name,
    });
  } catch (e) {
    const p = errPayload(e);
    console.error("[/api/ephemeral-token] error:", e);
    res.status(p.status).json({ ok: false, ...p });
  }
});

/** -----------------------------
 * Boot logging
 * ---------------------------- */
app.listen(PORT, () => {
  const { key, source } = pickApiKey();
  console.log(`Token server on http://localhost:${PORT}`);
  console.log(`Loaded .env: ${path.join(__dirname, ".env")}`);
  console.log(`Key source: ${source}`);
  console.log(`Key starts: ${key ? key.slice(0, 4) : "(missing)"}`);
  console.log(`Key last4:  ${key ? key.slice(-4) : "(missing)"}`);
  console.log(`Key fp:     ${key ? keyFingerprint(key) : "(missing)"}`);
});
