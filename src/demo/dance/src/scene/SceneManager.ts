import {
  AnimationMixer,
  Color,
  GridHelper,
  Group,
  LoopOnce,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer
} from 'three/src/Three';
import PhysicsHandler from '../../../../shared/physics/cannon/PhysicsHandler';
import { GestureType, HandTrackingResult } from '../../../../shared/scene/SceneManagerInterface';
import AudioHandler, { AudioDemo } from '../../../../shared/audio/AudioHandler';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { BVH, BVHLoader } from 'three/examples/jsm/loaders/BVHLoader';
import SkeletonUtils from '../../../../shared/model/SkeletonUtils';
import SkeletonHelper from '../../../../shared/model/SkeletonHelper';
import SceneManagerParent from '../../../../shared/scene/SceneManagerParent';

export default class SceneManager extends SceneManagerParent {
  private player: any;
  private skeletonHelper: SkeletonHelper;
  private boneContainer: Group;
  private options = {
    hip: "hips_JNT",
    preservePosition: false,
    preserveHipPosition: false,
    useTargetMatrix: true,
    names: {
      "mixamorigHips": "hips_JNT",
      "mixamorigSpine": "spine_JNT",
      "mixamorigSpine1": "spine1_JNT",
      "mixamorigSpine2": "spine2_JNT",
      "mixamorigNeck": "neck_JNT",
      "mixamorigHead": "head_JNT",

      "mixamorigRightArm": "r_arm_JNT",
      "mixamorigRightForeArm": "r_forearm_JNT",
      "mixamorigRightHand": "r_hand_JNT",

      "mixamorigLeftArm": "l_arm_JNT",
      "mixamorigLeftForeArm": "l_forearm_JNT",
      "mixamorigLeftHand": "l_hand_JNT",

      "mixamorigRightUpLeg": "r_upleg_JNT",
      "mixamorigRightLeg": "r_leg_JNT",
      "mixamorigRightFoot": "r_foot_JNT",

      "mixamorigLeftUpLeg": "l_upleg_JNT",
      "mixamorigLeftLeg": "l_leg_JNT",
      "mixamorigLeftFoot": "l_foot_JNT"
    }
  };
  private audioHandler = new AudioHandler();
  private audioElement: HTMLAudioElement;
  private isAnimationStarted: boolean;
  private bvh: BVH;

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler) {
    super.build(camera, scene, renderer, physicsHandler);
    this.sceneHelper.addLight(true);
    this.audioHandler.initAudio(AudioDemo.dance);
    this.audioElement = this.audioHandler.audioElement;
    this.audioElement.loop = false;
    this.scene.background = new Color( 0xeeeeee );
    let grid = new GridHelper(400, 50);
    this.scene.add( grid );
    this.loadModel(scene);
    this.sceneHelper.addMessage('Show open hand to start the dance!', renderer.capabilities.getMaxAnisotropy());
  }

  private loadModel(scene: Scene) {
    const loader = new GLTFLoader();
    loader.load('models/gltf/Xbot.glb', (gltf) => {
      let model = gltf.scene;
      scene.add(model);
      this.player = model;
      let skeleton = new SkeletonHelper(model);
      skeleton.visible = true;
      scene.add(skeleton);
      this.loadBVH();
    });
  }

  loadBVH = () => {
    let loader = new BVHLoader();
    loader.load( "models/bvh/Samy.bvh", (bvh) => {
      this.bvh = bvh;
      this.skeletonHelper = new SkeletonHelper( bvh.skeleton.bones[0]);
      // @ts-ignore
      this.skeletonHelper.skeleton = bvh.skeleton;
      this.adjustScale(bvh, 1.05);
      this.boneContainer = new Group();
      this.boneContainer.add( bvh.skeleton.bones[ 0 ] );
      this.scene.add( this.skeletonHelper );
      this.scene.add( this.boneContainer );
    } );
  }

  private adjustScale(bvh: BVH, scale: number) {
    for (let i = 0; i < bvh.skeleton.bones.length; ++i) {
      let bone = bvh.skeleton.bones[i];
      bone.scale.copy(new Vector3(scale, scale, scale));
    }
  }

  private startShow(bvh: BVH) {
    setTimeout(() => {
        console.log("Start animation");
        this.mixer = new AnimationMixer( this.skeletonHelper );
        this.mixer.clipAction(bvh.clip).setEffectiveWeight(1.0).setLoop(LoopOnce, 1).play();
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
    if (this.isAnimationStarted && this.mixer) {
      this.mixer.update(delta);
      SkeletonUtils.retarget(this.player.children[0].children[1], this.skeletonHelper, this.options);
    }
  }

  updateHandPose(result) {
    if (this.handPoseManager) {
      this.handPoseManager.renderHands(result);
      if (!this.isAnimationStarted) {
        if (this.handPoseManager.isOpenHand()) {
          this.isAnimationStarted = true;
          this.startShow(this.bvh);
        }
      }
    }
  }

  handleGesture(gesture: HandTrackingResult) {
    if (gesture.gestureType == GestureType.Open_Hand) {
      if (!this.isAnimationStarted) {
        this.isAnimationStarted = true;
        this.startShow(this.bvh);
      }
    }
  }

  getInitialCameraPosition(): Vector3 {
    return new Vector3(-0.5, 1.75, 4);
  }
}
