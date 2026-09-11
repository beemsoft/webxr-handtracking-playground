import * as THREE from 'three';

export function createParticulate(
  scene: THREE.Scene,
  uniforms: { [key: string]: THREE.IUniform }
): THREE.Points {
  const count = 240;
  const data = new Float32Array(count * 3);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.sin(i * 127.1 + Math.cos(i * 31.4)) * 0.5;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data, 3));
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      uniform float uTime;
      uniform sampler2D uHeightMap;
      varying float vAlpha;
      void main(){
        vec3 center = vec3(floor(cameraPosition.x / 16.0) * 16.0, -1.4, floor(cameraPosition.z / 16.0) * 16.0);
        vec3 world = center + position * vec3(32.0, 2.8, 32.0);
        world.xz += vec2(sin(uTime * 0.19 + position.y * 8.0), cos(uTime * 0.17 + position.x * 9.0)) * 0.18;
        float bed = texture2D(uHeightMap, world.xz / 1100.0 + vec2(0.5)).r;
        vAlpha = smoothstep(bed, bed + 0.3, world.y) * (1.0 - smoothstep(10.0, 16.0, distance(world.xz, cameraPosition.xz)));
        vec4 mvPosition = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = clamp(16.0 / max(1.0, -mvPosition.z), 0.7, 1.5);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      varying float vAlpha;
      uniform float uStorm, uGolden;
      void main(){
        #include <logdepthbuf_fragment>
        float alpha = (1.0 - smoothstep(0.1, 0.5, length(gl_PointCoord - vec2(0.5)))) * vAlpha * 0.12 * (1.0 - uStorm * 0.8);
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(mix(vec3(0.63, 0.85, 0.78), vec3(0.86, 0.81, 0.59), uGolden), alpha);
      }
    `,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.layers.set(1);
  scene.add(points);
  return points;
}
