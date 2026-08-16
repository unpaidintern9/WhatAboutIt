import { spawn, execFile } from "node:child_process";
import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { promisify } from "node:util";
import type { IncomingMessage } from "node:http";
import type { LocalTranscriptionProgress, LocalTranscriptionResult, LocalTranscriptionStatus } from "../shared/local-transcription";
import { parseWhisperJson } from "../shared/local-transcription";
import { getAppDataRoot, getEpisodesRoot } from "./config-service";
import { getMediaDurationMs, runFfmpegWithProgress } from "./ffmpeg-tools";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

export const LOCAL_WHISPER_MODEL = {
  name: "Whisper base.en Q5_1",
  fileName: "ggml-base.en-q5_1.bin",
  sizeBytes: 59_721_011,
  sha256: "4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f",
  url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.en-q5_1.bin"
} as const;

export const LOCAL_WHISPER_RUNTIME = {
  version: "v1.9.2",
  archiveName: "whisper-bin-x64.zip",
  sha256: "49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a",
  url: "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip"
} as const;

export const LOCAL_WHISPER_RUNTIME_FILES: Readonly<Record<string, string>> = {
  "whisper-cli.exe": "95e3c0b0e778ad9499eb0125f97c1dcf437dd9eb4ea77050b043574f93c2631d",
  "whisper.dll": "792fc523c7ad16e6b9c348e30ad5e5f591165cbcf6a80ca8d0db02a38ce3eea2",
  "ggml.dll": "894c6237ee7849843213906a2b6a0b371aaa6234048d465f206d910ae846fafb",
  "ggml-base.dll": "1482359d921b4c1b183d49db1d770f9b5e90d86a618b8b648d4845c2471ad6b0",
  "ggml-cpu-alderlake.dll": "d1c5411561361f7ce71ff8455ecf01f666f581b0608fa91a1dfe7d3fd6a25bd1",
  "ggml-cpu-cannonlake.dll": "2ef36f05fa252ff4fdcb8d42ebce1ceba4f3d3de12b93bed15bdee6237dccd63",
  "ggml-cpu-cascadelake.dll": "505899aaf3f99c5d714361640f561458ea97f8a09eb0614568a66bead2115cb0",
  "ggml-cpu-haswell.dll": "f8cf2f35a06498d783d77fde42004dd54d2f8236b0d42ac323b94bba65a603c4",
  "ggml-cpu-icelake.dll": "78ad143ee2e674d037b4840ef33b5748a0659762a26e0ae2b621c4f9451cbde8",
  "ggml-cpu-sandybridge.dll": "ee47db7dc40fb30eca73e62a05306059c2c3c42aecddf2e8d6ad7e530069b815",
  "ggml-cpu-skylakex.dll": "164e2793897944a43ee071ce6c0b09018088bdf4dd8b14ac0755c58849cf8c50",
  "ggml-cpu-sse42.dll": "7318a9a3b95a85b2453c437b274412bbbae89e5ecdf5babb19b99edc06ded063",
  "ggml-cpu-x64.dll": "af0f1c2f28ff9e3f472481dd969907bda85fa39d4fde17617d4bb0b389301b60"
};

interface TranscriptionPaths {
  root: string;
  runtimeFolder: string;
  executable: string;
  model: string;
}

interface ActiveTranscription {
  episodeId: string;
  controller: AbortController;
}

let activeTranscription: ActiveTranscription | undefined;

const THIRD_PARTY_NOTICE = `Local transcription components\n\nwhisper.cpp\nCopyright (c) 2023-2026 Georgi Gerganov\nhttps://github.com/ggml-org/whisper.cpp\n\nWhisper model\nCopyright (c) 2022 OpenAI\nhttps://github.com/openai/whisper\n\nMIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n`;

function createAbortError(message = "Local transcription was canceled") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw createAbortError();
}

function transcriptionPaths(): TranscriptionPaths {
  const root = path.join(getAppDataRoot(), "Local Transcription");
  const runtimeFolder = path.join(root, `whisper-${LOCAL_WHISPER_RUNTIME.version}-win-x64`);
  return {
    root,
    runtimeFolder,
    executable: path.join(runtimeFolder, "whisper-cli.exe"),
    model: path.join(root, "models", LOCAL_WHISPER_MODEL.fileName)
  };
}

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(filePath: string) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function runtimeIsVerified(paths: TranscriptionPaths) {
  try {
    const results = await Promise.all(Object.entries(LOCAL_WHISPER_RUNTIME_FILES).map(async ([fileName, expectedHash]) => await sha256File(path.join(paths.runtimeFolder, fileName)) === expectedHash));
    return results.every(Boolean);
  } catch {
    return false;
  }
}

