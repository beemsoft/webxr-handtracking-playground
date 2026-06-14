# Salsa party 4

## Credits

### Scene
Ehemalige Kleeblat Tankstelle Hannover: https://sketchfab.com/3d-models/ehemalige-kleeblat-tankstelle-hannover-955e1ad9c5c646a68480e103be28b5a4

### Lighting

Threejs example
https://threejs.org/examples/#webgl_lights_spotlights

### VRM models

### VRM models

#### Shina2
https://hub.vroid.com/en/characters/2579238391074506579/models/3169819120509963851

### BVH files

[The BVH Conversion Release of CMU's Motion Capture Database](https://www.outworldz.com/Secondlife/Posts/CMU/)

>   Use this data!  This data is free for use in research and commercial
projects worldwide.  If you publish results obtained using this data,
we would appreciate it if you would send the citation to your
published paper to jkh+mocap@cs.cmu.edu, and also would add this text
to your acknowledgments section: "The data used in this project was
obtained from mocap.cs.cmu.edu.  The database was created with funding
from NSF EIA-0196217."
 
### BVH hacker

[bvhacker 1.9.1](https://www.bvhacker.com/) by [davedub](http://davedub.co.uk/davedub/wordpress/)

## Implementation Details

### Lighting and Shadows
This demo uses a sophisticated multi-light setup to create a vibrant dance party atmosphere while maintaining performance:
- **Directional Light**: Provides global illumination and cast high-quality shadows for the overall scene.
- **Hemisphere Light**: Adds subtle ambient lighting to soften shadows and ensure no part of the scene is pitch black.
- **SpotLights**: Four colored spotlights (Red, Blue, Green, Yellow) are positioned above and focused on each of the four dancing couples. These cast dynamic shadows on the dance floor.
- **Point Lights**: Four additional point lights provide localized color accents across the room. Shadows for these are disabled to optimize GPU texture unit usage and performance.
- **Shadow Mapping**: PCFShadowMap is used for efficient shadow edges across both WebXR and standard web page rendering.

### Spatial Sound
Spatial audio is implemented to enhance immersion in VR and 3D:
- **Audio Source**: The music is centered at the origin `(0, 0, 0)` of the dance floor.
- **Dynamic Updates**: In the animation loop, the listener's position and orientation (relative to the VR camera) are used to update the audio position and volume.
- **Immersion**: As you move around the dance floor in VR or using orbit controls, the music's volume and stereo panning shift naturally, making the sound feel like it's coming from a fixed point in the room.


