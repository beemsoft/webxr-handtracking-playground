import * as THREE from "../../vendor/three/build/three.webgpu.js";
import { WATER_HEIGHT } from "./motion.js";
import { PLINTH_TOP } from "./architecture.js";
import { traceCrystal, CRYSTAL_DISPERSION } from "./crystal-optics.js";
import {
  Fn,
  If,
  uniform,
  uniformArray,
  varying,
  float,
  vec2,
  vec3,
  vec4,
  positionLocal,
  varyingProperty,
  refract,
  cross,
  dFdx,
  dFdy,
  texture,
  uv,
  storage,
  instanceIndex,
  vertexIndex,
} from "../../vendor/three/build/three.tsl.js";

// Seven spectral quadrature samples, from red through violet. Each channel's
// weights sum to one, preserving white light and the flat-water energy scale.
const SPECTRUM = [
  [0.4, 0, 0],
  [0.32, 0.09, 0],
  [0.2, 0.36, 0],
  [0, 0.4, 0.03],
  [0, 0.15, 0.32],
  [0, 0, 0.4],
  [0.08, 0, 0.25],
];
const RIPPLE_AMPLITUDE = 0.45;
const RIPPLE_FREQUENCY = 16;

export function createOptics() {
  const time = uniform(0),
    amplitude = uniform(1),
    strength = uniform(1),
    dispersion = uniform(0.85),
    ior = uniform(1.5);
  const shellThickness = uniform(0.16);
  const rippleProjection = uniform(1.25);
  const center = uniform(new THREE.Vector3(0, 3.15, 0)),
    radius = uniform(1.85);
  const sun = uniform(new THREE.Vector3(-0.04, 1, -0.03).normalize());
  const aperture = uniform(new THREE.Vector2(0, 3.8));
  const lightPosition = uniform(new THREE.Vector3(0, 8.5, 0));
  const ripples = Array.from({ length: 6 }, () =>
    uniform(new THREE.Vector4(0, 0, -100, 0)),
  );
  const waterExtent = 3;
  const baseWaves = Fn(([p]) => {
    const field = vec3(0).toVar();
    for (let i = 0; i < 10; i++) {
      const angle = i * 2.399963 + 0.3,
        frequency = (4.3 * 1.22 ** i * waterExtent) / (Math.PI * 2),
        a = 0.01 * 0.79 ** i;
      const x =
          (Math.round(Math.cos(angle) * frequency) * Math.PI * 2) / waterExtent,
        z =
          (Math.round(Math.sin(angle) * frequency) * Math.PI * 2) / waterExtent;
      const k = Math.hypot(x, z),
        direction = vec2(x / k, z / k);
      const phase = p
        .dot(direction)
        .mul(k)
        .add(time.mul(Math.sqrt(9.8 * k) * 0.32))
        .add(i * 7.13);
      field.addAssign(
        vec3(direction.mul(phase.cos().mul(a * k)), phase.sin().mul(a)).mul(
          amplitude,
        ),
      );
    }
    return field;
  });
  const rippleSample = Fn(([p]) => {
    const field = vec4(0).toVar();
    for (const ripple of ripples) {
      const age = time.sub(ripple.z).toVar();
      If(age.greaterThanEqual(0).and(age.lessThan(14)), () => {
        const delta = p.sub(ripple.xy),
          // A finite contact footprint keeps the radial slope smooth at its
          // origin instead of introducing a singular direction at one point.
          distance = delta.dot(delta).add(0.01).sqrt();
        const front = distance.sub(age.mul(0.85));
        const widthSquared = age.mul(0.1).add(0.48).pow2();
        const envelope = front
          .pow2()
          .div(widthSquared)
          .negate()
          .sub(age.mul(0.17))
          .exp()
          .mul(ripple.w)
          .mul(RIPPLE_AMPLITUDE)
          .div(distance.mul(0.35).add(1).sqrt());
        const phase = distance.sub(age.mul(1.1)).mul(RIPPLE_FREQUENCY);
        const decay = front
          .mul(-2)
          .div(widthSquared)
          .sub(float(0.175).div(distance.mul(0.35).add(1)));
        const derivative = phase
          .cos()
          .mul(RIPPLE_FREQUENCY)
          .add(decay.mul(phase.sin()))
          .mul(envelope);
        const decayDerivative = float(-2)
          .div(widthSquared)
          .add(float(0.06125).div(distance.mul(0.35).add(1).pow2()));
        const secondDerivative = decay
          .pow2()
          .add(decayDerivative)
          .sub(RIPPLE_FREQUENCY ** 2)
          .mul(phase.sin())
          .add(decay.mul(2 * RIPPLE_FREQUENCY).mul(phase.cos()))
          .mul(envelope);
        const radial = delta.dot(delta).div(distance.pow2());
        const curvature = secondDerivative
          .mul(radial)
          .add(derivative.mul(float(2).sub(radial)).div(distance));
        field.addAssign(
          vec4(
            delta.div(distance).mul(derivative),
            phase.sin().mul(envelope),
            curvature,
          ),
        );
      });
    }
    return field;
  });
  const rippleField = Fn(([p]) => rippleSample(p).xyz);
  const waves = Fn(([p]) => baseWaves(p).add(rippleField(p)));
  const roots = Fn(([origin, direction]) => {
    const q = origin.sub(center),
      b = q.dot(direction),
      d = b.pow2().sub(q.dot(q)).add(radius.pow2());
    return d
      .greaterThanEqual(0)
      .select(
        vec2(b.negate().sub(d.max(0).sqrt()), b.negate().add(d.max(0).sqrt())),
        vec2(-1),
      );
  });
  const waterMap = new THREE.RenderTarget(2048, 2048, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
  });
  const orbMap = new THREE.RenderTarget(2048, 2048, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
  });
  waterMap.texture.anisotropy = orbMap.texture.anisotropy = 8;
  waterMap.texture.wrapS = waterMap.texture.wrapT = THREE.RepeatWrapping;
  const makeTarget = (size) =>
    new THREE.RenderTarget(size, size, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
    });
  const rawWater = makeTarget(2048),
    rawOrb = makeTarget(2048);
  // The receivers are filtered sequentially, so both can share this workspace.
  const scratch = makeTarget(2048);
  function makeFilter(source, step, sigma = 3, radius = 8) {
    // Pair adjacent Gaussian taps at their weighted bilinear positions. Scaling
    // the old five-tap offsets left unsampled texels and stamped a fine grid
    // around narrow photon triangles, especially in the globe's caustic.
    const weights = Array.from({ length: radius + 1 }, (_, i) =>
      Math.exp(-(i * i) / (2 * sigma * sigma)),
    );
    const sum = weights[0] + 2 * weights.slice(1).reduce((a, b) => a + b, 0);
    const taps = [];
    for (let i = 1; i < weights.length; i += 2) {
      const weight = weights[i] + weights[i + 1];
      taps.push({ offset: i + weights[i + 1] / weight, weight: weight / sum });
    }
    const input = texture(source, uv());
    const filterMaterial = new THREE.MeshBasicNodeMaterial({
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    filterMaterial.fragmentNode = Fn(() => {
      const p = uv();
      const c = input
        .sample(p)
        .mul(weights[0] / sum)
        .toVar();
      for (const { offset, weight } of taps)
        c.addAssign(
          input
            .sample(p.add(step.mul(offset)))
            .add(input.sample(p.sub(step.mul(offset))))
            .mul(weight),
        );
      return vec4(c.rgb, 1);
    })();
    return new THREE.QuadMesh(filterMaterial);
  }
  // Each pass owns its source binding and texel step. Sample nodes cloned by
  // TSL must not retain the preceding pass's texture or direction.
  const filters = [
    [
      makeFilter(rawWater.texture, vec2(1 / rawWater.width, 0)),
      makeFilter(scratch.texture, vec2(0, 1 / waterMap.height)),
    ],
    [
      makeFilter(rawOrb.texture, vec2(1 / rawOrb.width, 0), 6, 16),
      makeFilter(scratch.texture, vec2(0, 1 / orbMap.height), 6, 16),
    ],
  ];
  const kind = uniform(0),
    achromatic = uniform(0);
  const spectrum = uniformArray(
    SPECTRUM.map((rgb) => new THREE.Vector3(...rgb)),
  );
  const spectralColor = varying(
    achromatic.greaterThan(0).select(vec3(1), spectrum.element(instanceIndex)),
    "photonSpectrum",
  ).setInterpolation("flat");
  const sourceV = varyingProperty("vec3", "photonSource");
  const targetV = varyingProperty("vec3", "photonTarget");
  const validV = varyingProperty("float", "photonValid");
  function photonSheet(segments, extent, lens) {
    const count = (segments + 1) ** 2;
    const positions = new THREE.StorageBufferAttribute(
      count * SPECTRUM.length,
      4,
    );
    const writable = storage(positions, "vec4");
    const readable = storage(positions, "vec4").toReadOnly();
    const compute = Fn(() => {
      const index = instanceIndex;
      const source = vec2(
        index
          .mod(segments + 1)
          .toFloat()
          .div(segments)
          .sub(0.5),
        float(0.5).sub(
          index
            .div(segments + 1)
            .toFloat()
            .floor()
            .div(segments),
        ),
      )
        .mul(extent)
        .toVar();
      if (!lens) {
        // Center the source patch on the rays landing in this receiver tile.
        // Without this, an angled light leaves holes that repeat across the room.
        const meanRay = refract(sun.negate(), vec3(0, 1, 0), float(1 / 1.333));
        source.addAssign(meanRay.xz.mul(WATER_HEIGHT).div(meanRay.y));
      }
      // Wave height and slope are shared by all spectral rays.
      const wave = (lens ? waves(source) : baseWaves(source)).toVar();
      const normal = vec3(wave.x.negate(), 1, wave.y.negate())
        .normalize()
        .toVar();
      const surfacePoint = vec3(source.x, wave.z.add(WATER_HEIGHT), source.y);
      const incoming = lens
        ? surfacePoint.sub(lightPosition).normalize()
        : sun.negate();
      for (let band = 0; band < SPECTRUM.length; band++) {
        const spectralOffset = (band - 3) / 3;
        // Exaggerated spectral spread survives the reconstruction footprint
        // and leaves colored fringes around otherwise white caustic cores.
        const waterIOR = dispersion.mul(spectralOffset * 0.055).add(1.333);
        const ray = refract(incoming, normal, waterIOR.reciprocal()).toVar();
        const origin = vec3(
          source.x,
          wave.z.add(WATER_HEIGHT),
          source.y,
        ).toVar();
        const valid = float(1).toVar();
        if (lens) {
          const hit = roots(origin, ray).toVar();
          If(hit.x.lessThan(0), () => {
            valid.assign(0);
          }).Else(() => {
            const enter = origin.add(ray.mul(hit.x)).toVar();
            const eta = ior.add(
              dispersion.mul(spectralOffset * CRYSTAL_DISPERSION),
            );
            const traced = traceCrystal(
              enter,
              ray,
              eta,
              center,
              radius,
              shellThickness,
            ).toVar();
            ray.assign(traced.get("direction"));
            origin.assign(traced.get("origin"));
          });
        }
        const target = origin.add(
          ray.mul(
            float(lens ? PLINTH_TOP : 0)
              .sub(origin.y)
              .div(ray.y.min(-0.01)),
          ),
        );
        writable.element(index.add(count * band)).assign(vec4(target, valid));
      }
    })().compute(count);
    return {
      count,
      positions,
      readable,
      compute,
      geometry: new THREE.PlaneGeometry(1, 1, segments, segments),
    };
  }
  const waterSheet = photonSheet(512, waterExtent + 2, false),
    orbSheet = photonSheet(384, 7, true);
  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
  material.vertexNode = Fn(() => {
    const channel = achromatic.greaterThan(0).select(3, instanceIndex).toUint();
    const extent = kind.lessThan(0.5).select(waterExtent + 2, 7);
    const source = positionLocal.xy.mul(extent).toVar();
    const photon = vec4(0).toVar();
    If(kind.lessThan(0.5), () => {
      photon.assign(
        waterSheet.readable.element(
          vertexIndex.add(channel.mul(waterSheet.count)),
        ),
      );
    }).Else(() => {
      photon.assign(
        orbSheet.readable.element(vertexIndex.add(channel.mul(orbSheet.count))),
      );
    });
    const target = photon.xyz;
    sourceV.assign(vec3(source.x, 0, source.y));
    targetV.assign(target);
    validV.assign(photon.w);
    const mapExtent = kind.lessThan(0.5).select(waterExtent, 10);
    return vec4(
      target.x.div(mapExtent.mul(0.5)),
      target.z.negate().div(mapExtent.mul(0.5)),
      0,
      1,
    );
  })();
  material.fragmentNode = Fn(() => {
    // Evaluate derivatives before the per-fragment validity discard.
    const before = cross(dFdx(sourceV), dFdy(sourceV)).length().toVar();
    const after = cross(dFdx(targetV), dFdy(targetV))
      .length()
      .max(0.00000001)
      .toVar();
    validV.lessThan(0.999).discard();
    const energy = before
      .div(after)
      .min(28)
      .mul(kind.lessThan(0.5).select(0.22, 0.16));
    return vec4(spectralColor.mul(energy), 1);
  })();
  const mesh = new THREE.InstancedMesh(
    waterSheet.geometry,
    material,
    SPECTRUM.length,
  );
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const causticIrradiance = Fn(([p]) => {
    const ray = refract(
      p.sub(lightPosition).normalize(),
      vec3(0, 1, 0),
      float(1 / 1.333),
    );
    // This is a small inverse-lookup approximation. Bound its curvature so it
    // cannot fold the tiled floor pattern into repeated concentric bands. The
    // visible water and sphere photon paths retain the full ripple strength.
    const ripple = rippleSample(p.xz).toVar();
    const warp = ripple.xy.mul(rippleProjection);
    const q = p.xz.sub(ray.xz.div(ray.y).mul(p.y)).sub(warp);
    const irradiance = texture(
      waterMap.texture,
      q.div(waterExtent).add(0.5),
    ).rgb;
    // Curvature concentrates and spreads light as the wave passes. Keep this
    // response separate from the bounded coordinate shift: a strong ripple
    // must still visibly focus the caustics without folding the texture.
    // This bounded first-order response approximates a change of ray density.
    const convergence = ripple.w
      .mul(float(WATER_HEIGHT).sub(p.y).max(0))
      .mul(-0.12);
    const focusing = convergence.div(convergence.abs().add(1)).mul(0.85).add(1);
    // Undo the photon sheet's storage scale: flat water gives unit direct light.
    return irradiance.mul(focusing).div(0.22);
  });
  // Positive excess light remains available to the approximate particle field.
  const caustic = Fn(([p, n]) => {
    const ray = refract(
      p.sub(lightPosition).normalize(),
      vec3(0, 1, 0),
      float(1 / 1.333),
    );
    // Reproject the floor-depth irradiance along the mean refracted light,
    // including receiver foreshortening. This stays coherent across a stair
    // edge or column, unlike unrelated UV projections on each surface axis.
    // Convergence at other heights remains a floor-depth approximation.
    const incidence = n.dot(ray.negate()).max(0).div(ray.y.negate());
    return causticIrradiance(p)
      .mul(0.22)
      .sub(0.23)
      .max(0)
      .mul(incidence)
      .mul(strength);
  });
  return {
    time,
    amplitude,
    strength,
    dispersion,
    ior,
    shellThickness,
    center,
    radius,
    sun,
    lightPosition,
    aperture,
    ripples,
    waves,
    rippleField,
    rippleProjection,
    waterExtent,
    roots,
    waterMap,
    orbMap,
    rawWater,
    rawOrb,
    caustic,
    causticIrradiance,
    render(renderer) {
      let curvature = 0;
      for (const { value } of ripples) {
        const age = time.value - value.z;
        if (age < 0 || age >= 14) continue;
        const width = 0.48 + age * 0.1;
        const height =
          Math.abs(value.w) * RIPPLE_AMPLITUDE * Math.exp(-age * 0.17);
        // Conservative radial second-derivative bound for the carrier and
        // Gaussian envelope, including its distance attenuation.
        curvature +=
          height *
          (RIPPLE_FREQUENCY ** 2 +
            2 * RIPPLE_FREQUENCY * (Math.SQRT2 / width + 0.175) +
            2 / (width * width) +
            0.5 / width +
            0.1);
      }
      rippleProjection.value = 1.25 / (1 + (curvature * 1.25) / 0.45);
      const previous = renderer.getRenderTarget(),
        autoClear = renderer.autoClear;
      const clear = renderer.getClearColor(new THREE.Color()),
        alpha = renderer.getClearAlpha();
      renderer.autoClear = false;
      renderer.setClearColor(0, 0);
      achromatic.value = dispersion.value === 0 ? 1 : 0;
      mesh.count = dispersion.value === 0 ? 1 : SPECTRUM.length;
      for (const [raw, map, type] of [
        [rawWater, waterMap, 0],
        [rawOrb, orbMap, 1],
      ]) {
        kind.value = type;
        const sheet = type === 0 ? waterSheet : orbSheet;
        mesh.geometry = sheet.geometry;
        renderer.compute(sheet.compute);
        renderer.setRenderTarget(raw);
        renderer.clear();
        // All wavelengths share one instanced draw, preserving their photon
        // positions and additive order without seven render-pass submissions.
        renderer.render(scene, camera);
        renderer.setRenderTarget(scratch);
        filters[type][0].render(renderer);
        renderer.setRenderTarget(map);
        filters[type][1].render(renderer);
      }
      renderer.setRenderTarget(previous);
      renderer.autoClear = autoClear;
      renderer.setClearColor(clear, alpha);
    },
    dispose() {
      for (const sheet of [waterSheet, orbSheet]) {
        sheet.geometry.dispose();
        sheet.compute.dispose();
        sheet.positions.dispose();
      }
      material.dispose();
      mesh.dispose();
      waterMap.dispose();
      orbMap.dispose();
      for (const map of [rawWater, rawOrb, scratch]) map.dispose();
      for (const quad of filters.flat()) quad.material.dispose();
    },
  };
}