function isTrustedDownloadUrl(value: URL) {
  const hostname = value.hostname.toLowerCase();
  return value.protocol === "https:" && (
    hostname === "github.com"
    || hostname === "huggingface.co"
    || hostname.endsWith(".githubusercontent.com")
    || hostname.endsWith(".huggingface.co")
    || hostname.endsWith(".hf.co")
    || hostname.endsWith(".xethub.hf.co")
  );
}

async function openDownload(rawUrl: string, signal: AbortSignal | undefined, redirects = 0): Promise<IncomingMessage> {
  if (redirects > 6) throw new Error("The transcription download redirected too many times.");
  const url = new URL(rawUrl);
  if (!isTrustedDownloadUrl(url)) throw new Error("The transcription download source is not trusted.");
  throwIfAborted(signal);

  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "User-Agent": "What-About-It-Studio" } }, (response) => {
      const location = response.headers.location;
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && location) {
        response.resume();
        signal?.removeEventListener("abort", abort);
        void openDownload(new URL(location, url).toString(), signal, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        signal?.removeEventListener("abort", abort);
        reject(new Error(`The transcription download failed with HTTP ${response.statusCode ?? "unknown"}.`));
        return;
      }
      response.once("close", () => signal?.removeEventListener("abort", abort));
      resolve(response);
    });
    const abort = () => request.destroy(createAbortError());
    signal?.addEventListener("abort", abort, { once: true });
    request.once("error", (error) => {
      signal?.removeEventListener("abort", abort);
      reject(signal?.aborted ? createAbortError() : error);
    });
  });
}

export async function downloadVerifiedFile(
  url: string,
  destination: string,
  expectedSha256: string,
  options: { signal?: AbortSignal; onProgress?: (progress: number) => void } = {}
) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporaryPath = `${destination}.${crypto.randomUUID()}.part`;
  const hash = crypto.createHash("sha256");
  let file: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    const response = await openDownload(url, options.signal);
    const totalBytes = Number(response.headers["content-length"] ?? 0);
    let receivedBytes = 0;
    file = await fs.open(temporaryPath, "wx");
    for await (const rawChunk of response) {
      throwIfAborted(options.signal);
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk as Uint8Array);
      await file.writeFile(chunk);
      hash.update(chunk);
      receivedBytes += chunk.byteLength;
      if (totalBytes > 0) options.onProgress?.(Math.min(99, Math.round((receivedBytes / totalBytes) * 100)));
    }
    await file.sync();
    await file.close();
    file = undefined;
    const digest = hash.digest("hex");
    if (digest !== expectedSha256) throw new Error("The transcription download failed its security check. Nothing was installed.");
    await fs.rename(temporaryPath, destination);
    options.onProgress?.(100);
  } catch (error) {
    await file?.close().catch(() => undefined);
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function ensureRuntime(paths: TranscriptionPaths, progress: (value: number) => void, signal: AbortSignal) {
  if (await runtimeIsVerified(paths)) return;
  await fs.rm(paths.runtimeFolder, { recursive: true, force: true });
  const archivePath = path.join(paths.root, "downloads", `${LOCAL_WHISPER_RUNTIME.version}-${crypto.randomUUID()}-${LOCAL_WHISPER_RUNTIME.archiveName}`);
  const extractionFolder = path.join(paths.root, `runtime-install-${crypto.randomUUID()}`);
  try {
    await downloadVerifiedFile(LOCAL_WHISPER_RUNTIME.url, archivePath, LOCAL_WHISPER_RUNTIME.sha256, { signal, onProgress: progress });
    throwIfAborted(signal);
    await fs.mkdir(extractionFolder, { recursive: true });
    await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "& { param($archivePath, $destinationPath) Expand-Archive -LiteralPath $archivePath -DestinationPath $destinationPath -Force }",
        archivePath,
        extractionFolder
      ],
      { windowsHide: true, timeout: 120_000 }
    );
    const extractedRuntime = path.join(extractionFolder, "Release");
    const extractedFilesPresent = await Promise.all(Object.keys(LOCAL_WHISPER_RUNTIME_FILES).map((fileName) => pathExists(path.join(extractedRuntime, fileName))));
    if (!extractedFilesPresent.every(Boolean)) {
      throw new Error("The verified Whisper engine archive did not contain the expected files.");
    }
    await fs.rm(paths.runtimeFolder, { recursive: true, force: true });
    await fs.rename(extractedRuntime, paths.runtimeFolder);
  } finally {
    await fs.rm(extractionFolder, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(archivePath, { force: true }).catch(() => undefined);
  }
}

