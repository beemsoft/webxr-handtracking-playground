export const noiseGLSL = /* glsl */ `
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += vec3(dot(p3, p3.yzx + vec3(33.33)));
    return fract((p3.x + p3.y) * p3.z);
  }
  float noise2(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (vec2(3.0) - vec2(2.0) * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fractal(vec2 p) {
    mat2 turn = mat2(0.80, 0.60, -0.60, 0.80);
    float f = 0.55 * noise2(p);
    p = turn * p * 2.03 + vec2(17.1);
    f += 0.28 * noise2(p);
    p = turn * p * 2.07 - vec2(9.2);
    return f + 0.17 * noise2(p);
  }
`;
