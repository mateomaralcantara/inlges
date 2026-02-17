import { GoogleGenAI } from "@google/genai";

export default async function handler(req, res) {
  try {
    const apiKey = (process.env.GEMINI_API_KEY_SERVER || process.env.GEMINI_API_KEY || "").trim();
    if (!apiKey) return res.status(400).json({ ok: false, error: "Missing GEMINI_API_KEY_SERVER" });

    const client = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });

    const out = await client.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ role: "user", parts: [{ text: "ping" }] }],
    });

    res.status(200).json({ ok: true, text: out?.text ?? null, keyLast4: apiKey.slice(-4) });
  } catch (e) {
    res.status(Number(e?.status || 500)).json({ ok: false, error: String(e?.message || e) });
  }
}
