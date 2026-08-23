uniform sampler2D texture2;
varying vec2 coord;


void main() {
  coord = position.xy + 0.5;

  gl_Position = vec4(position.xy * 2., 0., 1.);
}
