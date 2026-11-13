import * as THREE from "../../vendor/three/build/three.webgpu.js";
import {
  Fn,
  attribute,
  cameraViewMatrix,
  cameraProjectionMatrix,
  cameraPosition,
  positionView,
  uniform,
  uv,
  vec3,
  vec4,
  viewportSize,
} from "../../vendor/three/build/three.tsl.js";
import { floorHeight } from "./architecture.js";
import { WATER_HEIGHT } from "./motion.js";
import { FOG_DEFAULTS } from "./fog-settings.js";

export const PARTICLE_COUNT = 32000;

export function createParticles(scene, field, opaqueViewZ, settings) {
  const plane = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = plane.index;
  geometry.attributes = plane.attributes;
  geometry.instanceCount = PARTICLE_COUNT;
  const seeds = new Float32Array(PARTICLE_COUNT * 4),
    floors = new Float32Array(PARTICLE_COUNT);
  let state = 8157;
  const random = () =>
    (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const radius = Math.sqrt(random()) * 12.5,
      angle = random() * Math.PI * 2;
    seeds.set(
      [Math.cos(angle) * radius, random(), Math.sin(angle) * radius, random()],
      i * 4,
    );
    floors[i] = floorHeight(radius) + 0.08;
  }
  geometry.setAttribute(
    "particleSeed",
    new THREE.InstancedBufferAttribute(seeds, 4),
  );
  geometry.setAttribute(
    "particleFloor",
    new THREE.InstancedBufferAttribute(floors, 1),
  );
  const clock = uniform(0),
    intensity = uniform(settings.particleBrightness),
    opacity = uniform(settings.particleOpacity),
    size = uniform(settings.particleSize);
  const haze = uniform(FOG_DEFAULTS.haze),
    fogStart = uniform(FOG_DEFAULTS.fogStart);
  const seed = attribute("particleSeed", "vec4"),
    bottom = attribute("particleFloor", "float");
  const phase = seed.w.mul(Math.PI * 2);
  const progress = seed.y.sub(clock.mul(seed.w.mul(0.001).add(0.0015))).fract();
  const center = Fn(() =>
    vec3(
      seed.x
        .add(clock.mul(0.15).add(phase).sin().mul(0.22))
        .add(clock.mul(0.07).add(seed.z).cos().mul(0.12)),
      progress.mul(bottom.negate().add(WATER_HEIGHT - 0.08)).add(bottom),
      seed.z
        .add(clock.mul(0.12).add(phase).cos().mul(0.25))
        .add(clock.mul(0.09).add(seed.x).sin().mul(0.14)),
    ),
  )();
  const illumination = field.sample(center).toVarying("moteIllumination");
  const lit = illumination
    .dot(vec3(0.2126, 0.7152, 0.0722))
    .smoothstep(0.12, 0.45);
  const material = new THREE.SpriteNodeMaterial({
    name: "Suspended underwater particles",
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.positionNode = center;
  const distance = center
    .sub(cameraPosition)
    .length()
    .toVarying("moteDistance");
  const extinction = vec3(0.018, 0.008, 0.004)
    .mul(distance)
    .mul(haze)
    .negate()
    .exp();
  const fog = distance
    .sub(fogStart)
    .max(0)
    .mul(haze)
    .mul(0.06)
    .pow2()
    .negate()
    .exp();
  material.colorNode = illumination.mul(intensity).mul(extinction).mul(fog);
  const diameter = seed.w.mul(0.7).add(0.3).mul(size);
  const depth = cameraViewMatrix.mul(vec4(center, 1)).z.negate().max(0.1);
  const pixelWorld = depth
    .mul(2)
    .div(cameraProjectionMatrix.element(1).y.mul(viewportSize.y));
  const rendered = diameter.max(pixelWorld.mul(1.5));
  material.scaleNode = lit.greaterThan(0).select(rendered, 0);
  const r2 = uv().sub(0.5).length().mul(2).pow2();
  const disc = r2.mul(-3).exp().mul(r2.smoothstep(0.7, 1).oneMinus());
  const intersection = positionView.z.sub(opaqueViewZ).smoothstep(0, 0.12);
  const lifetime = progress
    .smoothstep(0, 0.04)
    .mul(progress.smoothstep(0.96, 1).oneMinus());
  material.opacityNode = disc
    .mul(opacity)
    .mul(lit)
    .mul(diameter.div(rendered).pow2())
    .mul(intersection)
    .mul(lifetime)
    .mul(distance.smoothstep(0.3, 0.8));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "Suspended particles";
  mesh.frustumCulled = false;
  scene.add(mesh);
  return {
    mesh,
    clock,
    count: PARTICLE_COUNT,
    update(time, settings) {
      clock.value = time;
      intensity.value = settings.particleBrightness;
      opacity.value = settings.particleOpacity;
      size.value = settings.particleSize;
      haze.value = settings.haze;
      fogStart.value = settings.fogStart;
      mesh.visible = settings.particles;
    },
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}
