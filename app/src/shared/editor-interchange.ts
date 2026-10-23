import { isTimelineTrackAvailableAt, type TimelineDraft } from "./timeline";

export interface InterchangeSource {
  assetId: string;
  file: string;
  kind: "video" | "audio";
  durationMs: number;
  width?: number;
  height?: number;
  channels?: number;
  frameRate?: string;
}
interface Clip {
  source: InterchangeSource;
  label: string;
  timelineStart: number;
  sourceStart: number;
  duration: number;
  lane: number;
  gain: number;
}
const fps = 30;
const frame = (ms: number) => Math.round((ms * fps) / 1000);
const time = (ms: number) => `${frame(ms)}/${fps}s`;
const xml = (value: string | number) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
const sourceRate = (source: InterchangeSource) => {
  const [numerator, denominator = 1] = (source.frameRate ?? "30/1")
    .split("/")
    .map(Number);
  return numerator > 0 && denominator > 0
    ? { numerator, denominator }
    : { numerator: 30, denominator: 1 };
};
const sourceFrames = (source: InterchangeSource, ms: number) => {
  const rate = sourceRate(source);
  return Math.round((ms * rate.numerator) / rate.denominator / 1000);
};
const sourceTime = (source: InterchangeSource, ms: number) => {
  const rate = sourceRate(source);
  return `${sourceFrames(source, ms) * rate.denominator}/${rate.numerator}s`;
};
const uri = (file: string) =>
  `../${file.replaceAll("\\", "/").split("/").map(encodeURIComponent).join("/")}`;

