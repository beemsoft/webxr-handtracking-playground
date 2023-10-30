precision highp float;
precision highp int;

uniform sampler2D texture2;
varying vec2 coord;


void main() {
  vec4 color = texture2D(texture2, coord);

  gl_FragColor = vec4(color.x, color.y, color.z, 1.);
}
