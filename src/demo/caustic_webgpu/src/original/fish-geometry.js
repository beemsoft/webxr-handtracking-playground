import * as THREE from "../../vendor/three/build/three.webgpu.js";
import {
  mergeGeometries,
  mergeVertices,
} from "../../vendor/three/examples/jsm/utils/BufferGeometryUtils.js";

// +X is forward. Rounded shoulders narrow into a real caudal peduncle;
// curved, subdivided membranes can flex instead of behaving like rigid triangles.
export function createFishGeometry() {
  const parts = [];
  const scaleRepeats = 3;
  function part(source, type, tint) {
    const g = source.index ? source.toNonIndexed() : source;
    if (g !== source) source.dispose();
    const finUV = type === -1 ? g.getAttribute("uv") : null;
    g.deleteAttribute("uv");
    const p = g.attributes.position,
      colors = [],
      uv = [],
      skin = [],
      c = new THREE.Color(),
      back = new THREE.Color("#9eafb3"),
      belly = new THREE.Color("#fff2cb");
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        y = p.getY(i),
        z = p.getZ(i);
      if (type === 1) {
        c.copy(back).lerp(
          belly,
          THREE.MathUtils.smoothstep(0.04 - y, -0.035, 0.095),
        );
        // Gill cover and a fine silver lateral line follow the body's curvature.
        const gill =
          Math.exp(-(((x - (0.125 - 2.2 * y * y)) / 0.01) ** 2)) *
          THREE.MathUtils.smoothstep(Math.abs(z), 0.018, 0.04);
        c.multiplyScalar(1 - gill * 0.3);
        c.lerp(belly, Math.exp(-(((y - 0.008) / 0.006) ** 2)) * 0.2);
      } else if (typeof tint === "function") tint(c, x, y, z);
      else c.set(tint);
      if (finUV)
        c.multiplyScalar(
          0.88 + 0.24 * THREE.MathUtils.smoothstep(finUV.getY(i), 0, 1),
        );
      colors.push(c.r, c.g, c.b);
      skin.push(type);
      if (finUV) uv.push(finUV.getX(i), finUV.getY(i));
      else
        uv.push(
          ((x + 0.24) / 0.48) * scaleRepeats,
          (Math.atan2(z / 0.05, y / 0.085) / (2 * Math.PI) + 0.5) *
            scaleRepeats,
        );
    }
    for (let i = 0; !finUV && i < p.count; i += 3) {
      const values = [uv[i * 2 + 1], uv[i * 2 + 3], uv[i * 2 + 5]];
      if (Math.max(...values) - Math.min(...values) > scaleRepeats / 2)
        for (let j = 0; j < 3; j++)
          if (values[j] < scaleRepeats / 2) uv[(i + j) * 2 + 1] += scaleRepeats;
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    g.setAttribute("scaleUV", new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute("skin", new THREE.Float32BufferAttribute(skin, 1));
    parts.push(g);
  }
  const profile = [
    [-0.235, 0.009, 0.009],
    [-0.205, 0.014, 0.013],
    [-0.16, 0.035, 0.024],
    [-0.09, 0.066, 0.039],
    [0, 0.086, 0.052],
    [0.075, 0.08, 0.052],
    [0.135, 0.062, 0.043],
    [0.185, 0.04, 0.03],
    [0.218, 0.021, 0.02],
    [0.239, 0.01, 0.012],
    [0.249, 0, 0],
  ];
  const positions = [],
    indices = [];
  const radial = 16;
  // Catmull-Rom interpolation gives continuous shoulders and a softly rounded nose.
  for (let ring = 0; ring < profile.length * 2 - 1; ring++) {
    const index = Math.floor(ring / 2),
      t = (ring % 2) * 0.5;
    const sample = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const a = profile[Math.max(0, index - 1)][k],
        b = profile[index][k],
        c = profile[Math.min(profile.length - 1, index + 1)][k],
        d = profile[Math.min(profile.length - 1, index + 2)][k];
      sample[k] =
        0.5 *
        (2 * b +
          (-a + c) * t +
          (2 * a - 5 * b + 4 * c - d) * t * t +
          (-a + 3 * b - 3 * c + d) * t * t * t);
    }
    for (let j = 0; j <= radial; j++) {
      const angle = (j / radial) * Math.PI * 2;
      positions.push(
        sample[0],
        Math.cos(angle) * sample[1],
        Math.sin(angle) * sample[2],
      );
    }
    if (ring > 0)
      for (let j = 0; j < radial; j++) {
        const a = (ring - 1) * (radial + 1) + j,
          b = a + radial + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
  }
  const body = new THREE.BufferGeometry();
  body.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  body.setIndex(indices);
  body.computeVertexNormals();
  part(body, 1);
  function fin(root, edge, tint = "#94a39b", paired = false) {
    const p = [],
      uv = [],
      index = [];
    const divisions = 3;
    for (let j = 0; j < edge.length; j++)
      for (let k = 0; k <= divisions; k++) {
        const t = k / divisions,
          point = edge[j];
        // Angular coordinate follows the fin rays, radial coordinate runs
        // from the thicker root to the thin trailing membrane.
        uv.push(j / (edge.length - 1), t);
        p.push(
          root[0] + (point[0] - root[0]) * t,
          root[1] +
            (point[1] - root[1]) * t +
            (paired ? Math.sin(t * Math.PI) * 0.009 : 0),
          root[2] +
            (point[2] - root[2]) * t +
            (!paired ? Math.sin(t * Math.PI) * 0.004 : 0),
        );
      }
    for (let j = 0; j < edge.length - 1; j++)
      for (let k = 0; k < divisions; k++) {
        const a = j * (divisions + 1) + k,
          b = a + divisions + 1;
        index.push(a, b, a + 1, a + 1, b, b + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(index);
    g.computeVertexNormals();
    part(g, -1, tint);
  }
  fin(
    [-0.215, 0, 0],
    [
      [-0.25, 0.035, 0],
      [-0.3, 0.084, 0],
      [-0.372, 0.105, 0],
      [-0.347, 0.061, 0],
      [-0.303, 0, 0],
      [-0.347, -0.061, 0],
      [-0.372, -0.105, 0],
      [-0.3, -0.084, 0],
      [-0.25, -0.035, 0],
    ],
    "#93a79e",
  );
  fin(
    [-0.035, 0.062, 0],
    [
      [0.09, 0.071, 0],
      [0.04, 0.125, 0],
      [-0.015, 0.143, 0],
      [-0.075, 0.124, 0],
      [-0.145, 0.065, 0],
      [-0.18, 0.027, 0],
    ],
    "#8d9e94",
  );
  fin(
    [-0.06, -0.047, 0],
    [
      [0.005, -0.077, 0],
      [-0.06, -0.104, 0],
      [-0.125, -0.089, 0],
      [-0.18, -0.024, 0],
    ],
    "#98a69d",
  );
  for (const side of [-1, 1]) {
    fin(
      [0.095, -0.008, side * 0.042],
      [
        [0.07, -0.016, side * 0.05],
        [-0.015, -0.055, side * 0.111],
        [-0.07, -0.046, side * 0.105],
        [-0.04, -0.022, side * 0.062],
        [0.045, -0.006, side * 0.042],
      ],
      "#94a39b",
      true,
    );
    fin(
      [-0.015, -0.065, side * 0.012],
      [
        [-0.04, -0.097, side * 0.045],
        [-0.1, -0.088, side * 0.04],
        [-0.07, -0.053, side * 0.015],
      ],
      "#98a69d",
      true,
    );
    // One convex cornea with concentric pupil, iris and limbal rim. Ring
    // topology keeps the pupil round without adding more eye triangles.
    const rings = [0.4, 0.43, 0.46, 0.72, 0.86, 1];
    const segments = 16,
      eyePositions = [0.172, 0.024, side * 0.044],
      eyeNormals = [0, 0, side],
      eyeIndices = [];
    const normal = new THREE.Vector3();
    for (const radius of rings) {
      const depth = Math.sqrt(1 - radius * radius);
      for (let j = 0; j <= segments; j++) {
        const angle = (j / segments) * Math.PI * 2,
          x = Math.cos(angle) * radius,
          y = Math.sin(angle) * radius;
        eyePositions.push(
          0.172 + x * 0.016,
          0.024 + y * 0.016,
          side * (0.032 + depth * 0.012),
        );
        normal.set(x / 0.016, y / 0.016, (side * depth) / 0.012).normalize();
        eyeNormals.push(normal.x, normal.y, normal.z);
      }
    }
    const triangle = (a, b, c) =>
      eyeIndices.push(a, side > 0 ? b : c, side > 0 ? c : b);
    for (let j = 0; j < segments; j++) triangle(0, 1 + j, 2 + j);
    for (let ring = 0; ring < rings.length - 1; ring++)
      for (let j = 0; j < segments; j++) {
        const a = 1 + ring * (segments + 1) + j,
          b = a + segments + 1;
        triangle(a, b, a + 1);
        triangle(a + 1, b, b + 1);
      }
    const eyeGeometry = new THREE.BufferGeometry();
    eyeGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(eyePositions, 3),
    );
    eyeGeometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(eyeNormals, 3),
    );
    eyeGeometry.setIndex(eyeIndices);
    const gold = new THREE.Color("#c5a867"),
      olive = new THREE.Color("#756f42");
    part(eyeGeometry, 0, (tint, x, y) => {
      const dx = (x - 0.172) / 0.016,
        dy = (y - 0.024) / 0.016;
      const radius = Math.hypot(dx, dy);
      if (radius < 0.445) tint.set("#050b0f");
      else if (radius > 0.8) tint.set("#203b36");
      else
        tint
          .copy(gold)
          .lerp(olive, (radius - 0.46) / 0.26)
          .multiplyScalar(0.86 + 0.14 * Math.cos(Math.atan2(dy, dx) * 7));
    });
  }
  const merged = mergeGeometries(parts);
  // Retain the exact triangles and attribute seams while reusing duplicate
  // vertices across them, including in every reflection and shadow capture.
  const geometry = mergeVertices(merged, 1e-7);
  // The native normal map derives its tangent frame from this UV set.
  geometry.setAttribute("uv", geometry.getAttribute("scaleUV"));
  merged.dispose();
  parts.forEach((g) => g.dispose());
  geometry.computeBoundingSphere();
  return geometry;
}
