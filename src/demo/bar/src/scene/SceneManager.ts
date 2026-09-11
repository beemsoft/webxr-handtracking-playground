import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
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
  private mixerDance1: AnimationMixer;
  private mixerDance2: AnimationMixer;
  private isAnimationStarted: boolean = false;
  private isLoaded: boolean = false; // Readiness guard flag

  private person1: VRM;
  private person2: VRM;
  private animationAction: AnimationAction;
  private source1SkeletonHelper: SkeletonHelper;
  private target1SkeletonHelper: SkeletonHelper;
  private source2SkeletonHelper: SkeletonHelper;
  private target2SkeletonHelper: SkeletonHelper;

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

  async build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler) {
    super.build(camera, scene, renderer, physicsHandler);
    this.sceneHelper.addLight(true);
    this.audioHandler.initAudio(AudioDemo.salsaDanceFast);
    this.audioElement = this.audioHandler.audioElement;
    this.audioElement.loop = false;

    this.loadBar(scene);

    try {
      // Load VRMs and BVHs sequentially in lifecycle, but parallel internally
      await this.loadModels();
      await this.loadBVH();

      // Everything is ready
      this.isLoaded = true;
      this.audioElement.play();
    } catch (error) {
      console.error('Initialization error:', error);
    }
  }

  private loadBar(scene: Scene) {
    const loader = new GLTFLoader();
    loader.load('models/gltf/Bar scene.glb', (gltf) => {
      let model = gltf.scene;
      model.scale.set(0.35, 0.35, 0.35);
      model.position.y = -0.43;
      model.position.z = -0.4;
      scene.add(model);
    });
  }

  private async loadModels(): Promise<void> {
    const gltfLoader = new GLTFLoader();
    gltfLoader.register((parser) => new VRMLoaderPlugin(parser));
    const modelUrl = '../../../shared/vrm/VRM1_Constraint_Twist_Sample.vrm';

    const [gltf1, gltf2] = await Promise.all([
      gltfLoader.loadAsync(modelUrl),
      gltfLoader.loadAsync(modelUrl),
    ]);

    // Setup Person 1
    this.person1 = this.processVRM(gltf1);
    this.target1SkeletonHelper = new SkeletonHelper(this.person1.scene.children[0]);
    this.playBlinkAnimationPerson1();

    // Setup Person 2
    this.person2 = this.processVRM(gltf2);
    this.target2SkeletonHelper = new SkeletonHelper(this.person2.scene.children[0]);
    this.playBlinkAnimationPerson2();
  }

  private processVRM(gltf: GLTF): VRM {
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
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

  loadBVH = async (): Promise<void> => {
    const loader = new BVHLoader();

    const [bvh1, bvh2] = await Promise.all([
      loader.loadAsync("../../../shared/bvh/60/60_01_scaled.bvh"),
      loader.loadAsync("../../../shared/bvh/61/61_01_scaled.bvh"),
    ]);

    this.bvh1 = bvh1;
    this.source1SkeletonHelper = new SkeletonHelper(bvh1.skeleton.bones[0]);
    this.source1SkeletonHelper.skeleton = bvh1.skeleton;

    this.bvh2 = bvh2;
    this.source2SkeletonHelper = new SkeletonHelper(bvh2.skeleton.bones[0]);
    this.source2SkeletonHelper.skeleton = bvh2.skeleton;

    this.startShow();
  };

  private startShow() {
    // Guard: Prevent running startShow if assets aren't ready
    if (!this.person1 || !this.person2 || !this.bvh1 || !this.bvh2) return;

    this.isAnimationStarted = true;
    this.mixerDance1 = new AnimationMixer(this.source1SkeletonHelper);
    this.mixerDance2 = new AnimationMixer(this.source2SkeletonHelper);

    if (this.person1.scene.parent !== this.scene) this.scene.add(this.person1.scene);
    if (this.person2.scene.parent !== this.scene) this.scene.add(this.person2.scene);

    this.mixerDance1.clipAction(this.bvh1.clip).setEffectiveWeight(1.0).setLoop(LoopRepeat, 5).play();
    this.mixerDance2.clipAction(this.bvh2.clip).setEffectiveWeight(1.0).setLoop(LoopRepeat, 5).play();

    setTimeout(() => {
      this.isAnimationStarted = false;
    }, this.bvh1.clip.duration * 1000 * 5);

    if (this.audioElement.paused) {
      this.audioElement.play();
    }
  }

  update() {
    super.update();
    let delta = this.timer.getDelta();

    // Guard update logic behind total readiness (isLoaded)
    if (!this.isLoaded) return;

    if (this.mixerDance1 && this.mixerDance2) {
      this.mixerDance1.update(delta);
      this.mixerDance2.update(delta);

      if (this.isAnimationStarted && this.source1SkeletonHelper && this.source2SkeletonHelper) {
        VrmSkeletonUtils.retarget(this.person1, this.source1SkeletonHelper, this.options);
        VrmSkeletonUtils.retarget(this.person2, this.source2SkeletonHelper, this.options);
      }
    }

    if (this.mixerBlink1) this.mixerBlink1.update(delta);
    if (this.person1) this.person1.update(delta);
    if (this.mixerBlink2) this.mixerBlink2.update(delta);
    if (this.person2) this.person2.update(delta);
  }

  updateHandPose(result: HandTrackingResult) {
    if (this.handPoseManager) {
      this.handPoseManager.renderHands(result);
      if (this.isLoaded && !this.isAnimationStarted && this.handPoseManager.isOpenHand()) {
        this.startShow();
      }
    }
  }

  handleGesture(gesture: HandTrackingResult) {
    if (gesture.gestureType === GestureType.Open_Hand) {
      if (this.isLoaded && !this.isAnimationStarted) {
        this.startShow();
      }
    }
  }

  getInitialCameraPosition(): Vector3 {
    return new Vector3(-0.5, 1.75, 4);
  }
}
