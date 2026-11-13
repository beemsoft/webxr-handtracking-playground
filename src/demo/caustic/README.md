# Caustic

WebGL / WebXR port of mrdoob's Codevember 2026 #10 ("Caustic", <https://mrdoob.github.io/codevember-2026/10/>):
a sunken stone observatory lit by refracted sunlight. The original is written for `WebGPURenderer` and TSL
compute shaders; this version uses plain `WebGLRenderer`, GLSL and the project's custom WebXR loop, so it runs on
desktop and on Meta Quest 3S / Quest 2.

The reflective glass sphere in the middle of the original (crystal optics, orb photon map, reflection probe) is
**intentionally not ported**. The plinth stays as an empty altar; a drop that falls on the water every ~11 s
replaces the ripple the floating sphere used to create.

## Run

- Dev server: `npm start`, then open `/src/demo/caustic/index.html`.
- Controls (desktop): drag to orbit, double click on the water to ripple, `R` ripple, `Space` pause.
- Controls (VR hand tracking): Open hand = ripple, Closed hand = pause / resume.

## Architecture

| File | Responsibility |
| --- | --- |
| `scene/SceneManager.ts` | Device-ignorant, synchronous `build()`; fog, tone mapping, lights, per-frame update, input. |
| `scene/CausticField.ts` | Periodic wave field, ripples (shared GLSL) and the caustic photon pass. |
| `scene/CausticMaterials.ts` | `MeshLambertMaterial` + `onBeforeCompile` that adds caustic sun light, triplanar stone grain, tile seams, algae sway and fish shading (scale albedo and relief, school stripe and belly colours, glossy eyes, iridescent sheen, tail wag with bent normals). |
| `scene/Rotunda.ts` | 16 stepped terraces, dais, plinth and 12 columns (static parts merged into two meshes). |
| `scene/ColumnGeometry.ts` | The Roman column: moulded Attic base, shaft with entasis and 16 sharp-arris flutes that run out into smooth rings, and a capital (necking, astragal, echinus, abacus). About 6k triangles each, indexed with smooth normals and no seam. |
| `scene/DiverGlove.ts` | The VR hands drawn as diver's gloves: two instanced meshes (tapered links and joint balls) follow the 25 WebXR joints, with light grip pads on the fingertips and a loose cuff with a yellow band. Uses the caustic material, so the glove is lit by the same moving caustics as the scene. |
| `scene/Water.ts` | Underwater view of the surface (Fresnel, Snell window, sun opening). |
| `scene/LightShafts.ts` | Volumetric sun beams: a closed cylinder around the pool, drawn additively from the inside; each pixel ray-marches 6 steps through the water, reading the caustic map along the point-sun ray (see Sun beams). |
| `scene/Marine.ts` | Four instanced fish schools + 12 lone riders (CPU orbits, GPU tail wag) and instanced algae tufts. Each fish also carries a spring-damped flight offset that is kicked away from the camera and the shark (see Creatures). |
| `scene/Shark.ts` | Gracious shark from `webgl_water_ocean` (`Shark_biting.glb`): patrols a ring and glides past the camera at a respectful distance, with at most one slow playful bite. |
| `scene/StingRays.ts` | Four sting rays (`sting_ray_swimming.glb`) roaming random floor spots, following the stepped terraces. |
| `scene/Creatures.ts` | Shared helpers: GLB loading, conversion of GLB materials to the caustic-lit Lambert material, column/plinth obstacle steering and hard push-out. |
| `scene/FishGeometry.ts` | Detailed fish after the original: lathed body with caudal peduncle, curved subdivided fins, convex eyes with pupil/iris (~860 triangles, merged and welded). |
| `scene/FishTexture.ts` | Overlapping-scale colour tile (albedo, fin rays, film thickness, gloss) and baked relief normal map. |
| `scene/Motes.ts` | 9000 additive GL points that glint where caustic filaments cross them. |
| `scene/StoneTexture.ts` | Tileable procedural limestone grain. |

### Creatures

- **Shark**: patrols at radius ~5.4 m between dais and columns. When the camera is underwater and within 8 m it *passes*: it picks the side it is already on and glides by ~2.6 m to the side of the viewer on a long, gentle curve at a steady ~0.85 m/s (no weaving, no leaning, no speed bursts), perhaps giving one slow bite as the snout goes by, then swims on and ignores the viewer for ~14 s. The steering goal, the avoidance push and the heading are all low-pass filtered, the climb/dive angle is capped at ~22 degrees, column push-out is eased in, and a soft personal-space push steers it away from a viewer who swims towards it. It also steers around columns, the outer wall, the floor and the surface.
- **Fish** (as in `beautiful_water`): a notice radius around the camera that grows with camera speed and shrinks once the viewer holds still (habituation), a personal-space bubble that always applies, and a shark panic that flees radially and sideways out of the shark's path. Vertical flight is damped; fish are kept out of columns, the wall, the floor and the water surface. Fish never escape sideways: the flee push becomes thrust along the body plus a small turn assist, the body aims at where the push is taking it (turn rate capped at 12 rad/s), a keel damps sideways velocity, and a fish held back by its flight range, a column, the wall or the floor loses the velocity it pushed into the obstacle and aims along its real motion. The shark is solid to the fish: they measure their distance to its whole body axis (tail to nose) instead of its centre point, and a hard push-out keeps every fish at least 0.75 m from that axis, so none swim through it. Fish never swim backwards: their net motion (orbit plus flight) is confined to a forward cone around the body axis (sideways speed at most 0.6 x forward speed), whatever is cut off becomes turning intent, and a fish tethered at the edge of its flight range follows its real motion with a faster turn.
- **Sting rays**: wander between random clear spots, steer around columns, the plinth, the wall and each other, flare away from the camera and the shark, and hug the stepped floor. Motion is smooth: all avoidance is blended into one low-passed push, heading changes go through a smoothed yaw rate, and the glide height follows the highest tread under a footprint from 0.5 m behind to 1.2 m ahead through a rate-limited climb (max 0.25 m/s), so stairs become a gentle ramp, and pitch follows the climb rate.
- Both GLBs live in `public/src/demo/caustic/assets/` (copied from `webgl_water_ocean`); materials are replaced with the caustic Lambert material (`map`/`normalMap` kept, emissive map for a base glow) so the creatures get the same light and fog as the room. Skinned meshes are never frustum culled.

