# Beautiful Water demo

Cinematic shallow-ocean environment with a directional procedural wave spectrum, physically grounded surface lighting, floating navigation buoy, seabed habitat, fish schools, animated shark, and volumetric underwater light rays.

Ported to WebXR from Victor Zakharov's [beautiful-water](https://github.com/VictorZakharov/beautiful-water) using the WebGL rendering pipeline.

## Summary of Changes Compared to Original Demo

Compared to Victor Zakharov's original desktop WebGL demo, the following key enhancements, additions, and architectural changes were implemented:

### 1. WebXR Integration & VR Performance Optimizations
- **WebXR Architecture**: Ported to TypeScript and structured as a `SceneManagerParent` module compatible with both standard desktop browsers and 6DoF WebXR headsets (e.g. Meta Quest).
- **VR Stereo Capture Decoupling**: Built dedicated perspective capture cameras for planar reflection and refraction render targets, eliminating duplicate `ArrayCamera` stereo render passes.
- **Frame-Interleaved Captures**: Interleaved offscreen reflection and refraction updates across alternate frames in WebXR mode to sustain 90 FPS.
- **Tuned Geometry & Bounds**: Halved ocean bounds ($210 \times 210$) and optimized surface tessellation ($80 \times 80$) to minimize vertex shader load in stereo VR while maintaining wave fidelity.
- **Hardware-Filtered Noise**: Offloaded procedural noise sampling to precomputed hardware-bilinear texture lookup tables to prevent mobile GPU shader arithmetic bottlenecks.

### 2. Animated 3D Shark & Predator/Prey AI
- **Animated Shark Model**: Added a swimming, animated GLTF shark with skeletal animations (`shark.gltf`), hydrodynamic banking, and seabed collision avoidance.
- **Curious Diver AI**: The shark circles the navigation buoy and, when the user submerges underwater, breaks orbit to make curious inspection passes directly across the camera's field of view.
- **Jaw/Beak Articulation**: Dynamically drives jaw armature bones (`Bone.007_Armature` / `008` / `009`) to open the shark's mouth when passing close in front of the submerged camera.
- **Fish Predator Evasion**: Enhanced the procedural fish flocking system with shark threat awareness, radial repulsion, lateral scattering away from the shark's swimming vector, and panic speed bursts.

### 3. Underwater Fog, Optical Extinction & Dedicated Abyss Dome
- **Beer-Lambert Wavelength Extinction**: Applied physical multi-spectral absorption (reds attenuating fastest, blue/cyan penetrating deepest) and vertical depth extinction across all submerged geometry (seabed, rocks, kelp, fish, shark, buoy, and water underside).
- **Dedicated Underwater Abyss Dome**: Added a camera-following underwater abyss dome at medium distance (~52m, following the architecture of the misty sky dome in `ship_fog`) that renders Snell-refracted forward sunlight scattering, light shafts, and vertical oceanic color gradients without overloading the skydome.
- **Dedicated Atmospheric Sky Dome**: Dedicated the primary skydome exclusively to atmospheric sky effects (clouds, multi-octave wind drift, sun disk, and crepuscular spokes).
- **Submersion Immersion Blending**: Smoothly transitions fog density, background color ramps, and exposure tone mapping based on the camera's real-time water immersion depth.

### 4. Snell's Law Refracted Caustics
- **Directional Caustics Projection**: Implemented physical water-air interface refraction (`IOR 1.0 -> 1.333`) and projected dynamic dual-wave caustic patterns along the refracted sun vector onto the shark skin, fish schools, seabed terrain, rocks, kelp, and buoy mooring lines.

### 5. Atmospheric Motion & Dynamic Clouds
- **Continuous Cloud Drift**: Added multi-octave directional wind advection across sky dome FBM octaves (broad body, erosion, and fine wisps), synchronized with ocean surface reflections and water cloud shadows.

### 6. Dynamic Immersion Audio
- **Dual-Track Audio Crossfading**: Plays spatial ocean surface wave audio above water and smoothly crossfades to an underwater ambient audio track (`/vr/sound/Underwater sound effect.mp3`) when diving.
- **Submersion Transient Reset**: Automatically restarts the underwater sound track from the beginning each time the camera submerges below the water surface.

### 7. Wave Physics & Buoy Alignment
- **CPU/GPU Wave Synchronization**: Aligned analytical CPU wave sampling formulas with GPU vertex displacement shaders, ensuring the buoy rests accurately at the waterline and responds realistically to ocean wave swell and tilt.

## Features

- Directional wave spectrum with domain warping, wave packets, and CPU surface sampling.
- Real-time planar reflection and refraction with projective distortion and Fresnel response.
- Procedural atmosphere, sun disk, dynamic clouds, and volumetric sun rays.
- Procedural floating navigation buoy bobbing and tilting on waves with dynamic wake and surface shadows.
- Underwater seabed habitat with procedural caustics, sand ripples, rocks, kelp vegetation, and floating marine snow particles.
- Procedural fish schools with flocking behaviors, seabed/waterline collision avoidance, camera reactions, and predator evasion against the patrolling shark.
- Animated 3D shark patrolling in wide orbits around the navigation buoy with curious camera passing behavior and dynamic jaw/beak opening when the camera is submerged underwater.
- Underwater god rays overlay with smooth above/below water immersion transition.
- Spatial ocean audio integration with dynamic immersion crossfading (ocean waves above water, underwater sound effect when submerged).

## Credits

### Victor Zakharov
[Beautiful Water](https://github.com/VictorZakharov/beautiful-water)

### Sound
- Ocean Waves Sounds: `/vr/sound/ocean-waves-sounds.mp3`
- Underwater Sound Effect: `/vr/sound/Underwater sound effect.mp3` (Source: https://www.youtube.com/watch?v=2W-SWObqSqM)


