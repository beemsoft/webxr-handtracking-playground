import * as THREE from "../../vendor/three/build/three.webgpu.js";
import {
  Fn,
  If,
  float,
  vec2,
  vec3,
  vec4,
  uniform,
  positionLocal,
  positionWorld,
  cameraPosition,
  transformNormalToView,
  refract,
  reflect,
  cubeTexture,
  texture,
  pmremTexture,
  mix,
  property,
  reference,
} from "../../vendor/three/build/three.tsl.js";
import { createWaterReflection } from "./water-reflection.js";
import { WATER_HEIGHT } from "./motion.js";
import { traceCrystal, CRYSTAL_DISPERSION } from "./crystal-optics.js";

export const waterReflection = property("vec3", "waterReflection");
export const waterFresnel = property("float", "waterFresnel");
export const waterViewNormal = property("vec3", "waterViewNormal");
export const crystalReflection = property("vec3", "crystalReflection");
export const crystalFresnel = property("float", "crystalFresnel");
export const crystalViewNormal = property("vec3", "crystalViewNormal");
export const WATER_ABSORPTION = [0.48, 0.12, 0.075];
export const WATER_SCATTER = [0.005, 0.105, 0.17];
export const GLASS_WATER_ABSORPTION = [0.028, 0.012, 0.008];
export const GLASS_WATER_SCATTER = [0.015, 0.12, 0.14];

export function createWater(scene, optics) {
  const reflection = createWaterReflection();
  const projection = uniform(reflection.matrix);
  const haze = uniform(0.8);
  const openingWidth = uniform(4);
  const openingColor = uniform(new THREE.Color("#65ddeb"));
  const distantWater = uniform(scene.background);
  const material = new THREE.MeshBasicNodeMaterial({
    name: "Underwater dielectric interface",
  });
  material.positionNode = vec3(
    positionLocal.x,
    optics.waves(positionLocal.xz).z.add(WATER_HEIGHT),
    positionLocal.z,
  );
  const wave = optics.waves(positionWorld.xz);
  const normal = vec3(wave.x, -1, wave.y).normalize();
  material.colorNode = Fn(() => {
    // MeshBasicNodeMaterial ignores normalNode. Export the actual wave normal
    // explicitly for the scene MRT so SSR traces the same surface as Fresnel.
    waterViewNormal.assign(transformNormalToView(normal));
    const p = positionWorld;
    const incident = p.sub(cameraPosition).normalize();
    const cosine = incident.negate().dot(normal).clamp(0.0001, 1);
    const sinSquared = cosine
      .pow2()
      .oneMinus()
      .mul(1.333 * 1.333);
    const transmittedCosine = sinSquared.oneMinus().max(0).sqrt();
    const rs = cosine
      .mul(1.333)
      .sub(transmittedCosine)
      .div(cosine.mul(1.333).add(transmittedCosine))
      .pow2();
    const rp = transmittedCosine
      .mul(1.333)
      .sub(cosine)
      .div(transmittedCosine.mul(1.333).add(cosine).max(0.0001))
      .pow2();
    const fresnel = sinSquared
      .greaterThanEqual(1)
      .select(1, rs.add(rp).mul(0.5));
    waterFresnel.assign(fresnel);
    const ray = reflect(incident, normal).toVar();
    ray.y.assign(ray.y.min(-0.015));
    ray.assign(ray.normalize());
    const distance = p.y.negate().div(ray.y).toVar();
    const hit = p.add(ray.mul(distance.max(0.01)));
    const projected = projection.mul(vec4(hit, 1));
    const uv = projected.xy.div(projected.w).mul(vec2(0.5, -0.5)).add(0.5);
    const edge = uv.x
      .smoothstep(0, 0.04)
      .mul(uv.y.smoothstep(0, 0.04))
      .mul(uv.x.oneMinus().smoothstep(0, 0.04))
      .mul(uv.y.oneMinus().smoothstep(0, 0.04));
    const fallback = pmremTexture(scene.environment, ray, float(0.04)).rgb.mul(
      reference("environmentIntensity", "float", scene),
    );
    const reflected = mix(
      fallback,
      texture(reflection.target.texture, uv.clamp(0.001, 0.999)).rgb,
      edge,
    );
    const extinction = vec3(...WATER_ABSORPTION)
      .mul(distance.clamp(0, 25))
      .mul(haze)
      .negate()
      .exp();
    const underwater = reflected
      .mul(extinction)
      .add(vec3(...WATER_SCATTER).mul(extinction.oneMinus()));
    const skyDirection = refract(incident, normal, float(1.333));
    const sky = mix(
      vec3(0.005, 0.12, 0.19),
      vec3(0.03, 0.45, 0.62),
      skyDirection.y.max(0).pow2(),
    );
    const aperture = p.xz
      .sub(optics.aperture)
      .add(wave.xy.mul(0.7))
      .div(openingWidth)
      .length()
      .pow2()
      // Share the shaft footprint: a bright core inside a wider cyan shoulder.
      .mul(-1.6)
      .exp();
    const fade = p.sub(cameraPosition).length().smoothstep(18, 45);
    waterReflection.assign(underwater.mul(fresnel).mul(fade.oneMinus()));
    waterFresnel.mulAssign(fade.oneMinus());
    return mix(
      sky
        .mul(fresnel.oneMinus())
        .add(underwater.mul(fresnel))
        .add(vec3(10.24, 9.6, 7.68).mul(aperture.pow(8)))
        .add(openingColor.mul(1.12).mul(aperture)),
      distantWater,
      fade,
    );
  })();
  function surfaceGeometry(segments) {
    const geometry = new THREE.PlaneGeometry(120, 120, segments, segments);
    geometry.rotateX(Math.PI / 2);
    // Dense near the installation, spreading into open water beyond the fog.
    const points = geometry.attributes.position;
    for (let i = 0; i < points.count; i++) {
      for (const axis of [0, 2]) {
        const x = points.array[i * 3 + axis];
        points.array[i * 3 + axis] =
          Math.sign(x) * (Math.abs(x) / 60) ** 1.7 * 60;
      }
    }
    return geometry;
  }
  const geometry = surfaceGeometry(192),
    captureGeometry = surfaceGeometry(96);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "Water surface";
  mesh.frustumCulled = false;
  mesh.userData.opticalSurface = 1;
  scene.add(mesh);
  return {
    mesh,
    material,
    captureGeometry,
    reflection,
    haze,
    openingWidth,
    openingColor,
    reflect(renderer, camera) {
      reflection.render(renderer, scene, camera, mesh);
    },
    dispose() {
      geometry.dispose();
      captureGeometry.dispose();
      material.dispose();
      reflection.dispose();
      scene.remove(mesh);
    },
  };
}

