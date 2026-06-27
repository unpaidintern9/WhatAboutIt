export function TimelineMarker({ label, timecode }: { label: string; timecode: string }) {
  return (
    <button className="wai-timeline-marker" type="button">
      <span>{timecode}</span>
      {label}
    </button>
  );
}

