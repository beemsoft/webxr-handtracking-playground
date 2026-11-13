import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createSettingsPanel } from "./settings.js";
import { createOptics } from "./optics.js";
import { createRoom, STONE_F0 } from "./room.js";
import { createWater, createCrystal } from "./water.js";
import { createPostProcessing } from "./post-processing.js";
import { orbHeight, surfaceContactBetween } from "./motion.js";
import { createMarineLife } from "./marine-life.js";
import { createCameraViews } from "./camera-views.js";
import { COLOR_GRADING_DEFAULTS } from "./color-grading.js";
import { FOG_DEFAULTS } from "./fog-settings.js";
import { createParticleLightField } from "./particle-light-field.js";
import { createParticles } from "./particles.js";
import { createUnderwaterEnvironment } from "./environment.js";

const INITIAL_FLOAT_TIME = 6.8;

export async function startExperiment() {
  if (!navigator.gpu)
    throw new Error("This experiment needs a browser with WebGPU.");
  const canvas = document.querySelector("canvas"),
    status = document.querySelector("#status");
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false });
  renderer._getFallback = null;
  await renderer.init();
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = COLOR_GRADING_DEFAULTS.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.transmitted = true;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const settings = {
    speed: 1,
    waves: 1,
    caustics: 1,
    dispersion: 1.6,
    ior: 1.5,
    shellThickness: 0.16,
    ...FOG_DEFAULTS,
    ...COLOR_GRADING_DEFAULTS,
    bloom: 0.28,
    lightShafts: 0.64,
    lightShaftWidth: 4,
    lightShaftColor: "#65ddeb",
    environmentIntensity: 1,
    autoOrbit: true,
    orbitSpeed: 0.18,
    resolution: 0,
    orb: true,
    crystalReflections: true,
    float: true,
    ssr: true,
    stoneReflectivity: STONE_F0,
    fish: true,
    fishGlow: 0.3,
    fishShine: 8,
    fishRelief: 1,
    algae: true,
    moss: 1,
    particles: true,
    particleBrightness: 3,
    particleOpacity: 0.4,
    particleSize: 0.012,
  };
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x012e3a);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.08, 150);
  camera.position.set(0, 2.9, 12);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 2.65, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.065;
  controls.enablePan = false;
  controls.minDistance = 4.1;
  controls.maxDistance = 14;
  controls.minPolarAngle = Math.PI * 0.34;
  controls.maxPolarAngle = Math.PI * 0.535;
  controls.rotateSpeed = 0.45;
  controls.zoomSpeed = 0.65;
  controls.update();
  const optics = createOptics();
  const room = createRoom(scene, optics);
  optics.render(renderer);
  status.textContent = "Filling the observatory…";
  const environment = createUnderwaterEnvironment(renderer);
  scene.environment = environment.texture;
  scene.environmentIntensity = settings.environmentIntensity;
  const water = createWater(scene, optics, room.sun),
    crystal = createCrystal(scene, optics, room.sun, water);
  const marine = createMarineLife(scene, optics);
  room.growMoss(marine.roots);
  marine.update(0, settings);
  room.sun.shadow.needsUpdate = true;
  crystal.reflect(renderer);
  const particleScene = new THREE.Scene();
  const post = createPostProcessing(
    renderer,
    scene,
    camera,
    particleScene,
    optics,
    room.sun,
  );
  const particleLight = createParticleLightField(
    optics,
    room,
    marine,
    environment,
    scene,
  );
  const particles = createParticles(
    particleScene,
    particleLight,
    post.particleViewZ,
    settings,
  );
  let time = 0,
    floatTime = INITIAL_FLOAT_TIME,
    paused = reducedMotion.matches,
    manual = false,
    disposed = false;
  let lastTime = null,
    dirty = true,
    photonsDirty = true,
    rippleIndex = 1,
    frameNumber = 0,
    frame = 0;
  let settle = 16;
  let shadowTime = null,
    shadowFish = null;
  let pageFogColor = null;
  const abort = new AbortController(),
    options = { signal: abort.signal };
  const cameraViews = createCameraViews(
    camera,
    controls,
    marine,
    optics,
    () => {
      post.invalidate();
      changed();
    },
  );
  function changed() {
    dirty = photonsDirty = true;
    settle = 16;
  }
  function resize() {
    const width = innerWidth,
      height = innerHeight;
    camera.aspect = width / height;
    cameraViews.resize();
    const scale =
      settings.resolution ||
      Math.min(devicePixelRatio, 1.5, Math.sqrt(1_200_000 / (width * height)));
    renderer.setPixelRatio(scale);
    renderer.setSize(width, height);
    post.invalidate();
    changed();
  }
  function sync() {
    if (pageFogColor !== settings.fogColor) {
      pageFogColor = settings.fogColor;
      document.documentElement.style.setProperty("--fog-color", pageFogColor);
      document.querySelector('meta[name="theme-color"]').content = pageFogColor;
    }
    optics.time.value = time;
    optics.amplitude.value = settings.waves;
    optics.strength.value = settings.caustics;
    optics.dispersion.value = settings.dispersion;
    optics.ior.value = settings.ior;
    optics.shellThickness.value = settings.shellThickness;
    optics.center.value.y = orbHeight(floatTime);
    crystal.mesh.position.copy(optics.center.value);
    crystal.mesh.visible = settings.orb;
    crystal.reflectionEnabled.value = settings.crystalReflections ? 1 : 0;
    room.orbVisible.value = settings.orb ? 1 : 0;
    room.mossAmount.value = settings.moss;
    renderer.toneMappingExposure = settings.exposure;
    scene.environmentIntensity = settings.environmentIntensity;
    room.stoneBounce.value = room.sun.intensity / 260;
    water.haze.value = settings.haze;
    water.openingWidth.value = settings.lightShaftWidth;
    water.openingColor.value.set(settings.lightShaftColor);
    crystal.haze.value = settings.haze;
    marine.update(time, settings);
    particles.update(time, settings);
    if (!settings.fish && cameraViews.following) setView("Observatory");
    cameraViews.update();
  }
  function render() {
    if (disposed) return;
    sync();
    if (shadowTime !== time || shadowFish !== settings.fish) {
      room.sun.shadow.needsUpdate = true;
      shadowTime = time;
      shadowFish = settings.fish;
    }
    if (photonsDirty) {
      optics.render(renderer);
      photonsDirty = false;
    }
    water.reflect(renderer, camera);
    if (settings.orb) crystal.reflect(renderer);
    if (settings.particles) particleLight.update(time, settings, renderer);
    post.render(settings);
    dirty = false;
    frameNumber++;
  }
  function pause(value = !paused) {
    paused = value;
    lastTime = null;
    settle = 16;
    dirty = true;
    const button = document.querySelector("#pause");
    button.textContent = paused ? "Play" : "Pause";
    button.setAttribute(
      "aria-label",
      paused ? "Play animation" : "Pause animation",
    );
  }
  function emitRipple(x, z, born = time, strength = 0.13) {
    optics.ripples[rippleIndex].value.set(x, z, born, strength);
    rippleIndex = (rippleIndex + 1) % 6;
    changed();
  }
  function ripple(x = 0, z = 0) {
    if (paused) pause(false);
    emitRipple(x, z);
  }
  function advance(dt) {
    if (!Number.isFinite(dt) || dt < 0)
      throw new RangeError("Time step must be finite and nonnegative.");
    if (!paused) {
      const step = dt * settings.speed;
      time += step;
      if (settings.float) {
        const contact = surfaceContactBetween(floatTime, floatTime + step);
        floatTime += step;
        if (contact !== null && settings.orb)
          emitRipple(0, 0, time - (floatTime - contact), 0.2);
      }
      dirty = photonsDirty = true;
    }
  }
  function updateViewDisplay() {
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    document.querySelector("#view").title =
      `Current view: ${cameraViews.state.view}`;
  }
  function setView(name) {
    if (name.endsWith("school")) {
      settings.fish = true;
      marine.update(time, settings);
    }
    cameraViews.select(name);
    updateViewDisplay();
  }
  function changeView() {
    cameraViews.next();
    if (cameraViews.following) {
      settings.fish = true;
      marine.update(time, settings);
      cameraViews.update();
    }
    updateViewDisplay();
  }
  function reset() {
    time = 0;
    floatTime = INITIAL_FLOAT_TIME;
    for (const r of optics.ripples) r.value.set(0, 0, -100, 0);
    optics.ripples[0].value.set(0, 0, -3.5, 0.16);
    rippleIndex = 1;
    marine.update(time, settings);
    setView("Observatory");
    changed();
  }
  function loop(now) {
    if (disposed) return;
    frame = requestAnimationFrame(loop);
    if (document.hidden || manual) {
      lastTime = null;
      return;
    }
    const dt = lastTime === null ? 0 : Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    advance(dt);
    controls.autoRotate =
      settings.autoOrbit && !paused && !cameraViews.following;
    controls.autoRotateSpeed = -settings.orbitSpeed;
    if (!cameraViews.following && controls.update(dt)) {
      dirty = true;
      settle = 16;
    }
    if (dirty || settle > 0) {
      render();
      settle = Math.max(0, settle - 1);
    }
  }
  controls.addEventListener("change", () => {
    dirty = true;
    settle = 16;
  });
  controls.addEventListener("start", () => {
    cameraViews.release();
    updateViewDisplay();
  });
  window.addEventListener("resize", resize, options);
  document.addEventListener(
    "visibilitychange",
    () => {
      lastTime = null;
      post.invalidate();
    },
    options,
  );
  document
    .querySelector("#pause")
    .addEventListener("click", () => pause(), options);
  document
    .querySelector("#view")
    .addEventListener("click", changeView, options);
  document
    .querySelector("#ripple")
    .addEventListener("click", () => ripple(), options);
  function toggleFloat() {
    settings.float = !settings.float;
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    changed();
  }
  canvas.addEventListener(
    "dblclick",
    (event) => {
      const p = new THREE.Vector3(
        (event.clientX / innerWidth) * 2 - 1,
        1 - (event.clientY / innerHeight) * 2,
        0.5,
      ).unproject(camera);
      const direction = p.sub(camera.position).normalize();
      const t =
        Math.abs(direction.y) > 0.12
          ? (3.15 - camera.position.y) / direction.y
          : 5;
      p.copy(camera.position).addScaledVector(
        direction,
        THREE.MathUtils.clamp(t, 0, 12),
      );
      ripple(
        THREE.MathUtils.clamp(p.x, -7, 7),
        THREE.MathUtils.clamp(p.z, -7, 7),
      );
    },
    options,
  );
  window.addEventListener(
    "keydown",
    (event) => {
      if (/INPUT|SELECT|TEXTAREA|BUTTON/.test(document.activeElement?.tagName))
        return;
      if (event.code === "Space") {
        event.preventDefault();
        pause();
      }
      if (event.code === "KeyR") ripple();
      if (event.code === "KeyF") toggleFloat();
      if (event.code === "ArrowRight") changeView();
      if (event.code === "KeyH") {
        const hide = !document.querySelector("header").hidden;
        for (const el of document.querySelectorAll(
          "header,footer,.lil-gui.root",
        ))
          el.hidden = hide;
      }
    },
    options,
  );
  const gui = createSettingsPanel({
    settings,
    cameraViews,
    post,
    resize,
    reset,
    ripple,
    setView,
    changed,
  });
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    abort.abort();
    controls.dispose();
    gui.destroy();
    post.dispose();
    particles.dispose();
    particleLight.dispose();
    marine.dispose();
    crystal.dispose();
    water.dispose();
    room.dispose();
    optics.dispose();
    environment.dispose();
    renderer.dispose();
    delete window.caustic;
  }
  window.caustic = {
    renderer,
    scene,
    environment,
    camera,
    controls,
    settings,
    gui,
    optics,
    room,
    water,
    crystal,
    marine,
    post,
    particles,
    particleLight,
    particleScene,
    pause,
    ripple,
    changeView,
    setView,
    cameraViews,
    reset,
    advance,
    render,
    resize,
    changed,
    dispose,
    get manual() {
      return manual;
    },
    set manual(value) {
      manual = Boolean(value);
      lastTime = null;
    },
    inspect: () => ({
      renderer: "WebGPURenderer",
      revision: THREE.REVISION,
      time,
      floatTime,
      orbHeight: orbHeight(floatTime),
      paused,
      frame: frameNumber,
      view: cameraViews.index,
      viewName: cameraViews.state.view,
      followingFish: cameraViews.following,
      camera: camera.position.toArray(),
      resolution: renderer.getDrawingBufferSize(new THREE.Vector2()).toArray(),
    }),
  };
  optics.ripples[0].value.set(0, 0, -3.5, 0.16);
  pause(paused);
  resize();
  cameraViews.reset();
  sync();
  status.textContent = "Refracting the first rays…";
  // Precompile the actual deferred scene pass, including its attachment names.
  await post.scenePass.compileAsync(renderer);
  render();
  await renderer.backend.device.queue.onSubmittedWorkDone();
  status.hidden = true;
  frame = requestAnimationFrame(loop);
}
