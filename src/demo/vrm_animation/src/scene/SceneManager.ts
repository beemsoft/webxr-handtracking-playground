import {
  AnimationClip,
  AnimationMixer,
  AxesHelper,
  Euler,
  GridHelper,
  LoopOnce,
  NumberKeyframeTrack,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  QuaternionKeyframeTrack,
  Scene,
  Vector3,
  WebGLRenderer
} from 'three/src/Three';
import PhysicsHandler from '../../../../shared/physics/PhysicsHandler';
import { GestureType, HandTrackingResult } from '../../../../shared/scene/SceneManagerInterface';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { VRM, VRMExpressionPresetName, VRMHumanBoneName, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { AnimationAction } from 'three/src/animation/AnimationAction';
import SceneManagerParent from '../../../../shared/scene/SceneManagerParent';

export default class SceneManager extends SceneManagerParent {
  private player: any;
  private isAnimationStarted: boolean;
  private currentVrm: VRM;
  private lookAtTarget = new Object3D();
  private animationAction: AnimationAction;

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler) {
    super.build(camera, scene, renderer, physicsHandler);
    this.sceneHelper.addLight(false);
    this.loadModel(scene);
    this.sceneHelper.addMessage('Show open hand to start the animation!', renderer.capabilities.getMaxAnisotropy());
    camera.add(this.lookAtTarget);
    const gridHelper = new GridHelper( 10, 10 );
    this.scene.add( gridHelper );
    const axesHelper = new AxesHelper( 5 );
    this.scene.add( axesHelper );
  }

  private loadModel(scene: Scene) {
    let gltfLoader = new GLTFLoader();
    gltfLoader.register((parser) => new VRMLoaderPlugin(parser));
    gltfLoader.loadAsync('/shared/vrm/VRM1_Constraint_Twist_Sample.vrm').then((gltf) => {
      const vrm = gltf.userData.vrm;
      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.removeUnnecessaryJoints(gltf.scene);
      let model = vrm.scene;
      scene.add(model);
      this.currentVrm = vrm;
      // vrm.humanoid.getBoneNode( VRMHumanBoneName.Hips ).rotation.y = Math.PI;
      // VRMUtils.rotateVRM0(vrm);
      vrm.lookAt.target = this.lookAtTarget;
      this.prepareAnimation(vrm);
      this.player = model;
    });
  }

  private prepareAnimation( vrm: VRM ) {

    this.mixer = new AnimationMixer( vrm.scene );

    const quatA = new Quaternion( 0.0, 0.0, 0.0, 1.0 );
    const quatB = new Quaternion( 0.0, 0.0, 0.0, 1.0 );
    quatB.setFromEuler( new Euler( 0.0, 0.0, 0.1 * Math.PI ) );

    const armTrack = new QuaternionKeyframeTrack(
      vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm ).name + '.quaternion', // name
      [ 0.0, 0.5, 1.0 ], // times
      [ ...quatA.toArray(), ...quatB.toArray(), ...quatA.toArray() ] // values
    );

    const headTrack = new QuaternionKeyframeTrack(
      vrm.humanoid.getNormalizedBoneNode( VRMHumanBoneName.Head ).name + '.quaternion', // name
      [ 0.0, 0.5, 1.0 ], // times
      [ ...quatA.toArray(), ...quatB.toArray(), ...quatA.toArray() ] // values
    );

    const blinkTrack = new NumberKeyframeTrack(
      vrm.expressionManager.getExpressionTrackName( VRMExpressionPresetName.Happy ),
      [ 0.0, 1.0, 1.0 ], // times
      [ 1.0, 1.0, 1.0 ] // values
    );

    const clip = new AnimationClip( 'blink', 1.0, [ headTrack, blinkTrack, armTrack ] );
    this.animationAction = this.mixer.clipAction( clip );
  }

  private startShow() {
    this.isAnimationStarted = true;
    this.animationAction.setLoop(LoopOnce, 1).play();
    setTimeout(() => {
        console.log("Stop animation");
        this.isAnimationStarted = false;
        this.animationAction.reset();
      }, 2000
    )
  }

  update() {
    let delta = this.clock.getDelta();
    if (this.isAnimationStarted && this.mixer) {
      this.mixer.update(delta);
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

  handleGesture(gesture: HandTrackingResult) {
    if (gesture.gestureType == GestureType.Open_Hand) {
      if (!this.isAnimationStarted) {
        this.startShow();
      }
    }
  }

  getInitialCameraPosition(): Vector3 {
    return new Vector3(-0.5, 1.75, 4);
  }
}
