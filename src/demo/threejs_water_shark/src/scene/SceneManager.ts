import {
  AmbientLight, AnimationMixer,
  BackSide, Clock,
  DirectionalLight,
  FrontSide,
  Mesh, MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  ShaderChunk, ShaderMaterial, SRGBColorSpace, TextureLoader,
  Vector3,
  WebGLRenderer
} from 'three';
import PhysicsHandler from '../../../../shared/physics/cannon/PhysicsHandler';
import SceneManagerParent from '../../../../shared/scene/SceneManagerParent';

import {Pool} from "./Pool";
import {WaterSimulation} from "./WaterSimulation";
import {Water} from "./Water";
import {loadFile} from "../utils/utils";
import {Caustics} from "../../../threejs_water/src/scene/Caustics";
import {GestureType, HandTrackingResult} from "../../../../shared/scene/SceneManagerInterface";
import {GLTFLoader} from "three/examples/jsm/loaders/GLTFLoader";

const light = [0.7559289460184544, 0.7559289460184544, -0.3779644730092272];

export default class SceneManager extends SceneManagerParent {
  private waterSimulation = new WaterSimulation();
  private water: Water;
  private caustics: Caustics;
  private pool: Pool;
  private waterTexture: any;
  private causticsTexture: any;
  private latestGesture = GestureType.None;
  private clock = new Clock();
  private sharkUniforms = {
    uLight: { value: new Vector3(...light) },
    uWater: { value: null as any },
    uCausticTex: { value: null as any },
    uUnderwaterColor: { value: new Vector3(0.4, 0.9, 1.0) }
  };

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler)  {
    super.build(camera, scene, renderer, physicsHandler);

    loadFile('shaders/utils.glsl').then((utils) => {
      ShaderChunk['utils'] = utils;
      this.pool = new Pool();
      this.scene.add(this.pool);
      this.water = new Water();
      this.scene.add(this.water);
      // @ts-ignore
      this.caustics = new Caustics(this.water.geometry);

      var loader = new GLTFLoader().setPath( 'assets/shark/' );
      loader.load( 'shark.gltf', ( gltf ) => {
        this.mixer = new AnimationMixer( gltf.scene );
        gltf.animations.forEach((clip) => {
          this.mixer.clipAction(clip).play();
        });

        gltf.scene.scale.set(0.12, 0.12, 0.12);
        gltf.scene.position.y = -0.5;

        gltf.scene.traverse((child) => {
          // @ts-ignore
          if (child.isMesh) {
            const mesh = child as Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = true;

            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((mat) => {
              if (mat instanceof MeshStandardMaterial) {
                mat.roughness = 0.4;
                mat.metalness = 0.05;
                mat.onBeforeCompile = (shader) => {
                  shader.uniforms.uLight = this.sharkUniforms.uLight;
                  shader.uniforms.uWater = this.sharkUniforms.uWater;
                  shader.uniforms.uCausticTex = this.sharkUniforms.uCausticTex;
                  shader.uniforms.uUnderwaterColor = this.sharkUniforms.uUnderwaterColor;

                  shader.vertexShader = shader.vertexShader.replace(
                    '#include <common>',
                    `#include <common>
                    varying vec3 vSharkWorldPos;`
                  );

                  shader.vertexShader = shader.vertexShader.replace(
                    '#include <worldpos_vertex>',
                    `#include <worldpos_vertex>
                    #if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
                      vSharkWorldPos = worldPosition.xyz;
                    #else
                      vec4 wPos = modelMatrix * vec4( transformed, 1.0 );
                      vSharkWorldPos = wPos.xyz;
                    #endif`
                  );

                  shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <common>',
                    `#include <common>
                    varying vec3 vSharkWorldPos;
                    uniform vec3 uLight;
                    uniform sampler2D uWater;
                    uniform sampler2D uCausticTex;
                    uniform vec3 uUnderwaterColor;`
                  );

                  shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <dithering_fragment>',
                    `#include <dithering_fragment>
                    const float IOR_AIR = 1.0;
                    const float IOR_WATER = 1.333;
                    vec3 refractedLight = -refract(-normalize(uLight), vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);
                    vec4 waterInfo = texture2D(uWater, vSharkWorldPos.xz * 0.5 + 0.5);
                    if (vSharkWorldPos.y < waterInfo.r) {
                      vec4 caustic = texture2D(uCausticTex, 0.75 * (vSharkWorldPos.xz - vSharkWorldPos.y * refractedLight.xz / refractedLight.y) * 0.5 + 0.5);
                      gl_FragColor.rgb += gl_FragColor.rgb * caustic.r * 2.0 * caustic.g;
                      gl_FragColor.rgb *= uUnderwaterColor * 1.15;
                    }`
                  );
                };
              }
            });
          }
        });

        this.scene.add(gltf.scene);
      } );
    });

    // light
    const ambientLight = new  AmbientLight( 0xe7e7e7, 1.2 );
    scene.add( ambientLight );

    const directionalLight = new DirectionalLight( 0xffffff, 2 );
    directionalLight.position.set( - 1, 1, 1 );
    scene.add( directionalLight );

    const loaded = [this.waterSimulation.loaded];

    Promise.all(loaded).then(() => {

      for (var i = 0; i < 20; i++) {
        this.waterSimulation.addDrop(
            renderer,
            Math.random() * 2 - 1, Math.random() * 2 - 1,
            0.03, (i & 1) ? 0.02 : -0.02
        );
      }

    });
  };

  update() {
    var delta = this.clock.getDelta();

    if ( this.mixer ) this.mixer.update( delta );

    if (this.water && this.waterSimulation.loaded) {
      // @ts-ignore
      this.water.material.uniforms['water'].value = this.waterTexture;
      // @ts-ignore
      this.water.material.uniforms['causticTex'].value = this.causticsTexture;
    }
  }

  getInitialCameraPosition() {
    return new Vector3(0, 0, 0);
    // return new Vector3(-3, 2, 1);
  }

  postUpdate() {
    if (this.waterSimulation.loaded && this.waterSimulation._dropMesh && this.waterSimulation._normalMesh && this.waterSimulation._updateMesh && this.caustics && this.caustics.loaded) {
      this.waterSimulation.stepSimulation(this.renderer);
      this.waterSimulation.updateNormals(this.renderer);
      this.waterTexture = this.waterSimulation.texture.texture;
      this.caustics.update(this.renderer, this.waterTexture);
      this.causticsTexture = this.caustics.texture.texture;
      if (this.pool) {
        // @ts-ignore
        this.pool.material.uniforms['water'].value = this.waterTexture;
        // @ts-ignore
        this.pool.material.uniforms['causticTex'].value = this.causticsTexture;
      }
      if (this.water) {
        // @ts-ignore
        this.water.material.uniforms['water'].value = this.waterTexture;
        // @ts-ignore
        this.water.material.uniforms['causticTex'].value = this.causticsTexture;
      }
      this.sharkUniforms.uWater.value = this.waterTexture;
      this.sharkUniforms.uCausticTex.value = this.causticsTexture;
      this.renderer.setRenderTarget(null);
    }
  }

  handleGesture(gesture: HandTrackingResult) {
    if (gesture.gestureType != GestureType.None && gesture.gestureType != this.latestGesture) {
      // this.latestGesture = gesture.gestureType;
      if (gesture.gestureType == GestureType.Open_Hand) {
        this.waterSimulation.addDrop(this.renderer, gesture.position.x, gesture.position.z, 0.03, 0.04);
      }
    }
  }

}
