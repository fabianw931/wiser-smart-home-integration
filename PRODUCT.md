# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One household member (the owner, Fabian) controlling a Wiser by Feller installation from a phone or a desktop browser on the home network. Frequent jobs: see whether lights are on or blinds are down, switch a room, move blinds, dim a light. Rare jobs: name devices, assign rooms and floors, pair or reconnect the gateway, check diagnostics. Confirmed 2026-11: touch-friendly on phone and desktop; not a wall tablet.

## Product Purpose

A local dashboard and Node proxy for the Wiser gateway's REST/WebSocket API. It replaces the vendor app's cloud-free blind spots: fast room-level control, live reported state, personal naming/rooms/floors stored locally, and an opt-in Home Assistant bridge. Success: any common action takes one or two taps and the reported state is trustworthy.

## Positioning

Runs entirely on the home network, keeps credentials on the user's computer, and never presents a command acceptance as proof of physical state.

## Operating Context

- Node server on the user's computer, bound to 127.0.0.1:3000; the browser must be on the same machine unless the user deliberately provisions access. Unauthenticated; one shared gateway session across tabs.
- Gateway reached over plain HTTP; gateway push updates arrive over WebSocket with 30 s polling fallback.
- Personal names, rooms, notes persist in SQLite (`data/wiser.sqlite`), separate from gateway configuration.

## Capabilities and Constraints

- Controls: on/off, dimming, blind position (0 = open, 100% closed), DALI tunable white (ct 1000–20000) and RGBW (0–255). No stop, tilt, scenes, jobs, HVAC writes.
- Read-only: buttons (with LED identify), sensors, weather-protection rules, HVAC groups, diagnostics.
- Gateway metadata edits (name, room) only via an explicit reviewed action.
- Hardware has not been tested; no real gateway data is stored in the repo. Room association field names on real loads are `room` (id) per existing code.
- Terminology: "load" = controllable channel; use "light" and "blind" in the UI.

## Brand Commitments

Name shown as "Wiser by Feller" workspace. Existing light/dark/system appearance setting must remain; Gruvbox and Catppuccin colour themes are optional additions. Tailwind + daisyUI built locally, no CDN.

## Evidence on Hand

No real installation data. Sample home in `src/demo.js` is fictional and must stay labeled.

## Product Principles

1. State before controls: show what is on, open or wrong before asking for input.
2. Common actions at room level, precision on demand.
3. Setup and diagnostics stay out of the daily path.
4. Never claim a device moved; separate accepted from reported.
5. Personal organisation (rooms, floors, favorites) is local and never written to the gateway implicitly.

## Accessibility & Inclusion

WCAG AA; 44px touch targets; keyboard operable; status changes announced.
