# Natural Disasters (ABYSSAL) WebXR Demo

A fully procedural cinematic ocean and extreme weather simulation ported to WebXR. Features real-time multi-cascade FFT waves, volumetric raymarched clouds, physical atmospheric scattering, and dynamic natural disasters (tsunamis, rogue waves, hurricanes, waterspouts, lightning, and torrential squalls), running in WebXR VR headsets and desktop browsers without any external mesh or texture assets.

Ported to WebXR from Token-Gremlin's [natural-disasters (ABYSSAL)](https://github.com/Token-Gremlin/natural-disasters) using Three.js and the WebGL 2.0 rendering pipeline.

## Summary of Changes Compared to Original Demo

Compared to Token-Gremlin's original desktop WebGL demo, the following key enhancements, additions, and architectural changes were implemented:

### 1. WebXR Integration & VR Architecture
- **WebXR Architecture**: Ported to TypeScript and structured as a `SceneManagerParent` module compatible with both standard desktop browsers and 6DoF WebXR headsets (e.g., Meta Quest).
- **WebXR VR Hand Tracking & Gesture Controls**: Integrated hand gesture triggers allowing VR headset users to spawn lightning (pinch gesture / index-thumb), summon rogue waves (fist / closed hand), generate tornadic waterspouts (open hand), and unleash tsunamis (middle/pinky pinch).
- **Dual-Mode Headset Support**: Supports both VR stereo immersion and desktop Cinematic / Sandbox modes with mouse/keyboard flight and interactive UI overlay.

### 2. GPU Procedural Texture Generation & Atmosphere LUT Pipeline
- **GPU Texture Baking**: Real-time baking of 3D Perlin-Worley cloud shape volume ($128^3$), 3D detail curl volume ($32^3$), 2D curl turbulence maps, 2D micro-ripple normals, and 2D foam raft patterns.
- **Bruneton/Hillaire Atmosphere Scattering**: Precomputes transmittance, multiple scattering, sky-view, and 3D aerial perspective atlas look-up tables (LUTs) for physically grounded horizon and aerial extinction.

### 3. Multi-Cascade FFT Wave Spectrum & Analytical Disaster Heightfield
- **3-Cascade JONSWAP-TMA Ocean FFT**: Computes directional displacement, normal derivatives, and turbulent foam across three independent scale cascades ($4099\text{m}$, $389\text{m}$, $41.3\text{m}$) using GPU butterfly IFFT passes.
- **Analytical Disaster Heightfields**: Real-time evaluation of solitons (tsunamis), rogue wave packets, cyclonic hurricane wind-swells, and whirlpool/maelstrom vortex funnels.

### 4. Dynamic Audio Integration
- **Dual-Track Immersion Audio**: Spatial ocean surface wave sounds crossfading into ambient underwater audio upon camera submersion below the sea waterline.

## Features

- Procedural multi-cascade ocean FFT waves with Donelan-Banner directional spreading.
- Real-time raymarched volumetric clouds with temporal reprojection and bicubic upsampling.
- Atmospheric scattering with aerial perspective LUT integration.
- Analytical disaster simulations:
  - Tsunamis (soliton wave packet displacement and camera floor riding)
  - Rogue waves (superposed crest spikes)
  - Hurricanes (cyclonic stadium eyewall and vortex fields)
  - Waterspouts (raymarched tornadic condensation funnel)
  - Branching procedural 3D lightning bolts with dynamic scene illumination
  - Rain streaks and wind-driven sea spray particle simulations
- Interactive Sandbox mode with condition presets and parameter sliders.
- Cinematic mode with automated act transitions and camera shots.
- Spatial WebXR audio with above/below waterline crossfading.
- WebXR VR hand tracking and gesture recognition.

## Credits

### Token-Gremlin
[natural-disasters (ABYSSAL)](https://github.com/Token-Gremlin/natural-disasters)

### Sound
- Ocean Waves Sounds: `/vr/sound/ocean-waves-sounds.mp3`
- Underwater Sound Effect: `/vr/sound/Underwater sound effect.mp3`
