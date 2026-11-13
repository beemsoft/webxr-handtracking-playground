import { Color } from "../../vendor/three/build/three.webgpu.js";
import {
  Fn,
  If,
  Loop,
  float,
  vec2,
  vec3,
  vec4,
  uniform,
  reference,
  texture,
  cubeTexture,
  textureSize,
  viewZToPerspectiveDepth,
  getViewPosition,
  screenUV,
  rtt,
} from "../../vendor/three/build/three.tsl.js";
import { WATER_HEIGHT } from "./motion.js";

// A small, directly lit water volume beneath the aperture. Midpoint sampling
// and explicit texture LOD keep this independent of camera jitter and history.
export function createLightShafts(
  depth,
  surface,
  camera,
  optics,
  sun,
  haze,
  fogStart,
) {
  const strength = uniform(1);
  const width = uniform(4);
  const tint = uniform(new Color("#65ddeb"));
  const world = uniform(camera.matrixWorld);
  const inverseProjection = uniform(camera.projectionMatrixInverse);
  const intensity = reference("intensity", "float", sun);
  const lightColor = reference("color", "color", sun);
  const luminance = vec3(0.2126, 0.7152, 0.0722);
  const scatteredColor = tint
    .mul(lightColor.dot(luminance))
    .div(tint.dot(luminance).max(0.0001));
  const near = reference("near", "float", sun.shadow.camera);
  const far = reference("far", "float", sun.shadow.camera);
  const viewDistance = (uv) =>
    getViewPosition(uv, depth.sample(uv).r, inverseProjection).length();
  const volume = rtt(
    Fn(() => {
      const view = getViewPosition(
        screenUV,
        depth.r,
        inverseProjection,
      ).toVar();
      const origin = world.mul(vec4(0, 0, 0, 1)).xyz.toVar();
      const direction = world.mul(vec4(view.normalize(), 0)).xyz.toVar();
      const distance = view.length().toVar();
      const end = distance.toVar();
      // The globe contains water. Include its interior rather than cutting a
      // dark circular hole in the shafts at the front glass interface.
      If(surface.a.div(256).floor().equal(2), () => {
        end.assign(end.max(optics.roots(origin, direction).y));
      });
      const safe = vec3(
        direction.x.greaterThanEqual(0).select(1, -1),
        direction.y.greaterThanEqual(0).select(1, -1),
        direction.z.greaterThanEqual(0).select(1, -1),
      ).mul(direction.abs().max(0.00001));
      const low = vec3(width.mul(-4.5), 0.6, width.mul(-4.5))
        .sub(origin)
        .div(safe);
      const high = vec3(width.mul(4.5), WATER_HEIGHT, width.mul(4.5))
        .sub(origin)
        .div(safe);
      const entry = low.min(high),
        exit = low.max(high);
      const start = entry.x.max(entry.y).max(entry.z).max(0).toVar();
      const finish = exit.x.min(exit.y).min(exit.z).min(end).min(30);
      const step = finish.sub(start).max(0).div(64).toVar();
      const scattered = vec3(0).toVar();
      If(
        step
          .greaterThan(0)
          .and(strength.greaterThan(0))
          .and(haze.greaterThan(0)),
        () => {
          Loop(64, ({ i }) => {
            const travel = start.add(float(i).add(0.5).mul(step)).toVar();
            const p = origin.add(direction.mul(travel)).toVar();
            const below = float(WATER_HEIGHT).sub(p.y);
            const spread = below.mul(0.3).add(1).mul(width);
            const aperture = p.xz.sub(optics.aperture).div(spread).toVar();
            const envelope = aperture.dot(aperture).mul(-1.6).exp();
            // The existing wave photon field breaks the cone into drifting shafts.
            // A fixed mip removes fine caustic cells before volume integration.
            const pattern = texture(
              optics.waterMap.texture,
              aperture.mul(0.65).add(0.5),
            )
              .level(6)
              .rgb.dot(vec3(1 / 3))
              .sub(0.17)
              .max(0)
              .mul(5)
              .min(2.5)
              .add(0.08);
            const fromLight = p.sub(optics.lightPosition).toVar();
            const lightDistance = fromLight.length();
            const major = fromLight.abs().toVar();
            const shadowDepth = viewZToPerspectiveDepth(
              major.x.max(major.y).max(major.z).negate(),
              near,
              far,
            );
            const visibility = cubeTexture(
              sun.shadow.map.depthTexture,
              fromLight,
            ).compare(shadowDepth.sub(0.0003)).r;
            const cosine = direction.dot(fromLight.normalize().negate());
            const phase = float(1.2025).sub(cosine.mul(0.9)).pow(-1.5).mul(0.8);
            const extinction = vec3(0.08, 0.025, 0.015)
              .mul(below)
              .mul(haze)
              .negate()
              .exp();
            const cameraTransmission = travel
              .sub(fogStart)
              .max(0)
              .mul(haze)
              .mul(0.06)
              .pow2()
              .negate()
              .exp();
            const irradiance = intensity.div(
              lightDistance
                .pow2()
                .mul(4 * Math.PI)
                .max(1),
            );
            scattered.addAssign(
              extinction
                .mul(scatteredColor)
                .mul(irradiance)
                .mul(envelope)
                .mul(pattern)
                .mul(visibility)
                .mul(phase)
                .mul(cameraTransmission)
                .mul(haze)
                .mul(0.18)
                .mul(step),
            );
          });
        },
      );
      return vec4(scattered.mul(strength), distance);
    })(),
    null,
    null,
    { resolutionScale: 0.5 },
  );

  // Bilinear reconstruction with scene-depth rejection avoids washing light
  // across column edges. No blur or temporal feedback touches the silhouettes.
  const output = Fn(() => {
    const size = vec2(textureSize(volume));
    const pixel = screenUV.mul(size).sub(0.5);
    const base = pixel.floor(),
      fraction = pixel.fract();
    const distance = viewDistance(screenUV).toVar();
    const total = float(0).toVar(),
      result = vec3(0).toVar();
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 2; x++) {
        const uv = base.add(vec2(x + 0.5, y + 0.5)).div(size);
        const tap = volume.sample(uv).toVar();
        const weight = (x ? fraction.x : fraction.x.oneMinus())
          .mul(y ? fraction.y : fraction.y.oneMinus())
          .mul(tap.a.sub(distance).abs().mul(-12).exp().max(0.00001));
        result.addAssign(tap.rgb.mul(weight));
        total.addAssign(weight);
      }
    return result.div(total.max(0.00001));
  })();
  return {
    output,
    volume,
    strength,
    width,
    tint,
    dispose: () => volume.dispose(),
  };
}
