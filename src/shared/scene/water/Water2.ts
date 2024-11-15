import {
    ClampToEdgeWrapping,
    Clock,
    Color, Matrix3,
    Matrix4,
    Mesh, MirroredRepeatWrapping,
    RepeatWrapping,
    ShaderMaterial,
    TextureLoader,
    UniformsLib,
    UniformsUtils,
    Vector2,
    Vector4
} from 'three';
// import {Refractor} from "three/examples/jsm/objects/Refractor";
import {Reflector} from "./Reflector2";
import {Refractor} from "./Refractor2";
import {Vector3, WebGLRenderTarget} from "three/src/Three";
// import {Reflector} from "three/examples/jsm/objects/Reflector";

/**
 * References:
 *	https://alex.vlachos.com/graphics/Vlachos-SIGGRAPH10-WaterFlow.pdf
 *	http://graphicsrunner.blogspot.de/2010/08/water-using-flow-maps.html
 *
 */

class Water extends Mesh {

    public reflector: Reflector;
    refractor: Refractor;
    textureMatrix: Matrix4;
    flowSpeed: number;
    cycle: number;
    halfCycle: number;
    public clipBias: number;
    public eye: Vector3;
    renderTarget: WebGLRenderTarget;

    constructor( geometry, options = {} ) {

        super( geometry );

        // @ts-ignore
        this.isWater = true;

        // @ts-ignore
        this.type = 'Water';

        // @ts-ignore
        const color = ( options.color !== undefined ) ? new Color( options.color ) : new Color( 0xFFFFFF );
        // @ts-ignore
        const textureWidth = options.textureWidth || 512;
        // @ts-ignore
        const textureHeight = options.textureHeight || 512;
        // @ts-ignore
        const clipBias = options.clipBias || 0;
        // @ts-ignore
        const flowDirection = options.flowDirection || new Vector2( 1, 0 );
        // @ts-ignore
        this.flowSpeed = options.flowSpeed || 0.03;
        // @ts-ignore
        const reflectivity = options.reflectivity || 0.02;
        // @ts-ignore
        const scale = options.scale || 1;
        // @ts-ignore
        const shader = options.shader || Water.WaterShader;
        // @ts-ignore

        const textureLoader = new TextureLoader();

        // @ts-ignore
        const flowMap = options.flowMap || undefined;
        // @ts-ignore
        const normalMap0 = options.normalMap0 || textureLoader.load( 'textures/water/Water_1_M_Normal.jpg' );
        // @ts-ignore
        const normalMap1 = options.normalMap1 || textureLoader.load( 'textures/water/Water_2_M_Normal.jpg' );

        this.cycle = 0.15; // a cycle of a flow map phase
        this.halfCycle = this.cycle * 0.5;
        this.textureMatrix = new Matrix4();

        this.renderTarget = new WebGLRenderTarget( textureWidth, textureHeight);

        this.reflector = new Reflector( geometry, {
            color: undefined,
            textureWidth: textureWidth,
            textureHeight: textureHeight,
            clipBias: clipBias,
            shader: undefined,
            multisample: undefined
        } );

        this.refractor = new Refractor( geometry, {
            color: undefined,
            textureWidth: textureWidth,
            textureHeight: textureHeight,
            clipBias: clipBias,
            shader: undefined,
            multisample: undefined
        } );

        // @ts-ignore
        this.reflector.matrixAutoUpdate = false;
        // @ts-ignore
        this.refractor.matrixAutoUpdate = false;

        // material
        // @ts-ignore
        this.material = new ShaderMaterial( {
            uniforms: UniformsUtils.merge( [
                UniformsLib[ 'fog' ],
                shader.uniforms
            ] ),
            vertexShader: shader.vertexShader,
            fragmentShader: shader.fragmentShader,
            transparent: true,
            fog: false
        } );

        if ( flowMap !== undefined ) {

            // @ts-ignore
            this.material.defines.USE_FLOWMAP = '';
            // @ts-ignore
            this.material.uniforms[ 'tFlowMap' ] = {
                type: 't',
                value: flowMap
            };

        } else {
            // @ts-ignore
            this.material.uniforms[ 'flowDirection' ] = {
                type: 'v2',
                value: flowDirection
            };

        }

        // maps

        // normalMap0.wrapS = normalMap0.wrapT = RepeatWrapping;
        // normalMap1.wrapS = normalMap1.wrapT = RepeatWrapping;
        // normalMap0.wrapS = normalMap0.wrapT = ClampToEdgeWrapping;
        // normalMap1.wrapS = normalMap1.wrapT = ClampToEdgeWrapping;
        normalMap0.wrapS = normalMap0.wrapT = MirroredRepeatWrapping;
        normalMap1.wrapS = normalMap1.wrapT = MirroredRepeatWrapping;

        // @ts-ignore
        this.material.uniforms[ 'tReflectionMap' ].value = this.reflector.getRenderTarget().texture;
        // @ts-ignore
        this.material.uniforms[ 'tRefractionMap' ].value = this.refractor.getRenderTarget().texture;
        // @ts-ignore
        this.material.uniforms[ 'tNormalMap0' ].value = normalMap0;
        // @ts-ignore
        this.material.uniforms[ 'tNormalMap1' ].value = normalMap1;

        // water

        // @ts-ignore
        this.material.uniforms[ 'color' ].value = color;
        // @ts-ignore
        this.material.uniforms[ 'reflectivity' ].value = reflectivity;
        // @ts-ignore
        this.material.uniforms[ 'textureMatrix' ].value = this.textureMatrix;

        // inital values

        // @ts-ignore
        this.material.uniforms[ 'config' ].value.x = 0; // flowMapOffset0
        // @ts-ignore
        this.material.uniforms[ 'config' ].value.y = this.halfCycle; // flowMapOffset1
        // @ts-ignore
        this.material.uniforms[ 'config' ].value.z = this.halfCycle; // halfCycle
        // @ts-ignore
        this.material.uniforms[ 'config' ].value.w = scale; // scale
    }

}

