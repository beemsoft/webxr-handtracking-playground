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
