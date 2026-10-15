# KINET — Factory Sight

An animated clay-model factory adapted from Machine Sight, with a grid-based KINET interface, contextual equipment inspector, segmented view controls, and scan-matched text inversion. Two articulated robots transfer parcels between roller conveyors. The cursor reveals a synchronized technical view with geometry edges, package detection boxes, inspection gates, and a transport route.

## Run

```sh
npm install
npm run dev
```

`npm run build` creates the static site in `dist/`. `npm run lint` runs Oxlint.

## Controls

- Move over the scene to reveal machine perception.
- Drive Detail frames the motor and transmission close up; Reset returns to the full factory.
- Conveyor cutaways expose roller bearings, shafts, an open ladder chassis, rotating sprockets, motor internals, and instanced chain links following a closed loop.
- Drag to orbit; scroll to zoom.
- Click a parcel to track it; Esc or Reset releases tracking.
- Pause freezes production while camera and scanning stay interactive.
- Machine View switches the entire scene to its technical rendering.
- Hold Space for slow motion.

The factory is a local visual simulation. Efficiency and confidence values are illustrative, not measured or AI-generated. Robot joints use two-link inverse kinematics; both render layers use the same scene transforms. All factory geometry is generated in code.

Equipment inspection includes articulated robot skeletons, live joint angles, control-cabinet internals, dispatch pallets, and conveyor motor modules. Hover any equipment to see its hierarchy and status.

Implementation: `src/main.ts`, `src/factory-details.ts`, and `src/factory.css`. Original traffic orchestration is preserved in `src/traffic-demo.ts`; the original rendering pipeline and lens grid are reused.

The original custom license still applies, including visible attribution and restrictions on standalone template resale. See `LICENSE`.

---

## Original project documentation

# Machine Sight

**A traffic intersection, seen the way its AI sees it.**

A miniature city block, rendered like a white-clay architectural model, runs a live traffic
simulation: signal phases, car-following, amber decisions, yielding left turns, walk signals and
jaywalkers. An AI's attention follows your cursor. Wherever you look, the street cuts through to
what the intersection's perception stack sees (LiDAR or a depth map, detection boxes, predicted
paths), and a reading card tells you, verdict first, whether that road user is safe.

Built with [Three.js](https://threejs.org), [postprocessing](https://github.com/pmndrs/postprocessing)
and [N8AO](https://github.com/N8python/n8ao). Every building, vehicle and person is generated in
code; there are no model files.

## Run it

```bash
npm install
npm run dev
```

Then open the URL Vite prints. `npm run build` writes a static site to `dist/` that runs from any
folder or sub-path (for example GitHub Pages).

## What you are looking at

- **The lens.** The tiles around the cursor reveal the machine view: a LiDAR point cloud built
  like a real spinning sensor (beam rings, building "shadows") or a depth map, glowing detection
  boxes, predicted paths and +1 s / +2 s position ghosts.
- **The reading.** Verdict first (Safe / Note / Caution / Risk), written from the live
  simulation: speed, intent, signal state, headway, range. Relations (conflicts with
  time-to-collision, signal control, following) arc across the street in 3D.
- **Conflicts anywhere** are flagged with pulsing rings and a feed, so the AI tells you where to look.
- **Tracking.** Click a road user and the camera follows it while the machine view floods the
  whole screen. Buildings and trees that get in the way turn see-through (an x-ray that fades whole
  objects, leaving a faint shell). Release it with Esc or a click on empty street.
- **Road users.** Sedans, hatchbacks, SUVs and vans built from extruded side profiles (wheel
  arches, glass cabins, pillars, mirrors, lights), a detailed bus, cyclists, and pedestrians with
  varied builds and clothes whose legs and arms move in the vertex shader.

## Controls

| Input | Action |
| --- | --- |
| Move | Look (the lens follows the cursor) |
| Click | Track a road user · click empty street to release |
| Drag | Rotate the camera (orbit and tilt) |
| Two-finger scroll | Pan |
| Pinch · ⌘-scroll · + / − | Zoom toward the cursor (up to 8×) |
| Shift-drag · right-drag | Pan (mouse) |
| 0 | Reset the camera |
| Space (hold) | Slow time |
| 1 / 2 | LiDAR / depth view |
| Esc | Release tracking |

## The panel

Everything is tunable live from the [DialKit](https://github.com/joshpuckett/dialkit) panel
(bottom right):

- **lens**: radius, cell size, tiers, organic edge, follow spring, attack and release.
- **machine**: LiDAR colouring, point size, scan sweep, edge glow and colour.
- **layers**: switch each visual off separately (lattice, grid marks, scanned cells, ground rings,
  facade and road-user points, depth contours, boxes, paths, ghosts, focus ring, alerts, relation
  arcs, corridor).
- **world**: time scale, traffic density, jaywalkers, time of day.
- **post**: quality, ambient occlusion, tilt-shift, bloom, grain, vignette, exposure.
- **camera**: zoom, orbit, pitch, tilt as you zoom in, invert rotate or pan, smoothing, sway.
- **tracking**: camera follow, lens lock, release when off-screen, x-ray (tracked, focused or
  off) and ghost strength, full-screen flood and its duration.
- **ui**: scale for every label and the reading card (for legible screen recordings), and a
  switch to hide the telemetry and hints.

The defaults are a close-up depth-view framing; the intro flies into it and **Reset camera**
returns to it.

## How it is built

| Part | File |
| --- | --- |
| Orchestration, input, camera rig, x-ray occlusion test | `src/main.ts` |
| Panel definition and defaults | `src/config.ts` |
| Street layout, lanes and paths | `src/world/layout.ts` |
| City (clay beauty meshes + classed machine meshes) | `src/world/city.ts`, `src/world/materials.ts` |
| LiDAR point clouds | `src/world/lidar.ts` |
| Traffic simulation (IDM car-following, signals, pedestrians) | `src/world/traffic.ts` |
| Road-user models and limb animation | `src/world/agents.ts` |
| Prediction, conflicts, readings | `src/intel/analyst.ts` |
| Relation arcs, rings, paths, ghosts | `src/intel/visuals.ts` |
| Screen-space lens grid | `src/lens/grid.ts` |
| Render graph (N8AO, tilt-shift, lens composite, bloom, AgX, SMAA) | `src/render/pipeline.ts` |
| HUD, labels and reading card | `src/ui/hud.ts`, `src/style.css` |

The frame is composed from three renders of one scene, split by layer: the clay beauty pass, the
machine pass (LiDAR or depth) and an overlay pass for the relation arcs. A full-screen composite
shader samples the lens grid's state texture to cut between beauty and machine views tile by tile.

## Reuse and license

The original project code is available under the custom
[Machine Sight Reuse License 1.0](LICENSE). You may use and adapt it for
personal projects, paid client work, and commercial websites. Selling it
as a standalone code download, template, or asset pack is not permitted.

**Commercial websites must display visible credit** linking to the original
project. For example, put this in a legible footer, or on a Credits/About page
reached through a clearly visible link:

```html
<span>
  Based on
  <a href="https://github.com/kaolti/machine-sight">
    Machine Sight by Zsolt Kacso / Whitespace
  </a>
</span>
```

Source comments or this README alone do not satisfy the website-credit
requirement. Visible credit is optional for noncommercial use. Free source
redistribution must include the license and copyright notice.

Third-party libraries and fonts retain their own licenses. See [LICENSE](LICENSE)
for the complete terms.

