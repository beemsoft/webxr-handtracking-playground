# ShoreBreak Rolling Waves Demo

An immersive, real-time WebXR simulation of shoaling ocean swell, along-crest peeling, and plunging breaker barrels inspired by [ShoreBreak](https://github.com/cryptomanavan/ShoreBreak).

## Highlights & Features
- **Analytical Breaker Stage Table**: Fast Catmull-Rom cubic Hermite spline evaluation of swell transformation parameters (shoaling, peaking, curl, collapse).
- **Plunging Lip Ribbon Mesh**: Parametric 3D jet ribbon modeling hollow curling barrels and overturning wave lips.
- **Dynamic Water Surface**: High-density breaker grid with subsurface scattering (SSS), sun specular glints, depth coloring, and whitecap foam.
- **Bathymetry Bed Terrain**: Sloped sandy beach bed with pebble graining, dry/wet sand transition, and coastal rocks.
- **WebXR Mobile Optimization**: Single sun shadow map pass, zero alpha testing/discard on high-density surfaces, synchronous scene construction adhering to Meta Quest 3S / Quest 2 hardware targets (>72-90 FPS).

## Controls & Interaction
- **Desktop**: Mouse OrbitControls for full 360-degree shoreline and ocean viewing.
- **WebXR / Headset**: 6DoF stereoscopic tracking at shoreline standing eye-level.
- **Hand Gestures**: Open hand activates / toggles immersive spatial coastal ambient audio.


## Quality Pass (WebXR-friendly)

Visual fidelity was brought closer to the original ShoreBreak renderer while keeping the frame budget
(still 3 draw calls for water, lip and beach; no render targets, FFT or SWE solver):

- **Water mesh to the horizon**: dense 14 cm rows across the breaker zone, geometric row growth
  offshore and columns fanning with distance (`RollingWaterSurface.ts`).
- **Bore & swash**: after impact `brkElevation` (`BreakerWave.ts`) rolls a decelerating whitewater
  bore up the beach, followed by a thin run-up tongue; foam is tracked as `fresh / aged / film`
  channels so it ages into a lace network. Previous-cycle events are kept alive while their
  whitewater is still running (`SceneManager.update`).
- **Per-pixel optics**: Beer-Lambert extinction over the visible sand bed (`bedProfile` matches
  `Shorebed.ts`), caustics in shallow water, turbid teal in the stirred break zone, swash film
  sheen, Schlick Fresnel with a procedural sky/sun reflection and two specular lobes.
- **Normals**: finite-difference macro normals near shore + 4 octaves of derivative value-noise
  ripples faded with distance (no texture lookups).
- **Backlit crest glow** on steep sunlit faces and a **ragged translucent lip jet** with streaks,
  torn spray tip and forward-scattered glow (`LipRibbon.ts`).
- **Beach**: wet band with sky-mirroring sheen, backwash ripple marks, dried foam residue line.
- **Impact splash-up** (`SplashParticles.ts`, 4th draw call): one `THREE.Points` cloud of 4096
  analytic particles. Each is launched from the landing line at the local lip-impact time (shared
  `brkTiming`) plus a per-particle delay and flies a ballistic arc computed in the vertex shader —
  cauliflower domes every ~2.25 m along the crest, crown droplets and spray, gated to plunging
  breakers as in ShoreBreak's whitewater emitters, but with no CPU simulation or render targets.
- All materials output through `tonemapping_fragment` / `colorspace_fragment`, so colors are
  specified in linear space and graded by the renderer's ACES tone mapping.
