import {
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DataTexture,
  Group,
  Material,
  Mesh,
  RingGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils';
import { CausticField, COLUMN_COUNT, COLUMN_RADIUS, COLUMN_RING_RADIUS, WATER_HEIGHT } from './CausticField';
import { createCausticMaterial } from './CausticMaterials';
import { createStoneTexture } from './StoneTexture';

export const ROOM_RADIUS = 11.5;
/** The top tread continues beyond the installation until the fog hides it. */
export const OUTER_TERRACE_RADIUS = 60;
export const TERRACE_START = 4.45;
export const TERRACE_COUNT = 16;
export const TERRACE_WIDTH = (ROOM_RADIUS - TERRACE_START) / TERRACE_COUNT;
export const TERRACE_RISE = 0.105;
export const PLINTH_RADIUS = 2.2;
export const PLINTH_TOP = 0.55;

export const COLUMNS: Array<{ x: number; z: number; radius: number }> = Array.from({ length: COLUMN_COUNT }, (_, i) => {
  const angle = ((i + 0.5) * Math.PI * 2) / COLUMN_COUNT;
  return { x: Math.sin(angle) * COLUMN_RING_RADIUS, z: Math.cos(angle) * COLUMN_RING_RADIUS, radius: COLUMN_RADIUS };
});

/** Height of the stepped floor at a given radius from the centre. */
export function floorHeight(radius: number): number {
  if (radius < 3.55) return 0.2;
  if (radius < 3.8) return 0.12;
  if (radius < 4.05) return 0.06;
  if (radius < TERRACE_START) return 0;
  return TERRACE_RISE * Math.min(TERRACE_COUNT, 1 + Math.floor((radius - TERRACE_START) / TERRACE_WIDTH));
}

/** Flip winding and normals so an open cylinder faces its own axis. */
function faceInward(geometry: BufferGeometry): BufferGeometry {
  const index = geometry.index!;
  for (let i = 0; i < index.count; i += 3) {
    const b = index.getX(i + 1);
    index.setX(i + 1, index.getX(i + 2));
    index.setX(i + 2, b);
  }
  const normal = geometry.getAttribute('normal');
  for (let i = 0; i < normal.count; i++) {
    normal.setXYZ(i, -normal.getX(i), -normal.getY(i), -normal.getZ(i));
  }
  return geometry;
}

export class Rotunda {
  readonly group = new Group();
  readonly stoneMap: DataTexture;
  readonly stoneMaterial: Material;
  readonly floorMaterial: Material;
  private readonly geometries: BufferGeometry[] = [];

  constructor(field: CausticField) {
    this.group.name = 'Rotunda';
    this.stoneMap = createStoneTexture(512);
    this.stoneMaterial = createCausticMaterial(field, {
      color: new Color('#d9cbb2'),
      stoneMap: this.stoneMap,
      stoneTint: new Color(1.1, 1.05, 0.95),
    });
    this.floorMaterial = createCausticMaterial(field, {
      color: new Color('#dccfb6'),
      stoneMap: this.stoneMap,
      stoneTint: new Color(1.1, 1.05, 0.95),
      floorTiles: true,
    });

    const floorParts: BufferGeometry[] = [];
    const stoneParts: BufferGeometry[] = [];

    // Central floor disc, hidden beyond the first terrace by the stair risers.
    floorParts.push(new CircleGeometry(TERRACE_START + 0.02, 96).rotateX(-Math.PI / 2));

    // Terraces: a flat tread and an inward-facing riser per step.
    for (let i = 0; i < TERRACE_COUNT; i++) {
      const r = TERRACE_START + i * TERRACE_WIDTH;
      const y = TERRACE_RISE * (i + 1);
      const outer = i === TERRACE_COUNT - 1 ? OUTER_TERRACE_RADIUS : r + TERRACE_WIDTH;
      floorParts.push(new RingGeometry(r + 0.016, outer, 96, 1).rotateX(-Math.PI / 2).translate(0, y, 0));
      stoneParts.push(faceInward(new CylinderGeometry(r, r, TERRACE_RISE, 96, 1, true)).translate(0, y - TERRACE_RISE / 2, 0));
    }

    // Columns reach through the water surface.
    for (const { x, z, radius } of COLUMNS) {
      const bottom = floorHeight(Math.hypot(x, z) - radius * 1.35);
      const top = WATER_HEIGHT + 0.04;
      const height = top - bottom;
      stoneParts.push(new CylinderGeometry(radius, radius * 1.02, height, 28, 1, true).translate(x, bottom + height / 2, z));
      stoneParts.push(new CylinderGeometry(radius * 1.25, radius * 1.32, 0.22, 28).translate(x, bottom + 0.11, z));
    }

    this.addMerged(floorParts, this.floorMaterial, 'Polished stone terraces');
    this.addMerged(stoneParts, this.stoneMaterial, 'Limestone architecture');

    // Shallow dais steps; tops are polished tile, sides diffuse limestone.
    const dais: Array<[number, number]> = [
      [4.05, 0.06],
      [3.8, 0.12],
      [3.55, 0.2],
    ];
    for (const [radius, height] of dais) {
      const geometry = new CylinderGeometry(radius, radius, height, 64).translate(0, height / 2, 0);
      this.addMesh(geometry, [this.stoneMaterial, this.floorMaterial, this.stoneMaterial], 'Dais');
    }
    this.addMesh(new CylinderGeometry(PLINTH_RADIUS + 0.07, PLINTH_RADIUS + 0.07, 0.05, 64).translate(0, 0.225, 0), this.stoneMaterial, 'Plinth base');
    this.addMesh(
      new CylinderGeometry(PLINTH_RADIUS, PLINTH_RADIUS, 0.3, 64).translate(0, PLINTH_TOP - 0.15, 0),
      [this.stoneMaterial, this.floorMaterial, this.stoneMaterial],
      'Plinth'
    );
  }

  private addMerged(parts: BufferGeometry[], material: Material, name: string) {
    const merged = mergeGeometries(parts, false);
    parts.forEach((part) => part.dispose());
    if (!merged) {
      throw new Error(`Unable to merge ${name}`);
    }
    this.addMesh(merged, material, name);
  }

  private addMesh(geometry: BufferGeometry, material: Material | Material[], name: string) {
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    // Large terrace rings extend far beyond the camera frustum bounds of their centre.
    mesh.frustumCulled = false;
    this.geometries.push(geometry);
    this.group.add(mesh);
  }

  dispose() {
    this.geometries.forEach((geometry) => geometry.dispose());
    this.stoneMaterial.dispose();
    this.floorMaterial.dispose();
    this.stoneMap.dispose();
  }
}
