import {
  AnimationMixer,
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
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { BVH, BVHLoader } from 'three/examples/jsm/loaders/BVHLoader';
import SkeletonHelper from '../../../../shared/model/SkeletonHelper';
import VrmSkeletonUtils from '../model/VrmSkeletonUtils';
import SceneManagerParent from '../../../../shared/scene/SceneManagerParent';

export default class SceneManager extends SceneManagerParent {
  private isAnimationStarted: boolean;
  private player: any;
  private sourceSkeletonHelper: SkeletonHelper;
  private targetSkeletonHelper: SkeletonHelper;
  private boneContainer: Group;
  private options = {
    hip: "hip",
    preservePosition: false,
    preserveHipPosition: false,
    useTargetMatrix: true,
    names: {
      "spine": "hip",          // 0
      "spine001": "abdomen",       // 1
      "spine002": "chest",       // 2
      "spine003": "abdomen",    // 3
      "spine004": "chest",     // 4
      "spine005": "neck",        //5
      "spine006": "head",       // 6

      "shoulderR": "rCollar",  // 22
      "upper_armR": "rShldr",   // 23
      "forearmR": "rForeArm", // 24
      "handR": "rHand",        // 25

      "shoulderL": "lCollar",  // 7
      "upper_armL": "lShldr",    // 8
      "forearmL": "lForeArm",  // 9
      "handL": "lHand",        // 10

      "pelvisL": "lButtock", // 39
      "pelvisR": "rButtock", // 40

      "thighR": "rThigh",    // 46
      "shinR": "rShin",       // 47
      "footR": "rFoot",      // 48

      "thighL": "lThigh",   // 41
      "shinL": "lShin",     // 42
      "footL": "lFoot"     // 43
    }
  };
  private bvh: BVH;

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler) {
    super.build(camera, scene, renderer, physicsHandler);
    this.sceneHelper.addLight(true);
    this.loadModel(scene);
    const gridHelper = new GridHelper( 10, 10 );
    this.scene.add( gridHelper );
  }

  private loadModel(scene: Scene) {
    new GLTFLoader().load('models//pirate/10MinutePirateRig_parented_colored2.glb', (gltf) => {
      console.log( gltf );
      let model = gltf.scene;
      scene.add(model);
      this.player = gltf;
      this.targetSkeletonHelper = new SkeletonHelper(gltf.scene.children[0].children[0]);
      this.targetSkeletonHelper.visible = true;
      this.scene.add(this.targetSkeletonHelper);
      this.loadBVH();
    });
  }

  loadBVH = () => {
    let loader = new BVHLoader();
    loader.load( "/shared/bvh/91_09_scaled_down7.bvh", (bvh) => {
      this.bvh = bvh;
      this.sourceSkeletonHelper = new SkeletonHelper( bvh.skeleton.bones[0]);
      this.sourceSkeletonHelper.skeleton = bvh.skeleton;
      this.boneContainer = new Group();
      this.boneContainer.add( bvh.skeleton.bones[ 0 ] );
      this.scene.add( this.sourceSkeletonHelper );
    } );
  }

  private startShow() {
    this.mixer = new AnimationMixer( this.sourceSkeletonHelper );
    setTimeout(() => {
        console.log("Start animation");
        this.mixer.clipAction(this.bvh.clip).setEffectiveWeight(1.0).setLoop(LoopOnce, 1).play();
        setTimeout( () => {
          console.log("Stop animation");
          this.isAnimationStarted = false;
        }, this.bvh.clip.duration * 1000)
      }, 3200
    )
  }

  update() {
    let delta = this.clock.getDelta();
    if (this.mixer) {
      this.mixer.update(delta);
      if (this.isAnimationStarted && this.player) {
        VrmSkeletonUtils.retarget(this.player.scene.children[0].children[0], this.sourceSkeletonHelper, this.options);
      }
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

  handleGesture(gesture: HandTrackingResult) {
    if (gesture.gestureType == GestureType.Open_Hand) {
      if (!this.isAnimationStarted) {
        this.isAnimationStarted = true;
        this.startShow();
      }
    }
  }

  getInitialCameraPosition(): Vector3 {
    return new Vector3(-0.5, 1.75, 4);
  }
}