export function createCrystal(scene, optics, sun, water) {
  const reflectionEnabled = uniform(1);
  const haze = uniform(0.9);
  const material = new THREE.MeshBasicNodeMaterial({
    name: "Two-interface spectral crystal",
    color: 0xffffff,
  });
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1.85, 128, 96),
    material,
  );
  mesh.name = "Floating crystal";
  mesh.position.copy(optics.center.value);
  mesh.userData.opticalSurface = 2;
  mesh.castShadow = false;
  scene.add(mesh);
  const probe = new THREE.CubeRenderTarget(384, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearMipmapLinearFilter,
    generateMipmaps: true,
  });
  let captures = 0;
  const probeCamera = new THREE.CubeCamera(0.05, 40, probe);
  // A capture contains illuminated geometry, but the point light has no
  // visible surface to capture. Integrate a small, finite sun separately.
  const sunVariance = 0.035 ** 2;
  const sunRadiance = uniform(
    sun.color
      .clone()
      .multiplyScalar(
        sun.intensity /
          (sun.isSpotLight || sun.isPointLight
            ? sun.position.distanceToSquared(optics.center.value)
            : 1) /
          (2 * Math.PI * sunVariance),
      ),
  );
  // Correct the local reflection probe against floor and water planes.
  // There is no cylindrical enclosure in the open-water scene.
  const roomHit = Fn(([p, d]) => {
    const distance = float(40).toVar();
    If(d.y.lessThan(-0.0001), () => {
      distance.assign(p.y.negate().div(d.y));
    });
    If(d.y.greaterThan(0.0001), () => {
      distance.assign(float(WATER_HEIGHT).sub(p.y).div(d.y));
    });
    return p.add(d.mul(distance.clamp(0.01, 40)));
  });
  const underwaterProbe = Fn(([origin, ray]) => {
    const hit = roomHit(origin, ray);
    const extinction = vec3(...GLASS_WATER_ABSORPTION)
      // Horizontal proxy rays can travel 40 m despite hitting a nearby column
      // in the capture. Bound this approximate path to the installation size.
      .mul(hit.sub(origin).length().min(12))
      .mul(haze)
      .negate()
      .exp();
    const radiance = cubeTexture(
      probe.texture,
      hit.sub(optics.center).normalize(),
    ).rgb;
    return radiance
      .mul(extinction)
      .add(vec3(...GLASS_WATER_SCATTER).mul(extinction.oneMinus()));
  });
  const transmitted = Fn(([p, d, eta]) => {
    const ray = traceCrystal(
      p,
      d,
      eta,
      optics.center,
      optics.radius,
      optics.shellThickness,
    ).toVar();
    return underwaterProbe(ray.get("origin"), ray.get("direction")).mul(
      vec3(0.018, 0.005, 0.003).mul(ray.get("glassDistance")).negate().exp(),
    );
  });
  material.colorNode = Fn(() => {
    const d = positionWorld.sub(cameraPosition).normalize();
    // Rasterized triangles lie just inside the analytic shell. Start optical
    // paths on the actual sphere, especially at grazing angles where a small
    // position error can incorrectly trigger total internal reflection.
    const entry = optics.roots(cameraPosition, d).x;
    const p = cameraPosition.add(d.mul(entry));
    const n = p.sub(optics.center).normalize();
    crystalViewNormal.assign(transformNormalToView(n));
    const spread = optics.dispersion.mul(CRYSTAL_DISPERSION);
    const transmittedRGB = vec3(
      transmitted(p, d, optics.ior.sub(spread)).r,
      transmitted(p, d, optics.ior).g,
      transmitted(p, d, optics.ior.add(spread)).b,
    );
    const reflectedRay = reflect(d, n);
    const reflection = underwaterProbe(p, reflectedRay);
    const cosine = d.negate().dot(n).clamp(0.0001, 1);
    const transmittedCosine = cosine
      .pow2()
      .oneMinus()
      .div(optics.ior.pow2())
      .oneMinus()
      .sqrt();
    const rs = cosine
      .sub(optics.ior.mul(transmittedCosine))
      .div(cosine.add(optics.ior.mul(transmittedCosine)))
      .pow2();
    const rp = optics.ior
      .mul(cosine)
      .sub(transmittedCosine)
      .div(optics.ior.mul(cosine).add(transmittedCosine))
      .pow2();
    const frontFresnel = rs.add(rp).mul(0.5);
    // Thin-wall Fresnel includes the second interface's reflected energy.
    // Blend back to the solid dielectric limit as the core closes.
    const wallFresnel = frontFresnel.mul(2).div(frontFresnel.add(1));
    const shell = optics.shellThickness.div(optics.radius).oneMinus().clamp();
    crystalFresnel.assign(
      mix(frontFresnel, wallFresnel, shell).mul(reflectionEnabled),
    );
    crystalReflection.assign(reflection.mul(crystalFresnel));

    const surfacePoint = p.xz.add(
      optics.sun.xz.mul(float(WATER_HEIGHT).sub(p.y).max(0).div(optics.sun.y)),
    );
    const slope = optics.waves(surfacePoint);
    const waterNormal = vec3(slope.x.negate(), 1, slope.y.negate()).normalize();
    const lightDirection = p.y
      .greaterThanEqual(WATER_HEIGHT)
      .select(
        optics.sun,
        refract(optics.sun.negate(), waterNormal, float(1 / 1.333)).negate(),
      );
    const sunLobe = reflectedRay
      .dot(lightDirection)
      .sub(1)
      .div(sunVariance)
      .exp();
    const sunlight = sunRadiance.mul(sunLobe).mul(crystalFresnel);
    // A small scattering term catches the projected light in the glass;
    // the darker regions remain clear rather than becoming a frosted shell.
    const surfaceLight = optics
      .caustic(p.mul(0.65), n)
      .mul(0.55)
      .mul(optics.center.y.sub(p.y).smoothstep(0.1, 1.3));
    // SSR may replace the captured reflection, never transmission or the sun.
    return transmittedRGB
      .mul(crystalFresnel.oneMinus())
      .add(crystalReflection)
      .add(sunlight)
      .add(surfaceLight);
  })();
  return {
    mesh,
    material,
    probe,
    probeCamera,
    reflectionEnabled,
    haze,
    get captures() {
      return captures;
    },
    reflect(renderer) {
      const visible = mesh.visible;
      const waterGeometry = water.mesh.geometry;
      // The probe is 384 px per face. Keep the full per-pixel wave normal,
      // but avoid evaluating the dense main-view mesh six additional times.
      water.mesh.geometry = water.captureGeometry;
      mesh.visible = false;
      probeCamera.position.copy(mesh.position);
      try {
        probeCamera.update(renderer, scene);
        captures++;
      } finally {
        mesh.visible = visible;
        water.mesh.geometry = waterGeometry;
      }
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      probe.dispose();
      scene.remove(mesh);
    },
  };
}
