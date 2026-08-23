precision highp float;
precision highp int;

#include <utils>

uniform float underwater;
uniform samplerCube sky;

varying vec3 eye;
varying vec3 pos;


void main() {
  vec2 coord = pos.xz * 0.5 + 0.5;
  vec4 info = texture2D(water, coord);

  /* make water look more "peaked" */
  for (int i = 0; i < 5; i++) {
    coord += info.ba * 0.005;
    info = texture2D(water, coord);
  }

  vec3 normal = normalize(vec3(info.b, sqrt(max(0.001, 1.0 - dot(info.ba, info.ba))), info.a));
  vec3 incomingRay = normalize(pos - eye);

  if (dot(normal, incomingRay) > 0.0) {
    // Viewing from underwater
    normal = -normal;
    vec3 reflectedRay = reflect(incomingRay, normal);
    vec3 refractedRay = refract(incomingRay, normal, IOR_WATER / IOR_AIR);
    float fresnel = mix(0.4, 1.0, pow(1.0 - max(0.0, dot(normal, -incomingRay)), 3.0));

    vec3 skyCol = (length(refractedRay) > 0.0) ? textureCube(sky, refractedRay).rgb : underwaterColor;
    vec3 color = mix(underwaterColor * 0.9, skyCol, (1.0 - fresnel) * length(refractedRay));
    gl_FragColor = vec4(color, 0.45);
  } else {
    // Viewing from above water
    vec3 reflectedRay = reflect(incomingRay, normal);
    float fresnel = mix(0.15, 0.95, pow(1.0 - max(0.0, dot(normal, -incomingRay)), 3.0));

    vec3 reflectedSky = textureCube(sky, reflectedRay).rgb;

    // Sunlight specular glint on waves
    float specular = pow(max(0.0, dot(reflectedRay, normalize(light))), 40.0) * 1.6;
    reflectedSky += specular * vec3(1.0, 0.95, 0.85);

    // Water surface color tint (shallow tropical cyan)
    vec3 waterSurfaceTint = vec3(0.05, 0.35, 0.45);
    vec3 surfaceColor = mix(waterSurfaceTint, reflectedSky, fresnel) + specular;

    // Semi-transparent surface allowing shark and pool tiles to show through clearly
    float alpha = mix(0.35, 0.92, fresnel);
    gl_FragColor = vec4(surfaceColor, alpha);
  }
}
