/**
 * Decodes any browser-supported audio file or Blob (MP3, M4A, WebM, OGG, WAV)
 * into a 16kHz mono 16-bit PCM WAV File using the Web Audio API (`AudioContext` + `OfflineAudioContext`).
 * This allows the server's free built-in Whisper ONNX model to transcribe any uploaded or recorded
 * audio format without requiring external native `ffmpeg` binaries or paid cloud APIs.
 */
export async function convertAudioBlobTo16kHzWavFile(
  sourceBlob: Blob,
  baseName = "recording"
): Promise<{ wavFile: File; durationSeconds: number }> {
  if (
    typeof window === "undefined" ||
    (!window.AudioContext && !(window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
  ) {
    const fallbackName = baseName.endsWith(".wav") ? baseName : `${baseName}.wav`;
    return {
      wavFile: new File([sourceBlob], fallbackName, {
        type: sourceBlob.type || "audio/wav",
      }),
      durationSeconds: 0,
    };
  }

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AudioCtx();

  try {
    const arrayBuffer = await sourceBlob.arrayBuffer();
    const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const targetSampleRate = 16000;
    const targetLength = Math.max(1, Math.ceil(decodedBuffer.duration * targetSampleRate));

    const offlineCtx = new OfflineAudioContext(1, targetLength, targetSampleRate);
    const sourceNode = offlineCtx.createBufferSource();
    sourceNode.buffer = decodedBuffer;
    sourceNode.connect(offlineCtx.destination);
    sourceNode.start(0);

    const renderedBuffer = await offlineCtx.startRendering();
    const pcmFloat32 = renderedBuffer.getChannelData(0);
    const wavArrayBuffer = encodeMono16BitWav(pcmFloat32, targetSampleRate);

    const cleanName = baseName.replace(/\.[^/.]+$/, "");
    const wavFile = new File([wavArrayBuffer], `${cleanName}.wav`, {
      type: "audio/wav",
    });

    return {
      wavFile,
      durationSeconds: Math.round(decodedBuffer.duration),
    };
  } finally {
    await audioCtx.close().catch(() => {});
  }
}

function encodeMono16BitWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numChannels = 1;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format = 1
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // 16-bit samples
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }

  return buffer;
}

function writeAscii(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
