import { PerspectiveCamera, Scene, Vector2, WebGLRenderer, WebGLRenderTarget } from 'three/src/Three';
import { PostProcessingConfig, PostProcessingType } from '../scene/SceneManagerInterface';
import { EffectComposer } from '../postprocessing/EffectComposer';
import { RenderPass } from '../postprocessing/RenderPass';
import { UnrealBloomPass } from '../postprocessing/UnrealBloomPass';
import { OutputPass } from '../postprocessing/OutputPass';

export default class EffectManager {

  createEffectComposer(renderer: WebGLRenderer, camera: PerspectiveCamera, scene: Scene, finalRenderTarget: WebGLRenderTarget, frameBufferTarget: WebGLFramebuffer, postProcessingConfig: PostProcessingConfig) {
    let composer = new EffectComposer( renderer, finalRenderTarget );
    composer.addPass( new RenderPass( scene, camera ) );
    if (postProcessingConfig.postProcessingType == PostProcessingType.Bloom) {
      let bloomPass = new UnrealBloomPass(new Vector2(), 1.5, 0.4, 0.85, finalRenderTarget, camera);
      bloomPass.threshold = postProcessingConfig.threshold;
      bloomPass.strength = postProcessingConfig.strength;
      bloomPass.radius = postProcessingConfig.radius;
      composer.addPass(bloomPass);
    }
    composer.addPass( new OutputPass( postProcessingConfig.toneMapping, finalRenderTarget, frameBufferTarget ));
    return composer;
  }

}
