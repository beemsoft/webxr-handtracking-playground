import {
  COLUMNS,
  TERRACE_START,
  TERRACE_WIDTH,
  TERRACE_RISE,
} from "./architecture.js";
import { WATER_HEIGHT } from "./motion.js";
import {
  FISH_SCHOOLS,
  SCHOOL_SIZE,
  SCHOOL_FISH_COUNT,
  REEF_FISH_COUNT,
  FISH_COUNT,
} from "./fish-schools.js";

export { FISH_COUNT } from "./fish-schools.js";
export const FISH_STEP = 1 / 60;
const columns = COLUMNS;
const clamp = (x, low, high) => Math.max(low, Math.min(high, x));

// A continuous upper envelope of the steps. Steering starts above this ramp,
// so a change of terrace never teleports a fish or changes its heading.
export function fishFloor(x, z) {
  const r = Math.hypot(x, z);
  return Math.max(
    0.2,
    TERRACE_RISE * (1 + (r - TERRACE_START) / TERRACE_WIDTH),
  );
}

export function createFishSimulation() {
  let seed = 1073;
  const random = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const fish = Array.from({ length: FISH_COUNT }, (_, i) => ({
    school: Math.min(FISH_SCHOOLS.length, Math.floor(i / SCHOOL_SIZE)),
    phase:
      i < SCHOOL_FISH_COUNT
        ? (random() - 0.5) * 1.45
        : ((i - SCHOOL_FISH_COUNT) / REEF_FISH_COUNT) * Math.PI * 2,
    lane: (random() - 0.5) * 1.8,
    height: (random() - 0.5) * 1,
    seed: random() * Math.PI * 2,
    scale:
      i < SCHOOL_FISH_COUNT ? 0.5 + random() * 0.24 : 0.38 + random() * 0.2,
  }));
  const positions = new Float64Array(FISH_COUNT * 3),
    velocities = positions.slice();
  const previous = positions.slice(),
    previousVelocity = positions.slice();
  const rendered = positions.slice(),
    renderedVelocity = positions.slice();
  const forces = positions.slice(),
    cohesion = positions.slice(),
    alignment = positions.slice();
  const neighbours = new Uint16Array(FISH_COUNT);
  const neighbourOrder = Array.from({ length: FISH_COUNT }, (_, i) => i);
  const sortByX = (a, b) => positions[a * 3] - positions[b * 3] || a - b;
  const banks = new Float64Array(FISH_COUNT),
    previousBank = banks.slice(),
    renderedBank = banks.slice();
  const headings = positions.slice(),
    previousHeading = positions.slice(),
    renderedHeading = positions.slice();
  const goal = [0, 0, 0],
    ahead = [0, 0, 0];
  const phases = new Float64Array(FISH_COUNT),
    previousPhase = phases.slice();
  const swim = new Float32Array(FISH_COUNT * 4);
  let tick = 0;
  function guide(f, time, out) {
    const school = FISH_SCHOOLS[f.school];
    const a = time * (school?.speed ?? 0.073) + (school?.phase ?? 0) + f.phase;
    const r =
      (school ? 7.1 : 5.3) + f.lane + Math.sin(time * 0.23 + f.seed) * 0.18;
    out[0] = Math.sin(a) * r;
    out[2] = Math.cos(a) * r * (school ? 0.88 : 1);
    const bottom = fishFloor(out[0], out[2]) + 0.55;
    const depth =
      0.5 +
      0.5 * Math.sin(time * 0.11 + (school?.depthPhase ?? 0) + f.phase * 0.45);
    out[1] = school
      ? bottom + (WATER_HEIGHT - 0.65 - bottom) * depth + f.height
      : bottom + 0.2;
  }
  function reset() {
    tick = 0;
    for (let i = 0; i < FISH_COUNT; i++) {
      const o = i * 3;
      guide(fish[i], 0, goal);
      guide(fish[i], 0.05, ahead);
      for (let k = 0; k < 3; k++) {
        positions[o + k] = goal[k];
        velocities[o + k] = (ahead[k] - goal[k]) / 0.05;
      }
      // Establish heading before projecting the initial position off obstacles.
      const horizontal = Math.hypot(velocities[o], velocities[o + 2]);
      const vertical = clamp(
        velocities[o + 1],
        -horizontal * 0.65,
        horizontal * 0.65,
      );
      const length = Math.hypot(horizontal, vertical);
      headings[o] = velocities[o] / length;
      headings[o + 1] = vertical / length;
      headings[o + 2] = velocities[o + 2] / length;
      resolve(i);
      phases[i] = fish[i].seed;
    }
    // Relax the seeded cloud before the first frame, avoiding an initial burst
    // of overlapping fish. Subsequent separation uses forces, never pair snaps.
    for (let iteration = 0; iteration < 48; iteration++) {
      for (let i = 0; i < FISH_COUNT; i++)
        for (let j = i + 1; j < FISH_COUNT; j++) {
          const a = i * 3,
            b = j * 3,
            dx = positions[a] - positions[b],
            dy = positions[a + 1] - positions[b + 1],
            dz = positions[a + 2] - positions[b + 2],
            d = Math.hypot(dx, dy, dz);
          if (d > 0.001 && d < 0.25) {
            const push = ((0.25 - d) * 0.35) / d;
            positions[a] += dx * push;
            positions[a + 1] += dy * push;
            positions[a + 2] += dz * push;
            positions[b] -= dx * push;
            positions[b + 1] -= dy * push;
            positions[b + 2] -= dz * push;
          }
        }
      for (let i = 0; i < FISH_COUNT; i++) resolve(i);
    }
    previous.set(positions);
    previousVelocity.set(velocities);
    banks.fill(0);
    previousBank.fill(0);
    previousPhase.set(phases);
    previousHeading.set(headings);
  }
  // Last-resort nonpenetration. Normal movement is handled by predictive forces.
  function resolve(i) {
    const o = i * 3;
    for (const c of columns) {
      const dx = positions[o] - c.x,
        dz = positions[o + 2] - c.z,
        d = Math.hypot(dx, dz),
        r = c.radius * 1.3 + 0.23;
      if (d < r) {
        const nx = d > 1e-8 ? dx / d : 1,
          nz = d > 1e-8 ? dz / d : 0;
        positions[o] = c.x + nx * r;
        positions[o + 2] = c.z + nz * r;
        const inward = Math.min(0, velocities[o] * nx + velocities[o + 2] * nz);
        velocities[o] -= inward * nx;
        velocities[o + 2] -= inward * nz;
      }
    }
    // The school's corridor leaves room for the glass globe at every float height.
    const radius = Math.hypot(positions[o], positions[o + 2]);
    if (radius < 3.05 || radius > 8.55) {
      const r = clamp(radius, 3.05, 8.55);
      positions[o] *= r / radius;
      positions[o + 2] *= r / radius;
    }
    const bottom = fishFloor(positions[o], positions[o + 2]) + 0.32,
      top = WATER_HEIGHT - 0.32;
    if (positions[o + 1] < bottom) {
      positions[o + 1] = bottom;
      velocities[o + 1] = Math.max(0, velocities[o + 1]);
    }
    if (positions[o + 1] > top) {
      positions[o + 1] = top;
      velocities[o + 1] = Math.min(0, velocities[o + 1]);
    }
  }
  function step() {
    previous.set(positions);
    previousVelocity.set(velocities);
    previousBank.set(banks);
    previousPhase.set(phases);
    previousHeading.set(headings);
    forces.fill(0);
    cohesion.fill(0);
    alignment.fill(0);
    neighbours.fill(0);
    // Sweep along X to reject distant pairs before evaluating the unchanged
    // spherical neighbourhood. Every fish still reads the same old state.
    neighbourOrder.sort(sortByX);
    for (let left = 0; left < FISH_COUNT; left++) {
      const first = neighbourOrder[left];
      for (let right = left + 1; right < FISH_COUNT; right++) {
        const second = neighbourOrder[right];
        if (positions[second * 3] - positions[first * 3] > 1.2) break;
        // Keep tie-breaking in passing traffic independent of spatial order.
        const i = Math.min(first, second),
          j = Math.max(first, second);
        const a = i * 3,
          b = j * 3,
          dx = positions[a] - positions[b],
          dy = positions[a + 1] - positions[b + 1],
          dz = positions[a + 2] - positions[b + 2],
          d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > 1.44) continue;
        const distance = Math.sqrt(d2),
          personal = 0.32;
        if (distance < personal) {
          const strength =
            ((1 - distance / personal) * 3.5) / Math.max(distance, 0.001);
          forces[a] += dx * strength;
          forces[a + 1] += dy * strength;
          forces[a + 2] += dz * strength;
          forces[b] -= dx * strength;
          forces[b + 1] -= dy * strength;
          forces[b + 2] -= dz * strength;
        }
        // Anticipate passing traffic, including other schools. Separation
        // alone reacts too late when two fish approach head-on at full speed.
        const vx = velocities[a] - velocities[b],
          vy = velocities[a + 1] - velocities[b + 1],
          vz = velocities[a + 2] - velocities[b + 2];
        const relativeSpeed = vx * vx + vy * vy + vz * vz;
        const closing = -(dx * vx + dy * vy + dz * vz);
        if (closing > 0 && relativeSpeed > 0.01) {
          const closest = clamp(closing / relativeSpeed, 0, 1);
          let px = dx + vx * closest,
            py = dy + vy * closest,
            pz = dz + vz * closest;
          let predicted = Math.hypot(px, py, pz);
          if (predicted < 0.36) {
            const urgency = (1 - predicted / 0.36) * (1 - closest * 0.5) * 3;
            if (predicted < 0.01) {
              px = -vz;
              py = 0.2;
              pz = vx;
              predicted = Math.hypot(px, py, pz);
            }
            const strength = urgency / Math.max(predicted, 0.001);
            forces[a] += px * strength;
            forces[a + 1] += py * strength;
            forces[a + 2] += pz * strength;
            forces[b] -= px * strength;
            forces[b + 1] -= py * strength;
            forces[b + 2] -= pz * strength;
          }
        }
        if (fish[i].school !== fish[j].school) continue;
        neighbours[i]++;
        neighbours[j]++;
        for (let k = 0; k < 3; k++) {
          cohesion[a + k] += positions[b + k];
          cohesion[b + k] += positions[a + k];
          alignment[a + k] += velocities[b + k];
          alignment[b + k] += velocities[a + k];
        }
      }
    }
    const time = tick * FISH_STEP;
    for (let i = 0; i < FISH_COUNT; i++) {
      const o = i * 3,
        f = fish[i];
      guide(f, time, goal);
      guide(f, time + 0.05, ahead);
      for (let k = 0; k < 3; k++) {
        const desired =
          (ahead[k] - goal[k]) / 0.05 +
          clamp((goal[k] - positions[o + k]) * 0.65, -0.65, 0.65);
        forces[o + k] += (desired - velocities[o + k]) * 1.5;
        if (neighbours[i])
          forces[o + k] +=
            (alignment[o + k] / neighbours[i] - velocities[o + k]) * 0.7 +
            (cohesion[o + k] / neighbours[i] - positions[o + k]) * 0.12;
      }
      forces[o] += Math.sin(time * 0.7 + f.seed) * 0.045;
      forces[o + 1] += Math.sin(time * 0.53 + f.seed) * 0.025;
      forces[o + 2] += Math.cos(time * 0.6 + f.seed) * 0.045;
      // Look ahead into columns; repulsion bends the guide velocity around
      // obstacles before a fish reaches the nonpenetration boundary.
      for (const c of columns) {
        const dx = positions[o] - c.x,
          dz = positions[o + 2] - c.z,
          d = Math.hypot(dx, dz);
        const px = dx + velocities[o] * 1.0,
          pz = dz + velocities[o + 2] * 1.0,
          pd = Math.hypot(px, pz),
          safe = c.radius * 1.3 + 0.55;
        if (d < safe + 0.6 || pd < safe) {
          const nx = dx / Math.max(d, 0.001),
            nz = dz / Math.max(d, 0.001);
          const urgency = Math.max(
            0,
            (safe + 0.6 - d) / 0.6,
            (safe - pd) / safe,
          );
          forces[o] += nx * urgency * 1.7;
          forces[o + 2] += nz * urgency * 1.7;
        }
      }
      const r = Math.hypot(positions[o], positions[o + 2]);
      const radial = Math.max(0, 3.8 - r) * 1.8 - Math.max(0, r - 7.9) * 1.8;
      forces[o] += (positions[o] / r) * radial;
      forces[o + 2] += (positions[o + 2] / r) * radial;
      const floor = fishFloor(
        positions[o] + velocities[o] * 0.8,
        positions[o + 2] + velocities[o + 2] * 0.8,
      );
      forces[o + 1] +=
        Math.max(0, floor + 0.65 - positions[o + 1]) * 3 -
        Math.max(0, positions[o + 1] - (WATER_HEIGHT - 0.55)) * 3;
      const force = Math.hypot(forces[o], forces[o + 1], forces[o + 2]),
        limit = Math.min(1, 1.2 / Math.max(force, 0.001));
      for (let k = 0; k < 3; k++)
        velocities[o + k] += forces[o + k] * limit * FISH_STEP;
      const speed = Math.hypot(
          velocities[o],
          velocities[o + 1],
          velocities[o + 2],
        ),
        scale = Math.min(1, 0.85 / Math.max(speed, 0.001));
      for (let k = 0; k < 3; k++) {
        velocities[o + k] *= scale;
        positions[o + k] += velocities[o + k] * FISH_STEP;
      }
      resolve(i);
      phases[i] += FISH_STEP * (6 + speed * 9);
      if (speed > 0.025) {
        const horizontal = Math.hypot(velocities[o], velocities[o + 2]);
        const desiredYaw = Math.atan2(velocities[o + 2], velocities[o]);
        const oldYaw = Math.atan2(headings[o + 2], headings[o]);
        const yawDelta = Math.atan2(
          Math.sin(desiredYaw - oldYaw),
          Math.cos(desiredYaw - oldYaw),
        );
        const newYaw =
          oldYaw + clamp(yawDelta, -1.8 * FISH_STEP, 1.8 * FISH_STEP);
        const oldPitch = Math.asin(clamp(headings[o + 1], -1, 1));
        const desiredPitch = clamp(
          Math.atan2(velocities[o + 1], horizontal),
          -0.57,
          0.57,
        );
        const pitch =
          oldPitch +
          clamp(desiredPitch - oldPitch, -0.8 * FISH_STEP, 0.8 * FISH_STEP);
        headings[o] = Math.cos(newYaw) * Math.cos(pitch);
        headings[o + 1] = Math.sin(pitch);
        headings[o + 2] = Math.sin(newYaw) * Math.cos(pitch);
      }
      const yaw =
        (previousVelocity[o + 2] * velocities[o] -
          previousVelocity[o] * velocities[o + 2]) /
        Math.max(0.04, velocities[o] ** 2 + velocities[o + 2] ** 2) /
        FISH_STEP;
      banks[i] +=
        (clamp(yaw * 0.3, -0.28, 0.28) - banks[i]) *
        (1 - Math.exp(-FISH_STEP * 4));
    }
    tick++;
  }
  function update(time) {
    if (!Number.isFinite(time) || time < 0)
      throw new RangeError("Fish time must be finite and nonnegative.");
    const target = Math.floor(time / FISH_STEP) + 1;
    if (target < tick) reset();
    while (tick < target) step();
    const alpha = clamp(time / FISH_STEP - (tick - 1), 0, 1);
    for (let i = 0; i < positions.length; i++) {
      rendered[i] = previous[i] + (positions[i] - previous[i]) * alpha;
      renderedVelocity[i] =
        previousVelocity[i] + (velocities[i] - previousVelocity[i]) * alpha;
      renderedHeading[i] =
        previousHeading[i] + (headings[i] - previousHeading[i]) * alpha;
    }
    for (let i = 0; i < FISH_COUNT; i++) {
      renderedBank[i] = previousBank[i] + (banks[i] - previousBank[i]) * alpha;
      swim[i * 4] = previousPhase[i] + (phases[i] - previousPhase[i]) * alpha;
      swim[i * 4 + 1] =
        0.65 +
        Math.min(
          1,
          Math.hypot(
            renderedVelocity[i * 3],
            renderedVelocity[i * 3 + 1],
            renderedVelocity[i * 3 + 2],
          ) / 0.6,
        ) *
          0.45;
    }
  }
  reset();
  update(0);
  return {
    fish,
    positions: rendered,
    velocities: renderedVelocity,
    banks: renderedBank,
    headings: renderedHeading,
    swim,
    update,
    reset,
  };
}
