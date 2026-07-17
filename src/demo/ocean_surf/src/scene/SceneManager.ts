import {
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  MeshStandardMaterial,
  Mesh,
  AmbientLight,
  Color,
  CylinderGeometry,
  SphereGeometry,
  ACESFilmicToneMapping,
  MathUtils,
  PMREMGenerator,
  Group
} from 'three';
import PhysicsHandler from '../../../../shared/physics/cannon/PhysicsHandler';
import { Sky } from '../../../../shared/scene/sky/Sky';
import SceneManagerParent from '../../../../shared/scene/SceneManagerParent';
import { OceanSurf } from '../../../../shared/scene/water/OceanSurf';
import { GestureType, HandTrackingResult, PostProcessingConfig } from '../../../../shared/scene/SceneManagerInterface';
import AudioHandler, { AudioDemo } from '../../../../shared/audio/AudioHandler';

export default class SceneManager extends SceneManagerParent {
  private ocean: OceanSurf;
  private sky: Sky;
  private sun: Vector3 = new Vector3();
  private pmremGenerator: PMREMGenerator;
  private palmLeaves: Group[] = [];
  private audioHandler = new AudioHandler();
  private audioElement: HTMLAudioElement;
  private isAudioStarted: boolean = false;

  private parameters = {
    elevation: 0.5,
    azimuth: 180
  };

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler) {
    super.build(camera, scene, renderer, physicsHandler);

    renderer.toneMapping = ACESFilmicToneMapping;
    this.pmremGenerator = new PMREMGenerator(renderer);

    this.scene.background = new Color(0x87ceeb);

    const ambientLight = new AmbientLight(0xffffff, 0.3);
    ambientLight.name = 'AmbientLight';
    this.scene.add(ambientLight);

    const dirLight = new DirectionalLight(0xffffff, 2.5);
    dirLight.name = 'SunLight';
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 500;
    dirLight.shadow.camera.left = -40;
    dirLight.shadow.camera.right = 40;
    dirLight.shadow.camera.top = 40;
    dirLight.shadow.camera.bottom = -40;
    dirLight.shadow.bias = -0.0005;
    this.scene.add(dirLight);

    this.addOcean();
    this.addSky();
    this.addIslands();
    this.addPalmTree();

    this.audioHandler.initAudio(AudioDemo.ocean);
    this.audioElement = this.audioHandler.audioElement;
    this.audioElement.loop = true;

    // Start the waves right away. In WebXR build() runs inside the session that was
    // launched by the "ENTER VR" button click, so resume()/play() is allowed there too.
    this.startAudio();
  }

  private addOcean() {
    this.ocean = new OceanSurf();
    this.ocean.name = 'OceanSurf';
    this.ocean.position.y = 0;
    this.scene.add(this.ocean);
  }

  private addSky() {
    this.sky = new Sky();
    this.sky.scale.setScalar(10000);
    this.scene.add(this.sky);

    const skyUniforms = this.sky.material.uniforms;
    this.sky.name = 'Sky';
    skyUniforms['turbidity'].value = 10;
    skyUniforms['rayleigh'].value = 2;
    skyUniforms['mieCoefficient'].value = 0.005;
    skyUniforms['mieDirectionalG'].value = 0.8;

    this.updateSun();
  }

  private updateSun() {
    const phi = MathUtils.degToRad(90 - this.parameters.elevation);
    const theta = MathUtils.degToRad(this.parameters.azimuth);

    this.sun.setFromSphericalCoords(1, phi, theta);

    this.sky.material.uniforms['sunPosition'].value.copy(this.sun);
    if (this.ocean) {
      (this.ocean.material as any).uniforms.uSunDirection.value.copy(this.sun);
    }

    this.scene.environment = this.pmremGenerator.fromScene(this.sky).texture;

    // Update directional light position and target to match the sun
    this.scene.children.forEach((obj) => {
      if (obj.name === 'SunLight' && obj instanceof DirectionalLight) {
        obj.position.copy(this.sun).multiplyScalar(100);
        obj.lookAt(0, 0, 0);
      }
    });
  }

  private addIslands() {
    // Use a more natural-looking material for the island and rocks
    const islandMat = new MeshStandardMaterial({ color: 0xd2b48c, roughness: 0.8, metalness: 0.2 });
    const rockMat = new MeshStandardMaterial({ color: 0x909090, roughness: 0.8, metalness: 0.2, envMapIntensity: 0.5 });

    // Add some random boulders to intersect with the water for foam effects
    for (let i = 0; i < 10; i++) {
      const radius = 2 + Math.random() * 4;
      // Low segment count gives a rocky, faceted look
      const rockGeom = new SphereGeometry(radius, 6, 5);
      const rock = new Mesh(rockGeom, rockMat.clone());
      rock.name = 'Rock';
      rock.castShadow = true;
      rock.receiveShadow = true;

      // Distort the sphere to make it look like a boulder
      rock.scale.set(
        1 + Math.random() * 0.5,
        0.5 + Math.random() * 0.5,
        1 + Math.random() * 0.5
      );
      rock.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
      );

      rock.position.set(
        Math.random() * 80 - 40,
        -radius * 0.2, // Slightly less submerged
        Math.random() * 80 - 40
      );
      this.scene.add(rock);
    }

    // A large main island with a gentle underwater slope
    // Truncated cone (cylinder with smaller top) creates a beach slope
    // CylinderGeometry(radiusTop, radiusBottom, height, radialSegments)
    const islandGeom = new CylinderGeometry(15, 80, 12, 32);
    const island = new Mesh(islandGeom, islandMat.clone());
    island.name = 'Island';
    island.castShadow = true;
    island.receiveShadow = true;

    // Position it so the top is slightly above water (y=0) and the base is wide underwater
    // y=-4 with height 12 means top is at -4 + 6 = 2.0, and base is at -4 - 6 = -10
    island.position.set(0, -4, -25);
    this.scene.add(island);
  }

  private addPalmTree() {
    const palmGroup = new Group();
    palmGroup.name = 'PalmTree';

    // Trunk
    const trunkMat = new MeshStandardMaterial({ color: 0x8b4513, roughness: 0.9, metalness: 0.1 });
    const trunkSegments = 5;
    const trunkHeight = 10;
    const segmentHeight = trunkHeight / trunkSegments;

    let currentY = 0;
    for (let i = 0; i < trunkSegments; i++) {
      const radiusTop = 0.5 - (i * 0.05);
      const radiusBottom = 0.6 - (i * 0.05);
      const segmentGeom = new CylinderGeometry(radiusTop, radiusBottom, segmentHeight, 6);
      const segment = new Mesh(segmentGeom, trunkMat);
      segment.position.y = currentY + segmentHeight / 2;

      // Add some slight curve to the trunk
      segment.rotation.z = Math.sin(i * 0.5) * 0.1;
      segment.position.x = Math.sin(i * 0.5) * 0.2;

      segment.castShadow = true;
      segment.receiveShadow = true;
      palmGroup.add(segment);
      currentY += segmentHeight;
    }

    // Leaves - Curved palm fronds
    const leafMat = new MeshStandardMaterial({ color: 0x228b22, roughness: 0.8, metalness: 0.1, side: 2 });
    const leafCount = 8;
    const leafSegments = 6;
    const leafSegmentLength = 1.2;

    for (let i = 0; i < leafCount; i++) {
      const leafGroup = new Group();
      leafGroup.position.y = trunkHeight;
      leafGroup.rotation.y = (i / leafCount) * Math.PI * 2;

      let currentLeafY = 0;
      let currentLeafZ = 0;

      for (let j = 0; j < leafSegments; j++) {
        const radius = 0.4 * (1 - j / leafSegments);
        const leafSegGeom = new CylinderGeometry(radius, radius * 1.2, leafSegmentLength, 4);
        const segment = new Mesh(leafSegGeom, leafMat);

        // Position segment
        segment.position.z = currentLeafZ + leafSegmentLength / 2;
        segment.position.y = currentLeafY;

        // Tilt segment downwards as we go further out
        const tilt = (j / leafSegments) * 0.5;
        segment.rotation.x = Math.PI / 2 + tilt;

        segment.castShadow = true;
        segment.receiveShadow = true;
        leafGroup.add(segment);

        currentLeafZ += Math.cos(tilt) * leafSegmentLength;
        currentLeafY -= Math.sin(tilt) * leafSegmentLength;
      }

      palmGroup.add(leafGroup);
      this.palmLeaves.push(leafGroup);
    }

    // Position the tree on the island
    // Island is at (0, -4, -25), top is at y=2
    palmGroup.position.set(0, 2, -25);
    this.scene.add(palmGroup);
  }

  update() {
    super.update();
    const time = this.timer.getElapsed();
    if (this.ocean) {
      this.ocean.update(time);
    }

    // Update audio listener position to camera position
    if (this.camera) {
      // Audio source is at origin (default), same as the beach demo. Use the
      // camera position directly so the waves stay at full volume near the scene.
      this.audioHandler.setVolume(this.camera.position);
    }

    // Animate palm leaves
    this.palmLeaves.forEach((leaf, i) => {
      // Create a wave effect
      // Each leaf has a slightly different phase based on its index
      const wave = Math.sin(time * 1.5 + i * 0.5) * 0.05;
      const wave2 = Math.cos(time * 1.0 + i * 0.8) * 0.02;

      leaf.rotation.x = wave;
      leaf.rotation.z = wave2;
    });
  }

  updateHandPose(result) {
    if (this.handPoseManager) {
      this.handPoseManager.renderHands(result);
      if (!this.isAudioStarted) {
        if (this.handPoseManager.isOpenHand()) {
          this.startAudio();
        }
      }
    }
  }

  getPostProcessingConfig(): PostProcessingConfig {
    return undefined;
  }

  isDepthEnabled(): boolean {
    return true;
  }

  isShadowEnabled(): boolean {
    return true;
  }

  handleGesture(gesture: HandTrackingResult) {
    if (gesture.gestureType == GestureType.Open_Hand) {
      this.startAudio();
    }
  }

  private startAudio() {
    if (!this.isAudioStarted) {
      this.isAudioStarted = true;
      this.audioHandler.resume();
      this.audioElement.play().catch(e => {
        console.warn("Audio play failed:", e);
        this.isAudioStarted = false;
      });
    }
  }

  getInitialCameraPosition(): Vector3 {
    return new Vector3(0, 5, 15);
  }

  getInitialCameraTarget(): Vector3 {
    return new Vector3(0, 0, 0);
  }
}
