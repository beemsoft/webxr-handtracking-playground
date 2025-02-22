import {
  ACESFilmicToneMapping,
  AnimationMixer,
  DirectionalLight,
  DoubleSide,
  Group,
  LoopRepeat,
  MathUtils,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  RepeatWrapping,
  Scene,
  TextureLoader,
  Vector3,
  WebGLRenderer
} from 'three/src/Three';
import PhysicsHandler from '../../../../shared/physics/cannon/PhysicsHandler';
import SceneManagerParent from '../../../../shared/scene/SceneManagerParent';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { Water } from '../../../../shared/scene/water/Water';
import { Sky } from '../../../../shared/scene/sky/Sky';
import WaterManager from '../../../../shared/web-managers/WaterManager';
import { BVH, BVHLoader } from 'three/examples/jsm/loaders/BVHLoader';
import SkeletonHelper from '../../../../shared/model/SkeletonHelper';
import VrmSkeletonUtils from '../model/VrmSkeletonUtils';

export default class SceneManager extends SceneManagerParent {
  private loader: TextureLoader = new TextureLoader();
  private water: Water;
  private sky: Sky;
  private light: DirectionalLight;
  private pmremGenerator: PMREMGenerator;
  private sun: Vector3;
  private ship: Scene;
  private ship2: Scene;
  private jackSparrow: any;
  private waterManager: WaterManager;
  private sourceSkeletonHelper: SkeletonHelper;
  private targetSkeletonHelper: SkeletonHelper;
  private boneContainer: Group;
  private isAnimationStarted: boolean;
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
    this.waterManager = new WaterManager();
    let light = new DirectionalLight( 0xffffff, 0.8 );
    this.light = light;
    this.scene.add(light);
    this.addWater();
    this.sun = new Vector3();
    renderer.toneMapping = ACESFilmicToneMapping;
    this.pmremGenerator = new PMREMGenerator( renderer );
    this.addSky();
    this.loadModels();
 }

  addJackSparrow() {
    const loader = new GLTFLoader();
    loader.load('models/JackSparrow/jack_sparrow.glb', (gltf) => {
      let model = gltf.scene;
      gltf.scene.traverse( function( object ) {
        object.frustumCulled = false;
      } );
      this.jackSparrow = gltf;
      this.targetSkeletonHelper = new SkeletonHelper(gltf.scene.children[0].children[0]);
      this.targetSkeletonHelper.visible = true;
      console.log(model);
      this.ship2.add(this.jackSparrow.scene);
      this.loadBVH();
    });
  }

  addWater() {
    let waterGeometry = new PlaneGeometry( 10000, 10000 );
    let water = new Water(
      waterGeometry,
      {
        textureWidth: 512,
        textureHeight: 512,
        waterNormals: this.loader.load( '/textures/water/waternormals.jpg', function ( texture ) {
          texture.wrapS = texture.wrapT = RepeatWrapping;
        } ),
        alpha: 1.0,
        sunDirection: this.light.position.clone().normalize(),
        sunColor: 0xffffff,
        waterColor: 0x001e0f,
        distortionScale: 3.7,
        fog: this.scene.fog !== undefined
      }
    );
    // @ts-ignore
    water.rotation.x = - Math.PI / 2;
    this.scene.add( water );
    this.water = water;
  }

  private parameters = {
    elevation: 0.5,
    azimuth: 180
  };

  updateSun() {
    const phi = MathUtils.degToRad( 90 - this.parameters.elevation );
    const theta = MathUtils.degToRad( this.parameters.azimuth );

    this.sun.setFromSphericalCoords( 1, phi, theta );

    this.sky.material.uniforms[ 'sunPosition' ].value.copy( this.sun );
    // @ts-ignore
    this.water.material.uniforms[ 'sunDirection' ].value.copy( this.sun ).normalize();

    this.scene.environment = this.pmremGenerator.fromScene( this.sky ).texture;
  }

  addSky() {
    this.sky = new Sky();
    this.sky.scale.setScalar( 10000 );
    this.scene.add( this.sky );

    const skyUniforms = this.sky.material.uniforms;

    skyUniforms[ 'turbidity' ].value = 10;
    skyUniforms[ 'rayleigh' ].value = 2;
    skyUniforms[ 'mieCoefficient' ].value = 0.005;
    skyUniforms[ 'mieDirectionalG' ].value = 0.8;
    this.updateSun();
  }

  private loadModels() {
    // new ColladaLoader()
    //       .load('models/pinnace/ship_pinnace_1k_resaved.dae', (obj) => {
    //         console.log(obj);
    //           // @ts-ignore
    //         obj.scene.children[0].material.side = DoubleSide;
    //         obj.scene.position.y -= 0.8;
    //         obj.scene.setRotationFromQuaternion(new Quaternion().setFromAxisAngle(new Vector3(0,0,1), -Math.PI/2));
    //         this.scene.add(obj.scene);
    //         this.ship = obj.scene;
    //       });
    new ColladaLoader()
      .load('models/black pearl moved to origin.dae', (obj) => {
        console.log(obj);
        // obj.scene.position.z = -55;
        for (let child of obj.scene.children) {
          // @ts-ignore
            if (child.material) {
            // @ts-ignore
            child.material.side = DoubleSide
          }
        }
        this.scene.add(obj.scene);
        this.ship2 = obj.scene;
        this.addJackSparrow();
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
      this.boneContainer.rotation.y = Math.PI/2;
      this.boneContainer.rotation.x = Math.PI/2;
      this.boneContainer.position.z = 4.9;
      this.boneContainer.position.y = -3.7;
      this.ship2.add(this.boneContainer);
      this.startShow();
    } );
  }

  private startShow() {
    this.isAnimationStarted = true;
    this.mixer = new AnimationMixer( this.sourceSkeletonHelper );
    setTimeout(() => {
        console.log("Start animation");
        this.mixer.clipAction(this.bvh.clip).setEffectiveWeight(1.0).setLoop(LoopRepeat, 10).play();
        setTimeout( () => {
          console.log("Stop animation");
          this.isAnimationStarted = false;
        }, this.bvh.clip.duration * 1000 * 10)
      }, 5
    )
  }

  update() {
    if (this.water) {
      // @ts-ignore
      this.water.material.uniforms['time'].value += 1.0 / 90.0;
    }
    const time = performance.now() * 0.001;

    if (this.ship) {
      this.ship.rotation.x = Math.sin(time) * 0.02 - Math.PI/2;
      this.ship.rotation.y = Math.sin(time) * 0.02;
    }
    if (this.ship2) {
      this.ship2.rotation.x = Math.sin(time-5) * 0.02 - Math.PI/2;
      this.ship2.rotation.y = Math.sin(time-5) * 0.02;
    }
    let delta = this.clock.getDelta();
    if (this.mixer) {
      this.mixer.update(delta);
      if (this.isAnimationStarted && this.jackSparrow) {
        VrmSkeletonUtils.retarget(this.jackSparrow.scene.children[0].children[1], this.sourceSkeletonHelper, this.options);
      }
    }
  }

  postUpdate() {
    this.waterManager.update(this.water, this.renderer, this.scene, this.camera);
  }

  getInitialCameraAngle(): number {
    return 0;
  }

  getInitialCameraPosition(): Vector3 {
    return new Vector3(0, 10, 40);
  }

  getInitialCameraTarget(): Vector3 {
      return new Vector3(0, 10, 10);
  }

}
