import GUI from "../../vendor/three/examples/jsm/libs/lil-gui.module.min.js";
import { COLOR_GRADING_DEFAULTS } from "./color-grading.js";
import { FOG_DEFAULTS } from "./fog-settings.js";

export function createSettingsPanel({
  settings,
  cameraViews,
  post,
  resize,
  reset,
  ripple,
  setView,
  changed,
}) {
  const gui = new GUI({ title: "Settings", width: 240 });
  const w = gui.addFolder("Water & light");
  w.add(settings, "waves", 0, 2, 0.01).name("Wave height");
  w.add(settings, "speed", 0.1, 2, 0.05).name("Speed");
  w.add(settings, "caustics", 0, 2, 0.01).name("Caustic light");
  w.add(settings, "environmentIntensity", 0, 3, 0.05)
    .name("Environment light")
    .onChange(() => post.invalidate());
  w.add({ ripple: () => ripple() }, "ripple").name("Send a ripple");
  const g = gui.addFolder("Crystal");
  g.add(settings, "orb").name("Visible");
  g.add(settings, "float").name("Float to the surface");
  g.add(settings, "crystalReflections").name("Reflections");
  g.add(settings, "ior", 1.1, 1.8, 0.01).name("Refraction");
  g.add(settings, "shellThickness", 0.04, 1.85, 0.01).name("Glass thickness");
  g.add(settings, "dispersion", 0, 2, 0.01).name("Dispersion");
  const a = gui.addFolder("Atmosphere");
  a.add(settings, "bloom", 0, 0.6, 0.01).name("Bloom");
  a.add(settings, "lightShafts", 0, 3, 0.05).name("Light shafts");
  a.add(settings, "lightShaftWidth", 1, 6, 0.1).name("Shaft width");
  a.addColor(settings, "lightShaftColor").name("Shaft color");
  a.add(settings, "ssr").name("SSR");
  a.add(settings, "stoneReflectivity", 0, 0.8, 0.01).name("Stone reflectivity");
  a.close();
  const fog = gui.addFolder("Fog");
  fog.add(settings, "haze", 0, 4, 0.01).name("Density");
  fog.addColor(settings, "fogColor").name("Color");
  fog.add(settings, "fogStart", 0, 15, 0.1).name("Start distance");
  fog
    .add(
      {
        reset() {
          Object.assign(settings, FOG_DEFAULTS);
          fog
            .controllersRecursive()
            .forEach((controller) => controller.updateDisplay());
          post.invalidate();
          changed();
        },
      },
      "reset",
    )
    .name("Reset fog");
  fog.onChange(() => post.invalidate());
  fog.close();
  const grading = gui.addFolder("Color grading");
  grading.add(settings, "exposure", 0.3, 2, 0.01).name("Exposure");
  grading.add(settings, "temperature", -1, 1, 0.01).name("Temperature");
  grading.add(settings, "tint", -1, 1, 0.01).name("Tint");
  grading.add(settings, "saturation", 0, 2, 0.01).name("Saturation");
  grading.add(settings, "contrast", 0.5, 1.5, 0.01).name("Contrast");
  grading.add(settings, "shadows", -0.25, 0.25, 0.01).name("Shadows");
  grading.add(settings, "highlights", -0.5, 0.5, 0.01).name("Highlights");
  grading.add(settings, "vignette", 0, 1, 0.01).name("Vignette");
  grading
    .add(
      {
        reset() {
          Object.assign(settings, COLOR_GRADING_DEFAULTS);
          gui.controllersRecursive().forEach((c) => c.updateDisplay());
          changed();
        },
      },
      "reset",
    )
    .name("Reset color grading");
  grading.close();
  const life = gui.addFolder("Marine life");
  life.add(settings, "fish").name("Schools of fish");
  life.add(settings, "fishGlow", 0, 8, 0.05).name("Fish glow");
  life.add(settings, "fishShine", 1, 10, 0.1).name("Scale shine");
  life.add(settings, "fishRelief", 0, 3, 0.05).name("Scale relief");
  life.add(settings, "algae").name("Algae");
  life.add(settings, "moss", 0, 1.5, 0.01).name("Moss growth");
  life.close();
  const motes = gui.addFolder("Particles");
  motes.add(settings, "particles").name("Suspended particles");
  motes.add(settings, "particleBrightness", 0, 12, 0.1).name("Brightness");
  motes.add(settings, "particleOpacity", 0, 1, 0.01).name("Opacity");
  motes.add(settings, "particleSize", 0.003, 0.025, 0.001).name("Grain size");
  motes.close();
  const c = gui.addFolder("Camera");
  c.add(cameraViews.state, "view", cameraViews.names)
    .name("View")
    .onChange(setView);
  c.add(settings, "autoOrbit").name("Auto orbit");
  c.add(settings, "orbitSpeed", 0.05, 0.6, 0.01).name("Orbit speed");
  c.add(settings, "resolution", { Auto: 0, "1×": 1, "1.5×": 1.5, "2×": 2 })
    .name("Resolution")
    .onChange(resize);
  c.add({ reset }, "reset").name("Reset view & water");
  c.close();
  gui.onChange(changed);
  gui.close();
  return gui;
}
