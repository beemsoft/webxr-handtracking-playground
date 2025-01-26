import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  BoxGeometry,
  LoopOnce,
  Matrix4,
  Mesh,
  MeshNormalMaterial,
  NumberKeyframeTrack,
  PerspectiveCamera,
  PointLight,
  Quaternion,
  Scene,
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
import { TextMesh } from '../../../../shared/scene/text/TextMesh';

let bvhLoader = new BVHLoader();

export default class SceneManager extends SceneManagerParent  {
  private mixerDance1: AnimationMixer;
  private mixerDance2: AnimationMixer;
  private action1: AnimationAction;
  private action2: AnimationAction;
  private isAnimationPaused: boolean;
  private source1SkeletonHelper: SkeletonHelper;
  private source2SkeletonHelper: SkeletonHelper;
  private stats = new Stats();
  private readonly audioLocation = new Vector3(0, 0, 0);
  private latestGesture = GestureType.None;
  private handText: TextMesh;

    private modelOptions = {
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
  private audioHandler = new AudioHandler();
  private audioElement: HTMLAudioElement;
  private bvh1: BVH;
  private bvh2: BVH;
  private bvh1Cache: BVH[] = [];
  private bvh2Cache: BVH[] = [];
  private slowDownFactor = 4;
  private danceCouples: {leader: VRM, follower: VRM}[] = [];
  private modelNames: DanceCouple[] = [
    { leader: "eric", follower: "Shina2", offsetX: -2, offsetZ: 0 },
    { leader: "eric", follower: "Shina2", offsetX: 0, offsetZ: -2 },
    { leader: "eric", follower: "Shina2", offsetX: 0, offsetZ: 2 },
    { leader: "eric", follower: "Shina2", offsetX: 2, offsetZ: 0 },
  ];
  private animationActionsEndOfDance: VRM[] = [];
  private animationMixersEndOfDance: AnimationMixer[] = [];
  private animationActionsBlink: VRM[] = [];
  private animationMixersBlink: AnimationMixer[] = [];

  private cube: Mesh;
  private cubeSound: Mesh;
  private cubeSound2: Mesh;
  private move = 1;
  private handTextFadeOut: boolean;
  private handTextOpacity = 1;

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler) {
    super.build(camera, scene, renderer, physicsHandler);
    document.body.appendChild(this.stats.dom);

    const material = new MeshNormalMaterial();
    const geometry = new BoxGeometry(0.1, 0.1, 0.1);
    this.cube = new Mesh(geometry, material);

    this.cubeSound = new Mesh(geometry, material);

    this.cubeSound.position.set(0, 0, 0);

    const geometry2 = new BoxGeometry(0.3, 0.3, 0.3);
    this.cubeSound2 = new Mesh(geometry2, material);

    const pointLight1 = SceneManager.createPointLight( 0xFF7F00 );
    const pointLight2 = SceneManager.createPointLight( 0x00FF7F );
    const pointLight3 = SceneManager.createPointLight( 0x7F00FF );
    renderer.shadowMap.enabled = false
    renderer.xr.enabled = false;
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

    const anisotropy: number = this.renderer.capabilities.getMaxAnisotropy();
    this.handText= new TextMesh(anisotropy, 1024, 512, 2, 12);
    this.scene.add(this.handText.mesh);
  }

  private static createPointLight(color ) {
    const newObj = new PointLight( color, 0.6 );
    newObj.castShadow = true;
    newObj.decay = 2;
    newObj.distance = 10;
    newObj.shadow.mapSize.width = 512;
    newObj.shadow.mapSize.height = 512;
    return newObj;

  }

