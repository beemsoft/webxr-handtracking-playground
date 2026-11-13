import { mix, positionWorld, vec3 } from "../../vendor/three/build/three.tsl.js";

// Redistribute direct sunlight through the native physical lighting model.
// The incoming light already contains distance falloff and shadow visibility;
// environmental fill and a material's own emission stay independent.
export function applyCausticLighting(
  material,
  optics,
  irradiance = optics.causticIrradiance(positionWorld),
) {
  const modulation = mix(vec3(1), irradiance, optics.strength).max(0);
  const setupLightingModel = material.setupLightingModel;
  material.setupLightingModel = function (builder) {
    const model = setupLightingModel.call(this, builder);
    const direct = model.direct;
    model.direct = function (input, builder) {
      direct.call(
        this,
        {
          ...input,
          lightColor: input.lightColor.mul(modulation),
        },
        builder,
      );
    };
    return model;
  };
}
