import {
	ShaderMaterial,
	UniformsUtils,
	NoToneMapping,
	LinearToneMapping,
	ReinhardToneMapping,
	CineonToneMapping,
	ACESFilmicToneMapping
} from 'three';
import { Pass, FullScreenQuad } from './Pass.js';
import { OutputShader } from '../shaders/OutputShader.js';

class OutputPass extends Pass {

	constructor( toneMapping = NoToneMapping, baseRenderTarget, frameBufferTarget, camera, toneMappingExposure = 1 ) {

		super();

		this.baseRenderTarget = baseRenderTarget;
		this.frameBufferTarget = frameBufferTarget;
		// this.camera = camera;
		this.toneMapping = toneMapping;
		this.toneMappingExposure = toneMappingExposure;

		//

		const shader = OutputShader;

		this.uniforms = UniformsUtils.clone( shader.uniforms );

		this.material = new ShaderMaterial( {
			uniforms: this.uniforms,
			vertexShader: shader.vertexShader,
			fragmentShader: shader.fragmentShader
		} );

		if ( toneMapping === LinearToneMapping ) this.material.defines.LINEAR_TONE_MAPPING = '';
		else if ( toneMapping === ReinhardToneMapping ) this.material.defines.REINHARD_TONE_MAPPING = '';
		else if ( toneMapping === CineonToneMapping ) this.material.defines.CINEON_TONE_MAPPING = '';
		else if ( toneMapping === ACESFilmicToneMapping ) this.material.defines.ACES_FILMIC_TONE_MAPPING = '';

		this.fsQuad = new FullScreenQuad( this.material );

	}

	render( renderer, writeBuffer, readBuffer /*, deltaTime, maskActive */ ) {

		this.uniforms[ 'tDiffuse' ].value = readBuffer.texture;
		this.uniforms[ 'toneMappingExposure' ].value = this.toneMappingExposure;

		if ( this.renderToScreen === true ) {
				// renderer.setRenderTarget( renderer.xr.getRenderTarget() );
                if (this.baseRenderTarget) {
					// console.log('Set outputpass render target');
					renderer.setRenderTarget(this.baseRenderTarget);
					// renderer.setRenderTargetFramebuffer( this.baseRenderTarget, glBaseLayer.framebuffer );
					renderer.setRenderTargetFramebuffer( this.baseRenderTarget, this.frameBufferTarget );
				} else {
					renderer.setRenderTarget(null);
				}
			let renderTarget = renderer.getRenderTarget();
			if (renderTarget && renderTarget.texture) {
				console.log('Set rendertarget: ' + renderTarget.texture.name + ' (' + renderTarget.texture.uuid + ')');
			} else {
				console.log('Rendertarget is set to : ' + renderTarget);
			}

			this.fsQuad.render( renderer, this.camera );

		} else {
			let renderTarget = renderer.getRenderTarget();
			if (renderTarget && renderTarget.texture) {
				console.log('Set rendertarget: ' + renderTarget.texture.name + ' (' + renderTarget.texture.uuid + ')');
			} else {
				console.log('Rendertarget is set to : ' + renderTarget);
			}

			renderer.setRenderTarget( writeBuffer );
			if ( this.clear ) renderer.clear( renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil );
			this.fsQuad.render( renderer, this.camera );

		}

	}

	dispose() {

		this.material.dispose();
		this.fsQuad.dispose();

	}

}

export { OutputPass };
