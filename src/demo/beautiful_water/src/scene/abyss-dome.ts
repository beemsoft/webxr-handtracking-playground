import {
  BackSide,
  Camera,
  Color,
  Mesh,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3
} from 'three';
import { abyssDomeFragmentShader, abyssDomeVertexShader } from '../shaders/abyss-dome';

export interface AbyssDomeController {
  mesh: Mesh;
  uniforms: { [uniform: string]: { value: any } };
  update(
    time: number,
    underwaterMix: number,
    camera: Camera,
    fogColor: Color,
    shallowColor: Color,
    deepColor: Color
  ): void;
}

export function createAbyssDome(scene: Scene, sunDirection: Vector3): AbyssDomeController {
  const uniforms = {
    uTime: { value: 0 },
    uSunDirection: { value: sunDirection },
    uUnderwater: { value: 0 },
    uFogColor: { value: new Color(0x0a4d5c) },
    uShallowColor: { value: new Color(0x0e6274) },
    uDeepColor: { value: new Color(0x021b24) },
  };

  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    depthTest: true,
    transparent: true,
    fog: false,
    uniforms,
    vertexShader: abyssDomeVertexShader,
    fragmentShader: abyssDomeFragmentShader,
  });

  // Spherical backdrop geometry enclosing the underwater scene within camera far plane
  const geometry = new SphereGeometry(210, 48, 28);
  const mesh = new Mesh(geometry, material);
  mesh.name = 'UnderwaterAbyssDome';
  mesh.renderOrder = -9;
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);

  return {
    mesh,
    uniforms,
    update(
      time: number,
      underwaterMix: number,
      camera: Camera,
      fogColor: Color,
      shallowColor: Color,
      deepColor: Color
    ) {
      const clampedMix = Math.min(1.0, Math.max(0.0, underwaterMix));
      const smoothMix = clampedMix * clampedMix * (3.0 - 2.0 * clampedMix);

      uniforms.uTime.value = time;
      uniforms.uUnderwater.value = smoothMix;
      uniforms.uFogColor.value.copy(fogColor);
      uniforms.uShallowColor.value.copy(shallowColor);
      uniforms.uDeepColor.value.copy(deepColor);

      mesh.position.copy(camera.position);
      mesh.visible = clampedMix > 0.0001;
    },
  };
}
