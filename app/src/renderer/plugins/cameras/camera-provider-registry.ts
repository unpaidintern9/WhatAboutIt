import { browserCameraProvider } from "./browser-camera-provider";
import { wirelessCameraProvider } from "./wireless-camera-provider";
import type { CameraProvider } from "./types";

export const cameraProviders: CameraProvider[] = [browserCameraProvider, wirelessCameraProvider];

export function getCameraProvider(providerId: string) {
  return cameraProviders.find((provider) => provider.id === providerId);
}
