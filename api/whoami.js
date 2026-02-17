export default function handler(req, res) {
    const k = (process.env.GEMINI_API_KEY_SERVER || process.env.GEMINI_API_KEY || "").trim();
    res.status(200).json({
      ok: !!k,
      starts: k ? k.slice(0, 4) : null,
      last4: k ? k.slice(-4) : null,
    });
  }
  