# WebXR Port Comparison: Ocean Simulation vs. Original

This document compares the WebXR-optimized port (`ocean_simulation2`) against the original desktop/flat-screen WebGL simulation from [iamtechartist/ocean-simulation](https://github.com/iamtechartist/ocean-simulation).

---

## Executive Summary

The original ocean simulation is a high-fidelity real-time simulation designed for single-viewport desktop browsers with a high GPU fill-rate budget. Porting this system to **WebXR** requires maintaining high stereo frame rates (72–90+ FPS on standalone headsets like Meta Quest 2/3/Pro, Pico 4, Apple Vision Pro) with strict frame pacing and latency constraints.

To achieve smooth WebXR performance, several architectural adaptations, shader simplifications, and pass eliminations were implemented—most notably omitting the secondary planar reflection render pass.

---

## Feature Porting Matrix

| Feature | Original Demo | WebXR Port (`ocean_simulation2`) | Status / Trade-off Notes |
| :--- | :---: | :---: | :--- |
| **3-Cascade IFFT JONSWAP-TMA Ocean Waves** | Yes (256/512 grids) | Yes (optimized cascades) | **Ported**: Ping-pong butterfly passes adapted for stereo VR render loop. |
| **Eikonal Godunov Wave Solver & Coastal Refraction** | Yes | Yes | **Ported**: Precomputed wave arrival times and shallow water shoaling/refraction preserved. |
| **Dual-Resolution Foam Advection** | Yes (768 & 512) | Yes (512 & 384 compact) | **Ported**: Scaled render target resolutions to reduce GPU memory bandwidth. |
| **Solar Seabed Caustics** | Yes (Dual Wide/Detail) | Yes | **Ported**: Optimized texture lookups (`texture2D`) and UV scaling for underwater rendering. |
| **Procedural Island, Foliage & Rocks** | Yes | Yes (Optimized) | **Ported**: Instanced palms, broadleaf trees, grass, and rocks with optimized LOD and draw calls. |
| **Atmospheric Sky & Dynamic Weather (4 Presets)** | Yes (HDR-based) | Yes (Adapted from Beautiful Water) | **Replaced**: Procedural Rayleigh/Mie scattering and multi-octave FBM cloud model adapted from the `beautiful_water` demo replaces heavy HDR equirectangular texture sampling (`uSkyMap`/`textureLod`), delivering instant initialization, dynamic cloud drift, and zero texture lookups. |
| **Scene & Island Distance Fog** | Yes | Yes | **Ported**: Integrated with Three.js `scene.fog` and dynamic weather transitions. |
| **Marine Snow & Wave Crest Spray Particles** | Yes | Yes | **Ported**: GPU particle systems adapted for stereo eye matrices. |
| **Camera Buoyancy Surface Probe** | Yes | Yes | **Ported**: Asynchronous readback / height sampling adapted for 6DoF XR rig. |
| **Dynamic Cascaded Shadows** | Yes (Always on) | Yes (Configurable / VR-optimized) | **Adapted**: Configurable/toggleable shadows (`enableShadows`) to save VR fill rate. |
| **Planar Terrain & Tree Reflection Pass** | Yes | **Omitted** | **Not Ported**: Replaced with analytical atmospheric sky reflection model. |
| **Screen-Space Refraction Depth Raymarching** | Yes (Secondary render target) | **Simplified / Omitted** | **Adapted**: Replaced with analytical optical absorption and bathymetry depth transmission. |
| **WebXR Stereo Rendering & 6DoF Tracking** | No (Desktop OrbitControls) | **Added** | **New**: Full 6DoF stereo view-projection and hand tracking gesture interaction. |
| **VR Hand Tracking Gestures** | No | **Added** | **New**: Weather cycle, lightning strikes, and camera mode triggers via hand gestures. |
| **WebXR Audio Integration** | No | **Added** | **New**: WebXR spatial 3D audio via ResonanceAudio tracking the island shoreline contour with distance fade when walking to the island center, plus gesture audio resumption. |

---

## Why Planar Reflections Were Not Ported

In the original desktop demo:
1. A secondary `THREE.WebGLRenderTarget` (512×512 or 768×512 HalfFloat) was created.
2. Every frame (or interleaved frames), the scene (terrain, rocks, foliage) was re-rendered from a mirrored camera viewpoint below the water plane with clipping planes (`renderer.clippingPlanes = [reflectionPlane]`).
3. The resulting texture was sampled in the ocean fragment shader (`uReflection`) to produce land reflections on water.

### Reasons for Omission in WebXR:
- **Stereo Rendering Multiplier**: In WebXR, the entire scene is already drawn twice per frame (once for each eye). Adding a planar reflection pass adds a 3rd (or 4th for true stereo reflection) render pass across thousands of instanced foliage and rock geometries, causing severe frame drops on mobile VR GPUs (Snapdragon XR2).
- **Stereo Parallax & Disparity Mismatch**: A single planar reflection camera cannot correctly represent stereo disparity for two displaced eyes simultaneously, resulting in stereo rivalry and visual discomfort in VR.
- **Render Target State Switching Overhead**: Switching render targets and altering clipping planes in the WebXR render loop introduces GPU pipeline stalls and breaks multiview / foveated rendering optimizations.
- **Alternative Solution**: In `ocean_simulation2`, water reflections are modeled analytically using the dynamic Rayleigh/Mie atmospheric sky model (`atmosphereFiltered(reflectionDirection)`), Fresnel reflection equations, and direct specular sun highlights. This delivers realistic reflections at a fraction of the GPU cost.

---

## Summary of WebXR Optimizations

1. **Procedural Atmospheric Sky Model**: The sky environment and sky reflection pipeline was replaced with the lightweight, procedural atmospheric sky model from the `beautiful_water` demo. This eliminates async HDR environment map loading, reduces GPU texture bandwidth, and removes costly `textureLod` equirectangular lookups in the water and atmosphere shaders in favor of analytical Rayleigh/Mie color gradients and continuous 2D FBM cloud drift.
2. **Analytical Water Optics**: Subsurface transmission and sky reflection are calculated analytically per pixel rather than relying on multiple full-scene color/depth texture render passes.
3. **Resolution & Memory Bandwidth Tuning**: Simulation render targets for foam and caustics are scaled to compact sizes to fit comfortably within mobile VR tiled GPU caches.
4. **Optimized Shadowing**: Shadow mapping is made configurable and offloaded/disabled by default for low-power standalone headsets.
5. **Stereo-Safe Particle Systems & Shaders**: All vertex unprojection, billboard orientation, and spray shaders use stereo-compatible view and projection matrices.
6. **Immersive XR Interaction**: Added hand tracking gesture recognition allowing users to control weather conditions, trigger lightning storms, and adjust viewpoints naturally in virtual reality.
