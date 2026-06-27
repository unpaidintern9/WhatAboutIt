import { browserCameraProvider } from "./browser-camera-provider";
import {
  futureSonySdkProvider,
  sonyHdmiCaptureProvider,
  sonyRemoteControlProvider,
  sonyUsbCameraProvider,
  sonyWirelessCameraProvider
} from "./sony-camera-provider";
import { universalCameraProviders } from "./universal-camera-provider";
import { wirelessCameraProvider } from "./wireless-camera-provider";
import type { CameraProvider } from "./types";

export const cameraProviders: CameraProvider[] = [
  browserCameraProvider,
  sonyUsbCameraProvider,
  sonyHdmiCaptureProvider,
  wirelessCameraProvider,
  sonyWirelessCameraProvider,
  sonyRemoteControlProvider,
  futureSonySdkProvider,
  ...universalCameraProviders
];

export function getCameraProvider(providerId: string) {
  return cameraProviders.find((provider) => provider.id === providerId);
}
