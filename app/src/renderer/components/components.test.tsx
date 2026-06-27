import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AudioMeter, Button, CameraPreview, Card, Panel, Toast, Toolbar, Tooltip } from ".";

describe("component library", () => {
  it("renders core branded primitives", () => {
    const markup = renderToStaticMarkup(
      <Card>
        <Panel title="Studio">
          <Toolbar>
            <Button variant="primary">New Episode</Button>
            <Button variant="secondary">Settings</Button>
          </Toolbar>
          <CameraPreview label="Camera 1" />
          <AudioMeter label="Mic 1" level={42} />
          <Tooltip label="Friendly help"><span>?</span></Tooltip>
          <Toast message="Saved locally." tone="success" />
        </Panel>
      </Card>
    );

    expect(markup).toContain("New Episode");
    expect(markup).toContain("Camera 1");
    expect(markup).toContain("Saved locally.");
  });
});

