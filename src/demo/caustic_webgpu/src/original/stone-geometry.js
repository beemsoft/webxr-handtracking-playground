import { LatheGeometry, CircleGeometry, Vector2 } from "../../vendor/three/build/three.webgpu.js";
import { mergeGeometries } from "../../vendor/three/examples/jsm/utils/BufferGeometryUtils.js";

function lathe(profile, normals, segments) {
  const geometry = new LatheGeometry(
    profile.map((p) => new Vector2(...p)),
    segments,
  );
  if (normals) {
    const attribute = geometry.attributes.normal;
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      for (let j = 0; j < profile.length; j++) {
        const [radial, y] = normals[j];
        attribute.setXYZ(
          i * profile.length + j,
          radial * Math.sin(angle),
          y,
          radial * Math.cos(angle),
        );
      }
    }
  }
  return geometry;
}

// Inward-facing step riser, with exact tangent normals at the rounded nosing.
export function createStepNosing(
  radius,
  height,
  bevel = 0.016,
  segments = 192,
) {
  const profile = [],
    normals = [];
  for (let i = 0; i <= 4; i++) {
    const angle = ((i / 4) * Math.PI) / 2;
    profile.push([
      radius + bevel - bevel * Math.sin(angle),
      height - bevel + bevel * Math.cos(angle),
    ]);
    normals.push([-Math.sin(angle), Math.cos(angle)]);
  }
  profile.push([radius, 0]);
  normals.push([-1, 0]);
  return lathe(profile, normals, segments);
}

// Material groups match CylinderGeometry: wall 0, top 1, underside 2.
export function createBeveledCylinder(
  radius,
  height,
  bevel = 0.025,
  segments = 96,
) {
  bevel = Math.min(bevel, height * 0.3);
  const profile = [],
    normals = [];
  for (let i = 0; i <= 4; i++) {
    const angle = ((i / 4) * Math.PI) / 2;
    profile.push([
      radius - bevel + bevel * Math.sin(angle),
      bevel - bevel * Math.cos(angle),
    ]);
    normals.push([Math.sin(angle), -Math.cos(angle)]);
  }
  for (let i = 0; i <= 4; i++) {
    const angle = ((i / 4) * Math.PI) / 2;
    profile.push([
      radius - bevel + bevel * Math.cos(angle),
      height - bevel + bevel * Math.sin(angle),
    ]);
    normals.push([Math.cos(angle), Math.sin(angle)]);
  }
  const side = lathe(profile, normals, segments);
  const top = new CircleGeometry(radius - bevel, segments);
  top.rotateX(-Math.PI / 2).translate(0, height, 0);
  const bottom = new CircleGeometry(radius - bevel, segments);
  bottom.rotateX(Math.PI / 2);
  const geometry = mergeGeometries([side, top, bottom], true);
  geometry.translate(0, -height / 2, 0);
  for (const part of [side, top, bottom]) part.dispose();
  return geometry;
}

export function createColumnGeometry(radius, height) {
  const profile = [
    [1.25, 0],
    [1.31, 0.025],
    [1.32, 0.055],
    [1.3, 0.085],
    [1.24, 0.11],
    [1.08, 0.14],
    [1.08, 0.16],
    [1.15, 0.185],
    [1.16, 0.215],
    [1.11, 0.245],
    [1.03, 0.27],
  ];
  // Gentle entasis keeps the long shaft from reading as a straight pipe.
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    profile.push([
      1 - 0.08 * t + 0.035 * Math.sin(Math.PI * t),
      0.3 + t * (height - 0.68),
    ]);
  }
  profile.push(
    [0.92, height - 0.34],
    [1, height - 0.315],
    [1.02, height - 0.29],
    [1.01, height - 0.265],
    [0.98, height - 0.24],
    [1.04, height - 0.205],
    [1.17, height - 0.15],
    [1.28, height - 0.11],
    [1.32, height - 0.075],
    [1.32, height - 0.035],
    [1.28, height],
  );
  return lathe(
    profile.map(([r, y]) => [r * radius, y]),
    null,
    64,
  );
}
