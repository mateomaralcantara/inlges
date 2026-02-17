import fs from "fs";
import crypto from "crypto";
import { GoogleGenAI } from "@google/genai";

function fp(key) {
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 10);
}

function last4(key) {
  return key.slice(-4);
}

function parseApiError(err) {
  const msg = String(err?.message || err);

  // intenta extraer JSON tipo {"error":{...}}
  const jsonMatch = msg.match(/\{[\s\S]*\}$/);
  if (jsonMatch) {
    try {
      const j = JSON.parse(jsonMatch[0]);
      const e = j?.error || j;
      return {
        status: e?.status,
        code: e?.code,
        message: e?.message,
        reason: e?.details?.[0]?.reason || e?.error?.details?.[0]?.reason,
        raw: msg,
      };
    } catch {}
  }

  return { raw: msg };
}

function classify(e) {
  const raw = (e?.message || e?.raw || "").toLowerCase();

  if (raw.includes("reported as leaked")) return "LEAKED (bloqueada)";
  if (raw.includes("api key expired")) return "EXPIRED (expirada)";
  if (raw.includes("api_key_invalid")) return "INVALID (invalida)";
  if (raw.includes("permission") || raw.includes("forbidden")) return "PERMISSION (sin permisos)";
  if (raw.includes("quota") || raw.includes("rate")) return "QUOTA/RATE (limite)";
  if (raw.includes("not found") || raw.includes("unavailable")) return "API/NETWORK";
  return "UNKNOWN";
}

async function testKey(key) {
  const client = new GoogleGenAI({
    apiKey: key,
    httpOptions: { apiVersion: "v1alpha" },
  });

  // 1) ping barato
  await client.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{ role: "user", parts: [{ text: "ping" }] }],
  });

  // 2) opcional: testea que authTokens exista (si usas ephemeral tokens)
  // Si esto falla, te dirá por qué.
  await client.authTokens.create({
    config: {
      uses: 1,
      expireTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      newSessionExpireTime: new Date(Date.now() + 60 * 1000).toISOString(),
      httpOptions: { apiVersion: "v1alpha" },
    },
  });

  return { ok: true };
}

async function main() {
  const file = process.argv[2] || "keys.txt";
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  if (!lines.length) {
    console.log("No keys found. Put keys in keys.txt (one per line).");
    process.exit(1);
  }

  console.log(`Auditing ${lines.length} keys...\n`);

  let ok = 0;
  for (let i = 0; i < lines.length; i++) {
    const key = lines[i];

    // no imprimimos la key completa nunca
    const id = `${i + 1}/${lines.length} last4=${last4(key)} fp=${fp(key)} starts=${key.slice(0,4)}`;

    try {
      await testKey(key);
      ok++;
      console.log(`✅ OK     ${id}`);
    } catch (err) {
      const info = parseApiError(err);
      const tag = classify(info);
      console.log(`❌ FAIL   ${id} -> ${tag}`);
      if (info?.message) console.log(`   msg: ${info.message}`);
      else console.log(`   msg: ${String(err?.message || err).slice(0, 200)}`);
    }

    // mini pausa para no rate-limit
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\nDone. OK=${ok} FAIL=${lines.length - ok}`);
}

main().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
