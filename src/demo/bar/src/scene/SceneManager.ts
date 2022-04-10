import {
  AnimationClip,
  AnimationMixer,
  Clock,
  LoopOnce,
  LoopRepeat,
  NumberKeyframeTrack,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer
} from 'three';
import PhysicsHandler from '../../../../shared/physics/PhysicsHandler';
import { SceneHelper } from '../../../../shared/scene/SceneHelper';
import HandPoseManager from '../../../../shared/hands/HandPoseManager';
import { GestureType, SceneManagerInterface } from '../../../../shared/scene/SceneManagerInterface';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { VRM, VRMSchema, VRMUtils } from '@pixiv/three-vrm';
import { AnimationAction } from 'three/src/animation/AnimationAction';
import { BVH, BVHLoader } from 'three/examples/jsm/loaders/BVHLoader';
import SkeletonHelper from '../../../../shared/model/SkeletonHelper';
import AudioHandler, { AudioDemo } from '../../../../shared/audio/AudioHandler';
import VrmSkeletonUtils from '../model/VrmSkeletonUtils';

export default class SceneManager implements SceneManagerInterface {
  private scene: Scene;
  private sceneHelper: SceneHelper;
  private physicsHandler: PhysicsHandler;
  private handPoseManager: HandPoseManager;
  private clock = new Clock();
  private mixerBlink1: AnimationMixer;
  private mixerBlink2: AnimationMixer;
  private mixerDance1: AnimationMixer;
  private mixerDance2: AnimationMixer;
  private isAnimationStarted: boolean;
  private person1: VRM;
  private person2: VRM;
  private animationAction: AnimationAction;
  private source1SkeletonHelper: SkeletonHelper;
  private target1SkeletonHelper: SkeletonHelper;
  private source2SkeletonHelper: SkeletonHelper;
  private target2SkeletonHelper: SkeletonHelper;

