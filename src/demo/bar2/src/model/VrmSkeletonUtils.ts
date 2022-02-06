import { Matrix4, Quaternion, Vector3 } from 'three';

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
      bones = target.isObject3D ? target.skeleton.bones : this.getBones(target),
      bindBones,
      bone, name,
      bonesPosition, i;

    // reset bones
    if (target.isObject3D) {
      target.skeleton.pose();
    } else {
      options.useTargetMatrix = true;
      options.preserveMatrix = false;
    }

    if (options.preservePosition) {
      bonesPosition = [];
      for (i = 0; i < bones.length; i++) {
        let pos = bones[i].position.clone();
        bonesPosition.push(pos);
      }
    }

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
      for (i = 0; i < bones.length; ++i) {
        bone = bones[i];
        name = options.names[bone.name] || bone.name;
        if (options.offsets && options.offsets[name]) {
          bone.matrix.multiply(options.offsets[name]);
          bone.matrix.decompose(bone.position, bone.quaternion, bone.scale);
          bone.updateMatrixWorld();
        }
        bindBones.push(bone.matrixWorld.clone());
      }
    }

    this.retargetBone(bones, options, sourceBones, target, bindBones, 9);
    // this.retargetBone(bones, options, sourceBones, target, bindBones, 8);
    this.retargetBone(bones, options, sourceBones, target, bindBones, 5);
    this.retargetBone(bones, options, sourceBones, target, bindBones, 4);
    this.retargetBone(bones, options, sourceBones, target, bindBones, 2);
    this.retargetBone(bones, options, sourceBones, target, bindBones, 0);
    this.retargetBone(bones, options, sourceBones, target, bindBones, 7);
    this.retargetBone(bones, options, sourceBones, target, bindBones, 14);
    this.retargetBone(bones, options, sourceBones, target, bindBones, 22);
    // this.retargetBone(bones, options, sourceBones, target, bindBones, 23);
    this.retargetBone(bones, options, sourceBones, target, bindBones, 1);
    this.retargetBone(bones, options, sourceBones, target, bindBones, 3);
    this.retargetBone(bones, options, sourceBones, target, bindBones, 20);
    // this.retargetBone(bones, options, sourceBones, target, bindBones, 21);
    this.retargetBone(bones, options, sourceBones, target, bindBones, 12);
    this.retargetBone(bones, options, sourceBones, target, bindBones, 18);
    this.retargetBone(bones, options, sourceBones, target, bindBones, 19);
    this.retargetBone(bones, options, sourceBones, target, bindBones, 10);
    this.retargetBone(bones, options, sourceBones, target, bindBones, 16);
    this.retargetBone(bones, options, sourceBones, target, bindBones, 17);
  };

  static retargetBone(bones, options, sourceBones, target, bindBones, i) {
    const pos = new Vector3(),
      quat = new Quaternion(),
      bindBoneMatrix = new Matrix4(),
      relativeMatrix = new Matrix4(),
      globalMatrix = new Matrix4();

    let bone = bones[i];
    let name = options.names[bone.name] || bone.name;
    let boneTo = this.getBoneByName(name, sourceBones);
    globalMatrix.copy(bone.matrixWorld);
    if (boneTo) {
      boneTo.updateMatrixWorld();
      if (options.useTargetMatrix) {
        relativeMatrix.copy(boneTo.matrixWorld);
      } else {
        relativeMatrix.getInverse(target.matrixWorld);
        relativeMatrix.multiply(boneTo.matrixWorld);
      }
      globalMatrix.makeRotationFromQuaternion(quat.setFromRotationMatrix(relativeMatrix));
      if (target.isObject3D) {
        const boneIndex = bones.indexOf(bone),
          wBindMatrix = bindBones ? bindBones[boneIndex] : bindBoneMatrix.getInverse(target.skeleton.boneInverses[boneIndex]);
        globalMatrix.multiply(wBindMatrix);
      }
      globalMatrix.copyPosition(relativeMatrix);
    }

    bone.matrix.getInverse(bone.parent.matrixWorld);
    bone.matrix.multiply(globalMatrix);

    if (options.preserveHipPosition && name === options.hip) {
      bone.matrix.setPosition(pos.set(0, bone.position.y, 0));
    }
    bone.matrix.decompose(bone.position, bone.quaternion, bone.scale);
    bone.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI));
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
