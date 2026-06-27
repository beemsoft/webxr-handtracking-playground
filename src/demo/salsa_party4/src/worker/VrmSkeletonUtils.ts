import { Euler, Matrix4, Quaternion, Vector3 } from 'three';

export default class VrmSkeletonUtils {

  static retarget(vrm, source, options) {

    options = options || {};
    options.preserveMatrix = options.preserveMatrix !== undefined ? options.preserveMatrix : true;
    options.preservePosition = options.preservePosition !== undefined ? options.preservePosition : true;
    options.preserveHipPosition = options.preserveHipPosition !== undefined ? options.preserveHipPosition : false;
    options.useTargetMatrix = options.useTargetMatrix !== undefined ? options.useTargetMatrix : false;
    options.hip = options.hip !== undefined ? options.hip : "hip";
    options.names = options.names || {};

    const target = vrm.scene.children[5] || vrm.scene;

    let sourceBones = source.isObject3D ? source.skeleton.bones : this.getBones(source),
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

    const humanoid = vrm.humanoid;
    const hips = humanoid.getNormalizedBoneNode('hips');

    if (options.adjustScaling && hips && !hips.isAdjusted) {
      this.adjustScaling(hips, sourceBones, options);
      hips.isAdjusted = true;
    }

    // Body
    this.retargetBone(options, sourceBones, hips);
    
    const spine = humanoid.getNormalizedBoneNode('spine');
    if (!options.rotateModel) {
      this.retargetBone(options, sourceBones, spine);
    }
    this.retargetBone(options, sourceBones, humanoid.getNormalizedBoneNode('chest'));
    this.retargetBone(options, sourceBones, humanoid.getNormalizedBoneNode('upperChest'));
    this.retargetBone(options, sourceBones, humanoid.getNormalizedBoneNode('neck'));
    this.retargetBone(options, sourceBones, humanoid.getNormalizedBoneNode('head'));

    // Left Arm
    this.retargetBone(options, sourceBones, humanoid.getNormalizedBoneNode('leftShoulder'));
    this.retargetBone(options, sourceBones, humanoid.getNormalizedBoneNode('leftUpperArm'));
    this.retargetBone(options, sourceBones, humanoid.getNormalizedBoneNode('leftLowerArm'));
    const leftHand = humanoid.getNormalizedBoneNode('leftHand');
    this.retargetBone(options, sourceBones, leftHand);

    // Right Arm
    this.retargetBone(options, sourceBones, humanoid.getNormalizedBoneNode('rightShoulder'));
    this.retargetBone(options, sourceBones, humanoid.getNormalizedBoneNode('rightUpperArm'));
    this.retargetBone(options, sourceBones, humanoid.getNormalizedBoneNode('rightLowerArm'));
    const rightHand = humanoid.getNormalizedBoneNode('rightHand');
    this.retargetBone(options, sourceBones, rightHand);

    if (!options.proceduralFingers) {
      this.retargetHand(options, sourceBones, leftHand);
      this.retargetHand(options, sourceBones, rightHand);
    }
    this.animateFingers(options, vrm);

    // Legs
    this.retargetBone(options, sourceBones, humanoid.getNormalizedBoneNode('rightUpperLeg'));
    this.retargetBone(options, sourceBones, humanoid.getNormalizedBoneNode('rightLowerLeg'));
    this.retargetBone(options, sourceBones, humanoid.getNormalizedBoneNode('rightFoot'));
    this.retargetBone(options, sourceBones, humanoid.getNormalizedBoneNode('leftUpperLeg'));
    this.retargetBone(options, sourceBones, humanoid.getNormalizedBoneNode('leftLowerLeg'));
    this.retargetBone(options, sourceBones, humanoid.getNormalizedBoneNode('leftFoot'));
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
          // If it's a finger bone, we might want to ignore the BVH data if it's known to be noisy
          // But for now, let's keep retargeting and then overlay our procedural animation
          this.retargetBone(options, sourceBones, child);
        }
        this.retargetHand(options, sourceBones, child);
      }
    }
  }

  static animateFingers(options, vrm) {
    if (options.proceduralFingers === false) return;
    const time = Date.now() * 0.001;

    const leftHand = vrm.humanoid.getNormalizedBoneNode('leftHand');
    const rightHand = vrm.humanoid.getNormalizedBoneNode('rightHand');
    const leftForearm = vrm.humanoid.getNormalizedBoneNode('leftLowerArm');
    const rightForearm = vrm.humanoid.getNormalizedBoneNode('rightLowerArm');

    if (leftHand) this.applyProceduralHandAnimation(leftHand, leftForearm, time, true, options);
    if (rightHand) this.applyProceduralHandAnimation(rightHand, rightForearm, time, false, options);
  }

  static applyProceduralHandAnimation(handBone, forearmBone, time, isLeft, options) {
    if (!handBone) return;

    // Calculate forearm-hand curve
    let extensionFactor = 0.5;
    if (forearmBone) {
      // Alignment of forearm and hand
      const forearmDir = new Vector3(0, 0, 1).applyQuaternion(forearmBone.quaternion).normalize();
      const handDir = new Vector3(0, 0, 1).applyQuaternion(handBone.quaternion).normalize();
      const dot = forearmDir.dot(handDir);

      // Map dot product to extensionFactor. 1.0 (aligned) -> 1.0, -1.0 (fully bent) -> 0.0
      extensionFactor = Math.max(0, (dot + 1) / 2);
    }

    const fingerNames = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
    const jointNames = ['Proximal', 'Intermediate', 'Distal'];

    // Artistic "Dance Hand" offsets
    const fingerBaseCurls = {
      'Thumb': 0.4,
      'Index': 0.15,
      'Middle': 0.35,
      'Ring': 0.3,
      'Little': 0.55
    };

    const fingerSplayOffsets = {
      'Thumb': isLeft ? 0.25 : -0.25,
      'Index': isLeft ? 0.2 : -0.2,
      'Middle': isLeft ? 0.05 : -0.05,
      'Ring': isLeft ? 0.2 : -0.2,
      'Little': isLeft ? 0.4 : -0.4
    };

    fingerNames.forEach((finger, fIdx) => {
      const isThumb = finger === 'Thumb';
      const isPinky = finger === 'Little';
      const side = isLeft ? 'Left' : 'Right';
      const baseCurl = fingerBaseCurls[finger];
      const splayBase = fingerSplayOffsets[finger];
      const timeOffset = fIdx * 0.15;

      jointNames.forEach((jName, jIdx) => {
        let boneName = `${side}${finger}${jName}`;
        let isMetacarpal = false;

        if (isThumb) {
           if (jIdx === 0) {
             boneName = `${side}ThumbMetacarpal`;
             isMetacarpal = true;
           } else if (jIdx === 1) {
             boneName = `${side}ThumbProximal`;
           } else if (jIdx === 2) {
             boneName = `${side}ThumbDistal`;
           }
        }

        // @ts-ignore
        const vrm = handBone.userData.vrm || handBone.parent.userData.vrm || (handBone.root && handBone.root.userData.vrm) || (handBone.scene && handBone.scene.userData.vrm);
        const vrmBoneName = boneName.charAt(0).toLowerCase() + boneName.slice(1);
        const bone = vrm ? vrm.humanoid.getNormalizedBoneNode(vrmBoneName) : null;

        if (bone) {
           this.applyFingerCurl(bone, baseCurl, splayBase, time, timeOffset + jIdx * 0.05, extensionFactor, isThumb, jIdx, isLeft, isMetacarpal, isPinky);
        } else {
           // console.warn(`Bone not found: ${boneName} (vrmBoneName: ${vrmBoneName})`);
        }
      });
    });
  }

  static applyFingerCurl(bone, baseCurl, splayBase, time, offset, extensionFactor, isThumb, jointIdx, isLeft, isMetacarpal = false, isPinky = false) {
    if (!bone) return;

    // Movement is more of a "breathing" or "swaying" motion
    const pulse = Math.sin(time * 0.8 + offset) * 0.04 + Math.sin(time * 1.5 + offset * 0.5) * 0.02;

    // In dance, the distal joints are often more relaxed/straight than the proximal ones
    // to create an elegant trailing effect.
    // However, if fingers look "stretched", we should ensure enough curl is applied.
    const jointFactor = Math.pow(0.85, jointIdx);

    let curlStrength = isThumb ? 0.6 : 1.0;
    let naturalCurve = 0.35; // Slightly reduced to avoid "tight" inward curl

    // The base of the thumb (Metacarpal) should be more aligned with the index base.
    // We adjust the splay and curl specifically for the metacarpal to bring it inside the palm.
    let splayAdjustment = 0;
    let thumbTilt = 0; // Subtle Z-axis rotation for opposition
    if (isThumb && isMetacarpal) {
      naturalCurve = 0.9; // Adjusted base curve for a more natural tucked position
      curlStrength = 0.3; // More movement at the base for organic feel
      splayAdjustment = (isLeft ? -0.5 : 0.5); // Aligned towards palm/index
      thumbTilt = (isLeft ? 0.2 : -0.2); // Tilt thumb base to face fingers
    } else if (isThumb) {
      // Thumb proximal and distal should also curve naturally
      naturalCurve = 0.6;
      splayAdjustment = (isLeft ? -0.25 : 0.25);
      thumbTilt = (isLeft ? 0.1 : -0.1);
    }

    // extensionFactor 1.0 (arm straight) -> less curl. 0.0 (arm bent) -> more curl (relaxed).
    const relaxation = (1.2 - extensionFactor) * 1.5;

    // In standard VRM (glTF) bone orientation, the Z-axis points towards the child bone,
    // and the X-axis is usually the curling axis.
    // The user says "direction seems opposite", so we negate totalCurl to ensure inward bending.
    let totalCurl = -(naturalCurve + baseCurl * relaxation + pulse * curlStrength) * jointFactor;

    // Splaying also pulses slightly
    let splayPulse = Math.cos(time * 1.0 + offset) * 0.02;
    let splayValue = splayPulse + splayAdjustment;

    // Splay (abduction/adduction) should primarily happen at the base joint (Proximal/Metacarpal)
    if (jointIdx === 0 || isMetacarpal) {
      splayValue += splayBase;
    }

    // If it's the pinky (Little finger), we want it straight
    if (isPinky) {
      // For the pinky, we only keep the base splay and force curl to 0
      const pinkySplay = (jointIdx === 0 || isMetacarpal) ? splayBase + splayAdjustment : 0;
      bone.quaternion.setFromEuler(new Euler(0, pinkySplay, 0, 'YXZ'));
      bone.updateMatrixWorld();

      // Also ensure children are straight if they aren't explicitly handled
      if (bone.children) {
          bone.children.forEach(child => {
              if (child.quaternion) {
                  child.quaternion.set(0, 0, 0, 1);
              }
          });
      }
      return;
    }

    // We use a very soft slerp to maintain fluid, organic movement
    const targetQuat = new Quaternion().setFromEuler(new Euler(totalCurl, splayValue, thumbTilt, 'YXZ'));
    bone.quaternion.slerp(targetQuat, 0.12);

    bone.updateMatrixWorld();
  }

  static adjustScaling(targetBone, sourceBones, options, accumulatedScale = 1) {
    const name = options.names[targetBone.name] || targetBone.name;
    const sourceBone = this.getBoneByName(name, sourceBones);

    let currentWorldScale = accumulatedScale;

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
          let desiredWorldScale = sourceLength / targetLength;
          // Clamp desired world scale to reasonable limits
          desiredWorldScale = Math.max(0.1, Math.min(10, desiredWorldScale));

          // Local scale must compensate for inherited scale
          const localScaleFactor = desiredWorldScale / accumulatedScale;
          targetBone.scale.set(localScaleFactor, localScaleFactor, localScaleFactor);

          // The world scale for children of this bone is now desiredWorldScale
          currentWorldScale = desiredWorldScale;
        }
      }
    }

    for (const child of targetBone.children) {
      if (child.isBone || child.name.includes("Normalized") || (child.name && child.name.startsWith("Normalized"))) {
        this.adjustScaling(child, sourceBones, options, currentWorldScale);
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
