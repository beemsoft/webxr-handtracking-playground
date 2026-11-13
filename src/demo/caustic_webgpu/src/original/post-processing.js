import * as THREE from "../../vendor/three/build/three.webgpu.js";
import { STONE_F0 } from "./room.js";
import {
  waterReflection,
  waterFresnel,
  waterViewNormal,
  crystalReflection,
  crystalFresnel,
  crystalViewNormal,
  WATER_ABSORPTION,
  WATER_SCATTER,
  GLASS_WATER_ABSORPTION,
  GLASS_WATER_SCATTER,
} from "./water.js";
import { createColorGrading } from "./color-grading.js";
import { FOG_DEFAULTS } from "./fog-settings.js";
import { createLightShafts } from "./light-shafts.js";
import {
  Fn,
  If,
  float,
  vec2,
  vec3,
  vec4,
  uniform,
  pass,
  mrt,
  output,
  normalView,
  diffuseColor,
  velocity,
  rtt,
  mix,
  screenUV,
  getViewPosition,
  property,
  roughness,
  metalness,
  specularF90,
  sample,
  perspectiveDepthToViewZ,
  reference,
} from "../../vendor/three/build/three.tsl.js";
import { temporalDenoise } from "../../vendor/three/examples/jsm/tsl/display/DenoiseNode.js";
import { smaa } from "../../vendor/three/examples/jsm/tsl/display/SMAANode.js";
import { bloom } from "../../vendor/three/examples/jsm/tsl/display/BloomNode.js";
import { ssr } from "../../vendor/three/examples/jsm/tsl/display/SSRNode.js";
import { ENV_RAY_LENGTH_THRESHOLD } from "../../vendor/three/examples/jsm/tsl/utils/SpecularHelpers.js";

