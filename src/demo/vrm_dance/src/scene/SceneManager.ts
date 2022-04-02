import {
  AnimationClip,
  AnimationMixer,
  Clock,
  GridHelper,
  Group,
  LoopOnce,
  NumberKeyframeTrack,
  Object3D,
  PerspectiveCamera,
  Scene,
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
import VrmSkeletonUtils from '../../../../shared/model/VrmSkeletonUtils';

export default class SceneManager implements SceneManagerInterface {
  private scene: Scene;
  private sceneHelper: SceneHelper;
  private physicsHandler: PhysicsHandler;
  private handPoseManager: HandPoseManager;
  private clock = new Clock();
  private mixer1: AnimationMixer;
  private mixer2: AnimationMixer;
  private isAnimationStarted: boolean;
  private currentVrm: VRM;
  private lookAtTarget = new Object3D();
  private animationAction: AnimationAction;
  private sourceSkeletonHelper: SkeletonHelper;
  private targetSkeletonHelper: SkeletonHelper;
  private boneContainer: Group;
  private options = {
    hip: "hips_JNT",
    preservePosition: false,
    preserveHipPosition: false,
    useTargetMatrix: true,
    names: {
      "J_Bip_C_Hips": "hips_JNT",                    // 9
      "J_Bip_C_Spine": "spine_JNT",                  // 8
      "J_Bip_C_Chest": "spine1_JNT",                 // 5
      "J_Bip_C_UpperChest": "spine2_JNT",            // 4
      "J_Bip_C_Neck": "neck_JNT",                    // 2
      "J_Bip_C_Head": "head_JNT",                    // 0

      "J_Bip_R_Shoulder": "r_shoulder_JNT",          // 7
      "J_Bip_R_UpperArm": "r_arm_JNT",               // 22
      "J_Bip_R_LowerArm": "r_forearm_JNT",           // 14
      "J_Bip_R_Hand": "r_hand_JNT",                  // 23

      "J_Bip_L_Shoulder": "l_shoulder_JNT",          // 1
      "J_Bip_L_UpperArm": "l_arm_JNT",               // 20
      "J_Bip_L_LowerArm": "l_forearm_JNT",           // 3
      "J_Bip_L_Hand": "l_hand_JNT",                  // 21

      "J_Bip_R_UpperLeg": "r_upleg_JNT",            // 12
      "J_Bip_R_LowerLeg": "r_leg_JNT",              // 18
      "J_Bip_R_Foot": "r_foot_JNT",                 // 19

      "J_Bip_L_UpperLeg": "l_upleg_JNT",            // 10
      "J_Bip_L_LowerLeg": "l_leg_JNT",              // 16
      "J_Bip_L_Foot": "l_foot_JNT"                  // 17
    }
  };
  private audioHandler = new AudioHandler();
  private audioElement: HTMLAudioElement;
  private bvh: BVH;

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler) {
    this.scene = scene;
    this.sceneHelper = new SceneHelper(scene);
    this.physicsHandler = physicsHandler;
    this.sceneHelper.addLight(false);
    this.audioHandler.initAudio(AudioDemo.dance);
    this.audioElement = this.audioHandler.audioElement;
    this.audioElement.loop = false;
    this.loadModel(scene);
    this.sceneHelper.addMessage('Show open hand to start the dance!', renderer.capabilities.getMaxAnisotropy());
    this.handPoseManager = new HandPoseManager(scene, physicsHandler);
    camera.add(this.lookAtTarget);
    const gridHelper = new GridHelper( 10, 10 );
    this.scene.add( gridHelper );
  }

  private loadModel(scene: Scene) {
    new GLTFLoader().load('models/vrm/three-vrm-girl.vrm', (gltf) => {
      VRMUtils.removeUnnecessaryJoints(gltf.scene);
      VRM.from(gltf).then( (vrm) => {
        console.log( vrm );
        let model = vrm.scene;
        scene.add(model);
        this.currentVrm = vrm;
        vrm.humanoid.getBoneNode( VRMSchema.HumanoidBoneName.Hips ).rotation.y = Math.PI;
        vrm.lookAt.target = this.lookAtTarget;
        this.prepareAnimation();
        this.targetSkeletonHelper = new SkeletonHelper(vrm.scene.children[0]);
        this.loadBVH();
      })
    });
  }

  private prepareAnimation() {
    this.playAnimation();
  }

  private playAnimation() {
    this.mixer1 = new AnimationMixer( this.currentVrm.scene );

    const blinkTrack = new NumberKeyframeTrack(
      this.currentVrm.blendShapeProxy.getBlendShapeTrackName( VRMSchema.BlendShapePresetName.Blink ), // name
      [ 0.0, 0.5, 1.0 ], // times
      [ 0.0, 1.0, 0.0 ] // values
    );

    const clip = new AnimationClip( 'blink', 1, [ blinkTrack ] );
    this.animationAction = this.mixer1.clipAction( clip ).setLoop(LoopOnce, 1)
    this.animationAction.play();
    setTimeout( () => {
        this.playAnimation()
      }, 4000
    )
  }

  loadBVH = () => {
    let loader = new BVHLoader();
    loader.load( "models/bvh/Samy.bvh", (bvh) => {
      this.bvh = bvh;
      this.sourceSkeletonHelper = new SkeletonHelper( bvh.skeleton.bones[0]);
      this.sourceSkeletonHelper.skeleton = bvh.skeleton;
      this.boneContainer = new Group();
      this.boneContainer.add( bvh.skeleton.bones[ 0 ] );
    } );
  }

  private startShow() {
    this.mixer2 = new AnimationMixer( this.sourceSkeletonHelper );
    setTimeout(() => {
        console.log("Start animation");
        this.mixer2.clipAction(this.bvh.clip).setEffectiveWeight(1.0).setLoop(LoopOnce, 1).play();
        setTimeout( () => {
          console.log("Stop animation");
          this.isAnimationStarted = false;
        }, this.bvh.clip.duration * 1000)
      }, 3200
    )
    this.audioElement.play();
  }

  update() {
    let delta = this.clock.getDelta();
    if (this.mixer2) {
      this.mixer2.update(delta);
      if (this.isAnimationStarted) {
        VrmSkeletonUtils.retarget(this.currentVrm.scene.children[4].children[0], this.sourceSkeletonHelper, this.options);
      }
    }
    if (this.mixer1) {
      this.mixer1.update(delta);
    }
    if (this.currentVrm) {
      this.currentVrm.update(delta);
    }
  }

  updateHandPose(result) {
    if (this.handPoseManager) {
      this.handPoseManager.renderHands(result);
      if (!this.isAnimationStarted) {
        if (this.handPoseManager.isOpenHand()) {
          this.isAnimationStarted = true;
          this.startShow();
        }
      }
    }
  }

  handleGesture(gesture: GestureType) {
    if (gesture == GestureType.openHand) {
      if (!this.isAnimationStarted) {
        this.isAnimationStarted = true;
        this.startShow();
      }
    }
  }
}
