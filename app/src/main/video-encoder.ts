import { requireMediaTools, runFfmpeg } from "./ffmpeg-tools";

let detected: Promise<string> | undefined;
/** Advertising an encoder is insufficient: require an actual one-frame hardware encode. */
export function detectVideoEncoder() {
  detected ??= (async () => {
    const tools = await requireMediaTools();
    const encoders = (await runFfmpeg(["-hide_banner", "-encoders"], tools))
      .stdout;
    for (const encoder of [
      "h264_nvenc",
      "h264_qsv",
      "h264_videotoolbox",
      "h264_amf",
    ]) {
      if (!encoders.includes(encoder)) continue;
      try {
        await runFfmpeg(
          [
            "-f",
            "lavfi",
            "-i",
            "color=size=128x128:rate=30",
            "-frames:v",
            "1",
            "-c:v",
            encoder,
            "-f",
            "null",
            "-",
          ],
          tools,
        );
        return encoder;
      } catch {
        /* Driver/device unavailable: keep probing, then use software. */
      }
    }
    return "libx264";
  })().catch(() => "libx264");
  return detected;
}
export function compatibleVideoArgs(encoder: string) {
  return encoder === "libx264"
    ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18"]
    : ["-c:v", encoder, "-b:v", "16M", "-maxrate", "24M", "-bufsize", "32M"];
}