### Caustics without compute shaders

The original runs a WebGPU compute pass that traces rays through the wave normals and splats them with
derivative-based energy. Here the same idea is a vertex shader:

1. A 192x192 grid on the water surface is refracted through the analytic wave normals (Snell, `eta = 1/1.333`),
   once per spectral band (4 instanced draws, wavelengths red to blue, IOR spread = chromatic dispersion).
2. Each vertex lands on the floor plane; `gl_Position` is that landing point, so the grid is drawn directly into a
   1024x1024 half-float render target with additive blending.
3. The fragment shader measures `|dFdx x dFdy|` of the source grid versus the landing grid; their ratio is the light
   concentration (clamped at 28x, normalised so flat water = 1).
4. The wave field is periodic over a 4 m tile, so the map tiles (`RepeatWrapping`) across the whole 23 m floor.
   Receivers at other heights are reprojected along the mean refracted ray. Ripples are not periodic; they warp the
   lookup and add a curvature focusing term on the receiver side (same approximation as the original).

Every lit surface (stone, algae, fish) takes its direct sun term only from this map. There is no punctual light,
no shadow map, no `discard` and no alpha test.

### Point sun, pillars and shadows

As in the original the sun is a point 8.5 m above the middle of the room (`SUN_HEIGHT`), so its rays fan out and
slant onto the columns. `causticSunGLSL` gives each receiver its own refracted ray (`sunRay`); the receiver reprojects
the map along that ray and weights it with `dot(n, L) / L.y` (the map holds light per square metre of floor, so
tilted faces such as the inner side of a column or a stair riser come out as bright as the floor). With the old single
near-vertical direction the vertical column faces got almost no light and the pillar caustics looked broken.
Columns also cast an analytic shadow (`columnShadow`): the 12-column ring is folded by angle so only the nearest
column is tested against the sun segment, with no shadow map and no loop.

### Sun beams

`LightShafts.ts` replaces the original's post-process light shafts without a depth pass or render target. The eye ray
is clipped to the water volume and marched 14 steps (interleaved-noise jitter). Each sample adds the caustic map
lookup (heavily mip-biased and squared, so a few soft rays rather than many filaments), absorbed by the water above it, blocked inside
column shadows, times a Henyey-Greenstein phase (brighter looking towards the sun) and a Gaussian column of extra
density under the sun opening. The march stops at the stepped floor, the plinth and columns (analytic). It costs one
full-screen fragment loop, so lower `STEPS` first if the Quest frame rate drops. Per-step cost is kept small: no `pow`, a column test that exits early outside the ring.

## WebXR notes (Quest)

- `SceneManager.update()` renders the caustic map offscreen (default framebuffer, before the XR layer framebuffer is
  bound), following the project's two-pass rule. No render target is touched during the eye render.
- Draw-call budget: 2 merged architecture meshes, 3 dais + 2 plinth meshes, 1 fish `InstancedMesh`, 1 algae
  `InstancedMesh`, water, the light-shaft volume and one `Points` object.
- `isShadowEnabled()` and `isDepthEnabled()` are `false`; no post-processing.
- Water surface has no planar reflection pass: total internal reflection samples the caustic map where the reflected
  ray meets the floor.
- Fog is `FogExp2`; the water horizon is blended with the same colour after tone mapping, so no seam appears.

## Differences from the original

- WebGPU / TSL / compute / MRT / SSR / temporal post-processing / lil-gui replaced by GLSL, one lit-material
  injection and a few additive passes.
- Fish use the original's geometry, scale texture, school colours and 12 lone riders (amber, cyan, purple), but orbit on procedural paths instead of the boid simulation; schools are 34 fish instead of 288, and the PBR/iridescent physical material is a Lambert material with a cheap sheen term.
- No bloom, colour grading, moss, camera view presets or settings panel.

## Sound

As in the other ocean demos, AudioHandler loops the underwater sound and the ocean waves on a shared audio context. They are crossfaded by the camera height against the water surface (underwater by default); playback starts on the first click or touch if autoplay is blocked.
