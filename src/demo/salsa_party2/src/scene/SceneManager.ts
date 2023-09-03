import {
  AnimationClip,
  AnimationMixer,
  BoxGeometry,
  LoopOnce,
  Mesh,
  MeshNormalMaterial,
  NumberKeyframeTrack,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  PointLight,
  Quaternion,
  Vector3,
  WebGLRenderer
} from 'three/src/Three';
import PhysicsHandler from '../../../../shared/physics/PhysicsHandler';
import { GestureType, HandTrackingResult } from '../../../../shared/scene/SceneManagerInterface';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { VRM, VRMExpressionPresetName, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { BVH, BVHLoader } from 'three/examples/jsm/loaders/BVHLoader';
import SkeletonHelper from '../../../../shared/model/SkeletonHelper';
import AudioHandler, { AudioDemo } from '../../../../shared/audio/AudioHandler';
import VrmSkeletonUtils from '../worker/VrmSkeletonUtils';
import SceneManagerParent from '../../../../shared/scene/SceneManagerParent';
import DanceCouple from './DanceCouple';
import Stats from "three/examples/jsm/libs/stats.module";
import HandPoseManager from '../../../../shared/hands/HandPoseManager';

export default class SceneManager extends SceneManagerParent  {
  private mixerDance1: AnimationMixer;
  private mixerDance2: AnimationMixer;
  private isAnimationPaused: boolean;
  private person1: VRM;
  private person2: VRM;
  private source1SkeletonHelper: SkeletonHelper;
  private source2SkeletonHelper: SkeletonHelper;
  private stats = new Stats();
  private readonly audioLocation = new Vector3(0, 0, 0);

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
    { leader: "kenji", follower: "female_redshirt", offsetX: -2.2, offsetZ: -1.5 },
    { leader: "eric", follower: "kat", offsetX: 0, offsetZ: -3 },
  ];
  private animationActionsEndOfDance: VRM[] = [];
  private animationMixersEndOfDance: AnimationMixer[] = [];
  private animationActionsBlink: VRM[] = [];
  private animationMixersBlink: AnimationMixer[] = [];

  private cube: Mesh;
  private cubeSound: Mesh;
  private cubeSound2: Mesh;

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler) {
    super.build(camera, scene, renderer, physicsHandler);
    document.body.appendChild(this.stats.dom);

    // this.sceneHelper.addLight(false);
    const material = new MeshNormalMaterial();
    const geometry = new BoxGeometry(0.1, 0.1, 0.1);
    this.cube = new Mesh(geometry, material);
    // this.scene.add(this.cube);

    this.cubeSound = new Mesh(geometry, material);
    // this.scene.add(this.cubeSound);
    this.cubeSound.position.set(0, 0, 0);

    const geometry2 = new BoxGeometry(0.3, 0.3, 0.3);
    this.cubeSound2 = new Mesh(geometry2, material);
    // this.scene.add(this.cubeSound2);

    const pointLight1 = SceneManager.createPointLight( 0xFF7F00 );
    const pointLight2 = SceneManager.createPointLight( 0x00FF7F );
    const pointLight3 = SceneManager.createPointLight( 0x7F00FF );
    renderer.shadowMap.enabled = false
    renderer.xr.enabled = false;
    renderer.outputColorSpace = SRGBColorSpace ;
    pointLight1.position.set( 3, 2, 3 );
    pointLight2.position.set( 4, 2, 0 );
    pointLight3.position.set( -3, 2, -3 );
    scene.add( pointLight1, pointLight2, pointLight3 );

    this.audioHandler.initAudio(AudioDemo.salsaDanceSlow);
    this.audioHandler.setPosition(this.audioLocation);
    this.audioElement = this.audioHandler.audioElement;
    this.audioElement.loop = true;
    this.loadModels();
    this.handPoseManager = new HandPoseManager(scene, physicsHandler);
  }

  private static createPointLight(color ) {

    const newObj = new PointLight( color, 0.6 );
    newObj.castShadow = true;
    newObj.decay = 2;
    newObj.distance = 10;
    return newObj;

  }

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
          object.castShadow = true;
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
            object.castShadow = true;
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
    loader.load('/shared/models/kleeblatt.gltf', (gltf) => {
      let model = gltf.scene;
      // model.position.y = +3.65;
      // model.position.z = -1;
      model.scale.set(0.03, 0.03, 0.03);
      model.position.y = -0.35;
      // model.position.z = -13;
      // model.position.x = 9;
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
      this.person1 = vrm;
      gltf.scene.traverse( function( object ) {

        object.frustumCulled = false;
        object.castShadow = true;
        // object.receiveShadow = true;

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
          object.castShadow = true;
          // object.receiveShadow = true;

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
    this.isAnimationPaused = false;
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
        this.isAnimationPaused = true;
      }
    }, this.bvh1.clip.duration * 1000 * this.slowDownFactor)
  }

  private pauseShow() {
    this.isAnimationPaused = true;
    console.log("Pause animation");
  }

  private resumeShow() {
    this.isAnimationPaused = false;
    console.log("Resume animation");
  }

  update() {
    let delta = this.clock.getDelta();
    if (this.mixerDance1 && this.mixerDance2) {
      this.mixerDance1.update(delta/this.slowDownFactor);
      this.mixerDance2.update(delta/this.slowDownFactor);
      if (!this.isAnimationPaused) {
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
        if (this.animationMixersEndOfDance.length > 0) {
          for (let i = 0; i < this.animationMixersEndOfDance.length; i++) {
            this.animationMixersEndOfDance[i].update(delta);
          }
        }
      }
    }
    if (this.animationMixersBlink.length > 0) {
      for (let i = 0; i < this.animationMixersBlink.length; i++) {
        this.animationMixersBlink[i].update(delta);
      }
    }

    const position = new Vector3(this.camera.position.x, this.camera.position.y, this.camera.position.z);



    const quat: Quaternion = new Quaternion(-this.camera.quaternion.x, -this.camera.quaternion.y, -this.camera.quaternion.z, -this.camera.quaternion.w);

    // const pointer2 = position.add(pointer.applyQuaternion(quat));
    // this.cube.position.x = pointer2.x;
    // this.cube.position.y = pointer2.y;
    // this.cube.position.z = pointer2.z;

    // console.log(JSON.stringify(quat));
    // const position2 = position
    const direction: Vector3 = position.sub(this.audioLocation);
    // console.log("to sound: " + JSON.stringify(direction));
    const direction3 = this.audioLocation.applyQuaternion(quat);
    const direction4 = position.sub(direction3);
    // const direction4 = direction3.sub(position);
    const direction5 = direction4.applyQuaternion(quat);
    const direction6 = direction5.add(direction4);


    const direction2: Vector3 = direction.applyQuaternion(quat);
    // console.log("after rot: " + JSON.stringify(direction4));
    // const direction7 = direction4.multiply(new Vector3(-1,-1,-1));
    this.cubeSound2.position.set(position.x - direction4.x, position.y - direction4.y, position.z - direction4.z);
    this.audioHandler.setPosition(direction4);
    this.audioHandler.setVolume(direction4);
  }

  updateHandPose(result) {
    if (this.handPoseManager) {
      this.handPoseManager.renderHands(result);
      if (this.isAnimationPaused) {
        if (this.handPoseManager.isOpenHand()) {
          console.log('Hand open');
          this.resumeShow();
        }
      } else {
        if (this.handPoseManager.isStopHand()) {
          this.pauseShow();
          console.log('Hand stop!');
        }
      }
    }
  }

  handleGesture(gesture: HandTrackingResult) {
    if (gesture.gestureType == GestureType.Open_Hand) {
      if (this.isAnimationPaused) {
        this.startShow(1);
      }
    }
  }

  getInitialCameraPosition(): Vector3 {
    return new Vector3(0, 0.75, -1.5);
  }

}
