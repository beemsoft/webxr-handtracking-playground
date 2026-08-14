import {
  AmbientLight,
  Color,
  DirectionalLight,
  FogExp2,
  Group,
  Mesh,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  Vector4,
  WebGLRenderer
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import SceneManagerParent from '../../../../shared/scene/SceneManagerParent';
import PhysicsHandler from '../../../../shared/physics/cannon/PhysicsHandler';
import { OceanSurf } from '../../../../shared/scene/water/OceanSurf';
import AudioHandler, { AudioDemo } from '../../../../shared/audio/AudioHandler';

export default class SceneManager extends SceneManagerParent {
  private ocean: OceanSurf;
  private shipGroup: Group = new Group();
  private skyDome: Mesh | null = null;
  private shipLoaded: boolean = false;
  private audioHandler = new AudioHandler();
  private audioElement: HTMLAudioElement;
  private isAudioStarted: boolean = false;

  // Fog & Daytime Atmosphere Parameters
  private readonly fogColor = new Color(0xd0dde5);
  private readonly skyZenithColor = new Color(0xb4c6d2); // Soft overcast/misty daytime sky
  private readonly fogDensity = 0.032;
  private readonly fogNear = 6.0;
  private readonly fogHeightFalloff = 0.07;

  // Ship animation parameters
  private shipStartZ = -150;
  private shipEndZ = -12;
  private shipSpeed = 2.2; // units per second
  private currentShipZ = -150;
  private time = 0;
  private readonly shipForward = new Vector3(0, 0, 1);
  // (beamWidth: 13.5, bowCutwaterZ: 22.5, sternZ: 26.0, maxWakeLength: 60.0)
  private readonly shipDimensions = new Vector4(13.5, 22.5, 26.0, 60.0);

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler) {
    super.build(camera, scene, renderer, physicsHandler);

    // Bright daytime misty marine atmosphere
    this.scene.background = this.fogColor;
    this.scene.fog = new FogExp2(this.fogColor, this.fogDensity);

    // Atmospheric sky dome for horizon blending and daylight scattering
    this.addSkyDome();

    // Bright ambient skylight diffused through daytime mist
    const ambientLight = new AmbientLight(0xddecf5, 1.8);
    ambientLight.name = 'AmbientLight';
    this.scene.add(ambientLight);

    // Directional sunlight piercing through daytime sea fog
    const dirLight = new DirectionalLight(0xfff5e6, 2.6);
    dirLight.name = 'SunLight';
    dirLight.position.set(35, 75, -50);
    this.scene.add(dirLight);

    // Add ocean with wave and keel foam simulation
    this.addOcean();

    // Add ship group and load the 17th-century pinnace model
    this.shipGroup.name = 'ShipPinnaceGroup';
    this.shipGroup.position.set(0, -0.5, this.shipStartZ);
    this.scene.add(this.shipGroup);
    this.loadShipModel();

    // Ocean audio for ambience
    try {
      this.audioHandler.initAudio(AudioDemo.ocean);
      this.audioElement = this.audioHandler.audioElement;
      if (this.audioElement) {
        this.audioElement.loop = true;
        this.startAudio();
      }
    } catch (e) {
      console.log('Audio init skipped:', e);
    }
  }

  private addSkyDome() {
    const skyGeo = new SphereGeometry(450, 32, 16);
    const skyMat = new ShaderMaterial({
      name: 'MistyAtmosphereSkyMaterial',
      uniforms: {
        uFogColor: { value: this.fogColor },
        uSkyColor: { value: this.skyZenithColor },
        uSunDirection: { value: new Vector3(0.35, 0.65, -0.65).normalize() }
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        varying vec3 vWorldPosition;
        uniform vec3 uFogColor;
        uniform vec3 uSkyColor;
        uniform vec3 uSunDirection;

        void main() {
          vec3 dir = normalize(vWorldPosition);
          // Gentle transition from sea fog at horizon/lower sky to soft overcast sky aloft
          float heightFactor = smoothstep(0.15, 0.85, max(0.0, dir.y));
          vec3 sky = mix(uFogColor, uSkyColor, heightFactor);

          // Sunlight scattering halo in the daytime mist
          float sunDot = max(0.0, dot(dir, uSunDirection));
          float halo = pow(sunDot, 8.0) * 0.25 + pow(sunDot, 32.0) * 0.45;
          sky += vec3(1.0, 0.98, 0.92) * halo;

          gl_FragColor = vec4(sky, 1.0);
        }
      `,
      side: 1, // THREE.BackSide
      depthWrite: false,
      depthTest: true
    });

    this.skyDome = new Mesh(skyGeo, skyMat);
    this.skyDome.name = 'MistySkyDome';
    this.skyDome.renderOrder = -100;
    this.skyDome.frustumCulled = false;
    this.scene.add(this.skyDome);
  }

  private addOcean() {
    this.ocean = new OceanSurf();
    this.ocean.name = 'OceanSurf';
    this.ocean.position.set(0, 0, -40);
    this.ocean.scale.set(3.5, 1, 3.5); // Cover full ship travel route towards horizon

    // Configure ocean material colors for misty sea under daylight
    if (this.ocean.material && (this.ocean.material as any).uniforms) {
      const uniforms = (this.ocean.material as any).uniforms;
      if (uniforms.uShallowColor) uniforms.uShallowColor.value.set(0x35788c);
      if (uniforms.uDeepColor) uniforms.uDeepColor.value.set(0x0f2f3d);
      if (uniforms.uFoamColor) uniforms.uFoamColor.value.set(0xffffff);
      if (uniforms.uFoamLimit) uniforms.uFoamLimit.value = 0.5;
      if (uniforms.uSunDirection) uniforms.uSunDirection.value.set(0.35, 0.65, -0.65).normalize();
      if (uniforms.uFogColor) uniforms.uFogColor.value.copy(this.fogColor);
      if (uniforms.uFogDensity) uniforms.uFogDensity.value = this.fogDensity;
      if (uniforms.uFogNear) uniforms.uFogNear.value = this.fogNear;
      if (uniforms.uFogHeightFalloff) uniforms.uFogHeightFalloff.value = this.fogHeightFalloff;
    }
    this.scene.add(this.ocean);
  }

  private loadShipModel() {
    const loader = new GLTFLoader();

    const applyHeightFog = (mat: any) => {
      mat.customProgramCacheKey = () => 'ship_height_fog';
      mat.onBeforeCompile = (shader: any) => {
        shader.uniforms.uCustomFogColor = { value: this.fogColor };
        shader.uniforms.uCustomSkyColor = { value: this.skyZenithColor };
        shader.uniforms.uCustomFogDensity = { value: this.fogDensity };
        shader.uniforms.uCustomFogNear = { value: this.fogNear };
        shader.uniforms.uCustomFogHeightFalloff = { value: this.fogHeightFalloff };

        shader.vertexShader = shader.vertexShader.replace(
          '#include <common>',
          `#include <common>
          varying vec3 vCustomWorldPosition;`
        ).replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vCustomWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`
        );

        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <common>',
          `#include <common>
          varying vec3 vCustomWorldPosition;
          uniform vec3 uCustomFogColor;
          uniform vec3 uCustomSkyColor;
          uniform float uCustomFogDensity;
          uniform float uCustomFogNear;
          uniform float uCustomFogHeightFalloff;`
        ).replace(
          '#include <fog_fragment>',
          `#ifdef USE_FOG
            vec3 rayDir = normalize(vCustomWorldPosition - cameraPosition);
            float dist = length(vCustomWorldPosition - cameraPosition);
            float effDist = max(0.0, dist - uCustomFogNear);
            float avgHeight = max(0.0, 0.5 * (cameraPosition.y + vCustomWorldPosition.y));
            // Thick fog layer in the first 10 meters above sea level
            float lowLayerBoost = 1.0 + 2.0 * smoothstep(10.0, 0.0, avgHeight);
            float heightAtten = exp(-uCustomFogHeightFalloff * avgHeight) * lowLayerBoost;
            float opticalThickness = effDist * uCustomFogDensity * heightAtten;
            float customFogFactor = 1.0 - exp(-opticalThickness);
            customFogFactor = clamp(customFogFactor, 0.0, 1.0);

            // Synchronize fog target color with atmospheric elevation gradient
            float skyBlend = smoothstep(0.15, 0.85, max(0.0, rayDir.y));
            vec3 targetFogColor = mix(uCustomFogColor, uCustomSkyColor, skyBlend);

            gl_FragColor.rgb = mix(gl_FragColor.rgb, targetFogColor, customFogFactor);
          #endif`
        );
      };
      mat.needsUpdate = true;
    };

    // Load the 17th century pinnace ship model
    loader.load(
      '/src/demo/ship/models/pinnace/ship_pinnace_1k.gltf',
      (gltf) => {
        const model = gltf.scene;
        model.name = 'ShipPinnace';

        // Scale and orient the ship to face forward (along positive Z towards camera)
        model.scale.set(1.6, 1.6, 1.6);
        model.rotation.y = 0; // Bow faces forward towards positive Z (towards camera)
        model.position.y = -0.3;    // Submerge keel slightly into water for depth foam contact

        model.traverse((child: any) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            child.frustumCulled = false;
            if (child.material) {
              if (Array.isArray(child.material)) {
                child.material.forEach(applyHeightFog);
              } else {
                applyHeightFog(child.material);
              }
            }
          }
        });

        this.shipGroup.add(model);
        this.shipLoaded = true;
      },
      undefined,
      (error) => {
        console.error('Error loading ship pinnace model:', error);
      }
    );
  }

  update() {
    super.update();
    const delta = this.timer ? this.timer.getDelta() : 0.016;
    const time = this.timer ? this.timer.getElapsed() : (this.time += 0.016);
    this.time = time;

    // Keep sky dome centered on active camera
    if (this.camera && this.skyDome) {
      this.skyDome.position.copy(this.camera.position);
    }

    // Update ocean wave animation with continuous elapsed time
    if (this.ocean) {
      this.ocean.update(time);
    }

    // Animate ship emerging slowly out of the fog towards the viewer
    if (this.shipGroup) {
      this.currentShipZ += this.shipSpeed * (delta || 0.016);
      if (this.currentShipZ > this.shipEndZ) {
        this.currentShipZ = this.shipStartZ; // Loop ship emergence journey
      }
      this.shipGroup.position.z = this.currentShipZ;

      // Gentle pitch and roll simulating ocean swell physics
      const roll = Math.sin(this.time * 0.8) * 0.035 + Math.sin(this.time * 1.7) * 0.015;
      const pitch = Math.cos(this.time * 0.6) * 0.025;
      const heave = Math.sin(this.time * 1.1) * 0.12;

      this.shipGroup.rotation.z = roll;
      this.shipGroup.rotation.x = pitch;
      this.shipGroup.position.y = -0.5 + heave;

      // Update hydrodynamic moving vessel foam (bow wave spray and trailing stern wake)
      if (this.ocean) {
        this.ocean.setShipState(
          this.shipGroup.position,
          this.shipForward,
          this.shipSpeed,
          this.shipDimensions
        );
      }
    }
  }

  isDepthEnabled(): boolean {
    return true; // Required for depth prepass and keel foam generation
  }

  isShadowEnabled(): boolean {
    return false;
  }

  getInitialCameraAngle(): number {
    return 0;
  }

  getInitialCameraPosition(): Vector3 {
    // Water-level vantage point looking into the distance where ship emerges
    return new Vector3(0, 1.5, 5);
  }

  private startAudio() {
    if (this.audioElement && !this.isAudioStarted) {
      this.audioElement.play().then(() => {
        this.isAudioStarted = true;
      }).catch((e) => {
        console.log('Audio autoplay prevented:', e);
      });
    }
  }
}
