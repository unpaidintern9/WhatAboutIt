export function Toast({ message, tone = "info" }: { message: string; tone?: "info" | "success" | "warning" | "danger" }) {
  return <div className={`wai-toast wai-toast-${tone}`} role="status">{message}</div>;
}

