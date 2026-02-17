/**
 * Live API audio:
 * - Siempre PCM 16-bit little-endian.
 * - Input típico: 16kHz mono (pero puede re-muestrear).
 * - Output: 24kHz. :contentReference[oaicite:3]{index=3}
 */

export function createPcm16Blob(float32: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < float32.length; i++) {
    let s = Math.max(-1, Math.min(1, float32[i]));
    // convert float [-1..1] -> int16
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([buffer], { type: `audio/pcm;rate=${sampleRate}` });
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function pcm16ToAudioBuffer(
  pcmBytes: Uint8Array,
  audioContext: AudioContext,
  sampleRate: number,
  channels: number
): Promise<AudioBuffer> {
  // 16-bit PCM, little endian
  const sampleCount = Math.floor(pcmBytes.length / 2);
  const audioBuffer = audioContext.createBuffer(channels, sampleCount / channels, sampleRate);

  const dataView = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);

  // mono esperado aquí; si llega estéreo algún día, lo separas
  const channelData = audioBuffer.getChannelData(0);
  let offset = 0;
  for (let i = 0; i < channelData.length; i++) {
    const int16 = dataView.getInt16(offset, true);
    channelData[i] = int16 / 0x8000;
    offset += 2;
  }

  return audioBuffer;
}