async function ensureModel(paths: TranscriptionPaths, progress: (value: number) => void, signal: AbortSignal) {
  if (await pathExists(paths.model)) {
    const stat = await fs.stat(paths.model);
    if (stat.size === LOCAL_WHISPER_MODEL.sizeBytes && await sha256File(paths.model) === LOCAL_WHISPER_MODEL.sha256) return;
    await fs.rm(paths.model, { force: true });
  }
  await downloadVerifiedFile(LOCAL_WHISPER_MODEL.url, paths.model, LOCAL_WHISPER_MODEL.sha256, { signal, onProgress: progress });
}

function episodeFolder(episodeId: string) {
  const root = path.resolve(getEpisodesRoot());
  const folder = path.resolve(root, episodeId);
  if (!episodeId || folder === root || !folder.startsWith(`${root}${path.sep}`)) throw new Error("The episode transcription path is invalid.");
  return folder;
}

async function existingSources(folder: string) {
  const microphoneCandidates = ["morgan-mic.m4a", "guest-mic.m4a", "extra-mic.m4a"].map((name) => path.join(folder, "Audio", name));
  const microphones = (await Promise.all(microphoneCandidates.map(async (candidate) => await pathExists(candidate) ? candidate : undefined))).filter((candidate): candidate is string => Boolean(candidate));
  if (microphones.length > 0) return microphones;
  const program = path.join(folder, "Program", "program.webm");
  return await pathExists(program) ? [program] : [];
}

export function createTranscriptionAudioArguments(sources: string[], outputPath: string) {
  const inputs = sources.flatMap((source) => ["-i", source]);
  if (sources.length === 1) return ["-y", ...inputs, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", outputPath];
  const labels = sources.map((_, index) => `[${index}:a]`).join("");
  return [
    "-y",
    ...inputs,
    "-filter_complex",
    `${labels}amix=inputs=${sources.length}:duration=longest:normalize=0,alimiter=limit=0.95[mix]`,
    "-map",
    "[mix]",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    outputPath
  ];
}

async function runWhisper(executable: string, model: string, input: string, outputPrefix: string, signal: AbortSignal, onProgress: (progress: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(executable, ["-m", model, "-f", input, "-l", "en", "-oj", "-of", outputPrefix, "-pp", "-sow", "-ml", "84"], {
      cwd: path.dirname(executable),
      windowsHide: true
    });
    let errorOutput = "";
    let aborted = false;
    const inspectOutput = (chunk: Buffer) => {
      const text = chunk.toString();
      errorOutput = `${errorOutput}${text}`.slice(-16_384);
      for (const match of text.matchAll(/progress\s*=\s*(\d+)%/gi)) onProgress(Math.min(99, Number(match[1])));
    };
    const abort = () => {
      aborted = true;
      child.kill();
    };
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", inspectOutput);
    child.stderr.on("data", inspectOutput);
    child.once("error", (error) => {
      signal.removeEventListener("abort", abort);
      reject(signal.aborted ? createAbortError() : error);
    });
    child.once("close", (code) => {
      signal.removeEventListener("abort", abort);
      if (aborted || signal.aborted) reject(createAbortError());
      else if (code === 0) {
        onProgress(100);
        resolve();
      } else reject(new Error(errorOutput.trim() || `Whisper exited with code ${code ?? "unknown"}.`));
    });
  });
}

export async function getLocalTranscriptionStatus(): Promise<LocalTranscriptionStatus> {
  const supported = process.platform === "win32" && process.arch === "x64";
  if (!supported) {
    return {
      supported: false,
      ready: false,
      modelName: LOCAL_WHISPER_MODEL.name,
      modelSizeBytes: LOCAL_WHISPER_MODEL.sizeBytes,
      message: "Free local transcription is currently available in the Windows app."
    };
  }
  const paths = transcriptionPaths();
  const [runtimeReady, modelReady] = await Promise.all([
    runtimeIsVerified(paths),
    pathExists(paths.model).then(async (exists) => exists && (await fs.stat(paths.model)).size === LOCAL_WHISPER_MODEL.sizeBytes)
  ]);
  return {
    supported: true,
    ready: runtimeReady && modelReady,
    modelName: LOCAL_WHISPER_MODEL.name,
    modelSizeBytes: LOCAL_WHISPER_MODEL.sizeBytes,
    message: runtimeReady && modelReady
      ? "Free local transcription is installed and works offline."
      : "The first transcription downloads the free local model (about 57 MB) and engine (about 8 MB)."
  };
}

