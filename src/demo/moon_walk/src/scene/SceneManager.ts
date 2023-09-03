import {
  BackSide,
  CineonToneMapping,
  DirectionalLight,
  EquirectangularReflectionMapping,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from 'three/src/Three';
import PhysicsHandler from '../../../../shared/physics/PhysicsHandler';
import SceneManagerParent from '../../../../shared/scene/SceneManagerParent';
import { Earth } from './Earth';
import {
  HandTrackingResult,
  PostProcessingConfig,
  PostProcessingType
} from '../../../../shared/scene/SceneManagerInterface';
import { Atmosphere } from './Atmosphere';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader';

const DISTANCE_FROM_EARTH = 17;

export default class SceneManager extends SceneManagerParent {
  private light: DirectionalLight;
  private sun: Vector3;
  private earth: Earth;
  private lightDirection: Vector3;
  private rightHand: Mesh;

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler)  {
    super.build(camera, scene, renderer, physicsHandler);

    renderer.shadowMap.enabled = true;
    this.addBackground();

    const initialSunRotation = new Vector3(1, 0, 0).applyAxisAngle(
      new Vector3(0, 0, 1),
      Math.PI * (13 / 180)
    );

    this.lightDirection = initialSunRotation.clone();
    this.earth = new Earth(this.lightDirection);
    this.scene.add(this.earth);
    this.scene.add(new Atmosphere(this.lightDirection));

    let light = new DirectionalLight( 0xffffff );
    light.castShadow = true;
    light.position.x = this.lightDirection.x;
    light.position.y = this.lightDirection.y;
    light.position.z = this.lightDirection.z;
    this.light = light;
    this.scene.add(light);

    this.sun = new Vector3();
    this.addSun();

    const loader = new GLTFLoader();
    loader.load('models/moon_-_petavius_crater.glb', (gltf) => {
      let model = gltf.scene;
      model.position.x = -DISTANCE_FROM_EARTH;
      model.position.y = -2;
      model.position.z = 5;
      model.scale.setScalar(12);
      model.receiveShadow = true;
      gltf.scene.traverse( function( object ) {
        object.receiveShadow = true;
        object.castShadow = true;
      } );
      scene.add(model);
    });

    loader.load('models/apollo_11_lunar_module/scene.gltf', (gltf) => {
      let model = gltf.scene;
      model.position.x = -(DISTANCE_FROM_EARTH-2.5);
      model.position.y = -1.22;
      model.position.z = 2;
      model.rotation.z = -0.04;
      model.rotation.x = -0.04;
      model.scale.setScalar(0.015);
      gltf.scene.traverse( function( object ) {
        object.receiveShadow = true;
        object.castShadow = true;
      } );
      scene.add(model);
    });

    loader.load('models/apollo_11_lunar_extravehicular_gloves.glb', (gltf) => {
      let model = gltf.scene;
      model.position.x = -DISTANCE_FROM_EARTH;
      model.position.y = -1.5;
      model.position.z = 5;
      model.rotation.y = Math.PI;
      model.scale.setScalar(0.1);
      gltf.scene.traverse( function( object ) {
        object.receiveShadow = true;
        object.castShadow = true;
      } );
      scene.add(model);
      // this.rightHand = model;
    });

    const loader3 = new OBJLoader();
    const materialLoader = new MTLLoader();
    materialLoader.setPath( 'models/armstrong_suit-web_model/' );
    materialLoader
      .load( 'suit_ext-part_01-high.mtl', function ( materials ) {
        materials.preload();
        loader3.setMaterials( materials );
        loader3.load('models/armstrong_suit-web_model/suit_ext-part_01-high.obj', function(object) {
          object.position.x = -(DISTANCE_FROM_EARTH-0.2);
          object.position.y = -2;
          object.position.z = 4.5;
          object.scale.setScalar(0.0004);
          object.traverse( function ( child ) {
            // if ( child.isMesh ) {
            //   child.castShadow = true;
            //   child.receiveShadow = true;
            // }
          } );
          scene.add(object);
          materialLoader
            .load( 'suit_ext-part_02-high.mtl', function ( materials ) {
              materials.preload();
              loader3.setMaterials( materials );
              loader3.load('models/armstrong_suit-web_model/suit_ext-part_02-high.obj', function(object) {
                object.position.x = -(DISTANCE_FROM_EARTH-0.2);
                object.position.y = -2;
                object.position.z = 4.5;
                object.scale.setScalar(0.0004);
                object.traverse( function ( child ) {
                  // if ( child.isMesh ) {
                  //   child.castShadow = true;
                  //   child.receiveShadow = true;
                  // }
                } );
                scene.add(object);
                materialLoader
                  .load( 'suit_ext-part_03-high.mtl', function ( materials ) {
                    materials.preload();
                    loader3.setMaterials( materials );
                    loader3.load('models/armstrong_suit-web_model/suit_ext-part_03-high.obj', function(object) {
                      object.position.x = -(DISTANCE_FROM_EARTH-0.2);
                      object.position.y = -2;
                      object.position.z = 4.5;
                      object.scale.setScalar(0.0004);
                      object.traverse( function ( child ) {
                        // if ( child.isMesh ) {
                        //   child.castShadow = true;
                        //   child.receiveShadow = true;
                        // }
                      } );
                      scene.add(object);
                    })
                  });
              })
            });
        })
      });
  };

  addBackground() {
    const loader = new TextureLoader();
    const texture = loader.load("/textures/starmap_g4k.jpg");
    texture.mapping = EquirectangularReflectionMapping;
    texture.colorSpace = SRGBColorSpace;
    let sphere = new Mesh(
      new SphereGeometry(60, 32, 32),
      new MeshBasicMaterial({
        map: texture,
        side: BackSide,
      })
    );
    this.scene.add(sphere);
  }

  addSun() {
    let sphere = new Mesh( new SphereGeometry(0.7, 32, 32), new MeshStandardMaterial({
      color: 'white',
      emissive: '#FFFFFF',
      emissiveIntensity: 15,
      toneMapped: false
    }));

    let sunPosition = this.lightDirection.clone().multiplyScalar(60);
    sphere.position.x = sunPosition.x;
    sphere.position.y = sunPosition.y;
    sphere.position.z = sunPosition.z;

    this.scene.add(sphere);
  }

  handleGesture(gesture: HandTrackingResult) {
    this.rightHand.position.x = gesture.position.x;
    this.rightHand.position.y = gesture.position.y;
    this.rightHand.position.z = gesture.position.z;
    this.rightHand.quaternion.x = gesture.orientation.x;
    this.rightHand.quaternion.y = gesture.orientation.y;
    this.rightHand.quaternion.z = gesture.orientation.z;
    this.rightHand.quaternion.w = gesture.orientation.w;
  }

  getInitialCameraPosition() {
    return new Vector3(-20, -1.5, 5);
  }

  getPostProcessingConfig(): PostProcessingConfig {
    return {
      postProcessingType: PostProcessingType.Bloom,
      toneMapping: CineonToneMapping,
      threshold: 2,
      strength: 0.3,
      radius: 0,
      exposure: 0
    };
  }
}
