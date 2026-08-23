import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RingGeometry,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer
} from 'three';
import { WaterSimulation } from './WaterSimulation';

export const SIMULATION_RADIUS = 10.0; // 20m x 20m simulation domain [-10, 10]

interface ParticleData {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  causedSecondary: boolean;
}

interface FoamRing {
  mesh: Mesh<RingGeometry, MeshBasicMaterial>;
  active: boolean;
  age: number;
  maxAge: number;
  initialScale: number;
  maxScale: number;
}

function createDropletTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 64, 64);

    // Outer soft glow
    const outerGrad = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
    outerGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    outerGrad.addColorStop(0.35, 'rgba(180, 240, 255, 0.85)');
    outerGrad.addColorStop(0.7, 'rgba(120, 215, 245, 0.4)');
    outerGrad.addColorStop(1, 'rgba(80, 190, 230, 0)');
    ctx.fillStyle = outerGrad;
    ctx.beginPath();
    ctx.arc(32, 32, 30, 0, Math.PI * 2);
    ctx.fill();

    // Sharp specular glint at upper left
    const glintGrad = ctx.createRadialGradient(24, 24, 0, 24, 24, 10);
    glintGrad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    glintGrad.addColorStop(0.6, 'rgba(255, 255, 255, 0.8)');
    glintGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = glintGrad;
    ctx.beginPath();
    ctx.arc(24, 24, 10, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

function createFoamTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 128, 128);
    const grad = ctx.createRadialGradient(64, 64, 40, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
    grad.addColorStop(0.5, 'rgba(230, 250, 255, 0.85)');
    grad.addColorStop(0.85, 'rgba(190, 240, 250, 0.5)');
    grad.addColorStop(1, 'rgba(160, 220, 240, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(64, 64, 62, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export class SplashEffect {
  private maxParticles = 600;
  private particles: ParticleData[] = [];
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private particleGeometry: BufferGeometry;
  private particleMesh: Points;
  private foamRings: FoamRing[] = [];
  private foamTexture: CanvasTexture;
  private dropletTexture: CanvasTexture;

  constructor(scene: Scene) {
    this.dropletTexture = createDropletTexture();
    this.foamTexture = createFoamTexture();

    this.positions = new Float32Array(this.maxParticles * 3);
    this.colors = new Float32Array(this.maxParticles * 3);
    this.sizes = new Float32Array(this.maxParticles);

    for (let i = 0; i < this.maxParticles; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: -100,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        size: 0.08,
        causedSecondary: false,
      });
      this.positions[i * 3 + 1] = -100;
      this.colors[i * 3] = 0.85;
      this.colors[i * 3 + 1] = 0.96;
      this.colors[i * 3 + 2] = 1.0;
      this.sizes[i] = 0.0;
    }

    this.particleGeometry = new BufferGeometry();
    this.particleGeometry.setAttribute('position', new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage));
    this.particleGeometry.setAttribute('color', new BufferAttribute(this.colors, 3).setUsage(DynamicDrawUsage));

    const particleMaterial = new PointsMaterial({
      size: 0.12,
      map: this.dropletTexture,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      vertexColors: true,
      sizeAttenuation: true,
    });

    this.particleMesh = new Points(this.particleGeometry, particleMaterial);
    this.particleMesh.frustumCulled = false;
    this.particleMesh.renderOrder = 20;
    scene.add(this.particleMesh);

    // Create a pool of foam rings
    const ringGeo = new RingGeometry(0.05, 0.35, 32);
    ringGeo.rotateX(-Math.PI / 2);

    for (let i = 0; i < 8; i++) {
      const ringMat = new MeshBasicMaterial({
        map: this.foamTexture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
        color: new Color(0xd8f5ff),
      });
      const ringMesh = new Mesh(ringGeo, ringMat);
      ringMesh.position.set(0, -50, 0);
      ringMesh.visible = false;
      ringMesh.renderOrder = 15;
      scene.add(ringMesh);

      this.foamRings.push({
        mesh: ringMesh,
        active: false,
        age: 0,
        maxAge: 0.6,
        initialScale: 0.4,
        maxScale: 1.8,
      });
    }
  }

  /**
   * Simulates a real splash made by smashing a hand into surface water.
   * Generates violent multi-point hydrodynamic shockwaves in GPU simulation,
   * realistic airborne spray droplets, and a surface foam ring.
   */
  triggerHandSmash(
    renderer: WebGLRenderer,
    worldX: number,
    worldZ: number,
    intensity: number = 1.0,
    waterSim: WaterSimulation
  ) {
    const clampedIntensity = MathUtils.clamp(intensity, 0.4, 2.5);

    // Map world position to [-1, 1] normalized simulation coordinates
    const simX = MathUtils.clamp(worldX / SIMULATION_RADIUS, -0.96, 0.96);
    const simZ = MathUtils.clamp(worldZ / SIMULATION_RADIUS, -0.96, 0.96);

    // 1. Central Palm Impact: Strong depression crater
    const centralRadius = 0.010 * MathUtils.lerp(0.8, 1.3, clampedIntensity);
    const centralStrength = -0.075 * clampedIntensity;
    waterSim.addDrop(renderer, simX, simZ, centralRadius, centralStrength);

    // 2. Surrounding Finger/Hand Smash Rim Splashes (multi-cluster shockwaves)
    const numFingers = 6 + Math.floor(Math.random() * 3);
    for (let i = 0; i < numFingers; i++) {
      const angle = (i / numFingers) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const dist = MathUtils.randFloat(0.12, 0.32) * (clampedIntensity * 0.5 + 0.5);
      const offsetX = (Math.cos(angle) * dist) / SIMULATION_RADIUS;
      const offsetZ = (Math.sin(angle) * dist) / SIMULATION_RADIUS;

      const fX = MathUtils.clamp(simX + offsetX, -0.98, 0.98);
      const fZ = MathUtils.clamp(simZ + offsetZ, -0.98, 0.98);
      const fRadius = MathUtils.randFloat(0.005, 0.0085);
      const fStrength = MathUtils.randFloat(0.04, 0.07) * clampedIntensity;

      waterSim.addDrop(renderer, fX, fZ, fRadius, fStrength);
    }

    // 3. Expanding capillary wave shock pulse
    waterSim.addDrop(renderer, simX, simZ, centralRadius * 1.8, 0.045 * clampedIntensity);

    // 4. Spawn airborne 3D water spray droplets bursting from the impact
    const dropletCount = Math.floor(MathUtils.randFloat(35, 60) * clampedIntensity);
    this.spawnSprayDroplets(worldX, worldZ, dropletCount, clampedIntensity);

    // 5. Spawn expanding surface foam ring
    this.spawnFoamRing(worldX, worldZ, clampedIntensity);
  }

  /**
   * Gentle fluid drag ripple with subtle micro-droplets
   */
  triggerGentleRipple(
    renderer: WebGLRenderer,
    worldX: number,
    worldZ: number,
    waterSim: WaterSimulation,
    strength = 0.025
  ) {
    const simX = MathUtils.clamp(worldX / SIMULATION_RADIUS, -0.96, 0.96);
    const simZ = MathUtils.clamp(worldZ / SIMULATION_RADIUS, -0.96, 0.96);

    waterSim.addDrop(renderer, simX, simZ, 0.0075, strength);

    if (Math.random() < 0.35) {
      this.spawnSprayDroplets(worldX, worldZ, 3, 0.5);
    }
  }

  private spawnSprayDroplets(originX: number, originZ: number, count: number, intensity: number) {
    let spawned = 0;
    for (let i = 0; i < this.maxParticles && spawned < count; i++) {
      const p = this.particles[i];
      if (!p.active) {
        p.active = true;
        // Jitter origin slightly around hand palm
        const jitterR = Math.random() * 0.15;
        const jitterTheta = Math.random() * Math.PI * 2;
        p.x = originX + Math.cos(jitterTheta) * jitterR;
        p.y = 0.02 + Math.random() * 0.04;
        p.z = originZ + Math.sin(jitterTheta) * jitterR;

        // Upward and radial explosive spray velocities
        const sprayAngle = Math.random() * Math.PI * 2;
        const radialSpeed = MathUtils.randFloat(0.6, 2.2) * (0.6 + 0.4 * intensity);
        p.vx = Math.cos(sprayAngle) * radialSpeed + (Math.random() - 0.5) * 0.3;
        p.vy = MathUtils.randFloat(1.4, 3.4) * (0.6 + 0.4 * intensity);
        p.vz = Math.sin(sprayAngle) * radialSpeed + (Math.random() - 0.5) * 0.3;

        p.life = 0;
        p.maxLife = MathUtils.randFloat(0.35, 0.75);
        p.size = MathUtils.randFloat(0.08, 0.16) * intensity;
        p.causedSecondary = false;

        spawned++;
      }
    }
  }

  private spawnFoamRing(worldX: number, worldZ: number, intensity: number) {
    for (let i = 0; i < this.foamRings.length; i++) {
      const ring = this.foamRings[i];
      if (!ring.active) {
        ring.active = true;
        ring.age = 0;
        ring.maxAge = MathUtils.randFloat(0.45, 0.75);
        ring.initialScale = 0.35 * intensity;
        ring.maxScale = 1.4 * intensity;
        ring.mesh.position.set(worldX, 0.006, worldZ);
        ring.mesh.scale.set(ring.initialScale, ring.initialScale, ring.initialScale);
        ring.mesh.material.opacity = 0.85;
        ring.mesh.visible = true;
        break;
      }
    }
  }

  update(delta: number, renderer?: WebGLRenderer, waterSim?: WaterSimulation) {
    const gravity = -9.8;
    const drag = 0.985;
    let activeCount = 0;

    const posAttr = this.particleGeometry.attributes.position as BufferAttribute;
    const colAttr = this.particleGeometry.attributes.color as BufferAttribute;

    for (let i = 0; i < this.maxParticles; i++) {
      const p = this.particles[i];
      if (p.active) {
        activeCount++;
        p.life += delta;
        const progress = p.life / p.maxLife;

        if (progress >= 1.0) {
          p.active = false;
          this.positions[i * 3 + 1] = -100;
          this.colors[i * 3] = 0;
          this.colors[i * 3 + 1] = 0;
          this.colors[i * 3 + 2] = 0;
          continue;
        }

        // Apply physics
        p.vy += gravity * delta;
        p.vx *= drag;
        p.vz *= drag;

        p.x += p.vx * delta;
        p.y += p.vy * delta;
        p.z += p.vz * delta;

        // Droplet re-entering water surface creates micro secondary ripple
        if (p.y <= 0.0 && !p.causedSecondary) {
          p.causedSecondary = true;
          if (renderer && waterSim && Math.abs(p.x) < SIMULATION_RADIUS && Math.abs(p.z) < SIMULATION_RADIUS) {
            const simX = p.x / SIMULATION_RADIUS;
            const simZ = p.z / SIMULATION_RADIUS;
            waterSim.addDrop(renderer, simX, simZ, 0.004, 0.015);
          }
          // Prematurely dampen or fade out upon hitting water
          p.life = Math.max(p.life, p.maxLife * 0.8);
        }

        this.positions[i * 3] = p.x;
        this.positions[i * 3 + 1] = Math.max(-0.05, p.y);
        this.positions[i * 3 + 2] = p.z;

        // Fade brightness and color as droplet disperses
        const alphaFade = (1.0 - progress) * (p.y > 0 ? 1.0 : 0.3);
        const brightness = alphaFade * 0.95;
        this.colors[i * 3] = 0.75 * brightness;
        this.colors[i * 3 + 1] = 0.92 * brightness;
        this.colors[i * 3 + 2] = 1.0 * brightness;
      } else {
        this.positions[i * 3 + 1] = -100;
      }
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;

    // Update foam rings
    for (let i = 0; i < this.foamRings.length; i++) {
      const ring = this.foamRings[i];
      if (ring.active) {
        ring.age += delta;
        const progress = ring.age / ring.maxAge;
        if (progress >= 1.0) {
          ring.active = false;
          ring.mesh.visible = false;
          ring.mesh.position.y = -50;
        } else {
          const scale = MathUtils.lerp(ring.initialScale, ring.maxScale, Math.pow(progress, 0.6));
          ring.mesh.scale.set(scale, scale, scale);
          ring.mesh.material.opacity = (1.0 - progress) * 0.75;
        }
      }
    }
  }
}
