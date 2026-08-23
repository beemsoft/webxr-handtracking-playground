# Ship in the Fog: Technical Architecture & Depth Rendering

## Overview

The **Ship in the Fog** demo showcases an atmospheric, real-time 3D simulation of a 17th-century sailing pinnace emerging from dense daylight sea mist on the open ocean. It operates seamlessly across both standard desktop displays (with `OrbitControls`) and immersive WebXR headsets (with stereoscopic 6DoF head tracking and tracked hands).

This demo represents the synthesis of multiple advanced rendering techniques:
- **Depth-Buffer Waterline Keel Foam**: Hardware depth prepass sampling for dynamic contact foam around the moving ship's hull.
- **Hydrodynamic Bow & Trailing Stern Foam**: Specialized procedural wake simulation rendering churning V-shaped bow wave spray in front and an expanding, dissipating frothy wake lane trailing far behind the vessel.
- **Height-Attenuated Atmospheric Sea Fog (Beer-Lambert Law)**: Physically inspired exponential fog that blankets the sea surface while allowing upper masts and sails to pierce through at distance.
- **Gerstner Wave Simulation & Buoyancy**: Real-time analytical ocean wave displacement with synchronized vessel pitch, roll, and heave dynamics.
- **Daylight Scattering Sky Dome**: An inverted camera-centered background dome providing seamless horizon blending and sun halo diffusion through the mist.

---

## Technical Solution & Pipeline Architecture

```
                                [ Frame Render Loop ]
                                          │
                  ┌───────────────────────┴───────────────────────┐
                  ▼                                               ▼
     [ 1. Depth Capture Prepass ]                    [ 2. Main Forward Color Pass ]
      • Render opaque Ship Hull into                  • OceanSurf: Gerstner Waves + Depth Foam
        offscreen WebGLRenderTarget with                (samples DepthTexture & unprojects)
        hardware DepthTexture                         • Ship Materials: Custom Height-Attenuated Fog
      • Exclude ocean plane, sky dome,                • MistySkyDome: Daylight Horizon Fog & Sun Halo
        and transparent objects                       • Tracked VR Hands: Normal Lit Phong Materials
```

### 1. Depth-Based Waterline Keel Foam (`OceanSurf`)
To create crisp, dynamic foam where undulating ocean waves intersect the submerged ship hull without computationally expensive fluid simulations, the demo utilizes a **two-pass depth buffer pipeline**:

1. **Depth Capture Prepass**:
   - In `WebPageManager.ts` / `WebXRManager.ts`, the scene's opaque geometry (the ship hull) is rendered from the viewpoint of `shadowCamera` into an offscreen `WebGLRenderTarget` equipped with a native `THREE.DepthTexture`.
   - The ocean plane, sky dome, and tracked hand joints are excluded from this pass.
2. **Stereo World Position Reconstruction & Water Depth Calculation**:
   - In the `OceanSurf` fragment shader, the wave surface's world position `vWorldPosition` is projected into the depth texture's screen UV coordinates:
     $$\mathbf{uv}_{\text{screen}} = \frac{(\mathbf{P}_{\text{proj}} \cdot \mathbf{V}_{\text{shadow}} \cdot \mathbf{v}_{\text{world}}).xy}{w} \cdot 0.5 + 0.5$$
   - The hardware depth is sampled: `depthSample = texture2D(uDepthTexture, screenUv).x`.
   - The 3D world position of the submerged hull is reconstructed using the inverted projection-view matrix:
     $$\mathbf{P}_{\text{world, hull}} = \mathbf{M}_{\text{invShadow}} \cdot \begin{pmatrix} \mathbf{uv}_{\text{screen}} \cdot 2 - 1 \\ \text{depthSample} \cdot 2 - 1 \\ 1 \\ 1 \end{pmatrix}$$
   - The hull position is transformed into the **current stereo eye's view space** (`viewMatrix * worldPosScene`) and compared against the ocean surface's view depth:
     $$\text{diff} = \text{surfaceViewZ} - \text{hullViewZ}$$
   - Where $\text{diff} < \text{uFoamLimit}$, dynamic shoreline/keel foam and shallow-to-deep water color gradients are rendered.

### 2. Hydrodynamic Bow Foam & Trailing Stern Wake
To distinguish between the front and back of the sailing vessel as it cuts through the ocean, `OceanSurf.ts` implements dedicated hydrodynamic wake algorithms driven by real-time vessel position, heading, velocity, and hull dimensions (`uShipPosition`, `uShipDirection`, `uShipSpeed`, `uShipParams`):

1. **Bow Wave & Prow Spray Foam (Front of Ship)**:
   - **Prow Cutwater Churning**: Evaluated at the cutting edge of the stem ($z_{\text{local}} \approx z_{\text{bow}}$ with $z_{\text{bow}} \approx 22.5$), generating localized high-energy churning foam, agitated spray noise, and water displacement right at the cutting prow tip.
   - **Diverging Kelvin Bow Wave**: Peels outward and backward from the cutwater along the forward hull flanks ($z_{\text{local}} \in [4.0, 22.5]$), creating classic V-shaped foaming wave crests curling away from port and starboard.
   - **Waterline Depth Boost**: Intensified where depth prepass sampling detects active hull contact ($z_{\text{local}} > 0$).
