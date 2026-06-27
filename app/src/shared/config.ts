export interface StudioConfiguration {
  theme: {
    activeThemeId: string;
  };
  storage: {
    appDataFolderName: string;
    episodeFolderName: string;
  };
  recordingDefaults: {
    maxCameras: number;
    separateAudioTracks: boolean;
  };
  exportDefaults: {
    videoPreset: "youtube-mp4";
    audioPreset: "podcast-audio";
  };
  teleprompterDefaults: {
    fontScale: number;
    scrollSpeed: number;
  };
  audioDefaults: {
    normalize: boolean;
    limiter: boolean;
  };
}

export const defaultStudioConfiguration: StudioConfiguration = {
  theme: {
    activeThemeId: "what-about-it"
  },
  storage: {
    appDataFolderName: "WhatAboutItStudioData",
    episodeFolderName: "episodes"
  },
  recordingDefaults: {
    maxCameras: 3,
    separateAudioTracks: true
  },
  exportDefaults: {
    videoPreset: "youtube-mp4",
    audioPreset: "podcast-audio"
  },
  teleprompterDefaults: {
    fontScale: 1,
    scrollSpeed: 1
  },
  audioDefaults: {
    normalize: true,
    limiter: true
  }
};

