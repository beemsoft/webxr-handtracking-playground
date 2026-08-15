# Depth visualization demo

## Implementation Notes

Unlike the original Three.js example which relies on a 2D post-processing screen quad sampling an offscreen depth texture, our implementation was adapted for WebXR portability. In stereoscopic WebXR, full-screen post-processing quads do not translate well to dual-eye rendering and 6DoF head tracking.

To ensure seamless VR/AR compatibility and simplify the rendering pipeline, we opted for a direct single-pass approach on the 3D meshes. Leveraging insights around view and inverse matrix transformations, depth is evaluated directly in camera view space per fragment. This eliminates the need for an intermediate depth render target and complex unprojections while preserving true stereoscopic parallax.

## Credits

### ThreeJS Depth texture example

[Depth texture example](https://threejs.org/examples/?q=dep#webgl_depth_texture)
