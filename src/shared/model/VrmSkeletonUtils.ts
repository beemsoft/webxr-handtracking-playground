import { Matrix4, Quaternion } from 'three/src/Three';

export default class VrmSkeletonUtils {

  static retarget(target, source, options) {

    options = options || {};
    options.preserveMatrix = options.preserveMatrix !== undefined ? options.preserveMatrix : true;
    options.preservePosition = options.preservePosition !== undefined ? options.preservePosition : true;
    options.preserveHipPosition = options.preserveHipPosition !== undefined ? options.preserveHipPosition : false;
    options.useTargetMatrix = options.useTargetMatrix !== undefined ? options.useTargetMatrix : false;
    options.hip = options.hip !== undefined ? options.hip : "hip";
    options.names = options.names || {};

    let sourceBones = source.isObject3D ? source.skeleton.bones : this.getBones(source),
      bindBones,
      bone, name,
      i;


    if (options.preserveMatrix) {
      // reset matrix
      target.updateMatrixWorld();
      target.matrixWorld.identity();
      // reset children matrix
      for (i = 0; i < target.children.length; ++i) {
        target.children[i].updateMatrixWorld(true);
      }
    }

    if (options.offsets) {
      bindBones = [];
        bone = target;
        name = options.names[bone.name] || bone.name;
        if (options.offsets && options.offsets[name]) {
          bone.matrix.multiply(options.offsets[name]);
          bone.matrix.decompose(bone.position, bone.quaternion, bone.scale);
          bone.updateMatrixWorld();
        }
        bindBones.push(bone.matrixWorld.clone());
    }

    this.retargetBone(options, sourceBones, target.children[0]);   // Hip
    this.retargetBone(options, sourceBones, target.children[0].children[0]);   // Spine
    this.retargetBone(options, sourceBones, target.children[0].children[0].children[0]);   // Chest
    this.retargetBone(options, sourceBones, target.children[0].children[0].children[0].children[0]);   // Upper chest
    this.retargetBone(options, sourceBones, target.children[0].children[0].children[0].children[0].children[0]);   // Neck
    this.retargetBone(options, sourceBones, target.children[0].children[0].children[0].children[0].children[0].children[0]);   // Head
    this.retargetBone(options, sourceBones, target.children[0].children[0].children[0].children[0].children[2]);   // Left shoulder
    this.retargetBone(options, sourceBones, target.children[0].children[0].children[0].children[0].children[2].children[0]);   // Left shoulder
    this.retargetBone(options, sourceBones, target.children[0].children[0].children[0].children[0].children[2].children[0].children[0]);   // Left shoulder
    this.retargetBone(options, sourceBones, target.children[0].children[0].children[0].children[0].children[2].children[0].children[0].children[0]);   // Left shoulder
    this.retargetBone(options, sourceBones, target.children[0].children[0].children[0].children[0].children[1]);   // Left shoulder
    this.retargetBone(options, sourceBones, target.children[0].children[0].children[0].children[0].children[1].children[0]);   // Left shoulder
    this.retargetBone(options, sourceBones, target.children[0].children[0].children[0].children[0].children[1].children[0].children[0]);   // Left shoulder
    this.retargetBone(options, sourceBones, target.children[0].children[0].children[0].children[0].children[1].children[0].children[0].children[0]);   // Left shoulder
    this.retargetBone(options, sourceBones, target.children[0].children[2]);   // Right upper leg
    this.retargetBone(options, sourceBones, target.children[0].children[2].children[0]);   // Right leg
    this.retargetBone(options, sourceBones, target.children[0].children[2].children[0].children[0]);   // Right foot
    this.retargetBone(options, sourceBones, target.children[0].children[1]);   // Left upper leg
    this.retargetBone(options, sourceBones, target.children[0].children[1].children[0]);   // Left leg
    this.retargetBone(options, sourceBones, target.children[0].children[1].children[0].children[0]);   // Left foot
  };

  static retargetBone(options, sourceBones, target) {
    const quat = new Quaternion(),
      relativeMatrix = new Matrix4(),
      globalMatrix = new Matrix4();

    let bone = target;
    let name = options.names[bone.name] || bone.name;
    let boneTo = this.getBoneByName(name, sourceBones);
    globalMatrix.copy(bone.matrixWorld);
    if (boneTo) {
      boneTo.updateMatrixWorld();
      if (options.useTargetMatrix) {
        relativeMatrix.copy(boneTo.matrixWorld);
      } else {
        relativeMatrix.copy(target.matrixWorld).invert();
        relativeMatrix.multiply(boneTo.matrixWorld);
      }
      globalMatrix.makeRotationFromQuaternion(quat.setFromRotationMatrix(relativeMatrix));
      globalMatrix.copyPosition(relativeMatrix);
    }

    bone.matrix.copy(bone.parent.matrixWorld).invert();
    bone.matrix.multiply(globalMatrix);

    bone.matrix.decompose(bone.position, bone.quaternion, bone.scale);
    bone.updateMatrixWorld();
  }

  static getBones(skeleton) {
    return Array.isArray(skeleton) ? skeleton : skeleton.bones;
  }

  static getBoneByName(name, skeleton) {
    let i = 0, bones = this.getBones(skeleton);
    for (; i < bones.length; i++) {
      if (name === bones[i].name)
        return bones[i];
    }
  }
}
