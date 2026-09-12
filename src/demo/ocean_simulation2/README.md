# WebXR Ocean Simulation (Pelagic Tropical Island)

A high-fidelity real-time procedural ocean and tropical island simulation ported to WebXR and TypeScript from [iamtechartist/ocean-simulation](https://github.com/iamtechartist/ocean-simulation).

## Key Features

1. **Procedural Island & Seabed Bathymetry**
   - Elliptical island morphology with sheltered coves, headlands, sand shelves, vegetation layers, cliffs, and instanced boulders.
   - Dual-layer half-float bathymetry texture (`heightMap`, `bottomMap`) encoding seabed elevation, terrestrial height, and rock indices.
   - **Monotone Godunov Eikonal Fast Sweeping Solver**: Precomputes finite-depth wave arrival times, refraction vector gradients, and directional fetch swell exposure around rocky obstacles and islands.

2. **3-Cascade GPU IFFT JONSWAP-TMA Ocean Wave Synthesis**
   - 3 multi-scale FFT cascades:
     - 1792m deep ocean swell cascade with directional spreading.
     - 211m wind-driven sea cascade.
     - 27.3m high-frequency capillary ripples cascade.
   - Ping-pong butterfly passes on GPU computing displacement vectors and Jacobian derivative folding.
   - Micro-surface BRDF capillary slope variance integration preventing sparkling aliasing artifacts.

3. **Dual-Resolution Foam Advection Simulation**
   - Wide (760m) and Near (128m focused) simulation render targets.
   - Non-linear wave breaking injection, shoreward bore momentum, orbital and wind drift, eddy currents around rocks, and beach swash wetting history.

4. **Solar Refraction Caustics Projection**
   - Dual-resolution caustic render targets (wide and detail).
   - Raytraced solar refraction through ocean wave heights intersecting seabed bathymetry with Jacobian area flux concentration calculations.

5. **Procedural Vegetation & Island Environment**
   - Procedural palm trees (fronds and curved trunks) with wind sway vertex shader and subsurface light transmission.
   - Crown broadleaf canopy trees and detailed branch meshes with distance-based LOD switching.
   - Instanced grass ground cover and icosahedron rocks with wetness shading and normal perturbation.

6. **Atmosphere, Sky & Dynamic Weather**
   - Dynamic atmospheric scattering with HDR sky integration and procedural fallback.
   - 4 Dynamic weather conditions with smooth inertia transitions:
     - **Calm**: Gentle swell, low wind, clear skies.
     - **Breeze**: Crisp waves, scattered clouds, ambient daylight.
     - **Golden Hour**: Low warm sun, golden reflections, long shadows.
     - **Storm**: High wind, dark overcast sky, heavy waves, procedural branching lightning strikes with flash illumination.

7. **Water Optics & Underwater Immersion**
   - Planar reflection pass with clipping plane and overscan.
   - Planar scene refraction pass with depth buffer and bathymetry ray marching.
   - Subsurface marine snow particulate simulation.
   - GPU surface spray particle system for wave crest breakers and rock collisions.
   - Asynchronous GPU surface probe for camera buoyancy and waterline elevation.

8. **WebXR & Hand Tracking Interaction**
   - Seamless stereo VR rendering in WebXR browsers (Meta Quest, Pico, Apple Vision Pro, etc.).
   - Full 6DoF head tracking with proper view-projection unprojection for water plane geometry.
   - **VR Hand Gestures**:
     - `Index_Thumb`: Cycle weather conditions (Calm → Breeze → Golden Hour → Storm).
     - `Closed_Hand`: Trigger storm and lightning.
     - `Open_Hand`: Return to calm/breeze conditions.
     - `Middle_Thumb` / `Pinky_Thumb`: Toggle waterline and shallows views.

## Keywords

`WebXR`, `Three.js`, `Ocean Simulation`, `GPU IFFT`, `JONSWAP-TMA`, `Eikonal Solver`, `Wave Refraction`, `Foam Advection`, `Seabed Caustics`, `Procedural Terrain`, `Bathymetry`, `Rayleigh-Mie Scattering`, `Atmospheric Sky`, `Dynamic Weather`, `Island Fog`, `ResonanceAudio`, `Spatial Audio`, `Shoreline Audio`, `Hand Tracking`, `Stereo VR`, `GLSL Shaders`, `Water Optics`

## File Structure

```
src/demo/ocean_simulation2/
├── README.md
└── src/
    ├── index.js
    └── scene/
        ├── SceneManager.ts
        ├── ocean/
        │   ├── OceanTypes.ts
        │   ├── NoiseGLSL.ts
        │   ├── CoastalField.ts
        │   ├── SpectralCascade.ts
        │   ├── FoamSystem.ts
        │   ├── Caustics.ts
        │   ├── WaterSurface.ts
        │   ├── SurfaceProbe.ts
        │   ├── SurfaceSpray.ts
        │   └── Particulate.ts
        ├── terrain/
        │   ├── TerrainGenerator.ts
        │   ├── Rocks.ts
        │   └── Foliage.ts
        ├── sky/
        │   └── SkyAtmosphere.ts
        ├── weather/
        │   └── WeatherManager.ts
        └── ui/
            └── HUD.ts
```