export function createEditorInterchange(
  draft: TimelineDraft,
  sources: InterchangeSource[],
) {
  const edits = draft.editLog.filter(
    (edit) => !edit.targetTrackId || edit.targetTrackId === "program",
  );
  const start = Math.max(
    0,
    ...edits
      .filter((edit) => edit.type === "trim-before")
      .map((edit) => edit.timestampMs),
  );
  const end = Math.min(
    draft.durationMs,
    ...edits
      .filter((edit) => edit.type === "trim-after")
      .map((edit) => edit.timestampMs),
  );
  const cuts = edits
    .filter((edit) => edit.type === "delete-section")
    .map((edit) => ({
      start: edit.timestampMs,
      end: edit.endTimestampMs ?? edit.timestampMs + 15000,
    }));
  const boundaries = [
    ...new Set([
      start,
      end,
      ...draft.cameraDecisions.map((item) => item.startMs),
      ...draft.editLog.flatMap((edit) => [
        edit.timestampMs,
        edit.endTimestampMs ?? edit.timestampMs + 15000,
      ]),
    ]),
  ]
    .filter((point) => point >= start && point <= end)
    .sort((a, b) => a - b);
  const ranges = boundaries
    .slice(0, -1)
    .map((value, index) => ({ start: value, end: boundaries[index + 1] }))
    .filter(
      (range) =>
        range.end > range.start &&
        !cuts.some((cut) => range.start >= cut.start && range.end <= cut.end),
    );
  const clips: Clip[] = [];
  const microphones = draft.tracks.filter(
    (track) =>
      track.kind === "microphone" &&
      sources.some((source) => source.assetId === track.sourceAssetId),
  );
  const anySolo = microphones.some(
    (track) => track.solo && track.includedInProgram && !track.muted,
  );
  let duration = 0;
  for (const range of ranges) {
    const midpoint = (range.start + range.end) / 2;
    const decision = [...draft.cameraDecisions]
      .sort((a, b) => b.startMs - a.startMs)
      .find((item) => item.startMs <= range.start);
    const camera = draft.tracks.find(
      (track) =>
        track.id === decision?.cameraTrackId &&
        track.includedInProgram &&
        isTimelineTrackAvailableAt(draft, track.id, midpoint),
    );
    const video =
      sources.find((source) => source.assetId === camera?.sourceAssetId) ??
      sources.find((source) => source.assetId === "program");
    const add = (
      source: InterchangeSource,
      label: string,
      lane: number,
      offset: number,
      gain: number,
    ) => {
      const inputStart = range.start + offset;
      const leading = Math.max(0, -inputStart);
      const available = Math.min(
        range.end - range.start - leading,
        source.durationMs - Math.max(0, inputStart),
      );
      if (frame(available) <= 0) return;
      clips.push({
        source,
        label,
        lane,
        timelineStart: duration + leading,
        sourceStart: Math.max(0, inputStart),
        duration: available,
        gain,
      });
    };
    if (video)
      add(
        video,
        camera?.label ?? "Program",
        1,
        camera?.syncOffsetMs ??
          draft.tracks.find((track) => track.id === "program")?.syncOffsetMs ??
          0,
        1,
      );
    if (microphones.length > 0) {
      microphones.forEach((track, index) => {
        const source = sources.find(
          (item) => item.assetId === track.sourceAssetId,
        )!;
        const enabled =
          track.includedInProgram &&
          !track.muted &&
          (!anySolo || track.solo) &&
          isTimelineTrackAvailableAt(draft, track.id, midpoint);
        add(
          source,
          track.label,
          -index - 1,
          track.syncOffsetMs,
          enabled ? track.volume / 100 : 0,
        );
      });
    } else if (video?.channels) add(video, "Program audio", -1, 0, 1);
    duration += range.end - range.start;
  }
  const editedTime = (timestamp: number) =>
    ranges.reduce(
      (sum, range) =>
        sum + Math.max(0, Math.min(range.end, timestamp) - range.start),
      0,
    );
  const markers = draft.markers
    .filter((marker) =>
      ranges.some(
        (range) =>
          marker.timestampMs >= range.start && marker.timestampMs < range.end,
      ),
    )
    .map((marker) => ({
      name: marker.label,
      at: editedTime(marker.timestampMs),
    }));
  const ids = new Map(
    sources.map((source, index) => [source.assetId, `asset${index + 1}`]),
  );
  const mainVideo = sources.find((source) => source.kind === "video");
  const width = mainVideo?.width ?? 1920;
  const height = mainVideo?.height ?? 1080;
  const resources = sources
    .map((source, index) => {
      const rate = sourceRate(source);
      const hasAudio = source.kind === "audio" || Boolean(source.channels);
      return `${source.kind === "video" ? `<format id="sourceFormat${index}" frameDuration="${rate.denominator}/${rate.numerator}s" width="${source.width ?? width}" height="${source.height ?? height}"/>` : ""}<asset id="${ids.get(source.assetId)}" name="${xml(source.assetId)}" start="0s" duration="${sourceTime(source, source.durationMs)}" hasVideo="${source.kind === "video" ? 1 : 0}" hasAudio="${hasAudio ? 1 : 0}"${hasAudio ? ` audioSources="1" audioChannels="${source.channels ?? 1}" audioRate="48000"` : ""}${source.kind === "video" ? ` format="sourceFormat${index}"` : ""}><media-rep kind="original-media" src="${xml(uri(source.file))}"/></asset>`;
    })
    .join("");
  const fcpxClips = clips
    .map(
      (clip) =>
        `<asset-clip ref="${ids.get(clip.source.assetId)}" name="${xml(clip.label)}" lane="${clip.lane}" offset="${time(clip.timelineStart)}" start="${sourceTime(clip.source, clip.sourceStart)}" duration="${time(clip.duration)}" srcEnable="${clip.lane > 0 ? "video" : "audio"}">${clip.lane < 0 ? `<adjust-volume amount="${clip.gain > 0 ? (20 * Math.log10(clip.gain)).toFixed(4) : "-96"}dB"/>` : ""}</asset-clip>`,
    )
    .join("");
  const fcpxml = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.10"><resources><format id="format0" name="Studio timeline" frameDuration="1/30s" width="${width}" height="${height}"/>${resources}</resources><library><event name="What About It"><project name="${xml(draft.episodeId ?? "Episode")}"><sequence format="format0" duration="${time(duration)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k"><spine><gap name="Episode" offset="0s" start="0s" duration="${time(duration)}">${fcpxClips}${markers.map((marker) => `<marker start="${time(marker.at)}" duration="1/30s" value="${xml(marker.name)}"/>`).join("")}</gap></spine></sequence></project></event></library></fcpxml>`;
  const rate = "<rate><timebase>30</timebase><ntsc>FALSE</ntsc></rate>";
  const clipRate = (source: InterchangeSource) => {
    const rate = sourceRate(source);
    return `<rate><timebase>${Math.round(rate.numerator / rate.denominator)}</timebase><ntsc>${rate.denominator === 1001 ? "TRUE" : "FALSE"}</ntsc></rate>`;
  };
  const clipXml = (clip: Clip, index: number) =>
    `<clipitem id="clip${index + 1}"><name>${xml(clip.label)}</name><duration>${sourceFrames(clip.source, clip.source.durationMs)}</duration>${clipRate(clip.source)}<start>${frame(clip.timelineStart)}</start><end>${frame(clip.timelineStart + clip.duration)}</end><in>${sourceFrames(clip.source, clip.sourceStart)}</in><out>${sourceFrames(clip.source, clip.sourceStart + clip.duration)}</out><enabled>${clip.gain > 0 ? "TRUE" : "FALSE"}</enabled><file id="file-${ids.get(clip.source.assetId)}"><name>${xml(clip.source.file.split(/[\\/]/).at(-1) ?? clip.source.assetId)}</name><pathurl>${xml(uri(clip.source.file))}</pathurl>${clipRate(clip.source)}<duration>${sourceFrames(clip.source, clip.source.durationMs)}</duration><media>${clip.source.kind === "video" ? `<video><samplecharacteristics>${rate}<width>${clip.source.width ?? width}</width><height>${clip.source.height ?? height}</height><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></video>` : ""}<audio><samplecharacteristics><depth>24</depth><samplerate>48000</samplerate></samplecharacteristics><channelcount>${clip.source.channels ?? 2}</channelcount></audio></media></file>${clip.lane < 0 ? `<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack><filter><effect><name>Audio Levels</name><effectid>audiolevels</effectid><effectcategory>audiolevels</effectcategory><effecttype>audio</effecttype><mediatype>audio</mediatype><parameter><parameterid>level</parameterid><name>Level</name><value>${clip.gain}</value></parameter></effect></filter>` : ""}</clipitem>`;
  const audioLanes = [
    ...new Set(clips.filter((clip) => clip.lane < 0).map((clip) => clip.lane)),
  ];
  const premiereXml = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="5"><sequence><name>${xml(draft.episodeId ?? "Episode")}</name><duration>${frame(duration)}</duration>${rate}<media><video><format><samplecharacteristics>${rate}<width>${width}</width><height>${height}</height><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></format><track>${clips.map((clip, index) => (clip.lane > 0 ? clipXml(clip, index) : "")).join("")}</track></video><audio><numOutputChannels>2</numOutputChannels>${audioLanes.map((lane) => `<track>${clips.map((clip, index) => (clip.lane === lane ? clipXml(clip, index) : "")).join("")}</track>`).join("")}</audio></media>${markers.map((marker) => `<marker><name>${xml(marker.name)}</name><in>${frame(marker.at)}</in><out>-1</out></marker>`).join("")}</sequence></xmeml>`;
  return {
    fcpxml,
    premiereXml,
    durationMs: duration,
    clips,
    notes: [
      "Timeline uses 30 fps; source media retains its native frame rate.",
      "Cuts, camera choices, track names, sync offsets, basic gains, mute/solo and markers are included.",
      "Picture treatments, transitions, titles and automation remain in the reference render and Studio JSON; review these effects after import.",
      "Final Cut media URLs are relative to this document. If Premiere/Resolve requests media, relink to the adjacent Camera Video and Isolated Audio folders.",
    ],
  };
}
