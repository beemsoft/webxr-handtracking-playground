import {
  AnimationClip,
  AnimationMixer,
  LoopOnce,
  NumberKeyframeTrack,
  Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer
} from 'three/src/Three';
import PhysicsHandler from '../../../../shared/physics/PhysicsHandler';
import { GestureType, HandTrackingResult } from '../../../../shared/scene/SceneManagerInterface';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { VRM, VRMExpressionPresetName, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { AnimationAction } from 'three/src/animation/AnimationAction';
import { BVH, BVHLoader } from 'three/examples/jsm/loaders/BVHLoader';
import SkeletonHelper from '../../../../shared/model/SkeletonHelper';
import AudioHandler, { AudioDemo } from '../../../../shared/audio/AudioHandler';
import VrmSkeletonUtils from '../../../../shared/model/VrmSkeletonUtils';
import SceneManagerParent from '../../../../shared/scene/SceneManagerParent';

export default class SceneManager extends SceneManagerParent  {
  private mixerBlink1: AnimationMixer;
  private mixerBlink2: AnimationMixer;
  private mixerHappy1: AnimationMixer;
  private mixerHappy2: AnimationMixer;
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
  private target1Skeleton: Object3D;
  private target2Skeleton: Object3D;

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

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler) {
    super.build(camera, scene, renderer, physicsHandler);
    this.sceneHelper.addLight(true);
    this.audioHandler.initAudio(AudioDemo.salsaDanceSlow);
    this.audioHandler.setPosition(new Vector3(-3, 2, 1));
    this.audioElement = this.audioHandler.audioElement;
    this.audioElement.loop = true;
    this.loadBar(scene);
    this.loadModels();
  }

  private loadBar(scene: Scene) {
    const loader = new GLTFLoader();
    loader.load('models/gltf/Bar scene.glb', (gltf) => {
      let model = gltf.scene;
      model.scale.set(0.35, 0.35, 0.35);
      model.position.y = -0.43;
      model.position.z = -0.5;
      model.position.x = 0.3;
      scene.add(model);
    });
  }

  private loadModels() {
    let gltfLoader = new GLTFLoader();
    gltfLoader.register((parser) => new VRMLoaderPlugin(parser));
    gltfLoader.loadAsync('/shared/vrm/VRM1_Constraint_Twist_Sample.vrm').then((gltf) => {
      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.removeUnnecessaryJoints(gltf.scene);
      const vrm = gltf.userData.vrm;
      this.person1 = vrm;
      gltf.scene.traverse( function( object ) {
        object.frustumCulled = false;
      } );
      this.playBlinkAnimationPerson1();
      this.target1SkeletonHelper = new SkeletonHelper(vrm.scene.children[0]);
      this.target1Skeleton = this.person1.scene.children[5]
      gltfLoader.loadAsync('/shared/vrm/VRM1_Constraint_Twist_Sample.vrm').then((gltf) => {
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.removeUnnecessaryJoints(gltf.scene);
        this.person2 = gltf.userData.vrm;
        gltf.scene.traverse( function( object ) {
          object.frustumCulled = false;
        } );
        this.playBlinkAnimationPerson2();
        this.target2SkeletonHelper = new SkeletonHelper(vrm.scene.children[0]);
        this.target2Skeleton = this.person2.scene.children[5]
        this.loadBVH(1);
        this.audioElement.play();
      })
    });
  }

  private playBlinkAnimationPerson1() {
    this.mixerBlink1 = new AnimationMixer( this.person1.scene );
    const blinkTrack = new NumberKeyframeTrack(
      this.person1.expressionManager.getExpressionTrackName( VRMExpressionPresetName.Blink ),
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

  private playHappyAnimationPerson1() {
    this.mixerHappy1 = new AnimationMixer( this.person1.scene );
    const happyTrack = new NumberKeyframeTrack(
      this.person1.expressionManager.getExpressionTrackName( VRMExpressionPresetName.Happy ),
      [ 0.0, 0.5, 1.0 ], // times
      [ 0.0, 0.5, 1.0 ] // values
    );
    const clip = new AnimationClip( 'happy', 1, [ happyTrack ] );
    this.animationAction = this.mixerHappy1.clipAction( clip ).setLoop(LoopOnce, 1)
    this.animationAction.play();
  }

  private playHappyAnimationPerson2() {
    this.mixerHappy2 = new AnimationMixer( this.person2.scene );
    const happyTrack = new NumberKeyframeTrack(
      this.person2.expressionManager.getExpressionTrackName( VRMExpressionPresetName.Happy ),
      [ 0.0, 0.5, 1.0 ], // times
      [ 0.0, 0.5, 1.0 ] // values
    );
    const clip = new AnimationClip( 'happy', 1, [ happyTrack ] );
    this.animationAction = this.mixerHappy2.clipAction( clip ).setLoop(LoopOnce, 1)
    this.animationAction.play();
  }

  private playBlinkAnimationPerson2() {
    this.mixerBlink2 = new AnimationMixer( this.person2.scene );
    const blinkTrack = new NumberKeyframeTrack(
      this.person2.expressionManager.getExpressionTrackName( VRMExpressionPresetName.Blink ),
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

  loadBVH(move) {
    let loader = new BVHLoader();
    let moveStr = move;
    if (move < 10) {
       moveStr = "0" + move;
    }
    loader.load("/shared/bvh/60/60_" + moveStr + "_scaled.bvh", (bvh) => {
      this.bvh1 = bvh;
      this.source1SkeletonHelper = new SkeletonHelper(bvh.skeleton.bones[0]);
      this.source1SkeletonHelper.skeleton = bvh.skeleton;
      loader.load("/shared/bvh/61/61_" + moveStr + "_scaled.bvh", (bvh) => {
        this.bvh2 = bvh;
        this.source2SkeletonHelper = new SkeletonHelper(bvh.skeleton.bones[0]);
        this.source2SkeletonHelper.skeleton = bvh.skeleton;
        this.startShow(move);
        this.preloadBVH(move + 1);
      });
    });
  }

  doNext(move) {
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
    setTimeout(() => {
      console.log("animation happy");
      this.playHappyAnimationPerson1();
      this.playHappyAnimationPerson2();
    }, (this.bvh1.clip.duration * 1000 * this.slowDownFactor) - 2000)
  }

  preloadBVH(move) {
    let loader = new BVHLoader();
    let moveStr = move;
    if (move < 10) {
      moveStr = "0" + move;
    }
    loader.load("/shared/bvh/60/60_" + moveStr + "_scaled.bvh", (bvh) => {
      this.nextBvh1 = bvh;
      loader.load("/shared/bvh/61/61_" + moveStr + "_scaled.bvh", (bvh) => {
        this.nextBvh2 = bvh;
       });
    });
  }

  private startShow(move) {
    console.log("Play move " + move + " for second: " + this.bvh1.clip.duration * this.slowDownFactor);
    this.isAnimationStarted = true;
    this.mixerDance1 = new AnimationMixer(this.source1SkeletonHelper);
    this.mixerDance2 = new AnimationMixer(this.source2SkeletonHelper);
    console.log("Start animation");
    this.scene.add(this.person1.scene);
    this.scene.add(this.person2.scene);
    this.mixerDance1.clipAction(this.bvh1.clip).play();
    this.mixerDance2.clipAction(this.bvh2.clip).play();
    setTimeout(() => {
      console.log("animation happy");
      this.playHappyAnimationPerson1();
      this.playHappyAnimationPerson2();
    }, (this.bvh1.clip.duration * 1000 * this.slowDownFactor) - 2000)
    setTimeout(() => {
      console.log("Stop animation");
      if (move < 15) {
        this.doNext(move + 1);
      } else {
        this.isAnimationStarted = false;
      }
    }, this.bvh1.clip.duration * 1000 * this.slowDownFactor)
  }

  update() {
    let delta = this.clock.getDelta();
    if (this.mixerDance1 && this.mixerDance2) {
      this.mixerDance1.update(delta/this.slowDownFactor);
      this.mixerDance2.update(delta/this.slowDownFactor);
      if (this.isAnimationStarted) {
        VrmSkeletonUtils.retarget(this.target1Skeleton, this.source1SkeletonHelper, this.options);
        VrmSkeletonUtils.retarget(this.target2Skeleton, this.source2SkeletonHelper, this.options);
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
    if (this.mixerHappy1) {
      this.mixerHappy1.update(delta);
    }
    if (this.mixerHappy2) {
      this.mixerHappy2.update(delta);
    }
  }

  updateHandPose(result) {
    if (this.handPoseManager) {
      this.handPoseManager.renderHands(result);
      if (!this.isAnimationStarted) {
        if (this.handPoseManager.isOpenHand()) {
          this.startShow(1);
        }
      }
    }
  }

  handleGesture(gesture: HandTrackingResult) {
    if (gesture.gestureType == GestureType.Open_Hand) {
      if (!this.isAnimationStarted) {
        this.startShow(1);
      }
    }
  }

  getInitialCameraPosition(): Vector3 {
    return new Vector3(-0.5, 1.75, 4);
  }
}
