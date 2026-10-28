import type { DeviceDefaults } from "../../shared/types";
import { assignTwoInputInterface, distinctAudioDeviceChoices, isTwoInputAudioInterface } from "../../shared/device-config";
import type { StudioDevice } from "../plugins/devices/types";

export function AudioInterfaceQuickSetup({ devices, defaults, disabled = false, onChange }: {
  devices: StudioDevice[]; defaults: DeviceDefaults; disabled?: boolean; onChange: (defaults: DeviceDefaults) => void;
}) {
  // Prefer real endpoints over Windows aliases for the same device.
  const interfaces = distinctAudioDeviceChoices(devices.filter((device) => device.audio?.interfaceLike || /m[\s-]*audio|m[\s-]*track|interface|audio.?box|usb.*codec/i.test(device.rawLabel ?? device.label)));
  if (!interfaces.length) return null;
  const assigned = interfaces.find((device) => device.id === defaults.microphones.morganMic);
  const selected = assigned ?? interfaces.find((device) => isTwoInputAudioInterface(device.rawLabel ?? device.label)) ?? interfaces[0];
  const configured = defaults.microphones.morganMic === selected.id && defaults.microphones.guestMic === selected.id
    && defaults.microphoneChannels?.morganMic === "input-1" && defaults.microphoneChannels?.guestMic === "input-2";
  const apply = (device: StudioDevice) => onChange(assignTwoInputInterface(defaults, device.id, device.rawLabel ?? device.label));
  return <section className="interface-quick-setup" aria-label="Two microphone interface setup">
    <div className="interface-quick-heading"><div><h3>Microphone inputs</h3>
      <p>Two voices. Two separate mono tracks.</p></div>
      <span className={configured ? "routing-ready" : "routing-pending"}>{configured ? "Inputs assigned separately" : "Choose your two inputs"}</span>
    </div>
    <div className="interface-quick-controls"><label>Audio interface<select aria-label="Audio interface for two microphones" disabled={disabled} value={selected.id}
      onChange={(event) => { const device = interfaces.find((item) => item.id === event.target.value); if (device) apply(device); }}>
      {interfaces.map((device) => <option key={device.id} value={device.id}>{device.label}</option>)}
    </select></label><button type="button" disabled={disabled} onClick={() => apply(selected)}>Use Input 1 + Input 2</button></div>
    {!configured ? <small>Apply this preset:</small> : null}
    <div className="interface-route-map"><span><b>Input 1 · Mono</b><span>→ {defaults.microphoneNames?.morganMic || "Morgan"}</span></span>
      <span><b>Input 2 · Mono</b><span>→ {defaults.microphoneNames?.guestMic || "Guest"}</span></span></div>
    <details className="interface-check-copy"><summary>Check separation and headphones</summary><p>Speak into Input 1, then Input 2. The matching meter should respond most strongly. Direct Mono on the M-Audio centers both voices in your headphones; it does not combine the saved tracks.</p></details>
  </section>;
}
