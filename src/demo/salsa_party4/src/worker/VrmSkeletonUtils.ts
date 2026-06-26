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

    if (options.adjustScaling && !target.children[0].isAdjusted) {
      this.adjustScaling(target.children[0], sourceBones, options);
      target.children[0].isAdjusted = true;
    }
    this.retargetBone(options, sourceBones, target.children[0]);   // Hip
    if (!options.rotateModel) {
      this.retargetBone(options, sourceBones, target.children[0].children[0]);   // Spine
    }
    this.retargetBone(options, sourceBones, target.children[0].children[0].children[0]);   // Chest
    this.retargetBone(options, sourceBones, target.children[0].children[0].children[0].children[0]);   // Upper chest
    this.retargetBone(options, sourceBones, target.children[0].children[0].children[0].children[0].children[0]);   // Neck
    this.retargetBone(options, sourceBones, target.children[0].children[0].children[0].children[0].children[0].children[0]);   // Head
    this.retargetBone(options, sourceBones, target.children[0].children[0].children[0].children[0].children[2]);   // Left shoulder
    this.retargetBone(options, sourceBones, target.children[0].children[0].children[0].children[0].children[2].children[0]);   // Left shoulder
    this.retargetBone(options, sourceBones, target.children[0].children[0].children[0].children[0].children[2].children[0].children[0]);   // Left shoulder
    this.retargetBone(options, sourceBones, target.children[0].children[0].children[0].children[0].children[2].children[0].children[0].children[0]);   // Left hand
    this.retargetHand(options, sourceBones, target.children[0].children[0].children[0].children[0].children[2].children[0].children[0].children[0]);
    this.retargetBone(options, sourceBones, target.children[0].children[0].children[0].children[0].children[1]);   // Right shoulder
    this.retargetBone(options, sourceBones, target.children[0].children[0].children[0].children[0].children[1].children[0]);   // Right upper arm
    this.retargetBone(options, sourceBones, target.children[0].children[0].children[0].children[0].children[1].children[0].children[0]);   // Right lower arm
    this.retargetBone(options, sourceBones, target.children[0].children[0].children[0].children[0].children[1].children[0].children[0].children[0]);   // Right hand
    this.retargetHand(options, sourceBones, target.children[0].children[0].children[0].children[0].children[1].children[0].children[0].children[0]);
    this.retargetBone(options, sourceBones, target.children[0].children[2]);   // Right upper leg
    this.retargetBone(options, sourceBones, target.children[0].children[2].children[0]);   // Right leg
    this.retargetBone(options, sourceBones, target.children[0].children[2].children[0].children[0]);   // Right foot
    this.retargetBone(options, sourceBones, target.children[0].children[1]);   // Left upper leg
    this.retargetBone(options, sourceBones, target.children[0].children[1].children[0]);   // Left leg
    this.retargetBone(options, sourceBones, target.children[0].children[1].children[0].children[0]);   // Left foot
  };

  static retargetBone(options, sourceBones, target) {
    if (!target) return;
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

    const oldScale = bone.scale.clone();
    bone.matrix.decompose(bone.position, bone.quaternion, bone.scale);
    if (!options.adjustScaling) {
      bone.scale.set(1, 1, 1);
    } else {
      bone.scale.copy(oldScale);
    }
    if (options.rotateModel) {
      bone.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI));
    }
    bone.updateMatrixWorld();
  }

  static retargetHand(options, sourceBones, handBone) {
    if (!handBone) return;

    for (const child of handBone.children) {
      if (child.isBone || child.name.includes("Normalized") || (child.name && child.name.startsWith("Normalized"))) {
        const name = options.names[child.name] || child.name;
        const sourceBone = this.getBoneByName(name, sourceBones);
        if (sourceBone) {
          this.retargetBone(options, sourceBones, child);
        }
        this.retargetHand(options, sourceBones, child);
      }
    }
  }

  static adjustScaling(targetBone, sourceBones, options) {
    const name = options.names[targetBone.name] || targetBone.name;
    const sourceBone = this.getBoneByName(name, sourceBones);

    if (sourceBone && sourceBone.children.length > 0 && targetBone.children.length > 0) {
      // Find matching source child
      let sourceChild;
      const targetChild = targetBone.children[0];
      const targetChildName = options.names[targetChild.name] || targetChild.name;

      for (const sc of sourceBone.children) {
        const scName = options.names[sc.name] || sc.name;
        if (scName === targetChildName || sc.name === targetChildName) {
          sourceChild = sc;
          break;
        }
      }

      if (sourceChild) {
        const sourceLength = sourceChild.position.length();
        const targetLength = targetChild.position.length();

        if (targetLength > 0 && sourceLength > 0) {
          let scaleFactor = sourceLength / targetLength;
          // Clamp scale factor to reasonable limits
          scaleFactor = Math.max(0.1, Math.min(10, scaleFactor));
          targetBone.scale.set(scaleFactor, scaleFactor, scaleFactor);
        }
      }
    }

    for (const child of targetBone.children) {
      if (child.isBone || child.name.includes("Normalized") || (child.name && child.name.startsWith("Normalized"))) {
        this.adjustScaling(child, sourceBones, options);
      }
    }
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