export function createPostProcessing(
  renderer,
  scene,
  camera,
  particleScene,
  optics,
  sun,
) {
  const grading = createColorGrading(renderer);
  const encodeNormal = Fn(([normal]) => {
    const n = normal.div(normal.abs().dot(vec3(1))).toVar();
    const xy = n.xy.toVar();
    If(n.z.lessThan(0), () => {
      xy.assign(
        n.yx
          .abs()
          .oneMinus()
          .mul(
            vec2(
              n.x.greaterThanEqual(0).select(1, -1),
              n.y.greaterThanEqual(0).select(1, -1),
            ),
          ),
      );
    });
    return xy;
  });
  const decodeNormal = Fn(([packed]) => {
    const n = vec3(
      packed,
      packed.x.abs().add(packed.y.abs()).oneMinus(),
    ).toVar();
    const t = n.z.negate().clamp();
    n.x.addAssign(n.x.greaterThanEqual(0).select(t.negate(), t));
    n.y.addAssign(n.y.greaterThanEqual(0).select(t.negate(), t));
    return n.normalize();
  });
  const scenePass = pass(scene, camera, { samples: 0 });
  // Stone keeps its rough PMREM finish. Fish export the native single-scatter
  // response so SSR replaces that lobe without adding a second reflection.
  const environmentSpecular = property("vec3", "causticEnvironmentSpecular");
  const specularResponse = property("vec3", "causticSpecularResponse");
  const setups = new Map();
  scene.traverse((object) => {
    for (const material of object.material ? [object.material].flat() : []) {
      if (setups.has(material) || !material.isMeshStandardNodeMaterial)
        continue;
      const setup = material.setupLightingModel;
      setups.set(material, setup);
      material.setupLightingModel = function (builder) {
        const model = setup.call(this, builder),
          finish = model.finish;
        model.finish = function (b) {
          finish.call(this, b);
          if (material.userData.screenReflection) {
            // Reuse Three's DFG and iridescent metallic/dielectric Fresnel.
            const metallic = vec3(0).toVar(),
              multiple = vec3(0).toVar();
            this.computeMultiscattering(
              metallic,
              multiple,
              specularF90,
              diffuseColor.rgb,
              this.iridescenceF0Metallic,
            );
            specularResponse.assign(
              mix(this.singleScatteringDielectric, metallic, metalness),
            );
            environmentSpecular.assign(
              b.context.radiance.mul(specularResponse),
            );
          } else {
            environmentSpecular.assign(
              material.userData.polishedStone
                ? b.context.radiance
                : b.context.reflectedLight.indirectSpecular,
            );
          }
        };
        return model;
      };
    }
  });
  const surfaceKind = uniform(0).onObjectUpdate(({ object, material }) =>
    material.userData.polishedStone ? 4 : object.userData.opticalSurface || 0,
  );
  scenePass.setMRT(
    mrt({
      output,
      normal: encodeNormal(
        surfaceKind
          .equal(1)
          .select(
            waterViewNormal,
            surfaceKind.equal(2).select(crystalViewNormal, normalView),
          ),
      ),
      diffuse: vec4(
        // Store the fish BRDF response with surface metadata, keeping the
        // existing attachment count and bandwidth.
        surfaceKind.equal(5).select(specularResponse, diffuseColor.rgb),
        surfaceKind
          .mul(256)
          .add(
            surfaceKind
              .equal(1)
              .select(
                waterFresnel,
                surfaceKind.equal(2).select(crystalFresnel, roughness),
              )
              .mul(255)
              .round(),
          ),
      ),
      velocity,
      environment: vec4(
        surfaceKind
          .equal(1)
          .select(
            waterReflection,
            surfaceKind.equal(2).select(crystalReflection, environmentSpecular),
          ),
        1,
      ),
    }),
  );
  scenePass.getTexture("normal").type = THREE.HalfFloatType;
  scenePass.getTexture("normal").format = THREE.RGFormat;
  scenePass.getTexture("velocity").format = THREE.RGFormat;
  scenePass.getTexture("environment").format = THREE.RGBFormat;
  scenePass.getTexture("environment").type = THREE.UnsignedInt101111Type;
  scenePass.getTexture("diffuse").minFilter = THREE.NearestFilter;
  scenePass.getTexture("diffuse").magFilter = THREE.NearestFilter;
  const beauty = scenePass.getTextureNode("output"),
    depth = scenePass.getTextureNode("depth");
  const particlePass = pass(particleScene, camera, { depthBuffer: false });
  const particleViewZ = perspectiveDepthToViewZ(
    depth.sample(screenUV).r,
    reference("near", "float", camera),
    reference("far", "float", camera),
  );
  const packedNormals = scenePass.getTextureNode("normal"),
    surface = scenePass.getTextureNode("diffuse");
  const normals = sample((uv) => decodeNormal(packedNormals.sample(uv).rg));
  const albedo = sample((uv) => {
    const s = surface.sample(uv);
    return vec4(s.rgb, s.a.div(256).floor());
  });
  const environment = scenePass.getTextureNode("environment");
  const haze = uniform(FOG_DEFAULTS.haze);
  const fogColor = uniform(new THREE.Color(FOG_DEFAULTS.fogColor));
  const fogStart = uniform(FOG_DEFAULTS.fogStart);
  const shafts = createLightShafts(
    depth,
    surface,
    camera,
    optics,
    sun,
    haze,
    fogStart,
  );
  const stoneReflectivity = uniform(STONE_F0);
  const isWater = albedo.a.equal(1);
  const isCrystal = albedo.a.equal(2);
  const isFish = albedo.a.equal(5);
  const dielectric = isWater.or(isCrystal);
  const reflective = dielectric.or(isFish);
  const reflectionRoughness = sample((uv) => {
    const s = surface.sample(uv);
    const kind = s.a.div(256).floor();
    return kind
      .equal(1)
      .select(0.015, kind.equal(2).select(0.01, s.a.mod(256).div(255)));
  });
  const reflections = ssr(beauty, depth, normals, {
    camera,
    stochastic: true,
    metalnessNode: float(0),
    // Trace incident radiance. Each finish applies Fresnel exactly once.
    specularNode: vec3(1),
    roughnessNode: Fn(() => {
      reflective.not().discard();
      return reflectionRoughness;
    })(),
    diffuseNode: albedo,
    binaryRefine: true,
  });
  reflections.resolutionScale = 0.5;
  reflections.quality.value = 0.85;
  reflections.maxDistance.value = 18;
  // Retain nearby scene hits without treating thin fish as thick volumes.
  reflections.thickness.value = 0.08;
  reflections.mirrorBias.value = 0.25;
  reflections.screenEdgeFadeBlack = true;
  reflections.screenEdgeFade.value = 0.12;
  const reflectionTexture = reflections.getTextureNode();
  const hit = reflectionTexture.a
    .greaterThan(0)
    .and(reflectionTexture.a.lessThan(ENV_RAY_LENGTH_THRESHOLD))
    .select(1, 0);
  const waterTransmission = vec3(...WATER_ABSORPTION)
    .mul(reflectionTexture.a.min(25))
    .mul(haze)
    .negate()
    .exp();
  const waterHit = reflectionTexture.rgb
    .mul(waterTransmission)
    .add(vec3(...WATER_SCATTER).mul(waterTransmission.oneMinus()))
    .mul(surface.a.mod(256).div(255));
  const glassTransmission = vec3(...GLASS_WATER_ABSORPTION)
    .mul(reflectionTexture.a.min(12))
    .mul(haze)
    .negate()
    .exp();
  const glassHit = reflectionTexture.rgb
    .mul(glassTransmission)
    .add(vec3(...GLASS_WATER_SCATTER).mul(glassTransmission.oneMinus()))
    .mul(surface.a.mod(256).div(255));
  const reflectionInput = rtt(
    vec4(
      isWater
        .select(waterHit, isCrystal.select(glassHit, reflectionTexture.rgb))
        .mul(hit),
      hit,
    ),
    null,
    null,
    { resolutionScale: 0.5 },
  );
  const motion = scenePass.getTextureNode("velocity");
  const filteredReflections = temporalDenoise(reflectionInput, {
    depth,
    normal: normals,
    camera,
    velocity: motion,
    coverage: true,
    quality: "fast",
    // Give subpixel water ripples a reconstruction footprint, while keeping
    // the traced rays optically sharp. Otherwise the mirror lobe rejects
    // virtually every neighboring sample and leaves visible hit/miss noise.
    roughness: sample((uv) => {
      const s = surface.sample(uv);
      const kind = s.a.div(256).floor();
      return kind
        .equal(1)
        .select(0.4, kind.equal(2).select(0.18, s.a.mod(256).div(255)));
    }),
    // A stable 3 m water guide lets hit and miss samples share a footprint.
    // Using the miss sentinel here isolated holes from neighboring valid rays.
    // Reflection extinction above still uses each ray's actual travel distance.
    hitDistance: sample((uv) =>
      surface
        .sample(uv)
        .a.div(256)
        .floor()
        .equal(1)
        .select(3, reflectionTexture.sample(uv).a),
    ),
  });
  filteredReflections.maxFrames.value = 6;
  const reflectionResult = filteredReflections.getTextureNode();
  const inverseProjection = uniform(camera.projectionMatrixInverse);
  function createBranch(reflecting) {
    const combined = rtt(
      Fn(() => {
        const color = beauty.rgb.toVar();
        const view = getViewPosition(screenUV, depth.r, inverseProjection);
        const surfaceNormal = normals.toVar("compositeNormal");
        const ndotv = surfaceNormal.dot(view.negate().normalize()).clamp();
        const finish = ndotv
          .oneMinus()
          .pow(5)
          .mul(stoneReflectivity.oneMinus())
          .add(stoneReflectivity);
        const polish = surface.a
          .mod(256)
          .div(255)
          .smoothstep(0.35, 0.85)
          .oneMinus();
        const stoneWeight = albedo.a.equal(4).select(finish.mul(polish), 0);
        // A reflection must replace diffuse energy, including caustic light.
        // Adding it to an already bright substrate hid dark reflected objects.
        color.assign(mix(color, environment.rgb, stoneWeight));
        if (reflecting) {
          // A half-resolution ray cannot resolve rapidly changing water
          // normals. Prefer the stable planar capture for those footprints.
          // Evaluate derivatives for every lane before selecting water pixels.
          // TSL select() can lower to a nonuniform branch; derivatives inside
          // that branch produced NaNs which bloom spread across the frame.
          const waterConfidence = surfaceNormal
            .dFdx()
            .length()
            .add(surfaceNormal.dFdy().length())
            .mul(-20)
            .exp()
            .toVar("waterReflectionConfidence");
          const coverage = reflectionResult.a
            .mul(reflective.select(1, 0))
            .mul(isWater.select(waterConfidence, 1));
          const reflected = reflectionResult.rgb.mul(
            isFish.select(surface.rgb, vec3(1)),
          );
          color.assign(
            color
              .sub(environment.rgb.mul(coverage))
              .max(0)
              .add(reflected.mul(coverage)),
          );
        }
        const distance = view.length();
        const absorb = vec3(0.018, 0.008, 0.004)
          .mul(distance)
          .mul(haze)
          .negate()
          .exp();
        // Radial distance keeps equal-length sightlines equally foggy, even at
        // the sides of a wide view. Exponential-squared falloff hides distant
        // architecture without a volume texture, ray march or temporal history.
        const transmission = distance
          .sub(fogStart)
          .max(0)
          .mul(haze)
          .mul(0.06)
          .pow(2)
          .negate()
          .exp();
        color.assign(mix(fogColor, color.mul(absorb), transmission));
        color.addAssign(shafts.output);
        // Motelike scatter has already been attenuated at each particle's
        // distance and tested against scene depth. Composite after SSR so
        // transparent grains never replace the underlying surface buffers.
        color.addAssign(particlePass.getTextureNode().rgb);
        return vec4(color, 1);
      })(),
    );
    // Keep silhouettes fixed on the pixel grid. Temporal camera jitter made
    // column edges alternate between geometry and the bright fog behind them.
    // SSR retains its motion-aware SVGF history.
    const antialias = smaa(combined);
    const glow = bloom(antialias, 0.18, 0.35, 1.2);
    const outputNode = grading.apply(antialias.rgb.add(glow.rgb));
    return { combined, antialias, glow, outputNode };
  }
  const branches = new Map();
  const pipeline = new THREE.RenderPipeline(renderer);
  let active = null;
  pipeline.outputColorTransform = false;
  return {
    pipeline,
    scenePass,
    particlePass,
    particleViewZ,
    shafts,
    reflections,
    filteredReflections,
    get combined() {
      return active?.combined;
    },
    render(settings) {
      grading.update(settings);
      const key = settings.ssr;
      if (!branches.has(key)) branches.set(key, createBranch(key));
      const next = branches.get(key);
      if (next !== active) {
        active = next;
        filteredReflections.reset();
        pipeline.outputNode = active.outputNode;
        pipeline.needsUpdate = true;
      }
      haze.value = settings.haze;
      fogColor.value.set(settings.fogColor);
      fogStart.value = settings.fogStart;
      shafts.strength.value = settings.lightShafts;
      shafts.width.value = settings.lightShaftWidth;
      shafts.tint.value.set(settings.lightShaftColor);
      stoneReflectivity.value = settings.stoneReflectivity;
      active.glow.strength.value = settings.bloom;
      pipeline.render();
    },
    invalidate() {
      filteredReflections.reset();
    },
    dispose() {
      shafts.dispose();
      for (const n of [
        scenePass,
        particlePass,
        reflections,
        reflectionInput,
        filteredReflections,
        pipeline,
      ])
        n.dispose();
      for (const [material, setup] of setups)
        material.setupLightingModel = setup;
      for (const branch of branches.values())
        for (const n of [branch.combined, branch.antialias, branch.glow])
          n.dispose();
    },
  };
}