export async function transcribeEpisodeLocally(
  episodeId: string,
  onProgress: (progress: LocalTranscriptionProgress) => void
): Promise<LocalTranscriptionResult> {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Free local transcription is currently available in the Windows app.");
  if (activeTranscription) throw new Error(`Local transcription is already running for ${activeTranscription.episodeId}.`);
  const controller = new AbortController();
  activeTranscription = { episodeId, controller };
  const emit = (stage: LocalTranscriptionProgress["stage"], progress: number, message: string) => onProgress({ episodeId, stage, progress: Math.min(100, Math.max(0, Math.round(progress))), message });
  const paths = transcriptionPaths();
  const folder = episodeFolder(episodeId);
  const workFolder = path.join(folder, "Session", "Transcription", crypto.randomUUID());
  const wavPath = path.join(workFolder, "episode-audio.wav");
  const outputPrefix = path.join(workFolder, "whisper-result");
  try {
    emit("checking", 0, "Checking the free local transcription files…");
    await fs.access(path.join(folder, "metadata.json"));
    await fs.mkdir(paths.root, { recursive: true });
    await fs.writeFile(path.join(paths.root, "THIRD-PARTY-NOTICES.txt"), THIRD_PARTY_NOTICE, "utf8");
    await fs.mkdir(workFolder, { recursive: true });
    emit("downloading-engine", 0, "Preparing the free local Whisper engine…");
    await ensureRuntime(paths, (progress) => emit("downloading-engine", progress, "Downloading the free local Whisper engine…"), controller.signal);
    emit("downloading-model", 0, "Preparing the free English speech model…");
    await ensureModel(paths, (progress) => emit("downloading-model", progress, "Downloading the free English model (57 MB)…"), controller.signal);
    throwIfAborted(controller.signal);

    const sources = await existingSources(folder);
    if (sources.length === 0) throw new Error("Add or record podcast audio before starting transcription.");
    const durations = await Promise.all(sources.map((source) => getMediaDurationMs(source).catch(() => 0)));
    const durationMs = Math.max(...durations, 1);
    emit("preparing-audio", 0, sources.length > 1 ? `Mixing ${sources.length} microphone tracks for transcription…` : "Preparing episode audio for transcription…");
    await runFfmpegWithProgress(createTranscriptionAudioArguments(sources, wavPath), {
      durationMs,
      signal: controller.signal,
      onProgress: (progress) => emit("preparing-audio", progress, "Preparing episode audio for transcription…")
    });

    emit("transcribing", 0, "Transcribing locally. The episode stays on this computer…");
    await runWhisper(paths.executable, paths.model, wavPath, outputPrefix, controller.signal, (progress) => emit("transcribing", progress, "Transcribing locally. The episode stays on this computer…"));
    const parsed = JSON.parse(await fs.readFile(`${outputPrefix}.json`, "utf8")) as unknown;
    const cues = parseWhisperJson(parsed, `caption-whisper-${Date.now()}`);
    if (cues.length === 0) throw new Error("Whisper finished but did not detect any spoken words.");
    emit("complete", 100, `${cues.length} caption cues are ready to review.`);
    await logger.info("LocalTranscription", "Created local episode transcript.", { episodeId, cueCount: cues.length, sourceCount: sources.length, model: LOCAL_WHISPER_MODEL.name });
    return {
      cues,
      modelName: LOCAL_WHISPER_MODEL.name,
      message: `${cues.length} caption cue${cues.length === 1 ? "" : "s"} created locally. Review names and timing before export.`
    };
  } catch (error) {
    const normalized = controller.signal.aborted ? createAbortError() : error;
    if (!(normalized instanceof Error) || normalized.name !== "AbortError") {
      await logger.error("LocalTranscription", "Local episode transcription failed.", { episodeId, error: String(normalized) });
    }
    throw normalized;
  } finally {
    await fs.rm(workFolder, { recursive: true, force: true }).catch(() => undefined);
    if (activeTranscription?.controller === controller) activeTranscription = undefined;
  }
}

export function cancelLocalTranscription(episodeId: string) {
  if (!activeTranscription || activeTranscription.episodeId !== episodeId) return false;
  activeTranscription.controller.abort();
  return true;
}
