import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  LoopOnce,
  NumberKeyframeTrack,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer
} from 'three';
import PhysicsHandler from '../../../../shared/physics/cannon/PhysicsHandler';
import { GestureType, HandTrackingResult } from '../../../../shared/scene/SceneManagerInterface';
import { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { VRM, VRMExpressionPresetName, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { BVH, BVHLoader } from 'three/examples/jsm/loaders/BVHLoader';
import SkeletonHelper from '../../../../shared/model/SkeletonHelper';
import AudioHandler, { AudioDemo } from '../../../../shared/audio/AudioHandler';
import VrmSkeletonUtils from '../../../../shared/model/VrmSkeletonUtils';
import SceneManagerParent from '../../../../shared/scene/SceneManagerParent';

export default class SceneManager extends SceneManagerParent {
  private mixerBlink1: AnimationMixer;
  private mixerBlink2: AnimationMixer;
  private mixerHappy1: AnimationMixer;
  private mixerHappy2: AnimationMixer;
  private mixerDance1: AnimationMixer;
  private mixerDance2: AnimationMixer;

  private isAnimationStarted: boolean = false;
  private isLoaded: boolean = false; // Readiness guard

  private person1: VRM;
  private person2: VRM;
  private animationAction: AnimationAction;
  private source1SkeletonHelper: SkeletonHelper;
  private target1SkeletonHelper: SkeletonHelper;
  private source2SkeletonHelper: SkeletonHelper;
  private target2SkeletonHelper: SkeletonHelper;
  private target1Skeleton: VRM;
  private target2Skeleton: VRM;

  private options = {
    hip: "hip",
    preservePosition: false,
    preserveHipPosition: false,
    useTargetMatrix: true,
    names: {
      "Normalized_J_Bip_C_Hips": "hip",
      "Normalized_J_Bip_C_Chest": "abdomen",
      "Normalized_J_Bip_C_UpperChest": "chest",
      "Normalized_J_Bip_C_Neck": "neck",
      "Normalized_J_Bip_C_Head": "head",

      "Normalized_J_Bip_R_Shoulder": "rCollar",
      "Normalized_J_Bip_R_UpperArm": "rShldr",
      "Normalized_J_Bip_R_LowerArm": "rForeArm",
      "Normalized_J_Bip_R_Hand": "rHand",

      "Normalized_J_Bip_L_Shoulder": "lCollar",
      "Normalized_J_Bip_L_UpperArm": "lShldr",
      "Normalized_J_Bip_L_LowerArm": "lForeArm",
      "Normalized_J_Bip_L_Hand": "lHand",

      "Normalized_J_Bip_R_UpperLeg": "rThigh",
      "Normalized_J_Bip_R_LowerLeg": "rShin",
      "Normalized_J_Bip_R_Foot": "rFoot",

      "Normalized_J_Bip_L_UpperLeg": "lThigh",
      "Normalized_J_Bip_L_LowerLeg": "lShin",
      "Normalized_J_Bip_L_Foot": "lFoot"
    }
  };

  private audioHandler = new AudioHandler();
  private audioElement: HTMLAudioElement;
  private bvh1: BVH;
  private bvh2: BVH;
  private nextBvh1: BVH;
  private nextBvh2: BVH;
  private slowDownFactor = 1.8;

  async build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler) {
    super.build(camera, scene, renderer, physicsHandler);
    this.sceneHelper.addLight(true);
    this.audioHandler.initAudio(AudioDemo.salsaDanceSlow);
    this.audioHandler.setPosition(new Vector3(-3, 2, 1));
    this.audioElement = this.audioHandler.audioElement;
    this.audioElement.loop = true;

    await this.loadBar(scene);

    try {
      // 1. Load models first
      await this.loadModels();

      // 2. Load initial animation moves
      await this.loadBVH(1);

      // 3. Flag ready and play audio
      this.isLoaded = true;
      await this.audioElement.play();
    } catch (error) {
      console.error('Failed initialization sequence:', error);
    }
  }

  private async loadBar(scene: Scene): Promise<void> {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync('models/gltf/Bar scene.glb');

    const model = gltf.scene;
    model.scale.set(0.35, 0.35, 0.35);
    model.position.y = -0.43;
    model.position.z = -0.5;
    model.position.x = 0.3;
    scene.add(model);
  }

  private async loadModels(): Promise<void> {
    const gltfLoader = new GLTFLoader();
    gltfLoader.register((parser) => new VRMLoaderPlugin(parser));
    const modelUrl = '../../../shared/vrm/VRM1_Constraint_Twist_Sample.vrm';

    const [gltf1, gltf2] = await Promise.all([
      gltfLoader.loadAsync(modelUrl),
      gltfLoader.loadAsync(modelUrl)
    ]);

    // Setup Person 1
    this.person1 = this.processVRM(gltf1);
    this.target1Skeleton = this.person1;
    this.target1SkeletonHelper = new SkeletonHelper(this.person1.scene.children[0]);
    this.scene.add(this.person1.scene)
    this.playBlinkAnimationPerson1();

    // Setup Person 2
    this.person2 = this.processVRM(gltf2);
    this.target2Skeleton = this.person2;
    this.target2SkeletonHelper = new SkeletonHelper(this.person2.scene.children[0]);
    this.scene.add(this.person2.scene);
    this.playBlinkAnimationPerson2();
  }

  private processVRM(gltf: GLTF): VRM {
    VRMUtils.combineSkeletons(gltf.scene);

    gltf.scene.traverse((object) => {
      object.frustumCulled = false;
    });

    return gltf.userData.vrm;
  }

  private playBlinkAnimationPerson1() {
    if (!this.person1?.expressionManager) return;
    this.mixerBlink1 = new AnimationMixer(this.person1.scene);
    const blinkTrack = new NumberKeyframeTrack(
        this.person1.expressionManager.getExpressionTrackName(VRMExpressionPresetName.Blink),
        [0.0, 0.5, 1.0],
        [0.0, 1.0, 0.0]
    );
    const clip = new AnimationClip('blink', 1, [blinkTrack]);
    this.animationAction = this.mixerBlink1.clipAction(clip).setLoop(LoopOnce, 1);
    this.animationAction.play();

    setTimeout(() => {
      this.playBlinkAnimationPerson1();
    }, 4000);
  }

  private playHappyAnimationPerson1() {
    if (!this.person1?.expressionManager) return;
    this.mixerHappy1 = new AnimationMixer(this.person1.scene);
    const happyTrack = new NumberKeyframeTrack(
        this.person1.expressionManager.getExpressionTrackName(VRMExpressionPresetName.Happy),
        [0.0, 0.5, 1.0],
        [0.0, 0.5, 1.0]
    );
    const clip = new AnimationClip('happy', 1, [happyTrack]);
    this.animationAction = this.mixerHappy1.clipAction(clip).setLoop(LoopOnce, 1);
    this.animationAction.play();
  }

  private playHappyAnimationPerson2() {
    if (!this.person2?.expressionManager) return;
    this.mixerHappy2 = new AnimationMixer(this.person2.scene);
    const happyTrack = new NumberKeyframeTrack(
        this.person2.expressionManager.getExpressionTrackName(VRMExpressionPresetName.Happy),
        [0.0, 0.5, 1.0],
        [0.0, 0.5, 1.0]
    );
    const clip = new AnimationClip('happy', 1, [happyTrack]);
    this.animationAction = this.mixerHappy2.clipAction(clip).setLoop(LoopOnce, 1);
    this.animationAction.play();
  }

  private playBlinkAnimationPerson2() {
    if (!this.person2?.expressionManager) return;
    this.mixerBlink2 = new AnimationMixer(this.person2.scene);
    const blinkTrack = new NumberKeyframeTrack(
        this.person2.expressionManager.getExpressionTrackName(VRMExpressionPresetName.Blink),
        [0.0, 0.5, 1.0],
        [0.0, 1.0, 0.0]
    );
    const clip = new AnimationClip('blink', 1, [blinkTrack]);
    this.animationAction = this.mixerBlink2.clipAction(clip).setLoop(LoopOnce, 1);
    this.animationAction.play();

    setTimeout(() => {
      this.playBlinkAnimationPerson2();
    }, 4000);
  }

  loadBVH = async (move: number): Promise<void> => {
    const loader = new BVHLoader();
    const moveStr = String(move).padStart(2, '0');

    const path1 = `../../../shared/bvh/60/60_${moveStr}_scaled.bvh`;
    const path2 = `../../../shared/bvh/61/61_${moveStr}_scaled.bvh`;

    try {
      const [bvh1, bvh2] = await Promise.all([
        loader.loadAsync(path1),
        loader.loadAsync(path2),
      ]);

      this.bvh1 = bvh1;
      this.source1SkeletonHelper = new SkeletonHelper(bvh1.skeleton.bones[0]);
      this.source1SkeletonHelper.skeleton = bvh1.skeleton;

      this.bvh2 = bvh2;
      this.source2SkeletonHelper = new SkeletonHelper(bvh2.skeleton.bones[0]);
      this.source2SkeletonHelper.skeleton = bvh2.skeleton;

      this.startShow(move);
      this.preloadBVH(move + 1);
    } catch (error) {
      console.error(`Failed to load BVH move ${moveStr}:`, error);
    }
  };

  async doNext(move: number): Promise<void> {
    if (!this.nextBvh1 || !this.nextBvh2) {
      // Fallback: load directly if preloader hasn't finished yet
      await this.preloadBVH(move);
    }

    this.bvh1 = this.nextBvh1;
    this.bvh2 = this.nextBvh2;

    if (move < 15) {
      this.preloadBVH(move + 1);
    }

    this.source1SkeletonHelper = new SkeletonHelper(this.bvh1.skeleton.bones[0]);
    this.source1SkeletonHelper.skeleton = this.bvh1.skeleton;

    this.source2SkeletonHelper = new SkeletonHelper(this.bvh2.skeleton.bones[0]);
    this.source2SkeletonHelper.skeleton = this.bvh2.skeleton;

    this.startShow(move);
  }

  preloadBVH = async (move: number): Promise<void> => {
    const loader = new BVHLoader();
    const moveStr = String(move).padStart(2, '0');

    const path1 = `../../../shared/bvh/60/60_${moveStr}_scaled.bvh`;
    const path2 = `../../../shared/bvh/61/61_${moveStr}_scaled.bvh`;

    try {
      const [bvh1, bvh2] = await Promise.all([
        loader.loadAsync(path1),
        loader.loadAsync(path2),
      ]);

      this.nextBvh1 = bvh1;
      this.nextBvh2 = bvh2;
    } catch (error) {
      console.error(`Failed to preload BVH move ${moveStr}:`, error);
    }
  };

  private startShow(move: number) {
    if (!this.person1 || !this.person2 || !this.bvh1 || !this.bvh2) return;

    console.log(`Play move ${move} for second: ${this.bvh1.clip.duration * this.slowDownFactor}`);
    this.isAnimationStarted = true;

    this.mixerDance1 = new AnimationMixer(this.source1SkeletonHelper);
    this.mixerDance2 = new AnimationMixer(this.source2SkeletonHelper);

    if (this.person1.scene.parent !== this.scene) this.scene.add(this.person1.scene);
    if (this.person2.scene.parent !== this.scene) this.scene.add(this.person2.scene);

    this.mixerDance1.clipAction(this.bvh1.clip).play();
    this.mixerDance2.clipAction(this.bvh2.clip).play();

    setTimeout(() => {
      console.log("animation happy");
      this.playHappyAnimationPerson1();
      this.playHappyAnimationPerson2();
    }, (this.bvh1.clip.duration * 1000 * this.slowDownFactor) - 2000);

    setTimeout(() => {
      console.log("Stop animation");
      if (move < 15) {
        this.doNext(move + 1);
      } else {
        this.isAnimationStarted = false;
      }
    }, this.bvh1.clip.duration * 1000 * this.slowDownFactor);
  }

  update() {
    super.update();
    let delta = this.timer.getDelta();

    // Guard update loop against uninitialized states
    if (!this.isLoaded) return;

    if (this.mixerDance1 && this.mixerDance2) {
      this.mixerDance1.update(delta / this.slowDownFactor);
      this.mixerDance2.update(delta / this.slowDownFactor);

      if (this.isAnimationStarted && this.source1SkeletonHelper && this.source2SkeletonHelper) {
        VrmSkeletonUtils.retarget(this.target1Skeleton, this.source1SkeletonHelper, this.options);
        VrmSkeletonUtils.retarget(this.target2Skeleton, this.source2SkeletonHelper, this.options);
      }
    }

    if (this.mixerBlink1) this.mixerBlink1.update(delta);
    if (this.person1) this.person1.update(delta);
    if (this.mixerBlink2) this.mixerBlink2.update(delta);
    if (this.person2) this.person2.update(delta);
    if (this.mixerHappy1) this.mixerHappy1.update(delta);
    if (this.mixerHappy2) this.mixerHappy2.update(delta);
  }

  updateHandPose(result: HandTrackingResult) {
    if (this.handPoseManager) {
      this.handPoseManager.renderHands(result);
      if (this.isLoaded && !this.isAnimationStarted && this.handPoseManager.isOpenHand()) {
        this.startShow(1);
      }
    }
  }

  handleGesture(gesture: HandTrackingResult) {
    if (gesture.gestureType === GestureType.Open_Hand) {
      if (this.isLoaded && !this.isAnimationStarted) {
        this.startShow(1);
      }
    }
  }

  getInitialCameraPosition(): Vector3 {
    return new Vector3(-0.5, 1.75, 4);
  }
}
