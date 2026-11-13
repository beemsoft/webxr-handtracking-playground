import { Vector3 } from "../../vendor/three/build/three.webgpu.js";
import {
  Fn,
  uniform,
  vec3,
  vec4,
  mix,
  screenUV,
  renderOutput,
} from "../../vendor/three/build/three.tsl.js";

export const COLOR_GRADING_DEFAULTS = {
  exposure: 1.5,
  temperature: 0.25,
  tint: 0,
  saturation: 1.15,
  contrast: 1.5,
  shadows: 0,
  highlights: 0,
  vignette: 1,
};

// Grading lives in the existing final composite, outside temporal history.
// White balance acts on HDR light; tonal controls act after tone mapping.
export function createColorGrading(renderer) {
  const balance = uniform(new Vector3(1, 1, 1));
  const saturation = uniform(COLOR_GRADING_DEFAULTS.saturation),
    contrast = uniform(COLOR_GRADING_DEFAULTS.contrast);
  const shadows = uniform(0),
    highlights = uniform(0),
    vignette = uniform(COLOR_GRADING_DEFAULTS.vignette);
  const luma = vec3(0.2126, 0.7152, 0.0722);
  return {
    apply(input) {
      const mapped = renderOutput(
        vec4(input.mul(balance), 1),
        renderer.toneMapping,
        renderer.outputColorSpace,
      );
      return Fn(() => {
        const rgb = mapped.rgb.toVar();
        const brightness = rgb.dot(luma).clamp();
        rgb.addAssign(
          rgb
            .oneMinus()
            .mul(brightness.smoothstep(0, 0.6).oneMinus())
            .mul(shadows),
        );
        rgb.mulAssign(brightness.smoothstep(0.4, 1).mul(highlights).add(1));
        rgb.assign(mix(vec3(rgb.dot(luma)), rgb, saturation));
        rgb.assign(rgb.sub(0.5).mul(contrast).add(0.5));
        return vec4(
          rgb
            .mul(screenUV.sub(0.5).length().pow2().mul(vignette).oneMinus())
            .clamp(),
          1,
        );
      })();
    },
    update(settings) {
      const red = 2 ** (settings.temperature * 0.35 + settings.tint * 0.125);
      const green = 2 ** (-settings.tint * 0.25);
      const blue = 2 ** (-settings.temperature * 0.35 + settings.tint * 0.125);
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      balance.value.set(red, green, blue).divideScalar(luminance);
      saturation.value = settings.saturation;
      contrast.value = settings.contrast;
      shadows.value = settings.shadows;
      highlights.value = settings.highlights;
      vignette.value = settings.vignette;
    },
  };
}
