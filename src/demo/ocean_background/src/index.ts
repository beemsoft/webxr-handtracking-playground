import { DefaultLoadingManager, MathUtils, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import PhysicsHandler from '../../../shared/physics/cannon/PhysicsHandler';
import OceanSceneManager from '../../webgl_water_ocean/src/scene/SceneManager';

/**
 * Silent variant of the WebGL Water Ocean scene used as a decorative,
 * non-interactive page background on the Ocean Fun Department landing page.
 */
class OceanBackgroundSceneManager extends OceanSceneManager {
  protected isAudioEnabled(): boolean {
    return false;
  }

  protected isPointerSplashEnabled(): boolean {
    return false;
  }

  isDepthEnabled(): boolean {
    return false;
  }
}

const CAMERA_DEPTH = -1.8;
const ORBIT_RADIUS = 6.5;
const ORBIT_SPEED = 0.028;
const MAX_PIXEL_RATIO = 1.25;
// The scene loads its GLB models relative to the demo folder; remap them relative to the landing page.
const DEMO_ASSET_BASE = 'src/demo/webgl_water_ocean/';

function createBackgroundContainer(): HTMLElement {
  let container = document.getElementById('ocean-bg');
  if (!container) {
    container = document.createElement('div');
    container.id = 'ocean-bg';
    document.body.prepend(container);
  }
  return container;
}

function start() {
  DefaultLoadingManager.setURLModifier((url) => url.startsWith('assets/') ? DEMO_ASSET_BASE + url : url);

  const container = createBackgroundContainer();

  const renderer = new WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.08, 350);
  camera.position.set(ORBIT_RADIUS, CAMERA_DEPTH, 0);

  const sceneManager = new OceanBackgroundSceneManager();
  sceneManager.build(camera, scene, renderer, new PhysicsHandler());

  const lookTarget = new Vector3();
  let elapsed = 0;
  let lastTime = performance.now();

  const render = () => {
    const now = performance.now();
    const delta = Math.min((now - lastTime) / 1000, 0.08);
    lastTime = now;
    elapsed += delta;

    // Slow underwater orbit with a gentle swell-like bob, always looking slightly up at the sunlit surface.
    const angle = elapsed * ORBIT_SPEED;
    const bob = Math.sin(elapsed * 0.45) * 0.18;
    camera.position.set(
      Math.cos(angle) * ORBIT_RADIUS,
      CAMERA_DEPTH + bob,
      Math.sin(angle) * ORBIT_RADIUS
    );
    lookTarget.set(
      Math.cos(angle + 0.35) * 1.5,
      MathUtils.lerp(-0.9, -0.3, 0.5 + 0.5 * Math.sin(elapsed * 0.21)),
      Math.sin(angle + 0.35) * 1.5
    );
    camera.lookAt(lookTarget);

    sceneManager.update();
    renderer.render(scene, camera);
    sceneManager.postUpdate();
  };

  renderer.setAnimationLoop(render);

  // Pause rendering when the tab is hidden to save battery.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      renderer.setAnimationLoop(null);
    } else {
      lastTime = performance.now();
      renderer.setAnimationLoop(render);
    }
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  container.classList.add('is-ready');
}

try {
  start();
} catch (e) {
  // WebGL unavailable: keep the static CSS background.
  console.warn('Ocean background disabled:', e);
}
