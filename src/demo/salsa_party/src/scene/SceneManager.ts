import {
  AnimationClip,
  AnimationMixer,
  LoopOnce,
  NumberKeyframeTrack,
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
import VrmSkeletonUtils from '../worker/VrmSkeletonUtils';
import SceneManagerParent from '../../../../shared/scene/SceneManagerParent';
import DanceCouple from './DanceCouple';
import Stats from "three/examples/jsm/libs/stats.module";

export default class SceneManager extends SceneManagerParent  {
  private mixerDance1: AnimationMixer;
  private mixerDance2: AnimationMixer;
  private isAnimationStarted: boolean;
  private person1: VRM;
  private person2: VRM;
  private source1SkeletonHelper: SkeletonHelper;
  private source2SkeletonHelper: SkeletonHelper;
  private stats = new Stats();

  private options1 = {
    hip: "hip",
    preservePosition: false,
    preserveHipPosition: false,
    useTargetMatrix: true,
    rotateModel: true,
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
  private options = {
    hip: "hip",
    preservePosition: false,
    preserveHipPosition: false,
    useTargetMatrix: true,
    rotateModel: false,
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
  private danceCouples: {leader: VRM, follower: VRM}[] = [];
  private modelNames: DanceCouple[] = [
    // { leader: "kenji", follower: "zombie", offsetX: -2.3, offsetZ: 0 },
    { leader: "kenji", follower: "female_redshirt", offsetX: -2.2, offsetZ: -1.5 },
    // { leader: "frost", follower: "kiku", offsetX: 0, offsetZ: 1.5 },
    // { leader: "emerald", follower: "soul_eon", offsetX: 2.2, offsetZ: -3 },
    { leader: "keiichi", follower: "naomi", offsetX: 2.2, offsetZ: -1.5 },
    // // // { leader: "shiro", follower: "female_redshirt", offsetX: 2.2, offsetZ: 1.5 },
    // { leader: "shiro", follower: "blackshirt", offsetX: 1, offsetZ: -1 },
    // // // { leader: "male_chinstripe", follower: "zombie", offsetX: 2.3, offsetZ: -1.5 },
    { leader: "eric", follower: "kat", offsetX: 0, offsetZ: -3 },
    // { leader: "davdino", follower: "vampire", offsetX: -2.3, offsetZ: 1.5 }
  ];
  private animationActionsEndOfDance: VRM[] = [];
  private animationMixersEndOfDance: AnimationMixer[] = [];
  private animationActionsBlink: VRM[] = [];
  private animationMixersBlink: AnimationMixer[] = [];

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler) {
    super.build(camera, scene, renderer, physicsHandler);
    // this.stats.showPanel(0); // TODO: not for XR mode
    document.body.appendChild(this.stats.dom);
    this.sceneHelper.addLight(true);
    this.audioHandler.initAudio(AudioDemo.salsaDanceSlow);
    this.audioHandler.setPosition(new Vector3(-3, 2, 1));
    this.audioElement = this.audioHandler.audioElement;
    this.audioElement.loop = true;
    this.loadModels();
  }

  // kenji + three vrm girl
  // black shirt (lang) + ?
  // zombie
  // frost
  // kiku
  // kat
  // valentine (open rug)
  // eric (too warm cloths, open spots at shoulder)
  // male_chinstripe
  // female_redshirt
  // shiro (1.89m)
  // naomi
  // keiichi
  // soul eon
  // emerald
  // mawi

  private loadModels2(modelNames: DanceCouple[]) {
    let gltfLoader = new GLTFLoader();
    gltfLoader.register((parser) => new VRMLoaderPlugin(parser));
    for (let i = 0; i < modelNames.length; i ++) {
      console.log('Loading model ' + modelNames[i].leader);
      gltfLoader.loadAsync('/shared/vrm/' + modelNames[i].leader + '.vrm').then((gltf) => {
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.removeUnnecessaryJoints(gltf.scene);
        this.scene.add(gltf.userData.vrm.scene);
        gltf.scene.children[5].position.x = modelNames[i].offsetX;
        gltf.scene.children[5].position.z = modelNames[i].offsetZ;
        gltf.scene.traverse( function( object ) {

          object.frustumCulled = false;

        } );
        this.initHappyAnimation(gltf.userData.vrm);
        this.initBlinkAnimation(gltf.userData.vrm);
        console.log('Loading model ' + modelNames[i].follower);
        gltfLoader.loadAsync('/shared/vrm/' + modelNames[i].follower + '.vrm').then((gltf2) => {
          VRMUtils.removeUnnecessaryVertices(gltf2.scene);
          VRMUtils.removeUnnecessaryJoints(gltf2.scene);
          gltf2.scene.children[5].position.x = modelNames[i].offsetX;
          gltf2.scene.children[5].position.z = modelNames[i].offsetZ;
          gltf2.scene.traverse( function( object ) {

            object.frustumCulled = false;

          } );
          this.initHappyAnimation(gltf2.userData.vrm);
          this.initBlinkAnimation(gltf2.userData.vrm);
          this.danceCouples.push({ leader: gltf.userData.vrm, follower: gltf2.userData.vrm });
          this.scene.add(gltf2.userData.vrm.scene);
        });
      });
    }
  }

  private loadModels() {
    const loader = new GLTFLoader();
    loader.load('models/scene.gltf', (gltf) => {
      let model = gltf.scene;
      model.position.y = +3.65;
      model.position.z = -1;
      // model.position.x = -2;
      // model.rotateY(Math.PI/2);
      this.scene.add(model);
    });
    this.loadModels2(this.modelNames);
    let gltfLoader = new GLTFLoader();
    gltfLoader.register((parser) => new VRMLoaderPlugin(parser));
    gltfLoader.loadAsync('/shared/vrm/mawi.vrm').then((gltf) => {
      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.removeUnnecessaryJoints(gltf.scene);
      const vrm = gltf.userData.vrm;
      console.log(vrm);
      this.person1 = vrm;
      gltf.scene.traverse( function( object ) {

        object.frustumCulled = false;

      } );
      this.initBlinkAnimation(vrm);
      this.initHappyAnimation(vrm);
      gltfLoader.loadAsync('/shared/vrm/VRM1_Constraint_Twist_Sample.vrm').then((gltf) => {
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.removeUnnecessaryJoints(gltf.scene);
        this.person2 = gltf.userData.vrm;
        this.initBlinkAnimation(gltf.userData.vrm);
        this.initHappyAnimation(gltf.userData.vrm);
        this.loadBVH(1);
        gltf.scene.traverse( function( object ) {

          object.frustumCulled = false;

        } );
        this.playBlinkAnimations();
        this.audioElement.play();
      })
    });
  }

  private playBlinkAnimations() {
    for (let i = 0; i < this.animationMixersBlink.length; i++) {
      const blinkTrack = new NumberKeyframeTrack(
        this.animationActionsBlink[i].expressionManager.getExpressionTrackName( VRMExpressionPresetName.Blink ),
        [ 0.0, 0.5, 1.0 ], // times
        [ 0.0, 1.0, 0.0 ] // values
      );
      const clip = new AnimationClip( 'blink', 1, [ blinkTrack ] );
      let animationAction = this.animationMixersBlink[i].clipAction( clip ).setLoop(LoopOnce, 1);
      animationAction.play();
      // console.log('blink ' + i);
    }
    setTimeout( () => {
        this.playBlinkAnimations();
      }, 4000
    )
  }

  private initBlinkAnimation(dancer: VRM) {
    let mixerBlink = new AnimationMixer( dancer.scene );
    this.animationActionsBlink.push(dancer);
    this.animationMixersBlink.push(mixerBlink);
  }

  private initHappyAnimation(dancer: VRM) {
    let mixerHappy = new AnimationMixer( dancer.scene );
    this.animationActionsEndOfDance.push(dancer);
    this.animationMixersEndOfDance.push(mixerHappy);
  }

  private playHappyAnimations() {
    console.log('Play happy animations: ' + this.animationMixersEndOfDance.length);
    for (let i = 0; i < this.animationMixersEndOfDance.length; i++) {
      const happyTrack = new NumberKeyframeTrack(
        this.animationActionsEndOfDance[i].expressionManager.getExpressionTrackName( VRMExpressionPresetName.Happy ),
        [ 0.0, 0.5, 1.0 ], // times
        [ 0.0, 0.5, 1.0 ] // values
      );
      const clip = new AnimationClip( 'happy', 1, [ happyTrack ] );
      let animationAction = this.animationMixersEndOfDance[i].clipAction( clip ).setLoop(LoopOnce, 1);
      animationAction.play();
    }
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
      this.playHappyAnimations();
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
      this.playHappyAnimations();
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
    // this.stats.begin();
    let delta = this.clock.getDelta();
    if (this.mixerDance1 && this.mixerDance2) {
      this.mixerDance1.update(delta/this.slowDownFactor);
      this.mixerDance2.update(delta/this.slowDownFactor);
      if (this.isAnimationStarted) {
        VrmSkeletonUtils.retarget(this.person1.scene.children[5], this.source1SkeletonHelper, this.options1);
        VrmSkeletonUtils.retarget(this.person2.scene.children[5], this.source2SkeletonHelper, this.options);
        if (this.danceCouples && this.danceCouples.length > 0) {
          for (let i = 0; i < this.danceCouples.length; i++) {
            VrmSkeletonUtils.retarget(this.danceCouples[i].leader.scene.children[5], this.source1SkeletonHelper, this.options1);
            VrmSkeletonUtils.retarget(this.danceCouples[i].follower.scene.children[5], this.source2SkeletonHelper, this.options1);
          }
        }
        if (this.person1) {
          this.person1.update(delta);
        }
        if (this.person2) {
          this.person2.update(delta);
        }
        if (this.danceCouples && this.danceCouples.length > 0) {
          for (let i = 0; i < this.danceCouples.length; i++) {
            this.danceCouples[i].leader.update(delta);
            this.danceCouples[i].follower.update(delta);
          }
        }
      }
    }
    if (this.animationMixersEndOfDance.length > 0) {
      for (let i = 0; i < this.animationMixersEndOfDance.length; i++) {
        this.animationMixersEndOfDance[i].update(delta);
      }
    }
    if (this.animationMixersBlink.length > 0) {
      for (let i = 0; i < this.animationMixersBlink.length; i++) {
        this.animationMixersBlink[i].update(delta);
      }
    }
    // this.stats.end();
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
    return new Vector3(0, 0.75, -1.5);
  }
}
