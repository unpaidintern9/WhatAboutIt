import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { defaultDeviceDefaults } from "../../shared/device-config";
import { AudioInterfaceQuickSetup } from "./AudioInterfaceQuickSetup";

describe("two microphone interface setup", () => {
  it("prefers the real interface endpoint and applies separate mono routes in one click", () => {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    const devices = [
      { id: "default", groupId: "duo", label: "Default - M-Track Duo", kind: "microphone" as const },
      { id: "physical-duo", groupId: "duo", label: "M-Track Duo", kind: "microphone" as const }
    ];
    function Harness() {
      const [defaults, setDefaults] = useState(defaultDeviceDefaults);
      return <><AudioInterfaceQuickSetup devices={devices} defaults={defaults} onChange={setDefaults} /><output>{JSON.stringify(defaults)}</output></>;
    }
    act(() => root.render(<Harness />));
    expect(host.querySelectorAll("option")).toHaveLength(1);
    expect((host.querySelector("select") as HTMLSelectElement).value).toBe("physical-duo");
    act(() => (host.querySelector("button") as HTMLButtonElement).click());
    const saved = JSON.parse(host.querySelector("output")!.textContent!);
    expect(saved.microphones).toMatchObject({ morganMic: "physical-duo", guestMic: "physical-duo" });
    expect(saved.microphoneChannels).toMatchObject({ morganMic: "input-1", guestMic: "input-2" });
    expect(host.textContent).toContain("Inputs assigned separately");
    expect(host.textContent).not.toContain("Apply this preset:");
    act(() => root.render(<AudioInterfaceQuickSetup devices={devices} defaults={saved} onChange={() => undefined} disabled />));
    expect((host.querySelector("select") as HTMLSelectElement).disabled).toBe(true);
    expect((host.querySelector("button") as HTMLButtonElement).disabled).toBe(true);
    act(() => root.unmount()); host.remove();
  });
});
