import * as THREE from "../../vendor/three/build/three.webgpu.js";
import {
  Fn,
  If,
  Loop,
  instanceIndex,
  uvec3,
  vec3,
  vec4,
  float,
  uniform,
  uniformArray,
  texture3D,
  textureStore,
  reference,
} from "../../vendor/three/build/three.tsl.js";
import { COLUMNS } from "./architecture.js";
import { WATER_HEIGHT } from "./motion.js";
import { FISH_SCHOOLS, SCHOOL_SIZE } from "./fish-schools.js";

export const LIGHT_GRID_SIZE = [40, 16, 40];
export const LIGHT_GRID_MIN = [-13, 0, -13];
export const LIGHT_GRID_EXTENT = [26, WATER_HEIGHT, 26];

// Day 08's world-space irradiance cache, adapted to underwater sources.
// Each mote reads one trilinear sample; it does not carry its own light.
export function createParticleLightField(
  optics,
  room,
  marine,
  environment,
  scene,
) {
  const [nx, ny, nz] = LIGHT_GRID_SIZE,
    count = nx * ny * nz;
  const texture = new THREE.Storage3DTexture(nx, ny, nz);
  texture.type = THREE.HalfFloatType;
  texture.name = "Underwater particle illumination";
  const target = new THREE.StorageTexture3DNode(texture);
  const sun = uniform(new THREE.Color());
  const ambient = environment.particleFill.mul(
    reference("environmentIntensity", "float", scene),
  );
  const centers = marine.schools.map(() => new THREE.Vector3());
  const colors = FISH_SCHOOLS.map(() => new THREE.Vector3());
  const positions = uniformArray(centers),
    radiance = uniformArray(colors);
  const schoolColors = FISH_SCHOOLS.map((school) => {
    const c = new THREE.Color().setHSL(
      school.hue + school.hueRange * 0.5,
      0.92,
      0.54,
    );
    if (school.belly) c.lerp(new THREE.Color(school.belly), 0.3);
    return c;
  });
  const minimum = vec3(...LIGHT_GRID_MIN),
    extent = vec3(...LIGHT_GRID_EXTENT);
  const columns = COLUMNS;
  const shafts = uniformArray(
    columns.map((c) => new THREE.Vector3(c.x, c.z, c.radius)),
  );
  const compute = Fn(() => {
    If(instanceIndex.lessThan(count), () => {
      const coord = uvec3(
        instanceIndex.mod(nx),
        instanceIndex.div(nx).mod(ny),
        instanceIndex.div(nx * ny),
      );
      const p = vec3(coord)
        .add(0.5)
        .div(vec3(nx, ny, nz))
        .mul(extent)
        .add(minimum)
        .toVar();
      const toSun = optics.lightPosition.sub(p);
      const distance2 = toSun.dot(toSun).max(1);
      const horizontal = toSun.xz,
        length2 = horizontal.dot(horizontal).max(0.001);
      const visibility = float(1).toVar();
      Loop(columns.length, ({ i }) => {
        const column = shafts.element(i);
        const along = column.xy.sub(p.xz).dot(horizontal).div(length2).clamp();
        const closest = p.xz.add(horizontal.mul(along));
        const height = p.y.add(toSun.y.mul(along));
        If(height.lessThan(WATER_HEIGHT), () => {
          const edge = column.xy.sub(closest).length().sub(column.z);
          visibility.mulAssign(
            edge.smoothstep(-0.04, along.mul(0.45).add(0.12)),
          );
        });
      });
      const extinction = vec3(0.13, 0.035, 0.018)
        .mul(float(WATER_HEIGHT).sub(p.y).max(0))
        .negate()
        .exp();
      const focused = optics
        .caustic(p, vec3(0, 1, 0))
        .min(8)
        .mul(0.3)
        .add(1);
      const result = sun
        .div(distance2)
        .mul(extinction)
        .mul(visibility)
        .mul(focused)
        .add(ambient)
        .toVar();
      Loop(FISH_SCHOOLS.length, ({ i }) => {
        const offset = p.sub(positions.element(i));
        const d2 = offset.dot(offset);
        // A school is a distributed emitter, so soften its near field and
        // restrict the colored spill to its immediate neighborhood.
        const weight = d2.sqrt().smoothstep(1.5, 4).oneMinus().div(d2.add(1.2));
        result.addAssign(radiance.element(i).mul(weight));
      });
      textureStore(target, coord, vec4(result.max(0), 1));
    });
  })()
    .compute(count)
    .setName("Underwater irradiance grid");
  const volume = texture3D(texture);
  let previous = [];
  return {
    texture,
    compute,
    sample(p) {
      const uvw = p.sub(minimum).div(extent);
      const inside = uvw
        .greaterThanEqual(vec3(0))
        .all()
        .and(uvw.lessThanEqual(vec3(1)).all());
      return volume.sample(uvw.clamp()).level(0).rgb.mul(inside.select(1, 0));
    },
    update(time, settings, renderer) {
      const light = room.sun;
      const values = [
        time,
        settings.fish,
        settings.fishGlow,
        settings.caustics,
        settings.waves,
        light.intensity,
        light.color.r,
        light.color.g,
        light.color.b,
        light.position.x,
        light.position.y,
        light.position.z,
        scene.environmentIntensity,
      ];
      if (values.every((v, i) => v === previous[i])) return;
      previous = values;
      sun.value
        .copy(light.color)
        .multiplyScalar(light.intensity / (4 * Math.PI));
      marine.schools.forEach((school, i) => {
        centers[i].copy(school.position);
        const c = schoolColors[i];
        colors[i]
          .set(c.r, c.g, c.b)
          .multiplyScalar(
            settings.fish ? settings.fishGlow * SCHOOL_SIZE * 0.012 : 0,
          );
      });
      renderer.compute(compute);
    },
    dispose() {
      compute.dispose();
      texture.dispose();
    },
  };
}