// @ts-ignore
Water.WaterShader = {

    uniforms: {

        'color': {
            type: 'c',
            value: null
        },

        'reflectivity': {
            type: 'f',
            value: 0
        },

        'tReflectionMap': {
            type: 't',
            value: null
        },

        'tRefractionMap': {
            type: 't',
            value: null
        },

        'tNormalMap0': {
            type: 't',
            value: null
        },

        'tNormalMap1': {
            type: 't',
            value: null
        },

        'textureMatrix': {
            type: 'm4',
            value: null
        },

        'config': {
            type: 'v4',
            value: new Vector4()
        }

    },

    vertexShader: /* glsl */`

		#include <common>
		#include <fog_pars_vertex>
		#include <logdepthbuf_pars_vertex>

		uniform mat4 textureMatrix;

		varying vec4 vCoord;
		varying vec2 vUv;
		varying vec3 vToEye;

		void main() {

			vUv = uv;
			vCoord = textureMatrix * vec4( position, 1.0 );

			vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
			vToEye = cameraPosition - worldPosition.xyz;

			vec4 mvPosition =  viewMatrix * worldPosition; // used in fog_vertex
			gl_Position = projectionMatrix * mvPosition;

			#include <logdepthbuf_vertex>
			#include <fog_vertex>

		}`,

    fragmentShader: /* glsl */`

		#include <common>
		#include <fog_pars_fragment>
		#include <logdepthbuf_pars_fragment>

		uniform sampler2D tReflectionMap;
		uniform sampler2D tRefractionMap;
		uniform sampler2D tNormalMap0;
		uniform sampler2D tNormalMap1;

		#ifdef USE_FLOWMAP
			uniform sampler2D tFlowMap;
		#else
			uniform vec2 flowDirection;
		#endif

		uniform vec3 color;
		uniform float reflectivity;
		uniform vec4 config;

		varying vec4 vCoord;
		varying vec2 vUv;
		varying vec3 vToEye;

		void main() {

			#include <logdepthbuf_fragment>

			float flowMapOffset0 = config.x;
			float flowMapOffset1 = config.y;
			float halfCycle = config.z;
			float scale = config.w;

			vec3 toEye = normalize( vToEye );

			// determine flow direction
			vec2 flow;
			#ifdef USE_FLOWMAP
				flow = texture2D( tFlowMap, vUv ).rg * 2.0 - 1.0;
			#else
				flow = flowDirection;
			#endif
			flow.x *= - 1.0;

			// sample normal maps (distort uvs with flowdata)
			vec4 normalColor0 = texture2D( tNormalMap0, ( vUv * scale ) + flow * flowMapOffset0 );
			vec4 normalColor1 = texture2D( tNormalMap1, ( vUv * scale ) + flow * flowMapOffset1 );

			// linear interpolate to get the final normal color
			float flowLerp = abs( halfCycle - flowMapOffset0 ) / halfCycle;
			vec4 normalColor = mix( normalColor0, normalColor1, flowLerp );

			// calculate normal vector
			vec3 normal = normalize( vec3( normalColor.r * 2.0 - 1.0, normalColor.b,  normalColor.g * 2.0 - 1.0 ) );

			// calculate the fresnel term to blend reflection and refraction maps
			float theta = max( dot( toEye, normal ), 0.0 );
			// float reflectance = reflectivity + ( 1.0 - reflectivity ) * pow( ( 1.0 - theta ), 5.0 );
			float reflectance = 0.5;

			// calculate final uv coords
			vec3 coord = vCoord.xyz / vCoord.w;
			vec2 uv = coord.xy + coord.z * normal.xz * 0.05;

			vec4 reflectColor = texture2D( tReflectionMap, vec2( 1.0 - uv.x, uv.y ) );
			vec4 refractColor = texture2D( tRefractionMap, uv );

			// multiply water color with the mix of both textures
			gl_FragColor = vec4( color, 1.0 ) * mix( refractColor, reflectColor, reflectance );

			#include <tonemapping_fragment>
			#include <colorspace_fragment>
			#include <fog_fragment>

		}`

};

export { Water };