2. **Trailing Stern Wake Foam (Back of Ship)**:
   - Evaluated behind the vessel's stern ($z_{\text{local}} \le z_{\text{stern}}$ with $z_{\text{stern}} \approx -26.0$) extending over a trailing distance of up to 60 meters.
   - Computes an expanding lateral wake cone with outer diverging Kelvin wake crests and a churning central propeller/rudder turbulence track.
   - Features animated trailing streaks and gradual distance dissipation as the wake dissolves into the surrounding sea.

### 3. Height-Attenuated Sea Fog with Dense Low-Altitude Layer (Beer-Lambert Law)
Standard linear fog creates a flat, artificial color wash that obscures tall structures uniformly regardless of altitude. To simulate realistic open-sea mist where thick fog hugs the water line while the sky above remains clear, the demo implements **height-attenuated exponential fog** based on the Beer-Lambert law across both the ship and the ocean, with an enhanced, dense fog blanket in the **first 10 meters above sea level**:

#### Mathematical Formulation:
- **Effective Distance**: $\Delta d = \max(0.0, \|\mathbf{p}_{\text{frag}} - \mathbf{p}_{\text{cam}}\| - d_{\text{near}})$
- **Ray Average Altitude**: $y_{\text{avg}} = \max\left(0.0, \frac{y_{\text{cam}} + y_{\text{frag}}}{2}\right)$
- **Sea-Level Layer Boost ($0 - 10\text{m}$)**: $B_{\text{layer}}(y) = 1.0 + 2.0 \cdot \text{smoothstep}(10.0, 0.0, y_{\text{avg}})$
- **Height Attenuation**: $A(y) = \exp(-\beta \cdot y_{\text{avg}}) \cdot B_{\text{layer}}(y)$, where $\beta = \text{uFogHeightFalloff} = 0.07$
- **Optical Thickness**: $\tau = \Delta d \cdot \text{density} \cdot A(y)$
- **Fog Blending Factor**:
  $$f_{\text{fog}} = 1.0 - \exp(-\tau)$$

This ensures that the water surface, keel foam, and the lower ship hull ($y \le 10\text{m}$) are shrouded in heavy, atmospheric sea mist, while the sails and masts (reaching up to $y \approx 48\text{m}$) rise out of the dense layer into the clear daylight sky.

#### Shader Injection on the GLTF Ship Model:
In `SceneManager.ts`, custom fog logic is injected into the ship's GLTF PBR materials via `onBeforeCompile` and cached with `customProgramCacheKey`:
```glsl
#ifdef USE_FOG
  float dist = length(vCustomWorldPosition - cameraPosition);
  float effDist = max(0.0, dist - uCustomFogNear);
  float avgHeight = max(0.0, 0.5 * (cameraPosition.y + vCustomWorldPosition.y));
  // Thick fog layer in the first 10 meters above sea level
  float lowLayerBoost = 1.0 + 2.0 * smoothstep(10.0, 0.0, avgHeight);
  float heightAtten = exp(-uCustomFogHeightFalloff * avgHeight) * lowLayerBoost;
  float opticalThickness = effDist * uCustomFogDensity * heightAtten;
  float customFogFactor = 1.0 - exp(-opticalThickness);
  customFogFactor = clamp(customFogFactor, 0.0, 1.0);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uCustomFogColor, customFogFactor);
#endif
```

### 4. Atmospheric Daylight Sky Dome (`MistySkyDome`)
To ensure the horizon and sky blend seamlessly with the sea mist without a visible seam or blue sky disparity next to the foggy ship:
- An inverted sphere (`SphereGeometry(450, 32, 16)`, `side: THREE.BackSide`) is centered dynamically on the camera (`skyDome.position.copy(camera.position)`).
- The shader smoothly interpolates from the sea-level fog color (`0xd0dde5`) at lower elevations to a soft overcast daylight sky zenith (`0xb4c6d2`) using a wide elevation ramp (`smoothstep(0.15, 0.85, dir.y)`).
- The ship's material fog shader synchronizes its background blending color with this exact elevation ramp, ensuring that distant sails and masts blend into the exact same atmospheric color as the surrounding sky dome.
- A directional sunlight scattering halo ($\cos\theta^8$ and $\cos\theta^{32}$) creates a luminous daylight glow through the mist.

### 5. Ship Buoyancy & Sailing Animation
- The ship model moves continuously forward along $+Z$ from distant fog ($z = -150$) toward the user ($z = -12$).
- At runtime, wave buoyancy dynamics are computed from elapsed time:
  $$\text{Pitch} = \sin(t \cdot 1.2) \cdot 0.035 + \sin(t \cdot 0.5) \cdot 0.02$$
  $$\text{Roll} = \cos(t \cdot 0.9) \cdot 0.045 + \cos(t \cdot 0.4) \cdot 0.025$$
  $$\text{Heave} = \sin(t \cdot 1.4) \cdot 0.12 - 0.3$$
  This causes the ship to naturally ride the waves as it cuts through the water.

