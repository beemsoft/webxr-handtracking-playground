import {
  ACESFilmicToneMapping,
  AnimationMixer,
  DirectionalLight,
  GridHelper,
  LoopOnce,
  MathUtils,
  PerspectiveCamera,
  PlaneBufferGeometry,
  PMREMGenerator,
  RepeatWrapping,
  Scene,
  TextureLoader,
  Vector3,
  WebGLRenderer
} from 'three/src/Three';
import PhysicsHandler from '../../../../shared/physics/PhysicsHandler';
import { GestureType } from '../../../../shared/scene/SceneManagerInterface';
import { BVH } from 'three/examples/jsm/loaders/BVHLoader';
import SkeletonHelper from '../../../../shared/model/SkeletonHelper';
import SceneManagerParent from '../../../../shared/scene/SceneManagerParent';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { Water } from '../../../../shared/scene/water/Water';
import { Sky } from '../../../../shared/scene/sky/Sky';
import WaterManager from '../../../../shared/web-managers/WaterManager';

export default class SceneManager extends SceneManagerParent {
  private isAnimationStarted: boolean;
  private player: any;
  private sourceSkeletonHelper: SkeletonHelper;
  private bvh: BVH;
  private grid: GridHelper;
  private loader: TextureLoader = new TextureLoader();
  private water: Water;
  private sky: Sky;
  private pmremGenerator: PMREMGenerator;
  private sun: Vector3;
  private light: DirectionalLight;
  private waterManager: WaterManager;

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler) {
    super.build(camera, scene, renderer, physicsHandler);
    this.waterManager = new WaterManager();
    let light = new DirectionalLight( 0xffffff, 0.8 );
    this.light = light;
    this.scene.add(light);
    this.addWater();
    this.sun = new Vector3();
    renderer.toneMapping = ACESFilmicToneMapping;
    this.pmremGenerator = new PMREMGenerator( renderer );
    this.addSky();
    this.loadModel(scene);
  }

  private loadModel(scene: Scene) {
    const loader = new GLTFLoader();
    loader.load('models/beach_exported_from_blender.glb', (gltf) => {
      let model = gltf.scene;
      model.position.y = -2;
      model.position.z = 0;
      model.position.x = 0;
      model.rotateY(Math.PI/2);
      scene.add(model);
    });
  }

  addWater() {
    let waterGeometry = new PlaneBufferGeometry( 10000, 10000 );
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
    const time = performance.now() * 0.001;
    if (this.grid && this.player && this.sourceSkeletonHelper) {
      this.grid.rotation.x = Math.sin(time) * 0.2;
    }

    if (this.grid && this.player) {
      this.grid.rotation.x = Math.sin(time) * 0.2;
      this.grid.rotation.y = Math.sin(time) * 0.2;
    }

    if (this.water) {
      // @ts-ignore
      this.water.material.uniforms['time'].value += 1.0 / 600.0;
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

  getInitialCameraAngle(): number {
    return Math.PI;
  }

  getInitialCameraPosition(): Vector3 {
    return new Vector3(-3, 2, -18);
  }

  postUpdate() {
    this.waterManager.update(this.water, this.renderer, this.scene, this.camera);
  }
}
