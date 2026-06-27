export type CameraLayout = "host" | "guest" | "split" | "triple" | "pip" | "sponsor-card" | "intro" | "outro";
export type TeleprompterMode = "light" | "dark";

export interface TeleprompterState {
  script: string;
  sponsorScript: string;
  isScrolling: boolean;
  speed: number;
  fontSize: number;
  mode: TeleprompterMode;
}

export interface GuestNotesState {
  questions: string;
  talkingPoints: string;
  researchNotes: string;
  links: string;
  dontForget: string;
}

export interface SponsorNotesState {
  sponsorName: string;
  readScript: string;
  talkingPoints: string;
  requiredDisclaimer: string;
}

export interface SoundSlot {
  id: string;
  label: string;
  filePath?: string;
  volume: number;
}

export interface SoundboardSettings {
  intro: SoundSlot;
  outro: SoundSlot;
  customSlots: SoundSlot[];
  masterVolume: number;
  playingSlotId?: string;
}

export interface LiveMarker {
  id: string;
  label: string;
  timestampMs: number;
  note?: string;
  recordingSessionId?: string;
  createdAt: string;
}

export interface PodcastToolsState {
  episodeId?: string;
  updatedAt: string;
  teleprompter: TeleprompterState;
  guestNotes: GuestNotesState;
  sponsorNotes: SponsorNotesState;
  soundboard: SoundboardSettings;
  markers: LiveMarker[];
  cameraLayout: CameraLayout;
  practiceMode: {
    teleprompterTried: boolean;
    notesTried: boolean;
    soundboardTried: boolean;
    markerTried: boolean;
    layoutTried: boolean;
  };
}

export const cameraLayouts: Array<{ id: CameraLayout; label: string }> = [
  { id: "host", label: "Host" },
  { id: "guest", label: "Guest" },
  { id: "split", label: "Split" },
  { id: "triple", label: "Triple" },
  { id: "pip", label: "Picture-in-Picture" },
  { id: "sponsor-card", label: "Sponsor Card" },
  { id: "intro", label: "Intro" },
  { id: "outro", label: "Outro" }
];

export const markerButtons = [
  { label: "Funny", emoji: "😂", icon: "laugh" },
  { label: "Highlight", emoji: "🔥", icon: "flame" },
  { label: "Clip", emoji: "🎬", icon: "clapperboard" },
  { label: "Sponsor", emoji: "💰", icon: "badge-dollar-sign" },
  { label: "Fix Later", emoji: "❌", icon: "badge-x" },
  { label: "Favorite", emoji: "⭐", icon: "star" }
] as const;

export function createDefaultPodcastToolsState(episodeId?: string, now = new Date().toISOString()): PodcastToolsState {
  return {
    episodeId,
    updatedAt: now,
    teleprompter: {
      script: "",
      sponsorScript: "",
      isScrolling: false,
      speed: 3,
      fontSize: 32,
      mode: "dark"
    },
    guestNotes: {
      questions: "",
      talkingPoints: "",
      researchNotes: "",
      links: "",
      dontForget: ""
    },
    sponsorNotes: {
      sponsorName: "",
      readScript: "",
      talkingPoints: "",
      requiredDisclaimer: ""
    },
    soundboard: {
      intro: { id: "intro", label: "Intro", volume: 80 },
      outro: { id: "outro", label: "Outro", volume: 80 },
      customSlots: [
        { id: "custom-1", label: "Custom 1", volume: 70 },
        { id: "custom-2", label: "Custom 2", volume: 70 },
        { id: "custom-3", label: "Custom 3", volume: 70 }
      ],
      masterVolume: 80
    },
    markers: [],
    cameraLayout: "host",
    practiceMode: {
      teleprompterTried: false,
      notesTried: false,
      soundboardTried: false,
      markerTried: false,
      layoutTried: false
    }
  };
}

export function withPodcastToolDefaults(state?: Partial<PodcastToolsState> | null, episodeId?: string): PodcastToolsState {
  const defaults = createDefaultPodcastToolsState(episodeId);
  return {
    ...defaults,
    ...state,
    episodeId: state?.episodeId ?? episodeId,
    teleprompter: { ...defaults.teleprompter, ...state?.teleprompter },
    guestNotes: { ...defaults.guestNotes, ...state?.guestNotes },
    sponsorNotes: { ...defaults.sponsorNotes, ...state?.sponsorNotes },
    soundboard: {
      ...defaults.soundboard,
      ...state?.soundboard,
      intro: { ...defaults.soundboard.intro, ...state?.soundboard?.intro },
      outro: { ...defaults.soundboard.outro, ...state?.soundboard?.outro },
      customSlots: state?.soundboard?.customSlots ?? defaults.soundboard.customSlots
    },
    markers: state?.markers ?? [],
    practiceMode: { ...defaults.practiceMode, ...state?.practiceMode }
  };
}

export function createLiveMarker(input: {
  label: string;
  timestampMs: number;
  note?: string;
  recordingSessionId?: string;
  now?: string;
}): LiveMarker {
  const createdAt = input.now ?? new Date().toISOString();
  return {
    id: `${createdAt}-${input.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    label: input.label,
    timestampMs: input.timestampMs,
    note: input.note?.trim() || undefined,
    recordingSessionId: input.recordingSessionId,
    createdAt
  };
}
