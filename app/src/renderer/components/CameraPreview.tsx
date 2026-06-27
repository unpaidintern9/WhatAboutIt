import { Camera } from "lucide-react";

export function CameraPreview({ label }: { label: string }) {
  return (
    <div className="wai-camera-preview" aria-label={`${label} empty camera preview`}>
      <Camera aria-hidden="true" />
      <span>{label}</span>
      <small>Preview comes in Phase 2</small>
    </div>
  );
}

