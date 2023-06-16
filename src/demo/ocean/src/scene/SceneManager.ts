import {
  ACESFilmicToneMapping,
  DirectionalLight,
  MathUtils,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  RepeatWrapping,
  Scene,
  TextureLoader,
  Vector3,
  WebGLRenderer
} from 'three/src/Three';
import PhysicsHandler from '../../../../shared/physics/PhysicsHandler';
import { Water } from '../../../../shared/scene/water/Water';
import { Sky } from '../../../../shared/scene/sky/Sky';
import WaterManager from '../../../../shared/web-managers/WaterManager';
import SceneManagerParent from '../../../../shared/scene/SceneManagerParent';

export default class SceneManager extends SceneManagerParent {
  private loader: TextureLoader = new TextureLoader();
  private light: DirectionalLight;
  private water: Water;
  private sky: Sky;
  private pmremGenerator: PMREMGenerator;
  private sun: Vector3;
  private waterManager: WaterManager;

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler)  {
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
  };

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

  update() {
    if (this.water) {
      // @ts-ignore
      this.water.material.uniforms['time'].value += 1.0 / 60.0;
    }
  }

  getInitialCameraPosition() {
    return new Vector3(-10, 25, 80);
  }

  postUpdate() {
    this.waterManager.update(this.water, this.renderer, this.scene, this.camera);
  }
}
