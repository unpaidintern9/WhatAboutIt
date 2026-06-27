import { describe, expect, it } from "vitest";
import { createDefaultPodcastToolsState, createLiveMarker, withPodcastToolDefaults } from "./podcast-tools";

describe("podcast tools state", () => {
  it("creates teleprompter, notes, sponsor, and soundboard defaults", () => {
    const state = createDefaultPodcastToolsState("episode-a", "2026-06-27T10:00:00.000Z");

    expect(state.episodeId).toBe("episode-a");
    expect(state.teleprompter.speed).toBe(3);
    expect(state.guestNotes.questions).toBe("");
    expect(state.sponsorNotes.requiredDisclaimer).toBe("");
    expect(state.soundboard.customSlots).toHaveLength(3);
  });

  it("preserves saved notes and soundboard settings while filling defaults", () => {
    const state = withPodcastToolDefaults({
      guestNotes: { questions: "Question?", talkingPoints: "Point", researchNotes: "", links: "", dontForget: "" },
      soundboard: { intro: { id: "intro", label: "Intro", volume: 50 }, outro: { id: "outro", label: "Outro", volume: 80 }, customSlots: [], masterVolume: 40 }
    });

    expect(state.guestNotes.questions).toBe("Question?");
    expect(state.soundboard.masterVolume).toBe(40);
    expect(state.teleprompter.fontSize).toBe(32);
  });

  it("round-trips teleprompter, notes, sponsor notes, and soundboard settings as local JSON", () => {
    const state = createDefaultPodcastToolsState("episode-a", "2026-06-27T10:00:00.000Z");
    state.teleprompter.script = "Opening script";
    state.guestNotes.questions = "What surprised you?";
    state.sponsorNotes.sponsorName = "Local Sponsor";
    state.soundboard.masterVolume = 55;

    const loaded = withPodcastToolDefaults(JSON.parse(JSON.stringify(state)), "episode-a");

    expect(loaded.teleprompter.script).toBe("Opening script");
    expect(loaded.guestNotes.questions).toBe("What surprised you?");
    expect(loaded.sponsorNotes.sponsorName).toBe("Local Sponsor");
    expect(loaded.soundboard.masterVolume).toBe(55);
  });

  it("creates markers with timestamp and session persistence", () => {
    const marker = createLiveMarker({
      label: "Funny",
      timestampMs: 12345,
      note: "Clip this",
      recordingSessionId: "session-a",
      now: "2026-06-27T10:00:00.000Z"
    });

    expect(marker.label).toBe("Funny");
    expect(marker.timestampMs).toBe(12345);
    expect(marker.recordingSessionId).toBe("session-a");
  });
});
