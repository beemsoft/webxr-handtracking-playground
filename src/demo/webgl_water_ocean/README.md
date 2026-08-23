# WebGL Water Ocean Demo

## Introduction

The **WebGL Water Ocean** demo is a rich fusion and evolution combining the interactive GPU fluid ripple and light refraction simulation of the classic **WebGL Water / Caustics** demos with the shallow tropical ocean environment, procedural marine life, and atmospheric skies of the **Beautiful Water** demo.

More than just a visual showcase, this demo is the **ultimate example of demonstrating WebXR hand tracking fun**:
- **Interactive Hand Splashes & Fluid Dynamics**: Reach out with natural hand tracking to smash your open hand into the water surface or drag your fingertips across the waterline. Every impact creates physical dynamic ripples, hydrodynamic impact craters, spray droplets, and expanding foam rings calculated in real time.
- **Dynamic Caustics & Optical Refraction**: Watch interactive caustics dance across the sandy dunes of the ocean floor, rocky outcroppings, swaying kelp, roaming stingrays, and darting fish schools using real-time Snell's Law refraction.
- **Apex Predator Curiosity & Interaction**: Smashing the water surface catches the attention of a majestic Great White Shark. The shark breaks its patrol trajectory, surges towards the disturbance while swimming high with its dorsal fin breaching the water surface, and approaches the camera with natural curious banking and playful biting snaps.
- **Natural Marine Ecosystem**: Roaming stingrays glide smoothly over seabed stones, fish schools react to predator presence and surface breaches, while tropical ocean fog and an underwater abyss dome create an authentic 10-meter depth-based visibility fadeout.

---

## Scene Features

- **Water area with sandy ocean floor**: Smooth sandy dunes with procedural sand ripples, rocks, kelp vegetation, and drifting marine snow particles.
- **Groups of fish**: Instanced fish schools with procedural flocking boid AI, undulating tail swimming animations, depth-based skin relief rendering, and predatory evasion.
- **Patrolling & Curious Shark**: Animated Great White Shark model (`Shark_biting.glb`) with skeletal swimming undulations, surface-breaching dorsal fin wakes, obstacle avoidance, splash curiosity attraction, and playful biting encounters on camera proximity.
- **Roaming Stingrays**: Elegant stingrays roaming at low altitude across the seabed with terrain-following undulations, gliding smoothly over rock formations, and banking naturally into turns.
- **Dynamic caustics on all underwater scene objects**: Real-time Snell's Law refracted GPU caustics dancing over the sandy ocean floor, fish bodies, stingray wings, shark skin, and rocks.
- **Sky with slowly moving clouds**: Atmospheric sky dome with multi-octave drifting cloud bodies, sunlight scattering, and sun disk.
- **Hand splash effect**: Interactive water disturbances via WebXR hand tracking open-hand gestures, downward hand smash velocities, and desktop mouse/pointer clicks and drags.
- **Underwater abyss effect**: Natural underwater Beer-Lambert chromatic extinction and depth-based visibility fadeout tuned for a plausible ~10–13m tropical sea distance, paired with a dedicated underwater abyss dome.
- **Dynamic immersion audio**: Spatial ocean surface waves above water smoothly crossfading to ambient underwater audio when diving, resetting from the beginning on every submersion.


## Credits

#### Sting ray
"Sculptober Day 30: Sting" (https://skfb.ly/6VYru) by Nicholas DaRocha is licensed under Creative Commons Attribution (http://creativecommons.org/licenses/by/4.0/).

https://sketchfab.com/3d-models/sculptober-day-30-sting-03e4d5c8efc54afdab4265a8520aa92e#download
