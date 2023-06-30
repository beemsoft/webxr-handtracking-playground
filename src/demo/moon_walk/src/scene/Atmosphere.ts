import {
  BackSide,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  UniformsUtils,
  Vector3 } from "three";
import { atmosphereFragmentShader, atmosphereVertexShader } from "./AtmosphereShaders";

const verteces = Math.pow(2, 9);

class Atmosphere extends Mesh {

  constructor( lightDirection: Vector3, options = {} ) {

    super( new SphereGeometry(1.02, verteces, verteces) );

    const scope = this;

    const uniformsRef = {
      uTime: { value: 0 },
      lightDirection: { value: lightDirection.clone() },
    };


    const mirrorShader = {

      uniforms: uniformsRef,

      vertexShader: atmosphereVertexShader,

      fragmentShader: atmosphereFragmentShader

    };

    const material = new ShaderMaterial( {
      side: BackSide,
      transparent: true,
      fragmentShader: mirrorShader.fragmentShader,
      vertexShader: mirrorShader.vertexShader,
      uniforms: UniformsUtils.clone( mirrorShader.uniforms )
    } );

    // @ts-ignore
    scope.material = material;
  }

}

export { Atmosphere };

// interface AtmosphereProps {
//   lightDirection: Vector3;
// }
//
// export const Atmosphere = ({ lightDirection }: AtmosphereProps) => {
//   const lightDirectionRef = useRef<Vector3>(lightDirection.clone());
//   useEffect(() => {
//     lightDirectionRef.current.copy(lightDirection);
//   }, [lightDirection]);
//
//   return (
//     <mesh>
//       <sphereGeometry args={[1.02, verteces, verteces]} />
//       <shaderMaterial
//         side={BackSide}
//         vertexShader={atmosphereVertexShader}
//         fragmentShader={atmosphereFragmentShader}
//         transparent
//         uniforms={{
//           lightDirection: { value: lightDirectionRef.current },
//         }}
//       />
//     </mesh>
//   );
// };
