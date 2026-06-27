interface AudioMeterProps {
  label: string;
  level: number;
}

export function AudioMeter({ label, level }: AudioMeterProps) {
  const safeLevel = Math.max(0, Math.min(100, level));
  return (
    <div className="wai-audio-meter" aria-label={`${label} audio level ${safeLevel}%`}>
      <span>{label}</span>
      <div><i style={{ inlineSize: `${safeLevel}%` }} /></div>
    </div>
  );
}

