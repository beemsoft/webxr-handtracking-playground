import { PlaneGeometry, Color, BufferAttribute } from "../../vendor/three/build/three.webgpu.js";

export function createAlgaeGeometry(compact = false) {
  const blade = new PlaneGeometry(1, 1, compact ? 4 : 6, compact ? 12 : 32);
  blade.translate(0, 0.5, 0);
  const positions = blade.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  const root = new Color("#193c24"),
    tip = new Color("#719549"),
    vein = new Color("#8b9c59");
  const tint = new Color();
  for (let i = 0; i < positions.count; i++) {
    const t = positions.getY(i),
      across = positions.getX(i) * 2;
    const arch = Math.sin(Math.PI * t);
    const width =
      (0.003 * (1 - t) + (compact ? 0.075 : 0.105) * arch ** 0.85) *
      (1 - t * 0.28);
    const scallop = 1 + 0.09 * Math.sin(t * 29 + across * 0.8);
    const lateral = across * width * 0.5 * scallop;
    const twist = -0.25 + t * (compact ? 0.8 : 1.25) + Math.sin(t * 5) * 0.22;
    // A raised midrib and undulating edges give the leaf a curved cross-section.
    const ridge = (1 - across * across) * arch * 0.009;
    const edge = across * across * arch * Math.sin(t * 33 + across) * 0.005;
    positions.setXYZ(
      i,
      Math.sin(t * 3.5) * 0.07 +
        t * t * (compact ? 0.14 : 0.3) +
        lateral * Math.cos(twist),
      t - t ** 4 * (compact ? 0.09 : 0.14),
      Math.sin(t * 4.8) * 0.07 + lateral * Math.sin(twist) + ridge + edge,
    );
    tint.copy(root).lerp(tip, t * 0.85);
    tint.multiplyScalar(1 - Math.abs(across) * 0.15);
    tint.lerp(vein, (1 - Math.abs(across)) ** 8 * arch * 0.3);
    tint.toArray(colors, i * 3);
  }
  blade.setAttribute("color", new BufferAttribute(colors, 3));
  blade.computeVertexNormals();
  return blade;
}