  // TODO: leftEye, rightEye mapping
  private options = {
    hip: "hip",
    preservePosition: false,
    preserveHipPosition: false,
    useTargetMatrix: true,
    names: {
      "J_Bip_C_Hips": "hip",                    // 9
     // "J_Bip_C_Spine": "abdomen",             // 8
      "J_Bip_C_Chest": "abdomen",               // 5
      "J_Bip_C_UpperChest": "chest",            // 4
      "J_Bip_C_Neck": "neck",                   // 2
      "J_Bip_C_Head": "head",                   // 0

      "J_Bip_R_Shoulder": "rCollar",            // 7
      "J_Bip_R_UpperArm": "rShldr",             // 22
      "J_Bip_R_LowerArm": "rForeArm",           // 14
      "J_Bip_R_Hand": "rHand",                  // 23

      "J_Bip_L_Shoulder": "lCollar",            // 1
      "J_Bip_L_UpperArm": "lShldr",             // 20
      "J_Bip_L_LowerArm": "lForeArm",           // 3
      "J_Bip_L_Hand": "lHand",                  // 21

      "J_Bip_R_UpperLeg": "rThigh",             // 12
      "J_Bip_R_LowerLeg": "rShin",              // 18
      "J_Bip_R_Foot": "rFoot",                  // 19

      "J_Bip_L_UpperLeg": "lThigh",             // 10
      "J_Bip_L_LowerLeg": "lShin",              // 16
      "J_Bip_L_Foot": "lFoot"                   // 17
    }
  };
  private audioHandler = new AudioHandler();
  private audioElement: HTMLAudioElement;
  private bvh1: BVH;
  private bvh2: BVH;

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler) {
    this.scene = scene;
    this.sceneHelper = new SceneHelper(scene);
    this.physicsHandler = physicsHandler;
    this.sceneHelper.addLight(false);
    this.audioHandler.initAudio(AudioDemo.salsaDanceFast);
    this.audioElement = this.audioHandler.audioElement;
    this.audioElement.loop = false;
    this.loadBar(scene);
    this.loadModels();
    this.handPoseManager = new HandPoseManager(scene, physicsHandler);
  }

  private loadBar(scene: Scene) {
    const loader = new GLTFLoader();
    loader.load('models/gltf/Bar scene.glb', (gltf) => {
      let model = gltf.scene;
      model.scale.set(0.35, 0.35, 0.35);
      model.position.y = -0.23;
      model.position.z = -0.4;
      scene.add(model);
    });
  }

  private loadModels() {
    let gltfLoader = new GLTFLoader();
    gltfLoader.load('/shared/vrm/three-vrm-girl.vrm', (gltf) => {
      VRMUtils.removeUnnecessaryJoints(gltf.scene);
      VRM.from(gltf).then( (vrm) => {
        this.person1 = vrm;
        vrm.humanoid.getBoneNode( VRMSchema.HumanoidBoneName.Hips ).rotation.y = Math.PI;
        this.playBlinkAnimationPerson1();
        this.target1SkeletonHelper = new SkeletonHelper(vrm.scene.children[0]);
        gltfLoader.load('/shared/vrm/three-vrm-girl.vrm', (gltf) => {
          VRMUtils.removeUnnecessaryJoints(gltf.scene);
          VRM.from(gltf).then( (vrm) => {
            this.person2 = vrm;
            vrm.humanoid.getBoneNode( VRMSchema.HumanoidBoneName.Hips ).rotation.y = Math.PI;
            this.playBlinkAnimationPerson2();
            this.target2SkeletonHelper = new SkeletonHelper(vrm.scene.children[0]);
            this.loadBVH();
          })
        });
      })
    });
  }

  private playBlinkAnimationPerson1() {
    this.mixerBlink1 = new AnimationMixer( this.person1.scene );

    const blinkTrack = new NumberKeyframeTrack(
      this.person1.blendShapeProxy.getBlendShapeTrackName( VRMSchema.BlendShapePresetName.Blink ), // name
      [ 0.0, 0.5, 1.0 ], // times
      [ 0.0, 1.0, 0.0 ] // values
    );

    const clip = new AnimationClip( 'blink', 1, [ blinkTrack ] );
    this.animationAction = this.mixerBlink1.clipAction( clip ).setLoop(LoopOnce, 1)
    this.animationAction.play();
    setTimeout( () => {
        this.playBlinkAnimationPerson1()
      }, 4000
    )
  }

  private playBlinkAnimationPerson2() {
    this.mixerBlink2 = new AnimationMixer( this.person2.scene );

    const blinkTrack = new NumberKeyframeTrack(
      this.person2.blendShapeProxy.getBlendShapeTrackName( VRMSchema.BlendShapePresetName.Blink ), // name
      [ 0.0, 0.5, 1.0 ], // times
      [ 0.0, 1.0, 0.0 ] // values
    );

    const clip = new AnimationClip( 'blink', 1, [ blinkTrack ] );
    this.animationAction = this.mixerBlink2.clipAction( clip ).setLoop(LoopOnce, 1)
    this.animationAction.play();
    setTimeout( () => {
        this.playBlinkAnimationPerson2()
      }, 4000
    )
  }

  loadBVH = () => {
    let loader = new BVHLoader();
    loader.load("/shared/bvh/60/60_01_scaled.bvh", (bvh) => {
      this.bvh1 = bvh;
      this.source1SkeletonHelper = new SkeletonHelper(bvh.skeleton.bones[0]);
      this.source1SkeletonHelper.skeleton = bvh.skeleton;
      loader.load("/shared/bvh/61/61_01_scaled.bvh", (bvh) => {
        this.bvh2 = bvh;
        this.source2SkeletonHelper = new SkeletonHelper(bvh.skeleton.bones[0]);
        this.source2SkeletonHelper.skeleton = bvh.skeleton;
        this.startShow();
      });
    });
  }

  private startShow() {
    this.isAnimationStarted = true;
    this.mixerDance1 = new AnimationMixer(this.source1SkeletonHelper);
    this.mixerDance2 = new AnimationMixer(this.source2SkeletonHelper);
    setTimeout(() => {
        console.log("Start animation");
        this.scene.add(this.person1.scene);
        this.scene.add(this.person2.scene);
        this.mixerDance1.clipAction(this.bvh1.clip).setEffectiveWeight(1.0).setLoop(LoopRepeat, 5).play();
        this.mixerDance2.clipAction(this.bvh2.clip).setEffectiveWeight(1.0).setLoop(LoopRepeat, 5).play();
        setTimeout(() => {
          console.log("Stop animation");
          this.isAnimationStarted = false;
        }, this.bvh1.clip.duration * 1000 * 5)
      }, 5
    )
    this.audioElement.play();
  }

  update() {
    let delta = this.clock.getDelta();
    if (this.mixerDance1 && this.mixerDance2) {
      this.mixerDance1.update(delta);
      this.mixerDance2.update(delta);
      if (this.isAnimationStarted) {
        VrmSkeletonUtils.retarget(this.person1.scene.children[4].children[0], this.source1SkeletonHelper, this.options);
        VrmSkeletonUtils.retarget(this.person2.scene.children[4].children[0], this.source2SkeletonHelper, this.options);
      }
    }
    if (this.mixerBlink1) {
      this.mixerBlink1.update(delta);
    }
    if (this.person1) {
      this.person1.update(delta);
    }
    if (this.mixerBlink2) {
      this.mixerBlink2.update(delta);
    }
    if (this.person2) {
      this.person2.update(delta);
    }
  }

  updateHandPose(result) {
    if (this.handPoseManager) {
      this.handPoseManager.renderHands(result);
      if (!this.isAnimationStarted) {
        if (this.handPoseManager.isOpenHand()) {
          this.startShow();
        }
      }
    }
  }

  handleGesture(gesture: GestureType) {
    if (gesture == GestureType.openHand) {
      if (!this.isAnimationStarted) {
        this.startShow();
      }
    }
  }

  getInitialCameraAngle(): number {
    return 0;
  }

  getInitialCameraPosition(): Vector3 {
    return new Vector3(-0.5, 1.75, 4);
  }
}
