# Cameras Plugin

Owns camera discovery, assignment, friendly health states, and future camera provider integrations.

Phase: 2/3 refinement  
Status: detection, assignment, and provider contracts routed behind simple camera cards

## User Experience Rule

The main UI only says Camera 1, Camera 2, Camera 3, Ready, Needs attention, Not connected, Find Cameras, Connect, Reconnect, and friendly next steps.

## Provider Boundary

Camera providers hide connection details behind a replaceable contract. The first providers cover local computer cameras and a wireless foundation. Future providers can add specific camera families without changing the setup screen.

Do not implement Auto Edit, timeline editing, or export workflows here.
