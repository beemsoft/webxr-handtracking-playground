import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Matrix4, Skeleton,
  Vector3
} from 'three/src/Three';

const _vector = /*@__PURE__*/ new Vector3();
const _boneMatrix = /*@__PURE__*/ new Matrix4();
const _matrixWorldInv = /*@__PURE__*/ new Matrix4();


export default class SkeletonHelper extends LineSegments {
  private isSkeletonHelper: boolean;
  public skeleton: Skeleton;
  public visible: boolean;
  public bones: any[];
  root: any;

  constructor(object) {
    const bones = getBoneList(object);
    const geometry = new BufferGeometry();
    const vertices = [];
    const colors = [];
    const color1 = new Color(0, 0, 1);
    const color2 = new Color(0, 1, 0);
    for (let i = 0; i < bones.length; i++) {
      vertices.push(0, 0, 0);
      vertices.push(0, 0, 0);
      colors.push(color1.r, color1.g, color1.b);
      colors.push(color2.r, color2.g, color2.b);
    }
    geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    const material = new LineBasicMaterial({
      vertexColors: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      transparent: true
    });
    super(geometry, material);
    this.isSkeletonHelper = true;
    this.root = object;
    this.bones = bones;
    // @ts-ignore
    this.matrix = object.matrixWorld;
    // @ts-ignore
    this.matrixAutoUpdate = false;
  }

  updateMatrixWorld(force) {
    const bones = this.bones;
    // @ts-ignore
    const geometry = this.geometry;
    // @ts-ignore
    const position = geometry.getAttribute('position');
    _matrixWorldInv.copy( this.root.matrixWorld ).invert();
    for (let i = 0, j = 0; i < bones.length; i++) {
      const bone = bones[i];
      if (bone.parent && bone.parent.isBone) {
        _boneMatrix.multiplyMatrices(_matrixWorldInv, bone.matrixWorld);
        _vector.setFromMatrixPosition(_boneMatrix);
        position.setXYZ(j, _vector.x, _vector.y, _vector.z);
        _boneMatrix.multiplyMatrices(_matrixWorldInv, bone.parent.matrixWorld);
        _vector.setFromMatrixPosition(_boneMatrix);
        position.setXYZ(j + 1, _vector.x, _vector.y, _vector.z);
        j += 2;
      }
    }
    // @ts-ignore
    geometry.getAttribute('position').needsUpdate = true;
    super.updateMatrixWorld(force);
  }
}

function getBoneList(object) {
  const boneList = [];
  if (object && object.isBone) {
    boneList.push(object);
  }
  for (let i = 0; i < object.children.length; i++) {
    boneList.push.apply(boneList, getBoneList(object.children[i]));
  }
  return boneList;
}
