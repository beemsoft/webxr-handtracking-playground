import {
  AnimationClip,
  AnimationMixer,
  Clock,
  Group,
  LoopOnce,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  NumberKeyframeTrack,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Scene,
  TextureLoader,
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
  private isAnimationPaused: boolean;
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
    leftHand: Vector3,
    rightHand: Vector3,
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
  private bvh1: BVH;
  private bvh2: BVH;
  private nextBvh1: BVH;
  private nextBvh2: BVH;
  private slowDownFactor = 4;
  private leftHand: Mesh;
  private rightHand: Mesh;
  private leftFoot: Mesh;
  private rightFoot: Mesh;
  private skeletonHelper: SkeletonHelper;
  private boneContainer: Group;

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler) {
    this.scene = scene;
    this.sceneHelper = new SceneHelper(scene);
    this.physicsHandler = physicsHandler;
    this.sceneHelper.addLight();
    this.loadShoes(scene);
    this.loadModels();

    this.handPoseManager = new HandPoseManager(scene, physicsHandler);
 }

  private loadShoes(scene: Scene) {
    const textureLoader = new TextureLoader();
    const loader = new GLTFLoader();
    let shoeMaterial = new MeshPhongMaterial({
      map: textureLoader.load('/textures/Shoes.png', () => {
        loader.load('models/gltf/right_shoe.glb', (gltf) => {
          let model = gltf.scene;
          // @ts-ignore
          let shoeMesh: Mesh = model.children[0];
          shoeMesh.material = shoeMaterial;
          // @ts-ignore
          shoeMesh.material.map.flipY = false; // https://discourse.threejs.org/t/flipped-maps-from-blender/6587/9
          scene.add(model);
          this.rightFoot = shoeMesh;
          this.rightFoot.position.add(new Vector3(-0.6,0.1,0.05));
        });
        loader.load('models/gltf/left_shoe.glb', (gltf) => {
          let model = gltf.scene;
          // @ts-ignore
          let shoeMesh: Mesh = model.children[0];
          shoeMesh.material = shoeMaterial;
          // @ts-ignore
          shoeMesh.material.map.flipY = false; // https://discourse.threejs.org/t/flipped-maps-from-blender/6587/9
          scene.add(model);
          this.leftFoot = shoeMesh;
          this.leftFoot.position.add(new Vector3(-0.6,0.1,-0.15));
        });
      }),
      shininess: 20,
      reflectivity: 2
    });
    const markerMaterial1 = new MeshBasicMaterial({color: 0xff0000, wireframe: true});
    const markerMaterial2 = new MeshBasicMaterial({color: 0xaabb04, wireframe: true});
    loader.load('models/gltf/left_hand.glb', (gltf) => {
      let model = gltf.scene;
      // @ts-ignore
      let handMesh: Mesh = model.children[0];
      handMesh.material = markerMaterial1;
      scene.add(model);
      this.rightHand = handMesh;
      this.rightHand.position.add(new Vector3(-0.4,0.8,-0.25));
    });
    loader.load('models/gltf/right_hand.glb', (gltf) => {
      let model = gltf.scene;
      // @ts-ignore
      let handMesh: Mesh = model.children[0];
      handMesh.material = markerMaterial2;
      scene.add(model);
      this.leftHand = handMesh;
      this.leftHand.position.add(new Vector3(-0.4,0.8,0.15));
    });

  }

  private loadModels() {
    let gltfLoader = new GLTFLoader();
    gltfLoader.load('models/vrm/three-vrm-girl.vrm', (gltf) => {
      VRMUtils.removeUnnecessaryJoints(gltf.scene);
      VRM.from(gltf).then( (vrm) => {
        this.person1 = vrm;
        vrm.humanoid.getBoneNode( VRMSchema.HumanoidBoneName.Hips ).rotation.y = Math.PI;
        this.target1SkeletonHelper = new SkeletonHelper(vrm.scene.children[0]);
        this.target1Skeleton = this.person1.scene.children[4].children[0];
        gltfLoader.load('models/vrm/three-vrm-girl.vrm', (gltf) => {
          VRMUtils.removeUnnecessaryJoints(gltf.scene);
          VRM.from(gltf).then( (vrm) => {
            this.person2 = vrm;
            vrm.humanoid.getBoneNode( VRMSchema.HumanoidBoneName.Hips ).rotation.y = Math.PI;
            this.playBlinkAnimationPerson2();
            this.target2SkeletonHelper = new SkeletonHelper(vrm.scene.children[0]);
            this.target2Skeleton = this.person2.scene.children[4].children[0];
            this.loadBVH(1);
          })
        });
      })
    });
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

  loadBVH(move) {
    let loader = new BVHLoader();
    let moveStr = move;
    if (move < 10) {
       moveStr = "0" + move;
    }
    loader.load("models/bvh/60/60_" + moveStr + "_scaled.bvh", (bvh) => {
      this.bvh1 = bvh;
      this.source1SkeletonHelper = new SkeletonHelper(bvh.skeleton.bones[0]);
      this.source1SkeletonHelper.skeleton = bvh.skeleton;
      this.boneContainer = new Group();
      this.boneContainer.add( bvh.skeleton.bones[ 0 ] );
      this.scene.add( this.skeletonHelper );
      this.scene.add( this.boneContainer );
      loader.load("models/bvh/61/61_" + moveStr + "_scaled.bvh", (bvh) => {
        this.bvh2 = bvh;
        this.source2SkeletonHelper = new SkeletonHelper(bvh.skeleton.bones[0]);
        this.source2SkeletonHelper.skeleton = bvh.skeleton;
        // stop in VR
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
  }

  preloadBVH(move) {
    let loader = new BVHLoader();
    let moveStr = move;
    if (move < 10) {
      moveStr = "0" + move;
    }
    loader.load("models/bvh/60/60_" + moveStr + "_scaled.bvh", (bvh) => {
      this.nextBvh1 = bvh;
      loader.load("models/bvh/61/61_" + moveStr + "_scaled.bvh", (bvh) => {
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
    // this.scene.add(this.person1.scene);
    this.scene.add(this.person2.scene);
    this.mixerDance1.clipAction(this.bvh1.clip).play();
    this.mixerDance2.clipAction(this.bvh2.clip).play();
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
      if (!this.isAnimationPaused) {
        this.mixerDance1.update(delta/this.slowDownFactor);
        this.mixerDance2.update(delta/this.slowDownFactor);
        VrmSkeletonUtils.retarget(this.target1Skeleton, this.source1SkeletonHelper, this.options, true);
        let result = new Vector3();
        // @ts-ignore
        this.target1Skeleton.skeleton.bones[23].getWorldPosition(result);
        this.leftHand.position.x = result.x;
        this.leftHand.position.y = result.y;
        this.leftHand.position.z = result.z;
        let result1a = new Quaternion();
        // @ts-ignore
        this.target1Skeleton.skeleton.bones[23].getWorldQuaternion(result1a);
        this.leftHand.setRotationFromQuaternion(result1a);

        let result2 = new Vector3();
        // @ts-ignore
        this.target1Skeleton.skeleton.bones[21].getWorldPosition(result2);
        this.rightHand.position.x = result2.x;
        this.rightHand.position.y = result2.y;
        this.rightHand.position.z = result2.z;
        let result2a = new Quaternion();
        // @ts-ignore
        this.target1Skeleton.skeleton.bones[21].getWorldQuaternion(result2a);
        this.rightHand.setRotationFromQuaternion(result2a);

        let result3 = new Vector3();
        // @ts-ignore
        this.target1Skeleton.skeleton.bones[19].getWorldPosition(result3);
        this.rightFoot.position.x = result3.x;
        this.rightFoot.position.y = result3.y + 0.17;
        this.rightFoot.position.z = result3.z;
        let result3a = new Quaternion();
        // @ts-ignore
        this.target1Skeleton.skeleton.bones[19].getWorldQuaternion(result3a);
        this.rightFoot.setRotationFromQuaternion(result3a);

        let result4 = new Vector3();
        // @ts-ignore
        this.target1Skeleton.skeleton.bones[17].getWorldPosition(result4);
        this.leftFoot.position.x = result4.x;
        this.leftFoot.position.y = result4.y + 0.17;
        this.leftFoot.position.z = result4.z;
        let result4a = new Quaternion();
        // @ts-ignore
        this.target1Skeleton.skeleton.bones[17].getWorldQuaternion(result4a);
        this.leftFoot.setRotationFromQuaternion(result4a);

        VrmSkeletonUtils.retarget(this.target2Skeleton, this.source2SkeletonHelper, this.options, false);
      }
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
      if (this.isAnimationPaused) {
        if (this.handPoseManager.isOpenHand()) {
          this.resumeShow();
        }
      } else {
        if (this.handPoseManager.isOpenHand()) {
          this.pauseShow();
        }
      }
    }
  }

  handleGesture(gesture: GestureType) {
    if (gesture == GestureType.openHand) {
      if (this.isAnimationPaused) {
        this.resumeShow();
      } else {
        this.pauseShow();
      }
    }
  }
}
