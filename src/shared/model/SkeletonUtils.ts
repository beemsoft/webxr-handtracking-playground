import { Matrix4, Quaternion, Vector3 } from 'three';

export default class SkeletonUtils {

  static retarget(target, source, options) {

    const pos = new Vector3(),
      quat = new Quaternion(),
      scale = new Vector3(),
      bindBoneMatrix = new Matrix4(),
      relativeMatrix = new Matrix4(),
      globalMatrix = new Matrix4();

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
      bone, name, boneTo,
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

    for (i = 0; i < bones.length; ++i) {
      bone = bones[i];
      name = options.names[bone.name] || bone.name;
      boneTo = this.getBoneByName(name, sourceBones);
      globalMatrix.copy(bone.matrixWorld);
      if (boneTo) {
        boneTo.updateMatrixWorld();
        if (options.useTargetMatrix) {
          relativeMatrix.copy(boneTo.matrixWorld);
        } else {
          relativeMatrix.copy( target.matrixWorld ).invert();
          relativeMatrix.multiply(boneTo.matrixWorld);
        }
        // ignore scale to extract rotation
        scale.setFromMatrixScale(relativeMatrix);
        relativeMatrix.scale(scale.set(1 / scale.x, 1 / scale.y, 1 / scale.z));
        // apply to global matrix
        globalMatrix.makeRotationFromQuaternion(quat.setFromRotationMatrix(relativeMatrix));
        if (target.isObject3D) {
          const boneIndex = bones.indexOf(bone),
            wBindMatrix = bindBones ? bindBones[ boneIndex ] : bindBoneMatrix.copy( target.skeleton.boneInverses[ boneIndex ] ).invert();
          globalMatrix.multiply(wBindMatrix);
        }
        globalMatrix.copyPosition(relativeMatrix);
      }

      bone.matrix.copy( bone.parent.matrixWorld ).invert();
      bone.matrix.multiply(globalMatrix);

      if (options.preserveHipPosition && name === options.hip) {
        bone.matrix.setPosition(pos.set(0, bone.position.y, 0));
      }
      bone.matrix.decompose(bone.position, bone.quaternion, bone.scale);
      bone.updateMatrixWorld();
    }
    if (options.preservePosition) {
      for (i = 0; i < bones.length; ++i) {
        bone = bones[i];
        name = options.names[bone.name] || bone.name;
        if (name && name !== options.hip) {
          bone.position.copy(bonesPosition[i]);
        } else {
          bone.position.copy(bonesPosition[i]);
        }
      }
    }

    if (options.preserveMatrix) {
      // restore matrix
      target.updateMatrixWorld(true);
    }
  };

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
