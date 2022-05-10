import {
	Color,
	FrontSide,
	Matrix4,
	Mesh,
	ShaderMaterial,
	UniformsLib,
	UniformsUtils,
	Vector3,
	WebGLRenderTarget
} from 'three/src/Three';

/**
 * Work based on :
 * https://github.com/Slayvin: Flat mirror for three.js
 * https://home.adelphi.edu/~stemkoski/ : An implementation of water shader based on the flat mirror
 * http://29a.ch/ && http://29a.ch/slides/2012/webglwater/ : Water shader explanations in WebGL
 */

class Water extends Mesh {

	public textureMatrix = new Matrix4();
	public clipBias: number;
	public eye: Vector3;
	renderTarget: WebGLRenderTarget;

	constructor( geometry, options = {} ) {

		super( geometry );

		const scope = this;

		// @ts-ignore
		const textureWidth = options.textureWidth !== undefined ? options.textureWidth : 512;
		// @ts-ignore
		const textureHeight = options.textureHeight !== undefined ? options.textureHeight : 512;

		// @ts-ignore
		this.clipBias = options.clipBias !== undefined ? options.clipBias : 0.0;
		// @ts-ignore
		const alpha = options.alpha !== undefined ? options.alpha : 1.0;
		// @ts-ignore
		const time = options.time !== undefined ? options.time : 0.0;
		// @ts-ignore
		const normalSampler = options.waterNormals !== undefined ? options.waterNormals : null;
		// @ts-ignore
		const sunDirection = options.sunDirection !== undefined ? options.sunDirection : new Vector3( 0.70707, 0.70707, 0.0 );
		// @ts-ignore
		const sunColor = new Color( options.sunColor !== undefined ? options.sunColor : 0xffffff );
		// @ts-ignore
		const waterColor = new Color( options.waterColor !== undefined ? options.waterColor : 0x7F7F7F );
		// @ts-ignore
		this.eye = options.eye !== undefined ? options.eye : new Vector3( 0, 0, 0 );
		// @ts-ignore
		const distortionScale = options.distortionScale !== undefined ? options.distortionScale : 20.0;
		// @ts-ignore
		const side = options.side !== undefined ? options.side : FrontSide;
		// @ts-ignore
		const fog = options.fog !== undefined ? options.fog : false;

		this.renderTarget = new WebGLRenderTarget( textureWidth, textureHeight);

		const mirrorShader = {

			uniforms: UniformsUtils.merge( [
				UniformsLib[ 'fog' ],
				UniformsLib[ 'lights' ],
				{
					'normalSampler': { value: null },
					'mirrorSampler': { value: null },
					'alpha': { value: 1.0 },
					'time': { value: 0.0 },
					'size': { value: 1.0 },
					'distortionScale': { value: 20.0 },
					'textureMatrix': { value: new Matrix4() },
					'sunColor': { value: new Color( 0x7F7F7F ) },
					'sunDirection': { value: new Vector3( 0.70707, 0.70707, 0 ) },
					'eye': { value: new Vector3() },
					'waterColor': { value: new Color( 0x555555 ) }
				}
			] ),

			vertexShader: /* glsl */`
				uniform mat4 textureMatrix;
				uniform float time;

				varying vec4 mirrorCoord;
				varying vec4 worldPosition;

				#include <fog_pars_vertex>
				#include <shadowmap_pars_vertex>

				void main() {
					mirrorCoord = modelMatrix * vec4( position, 1.0 );
					worldPosition = mirrorCoord.xyzw;
					mirrorCoord = textureMatrix * mirrorCoord;
					vec4 mvPosition =  modelViewMatrix * vec4( position, 1.0 );
					gl_Position = projectionMatrix * mvPosition;

				#include <fog_vertex>
				#include <shadowmap_vertex>
			}`,

			fragmentShader: /* glsl */`
				uniform sampler2D mirrorSampler;
				uniform float alpha;
				uniform float time;
				uniform float size;
				uniform float distortionScale;
				uniform sampler2D normalSampler;
				uniform vec3 sunColor;
				uniform vec3 sunDirection;
				uniform vec3 eye;
				uniform vec3 waterColor;

				varying vec4 mirrorCoord;
				varying vec4 worldPosition;

				vec4 getNoise( vec2 uv ) {
					vec2 uv0 = ( uv / 103.0 ) + vec2(time / 17.0, time / 29.0);
					vec2 uv1 = uv / 107.0-vec2( time / -19.0, time / 31.0 );
					vec2 uv2 = uv / vec2( 8907.0, 9803.0 ) + vec2( time / 101.0, time / 97.0 );
					vec2 uv3 = uv / vec2( 1091.0, 1027.0 ) - vec2( time / 109.0, time / -113.0 );
					vec4 noise = texture2D( normalSampler, uv0 ) +
						texture2D( normalSampler, uv1 ) +
						texture2D( normalSampler, uv2 ) +
						texture2D( normalSampler, uv3 );
					return noise * 0.5 - 1.0;
				}

				void sunLight( const vec3 surfaceNormal, const vec3 eyeDirection, float shiny, float spec, float diffuse, inout vec3 diffuseColor, inout vec3 specularColor ) {
					vec3 reflection = normalize( reflect( -sunDirection, surfaceNormal ) );
					float direction = max( 0.0, dot( eyeDirection, reflection ) );
					specularColor += pow( direction, shiny ) * sunColor * spec;
					diffuseColor += max( dot( sunDirection, surfaceNormal ), 0.0 ) * sunColor * diffuse;
				}

				#include <common>
				#include <packing>
				#include <bsdfs>
				#include <fog_pars_fragment>
				#include <lights_pars_begin>
				#include <shadowmap_pars_fragment>
				#include <shadowmask_pars_fragment>

				void main() {
					vec4 noise = getNoise( worldPosition.xz * size );
					vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );

					vec3 diffuseLight = vec3(0.0);
					vec3 specularLight = vec3(0.0);

					vec3 worldToEye = eye-worldPosition.xyz;
					vec3 eyeDirection = normalize( worldToEye );
					sunLight( surfaceNormal, eyeDirection, 100.0, 2.0, 0.5, diffuseLight, specularLight );

					float distance = length(worldToEye);

					vec2 distortion = surfaceNormal.xz * ( 0.001 + 1.0 / distance ) * distortionScale;
					vec3 reflectionSample = vec3( texture2D( mirrorSampler, mirrorCoord.xy / mirrorCoord.w + distortion ) );

					float theta = max( dot( eyeDirection, surfaceNormal ), 0.0 );
					float rf0 = 0.3;
					float reflectance = rf0 + ( 1.0 - rf0 ) * pow( ( 1.0 - theta ), 5.0 );
					vec3 scatter = max( 0.0, dot( surfaceNormal, eyeDirection ) ) * waterColor;
					vec3 albedo = mix( ( sunColor * diffuseLight * 0.3 + scatter ) * getShadowMask(), ( vec3( 0.1 ) + reflectionSample * 0.9 + reflectionSample * specularLight ), reflectance);
					vec3 outgoingLight = albedo;
					gl_FragColor = vec4( outgoingLight, alpha );

					#include <tonemapping_fragment>
					#include <fog_fragment>
				}`

		};

		const material = new ShaderMaterial( {
			fragmentShader: mirrorShader.fragmentShader,
			vertexShader: mirrorShader.vertexShader,
			uniforms: UniformsUtils.clone( mirrorShader.uniforms ),
			lights: true,
			side: side,
			fog: fog
		} );

		material.uniforms[ 'mirrorSampler' ].value = this.renderTarget.texture;
		material.uniforms[ 'textureMatrix' ].value = this.textureMatrix;
		material.uniforms[ 'alpha' ].value = alpha;
		material.uniforms[ 'time' ].value = time;
		material.uniforms[ 'normalSampler' ].value = normalSampler;
		material.uniforms[ 'sunColor' ].value = sunColor;
		material.uniforms[ 'waterColor' ].value = waterColor;
		material.uniforms[ 'sunDirection' ].value = sunDirection;
		material.uniforms[ 'distortionScale' ].value = distortionScale;

		material.uniforms[ 'eye' ].value = this.eye;

		// @ts-ignore
		scope.material = material;
	}

}

// @ts-ignore
Water.prototype.isWater = true;

export { Water };