---

## Comparative Analysis with Other Depth Demos

Our repository contains three distinct depth-oriented demos, each addressing different graphics challenges and rendering paradigms:

| Architectural Feature | Depth Visualization (`depth_visualization`) | Ocean Surf (`ocean_surf`) | Ship in the Fog (`ship_fog`) |
| :--- | :--- | :--- | :--- |
| **Primary Focus** | Visualizing 3D camera depth gradients in WebXR without post-processing quads | Interactive ocean wave simulation and shoreline foam on static terrain | Atmospheric sailing vessel simulation combining depth foam, wave buoyancy & sea fog |
| **Pipeline Passes** | **Single Forward Pass** | **Two-Pass Hybrid** (Depth Prepass + Ocean Pass) | **Two-Pass Hybrid** (Depth Prepass + Multi-Object Forward Shading) |
| **Depth Data Source** | Analytic View-Space Math (`vViewPosition.z`) | Hardware `DepthTexture` Buffer (`texture2D`) | Hardware `DepthTexture` Buffer + Analytic World Distance |
| **Depth Calculations** | Linear normalization: $\frac{z + \text{near}}{\text{near} - \text{far}}$ | World unprojection via $\mathbf{M}_{\text{invShadow}}$ & view-space diff ($\Delta z$) | Hull depth unprojection for waterline foam + Height-attenuated Beer-Lambert optical thickness |
| **Background Geometry** | Native Clear Color Background Void (`scene.background = new Color('#000000')`) | Static Skybox | Dynamic Camera-Following Inverted Dome (`MistySkyDome` with sun halo & fog blend) |
| **Atmospheric Fog** | None (Unlit Grayscale Depth) | None (Standard Sunlight & Water Shading) | Height-Attenuated Beer-Lambert Sea Fog on ship, ocean, and atmosphere |
| **Dynamic Meshes** | Rotating static torus knots | Static island/rock geometries | Moving 17th-century sailing ship with dynamic pitch/roll/heave buoyancy |
| **WebXR Stereo Handling** | Dynamic far-plane clamping (`far = 25`) to prevent dynamic range washout | Cross-camera stereo reprojection avoiding eye parallax mismatch | Full stereo parallax compensation for hull foam + global height fog |

---

### Detailed Comparison: Key Differences & Synergy

#### 1. "Ship in the Fog" vs. "Depth Visualization" (`depth_visualization`)
- **Depth Visualization Demo**:
  - Purpose: Pure educational and reference demo for rendering depth directly onto 3D objects in VR.
  - Architecture: Operates strictly in a single forward pass. It does not generate or read from a `DepthTexture` buffer at runtime; instead, each torus knot computes its distance to the camera mathematically in its fragment shader.
- **Ship in the Fog Demo**:
  - Purpose: Production-grade atmospheric showcase.
  - Architecture: Uses a true offscreen hardware `DepthTexture` prepass to capture the ship's submerged hull, allowing the separate ocean water shader to read the depth buffer and generate dynamic contact foam along the moving waterline.

#### 2. "Ship in the Fog" vs. "Ocean Surf" (`ocean_surf`)
- **Ocean Surf Demo**:
  - Purpose: Demonstrates procedural ocean water and shoreline foam breaking against static tropical island terrain and rocks.
  - Scope: Focused on static scene depth interaction and Gerstner wave dynamics under clear sunny skies.
- **Ship in the Fog Demo**:
  - Purpose: Expands the `OceanSurf` water pipeline into an animated narrative experience.
  - Enhancements:
    1. **Dynamic Moving Occluder**: Renders a moving 17th-century ship model during the depth prepass, continuously updating hull-water contact foam as the ship sails and pitches over waves.
    2. **Height-Attenuated Atmospheric Mist**: Integrates custom Beer-Lambert exponential sea fog across GLTF PBR materials and ocean water shaders.
    3. **Daylight Sky Dome**: Replaces static cubemaps with a procedural, camera-centered atmospheric dome that diffuses daylight and seamlessly fuses the ocean horizon with sea mist.

---

## File Structure & Reference

- **`src/demo/ship_fog/src/scene/SceneManager.ts`**: Main scene controller managing lighting, atmospheric parameters, GLTF custom shader compilation, `OceanSurf` instantiation, sky dome generation, and ship buoyancy animation.
- **`src/demo/ship_fog/src/index.js`**: Application entry point detecting VR capabilities and initializing desktop (`WebPageManager`) or VR (`WebXRManager`) modes.
- **`src/shared/scene/water/OceanSurf.ts`**: Procedural water mesh implementing Gerstner wave displacement, depth texture sampling for waterline foam, and height-attenuated horizon fog.
- **`src/shared/web-managers/WebXRManager.ts` & `WebPageManager.ts`**: Core render loop managers handling stereo WebXR rendering, 6DoF tracking, and offscreen depth render target prepasses.
