export type MediaAccessStatus = "not-determined" | "granted" | "denied" | "restricted" | "unknown";

export function isStudioMediaPermission(permission: string) {
  return permission === "media";
}

export function cameraAccessMessage(status: MediaAccessStatus, cameraCount: number) {
  if (status === "denied" || status === "restricted") {
    return "Windows camera access is turned off for desktop apps. Open Camera privacy settings, turn on Camera access and Let desktop apps access your camera, then fully restart What About It Studio.";
  }
  if (cameraCount === 0 && status === "granted") {
    return "Windows allows camera access, but it is not exposing any camera to the studio. Open the Windows Camera app to confirm the integrated camera works, then check Device Manager > Cameras and reconnect each USB camera.";
  }
  return undefined;
}