  private loadModels2(modelNames: DanceCouple[]) {
    let gltfLoader = new GLTFLoader();
    gltfLoader.register((parser) => new VRMLoaderPlugin(parser));
    for (let i = 0; i < modelNames.length; i ++) {
      console.log('Loading model ' + modelNames[i].leader);
      gltfLoader.loadAsync('/shared/vrm/' + modelNames[i].leader + '.vrm').then((gltf) => {
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.combineSkeletons(gltf.scene);
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
          VRMUtils.combineSkeletons(gltf.scene);;
          gltf2.scene.children[5].position.x = modelNames[i].offsetX;
          gltf2.scene.children[5].position.z = modelNames[i].offsetZ;
          gltf2.scene.traverse( function( object ) {
            object.frustumCulled = false;
          } );
          this.initHappyAnimation(gltf2.userData.vrm);
          this.initBlinkAnimation(gltf2.userData.vrm);
          this.danceCouples.push({ leader: gltf.userData.vrm, follower: gltf2.userData.vrm });
          this.scene.add(gltf2.userData.vrm.scene);
          if (i == modelNames.length - 1) {
            this.loadBVH();
            this.playBlinkAnimations();
          }
        });
      });
    }
  }

  private loadModels() {
    const loader = new GLTFLoader();
    loader.load('/shared/models/kleeblatt.gltf', (gltf) => {
      let model = gltf.scene;
      model.scale.set(0.03, 0.03, 0.03);
      model.position.y = -0.4;
      this.scene.add(model);
    });
    this.loadModels2(this.modelNames);
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

  initialLoadBVH() {
    let moveStr = "" + this.move;
    if (this.move < 10) {
       moveStr = "0" + this.move;
    }
    bvhLoader.load("/shared/bvh/60/60_" + moveStr + "_scaled.bvh", (bvh) => {
      this.bvh1 = bvh;
      this.bvh1Cache[this.move] = bvh;
      this.source1SkeletonHelper = new SkeletonHelper(bvh.skeleton.bones[0]);
      this.source1SkeletonHelper.skeleton = bvh.skeleton;
      bvhLoader.load("/shared/bvh/61/61_" + moveStr + "_scaled.bvh", (bvh) => {
        this.bvh2 = bvh;
        this.bvh2Cache[this.move] = bvh;
        this.source2SkeletonHelper = new SkeletonHelper(bvh.skeleton.bones[0]);
        this.source2SkeletonHelper.skeleton = bvh.skeleton;
        this.startShow();
      });
    });
  }

  doNext() {
    if (this.bvh1Cache[this.move]) {
      this.bvh1 = this.bvh1Cache[this.move];
      this.bvh2 = this.bvh2Cache[this.move];
      this.startMove1();
    } else {
      this.loadBVH();
    }
  }

  private startMove1() {
    this.source1SkeletonHelper = new SkeletonHelper(this.bvh1.skeleton.bones[0]);
    this.source1SkeletonHelper.skeleton = this.bvh1.skeleton;
    this.source2SkeletonHelper = new SkeletonHelper(this.bvh2.skeleton.bones[0]);
    this.source2SkeletonHelper.skeleton = this.bvh2.skeleton;
    this.startShow();
  }

  loadBVH() {
    let moveStr = "" + this.move;
    if (this.move < 10) {
      moveStr = "0" + this.move;
    }
    bvhLoader.load("/shared/bvh/60/60_" + moveStr + "_scaled.bvh", (bvh) => {
      this.bvh1Cache[this.move] = bvh;
      this.bvh1 = bvh;
      bvhLoader.load("/shared/bvh/61/61_" + moveStr + "_scaled.bvh", (bvh) => {
        this.bvh2Cache[this.move] = bvh;
        this.bvh2 = bvh;
        this.startMove1();
       });
    });
  }

  private startShow() {
    console.log("Play move " + this.move + " for second: " + this.bvh1.clip.duration * this.slowDownFactor);
    this.isAnimationPaused = false;
    this.mixerDance1 = new AnimationMixer(this.source1SkeletonHelper);
    this.mixerDance2 = new AnimationMixer(this.source2SkeletonHelper);
    console.log("Start animation");
    this.action1 = this.mixerDance1.clipAction(this.bvh1.clip);
    this.action1.clampWhenFinished = true;
    this.action1.play();
    this.action2 = this.mixerDance2.clipAction(this.bvh2.clip);
    this.action2.clampWhenFinished = true;
    this.action2.play();
    this.slowDownFactor = 1.83
    this.audioElement.play();
  }

  private pauseShow() {
    this.isAnimationPaused = true;
    console.log("Pause animation");
  }

  private resumeShow() {
    this.isAnimationPaused = false;
    console.log("Resume animation");
  }

  private playReverse() {
    this.action1.timeScale = -this.action1.timeScale;
    this.action2.timeScale = -this.action2.timeScale;
  }

  private playSpeed(delta) {
    this.slowDownFactor += delta;
    if (this.slowDownFactor > 5) {
      this.slowDownFactor = 2;
    }
  }

  update() {
    let delta = this.clock.getDelta();
    if (this.handTextFadeOut) {
      this.handTextOpacity -= 0.02;
      if (this.handTextOpacity < 0) {
        this.handTextOpacity = 0;
        this.handTextFadeOut = false;
      }
      this.handText.fadeOut(this.handTextOpacity);
    }
    if (this.mixerDance1 && this.mixerDance2) {
      if (!this.isAnimationPaused) {
        this.mixerDance1.update(delta/this.slowDownFactor);
        this.mixerDance2.update(delta/this.slowDownFactor);
        if (this.danceCouples && this.danceCouples.length > 0) {
          for (let i = 0; i < this.danceCouples.length; i++) {
            VrmSkeletonUtils.retarget(this.danceCouples[i].leader.scene.children[5], this.source1SkeletonHelper, this.modelOptions);
            VrmSkeletonUtils.retarget(this.danceCouples[i].follower.scene.children[5], this.source2SkeletonHelper, this.modelOptions);
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
    const direction3 = this.audioLocation.applyQuaternion(quat);
    const direction4 = position.sub(direction3);

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

  displayMessage(message: string, o: Vector3, q: Quaternion) {
    if (o) {
      this.handText.mesh.position.set(o.x, o.y, o.z);
      let rotationMatrix = new Matrix4();
      if (this.camera.position) {
        rotationMatrix.lookAt(this.camera.position, o, this.handText.mesh.up);
        this.handText.mesh.quaternion.setFromRotationMatrix(rotationMatrix);
        this.handText.set(message);
        this.handTextOpacity = 1;
        this.handTextFadeOut = true;
      }
    }
  }

  handleGesture(gesture: HandTrackingResult) {
    if (gesture.gestureType != GestureType.None && gesture.gestureType != this.latestGesture) {
      this.latestGesture = gesture.gestureType;
      if (gesture.gestureType == GestureType.Open_Hand) {
        if (this.isAnimationPaused) {
          this.displayMessage("Resume", gesture.position, gesture.orientation)
          this.resumeShow();
        }
      } else if (gesture.gestureType == GestureType.Middle_Thumb) {
        if (this.isAnimationPaused) {
        } else {
          this.displayMessage("Pause", gesture.position, gesture.orientation)
          this.pauseShow();
        }
      } else if (gesture.gestureType == GestureType.Closed_Hand) {
        if (this.isAnimationPaused) {
          this.displayMessage("Reverse animation", gesture.position, gesture.orientation)
          this.playReverse();
        }
      } else if (gesture.gestureType == GestureType.Index_Thumb) {
        if (this.isAnimationPaused) {
          this.displayMessage("Animation slow down factor: " + this.slowDownFactor, gesture.position, gesture.orientation)
          this.playSpeed(1);
        }
      } else if (gesture.gestureType == GestureType.Ring_Thumb) {
        if (this.isAnimationPaused) {
          this.move = this.move + 1;
          console.log("Play move " + this.move);
          if (this.move > 15) this.move = 1;
          this.displayMessage("Next move: " + this.move, gesture.position, gesture.orientation)
          this.doNext();
        }
      } else if (gesture.gestureType == GestureType.Pinky_Thumb) {
        if (this.isAnimationPaused) {
          this.move = this.move - 1;
          console.log("Play move " + this.move);
          if (this.move < 1) this.move = 15;
          this.displayMessage("Previous move: " + this.move, gesture.position, gesture.orientation)
          this.doNext();
        }
      }
    }
  }

  getInitialCameraPosition(): Vector3 {
    return new Vector3(0, 0.75, 0);
  }

}
