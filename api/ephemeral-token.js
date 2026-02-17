import { GoogleGenAI } from "@google/genai";

export default async function handler(req, res) {
  try {
    const apiKey = (process.env.GEMINI_API_KEY_SERVER || process.env.GEMINI_API_KEY || "").trim();
    if (!apiKey) return res.status(400).json({ ok: false, error: "Missing GEMINI_API_KEY_SERVER" });

    const client = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });

    const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const newSessionExpireTime = new Date(Date.now() + 60 * 1000).toISOString();

    const token = await client.authTokens.create({
      config: { uses: 1, expireTime, newSessionExpireTime, httpOptions: { apiVersion: "v1alpha" } },
    });

    res.status(200).json({ ok: true, token: token.name });
  } catch (e) {
    res.status(Number(e?.status || 500)).json({ ok: false, error: String(e?.message || e) });
  }
}
