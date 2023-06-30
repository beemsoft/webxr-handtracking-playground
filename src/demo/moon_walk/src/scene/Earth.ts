import {
	Mesh,
	ShaderMaterial,
	SphereGeometry,
	SRGBColorSpace,
	TextureLoader,
	UniformsUtils,
	Vector3,
	WebGLRenderTarget
} from 'three/src/Three';
import { earthFragmentShader, earthVertexShader } from './EarthShaders';

const verteces = Math.pow(2, 9);

class Earth extends Mesh {

	renderTarget: WebGLRenderTarget;

	constructor( lightDirection: Vector3, options = {} ) {

		super( new SphereGeometry(1, verteces, verteces) );

		const scope = this;

		const loader = new TextureLoader();
		const earthDayTexture = loader.load("/textures/8k_earth_daymap.jpg");
		const nightTexture = loader.load("/textures/8k_earth_nightmap.jpg");
		const cloudTexture = loader.load("/textures/8k_earth_clouds.jpg");

		earthDayTexture.colorSpace =
			nightTexture.colorSpace =
				cloudTexture.colorSpace =
					SRGBColorSpace;


	const uniformsRef = {
		dayMap: { value: earthDayTexture },
		nightMap: { value: nightTexture },
		cloudMap: { value: cloudTexture },
		uTime: { value: 0 },
		lightDirection: { value: lightDirection.clone() },
	};


		const mirrorShader = {

			uniforms: uniformsRef,

			vertexShader: earthVertexShader,

			fragmentShader: earthFragmentShader

		};

		const material = new ShaderMaterial( {
			fragmentShader: mirrorShader.fragmentShader,
			vertexShader: mirrorShader.vertexShader,
			uniforms: UniformsUtils.clone( mirrorShader.uniforms )
		} );

		// @ts-ignore
		scope.material = material;
	}

}

export { Earth };
