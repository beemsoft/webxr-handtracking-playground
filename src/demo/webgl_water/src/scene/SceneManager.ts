import {
  ACESFilmicToneMapping, AmbientLight, BackSide, DirectionalLight,
  Mesh, MeshBasicMaterial, MeshNormalMaterial, MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene, SphereGeometry, SRGBColorSpace,
  TextureLoader, Vector2,
  Vector3,
  WebGLRenderer
} from 'three/src/Three';
import PhysicsHandler from '../../../../shared/physics/PhysicsHandler';
import SceneManagerParent from '../../../../shared/scene/SceneManagerParent';
import {ParametricGeometries} from "three/examples/jsm/geometries/ParametricGeometries";
import TorusKnotGeometry = ParametricGeometries.TorusKnotGeometry;
import {Water} from "../../../../shared/scene/water/Water2";
import Water2Manager from "../../../../shared/web-managers/Water2Manager";

const params = {
  color: '#ffffff',
  scale: 4,
  flowX: 1,
  flowY: 1
};

export default class SceneManager extends SceneManagerParent {
  private loader: TextureLoader = new TextureLoader();
  private water: Water;
  private waterManager: Water2Manager;
  private torusKnot: Mesh;

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler)  {
    super.build(camera, scene, renderer, physicsHandler);

    const torusKnotGeometry = new TorusKnotGeometry( 3, 1, 256, 32 );
    const torusKnotMaterial = new MeshNormalMaterial();

    this.torusKnot = new Mesh( torusKnotGeometry, torusKnotMaterial );
    this.torusKnot.position.y = 4;
    this.torusKnot.scale.set( 0.5, 0.5, 0.5 );
    scene.add( this.torusKnot );

    const groundGeometry = new PlaneGeometry( 20, 20 );
    const groundMaterial = new MeshStandardMaterial( { roughness: 0.8, metalness: 0.4 } );
    const ground = new Mesh( groundGeometry, groundMaterial );
    ground.rotation.x = Math.PI * - 0.5;
    scene.add( ground );

    const textureLoader = new TextureLoader();
    textureLoader.load( '/textures/hardwood2_diffuse.jpg', function ( map ) {

      map.wrapS = RepeatWrapping;
      map.wrapT = RepeatWrapping;
      map.anisotropy = 16;
      map.repeat.set( 4, 4 );
      map.colorSpace = SRGBColorSpace;
      groundMaterial.map = map;
      groundMaterial.needsUpdate = true;

    } );


    this.waterManager = new Water2Manager();
    this.addWater();
    renderer.toneMapping = ACESFilmicToneMapping;

    let texture = this.loader.load('/textures/basketball/equirectangular_court.jpg');
    let sphere = new Mesh(
        new SphereGeometry(16, 32, 32),
        new MeshBasicMaterial({
          map: texture,
          side: BackSide,
        })
    );
    sphere.rotateY(-Math.PI/5.5);
    this.scene.add(sphere);

    // light
    const ambientLight = new  AmbientLight( 0xe7e7e7, 1.2 );
    scene.add( ambientLight );

    const directionalLight = new DirectionalLight( 0xffffff, 2 );
    directionalLight.position.set( - 1, 1, 1 );
    scene.add( directionalLight );
  };

  addWater() {
    let waterGeometry = new PlaneGeometry( 20, 20 );
    let water = new Water(
      waterGeometry,
      {
        color: params.color,
        scale: params.scale,
        flowDirection: new Vector2( params.flowX, params.flowY ),
        textureWidth: 1024,
        textureHeight: 1024,
        alpha: 0,
        distortionScale: 3.7,
        fog: this.scene.fog !== undefined
      }
    );
    water.position.y = 1;
    water.rotation.x = Math.PI * - 0.5;
    this.scene.add( water );
    this.water = water;
  }

  update() {
    const delta = this.clock.getDelta();
    this.torusKnot.rotation.x += delta;
    this.torusKnot.rotation.y += delta * 0.5;

  }

  getInitialCameraPosition() {
    return new Vector3(-15, 7, 15);
  }

  postUpdate() {
    if (this.water && this.water.reflector) {
      this.waterManager.update(this.water, this.renderer, this.scene, this.camera);
    }
  }
}
