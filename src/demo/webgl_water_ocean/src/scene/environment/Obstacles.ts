import { seabedHeight } from './Seabed';

export interface SeabedObstacle {
  type: 'rock' | 'kelp';
  x: number;
  y: number;
  z: number;
  radius: number;
  height: number;
  minY: number;
  maxY: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  rotX: number;
  rotY: number;
  rotZ: number;
}

export interface AvoidanceResult {
  steerX: number;
  steerZ: number;
  pushX: number;
  pushZ: number;
  liftY: number;
  isObstructed: boolean;
  minDist: number;
}

export function generateSeabedObstacles(): {
  rocks: SeabedObstacle[];
  kelp: SeabedObstacle[];
  all: SeabedObstacle[];
  nextRandomState: number;
} {
  let randomState = 0x7f4a7c15;
  function seededRandom() {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  }

  const rocks: SeabedObstacle[] = [];
  const rockCount = 30;
  for (let i = 0; i < rockCount; i++) {
    const angle = seededRandom() * Math.PI * 2;
    const distance = 4.0 + seededRandom() * 22.0;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    const y = seabedHeight(x, z) + 0.3;
    const scale = 0.5 + seededRandom() * 1.1;
    const rotX = seededRandom() * Math.PI;
    const rotY = seededRandom() * Math.PI;
    const rotZ = seededRandom() * Math.PI;
    const scaleY = scale * (0.7 + seededRandom() * 0.5);

    // Rock geometry is Dodecahedron(0.75)
    const radius = 0.75 * scale;
    const height = radius * 2 * (scaleY / scale);
    const minY = y - radius;
    const maxY = y + radius * (scaleY / scale);

    rocks.push({
      type: 'rock',
      x,
      y,
      z,
      radius,
      height,
      minY,
      maxY,
      scaleX: scale,
      scaleY,
      scaleZ: scale,
      rotX,
      rotY,
      rotZ,
    });
  }

  const kelp: SeabedObstacle[] = [];
  const kelpCount = 45;
  for (let i = 0; i < kelpCount; i++) {
    const angle = seededRandom() * Math.PI * 2;
    const distance = 3.5 + seededRandom() * 20.0;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    const y = seabedHeight(x, z);
    const heightScale = 0.8 + seededRandom() * 1.2;
    const rotX = seededRandom() * 0.2;
    const rotY = seededRandom() * Math.PI * 2;
    const rotZ = seededRandom() * 0.2;
    const radScale = 0.6 + seededRandom() * 0.4;

    // Kelp geometry is ConeGeometry(0.25, 2.2) translated up by 1.1
    const radius = 0.38 * radScale;
    const height = 2.2 * heightScale;
    const minY = y;
    const maxY = y + height;

    kelp.push({
      type: 'kelp',
      x,
      y,
      z,
      radius,
      height,
      minY,
      maxY,
      scaleX: radScale,
      scaleY: heightScale,
      scaleZ: radScale,
      rotX,
      rotY,
      rotZ,
    });
  }

  return {
    rocks,
    kelp,
    all: [...rocks, ...kelp],
    nextRandomState: randomState,
  };
}

const obstaclesData = generateSeabedObstacles();
export const SEABED_OBSTACLES = obstaclesData.all;
export const SEABED_ROCKS = obstaclesData.rocks;
export const SEABED_KELP = obstaclesData.kelp;

/**
 * Computes the elevation profile of rocks at a given (x, z) location.
 * Used for terrain-following creatures (like sting rays) to smoothly glide over rocks.
 */
export function getRockElevation(x: number, z: number, padding = 0.2): number {
  let maxElevation = 0;
  for (let i = 0; i < obstaclesData.rocks.length; i++) {
    const rock = obstaclesData.rocks[i];
    const dx = rock.x - x;
    const dz = rock.z - z;
    const distSq = dx * dx + dz * dz;
    const effRadius = rock.radius + padding;
    if (distSq < effRadius * effRadius) {
      const dist = Math.sqrt(distSq);
      // Hemispherical / smooth bell curve over the rock dome
      const normDist = dist / effRadius;
      const profile = Math.cos(normDist * (Math.PI * 0.5));
      const rockTop = rock.maxY;
      const baseFloor = seabedHeight(x, z);
      const elevation = (rockTop - baseFloor) * Math.max(0, profile);
      if (elevation > maxElevation) {
        maxElevation = elevation;
      }
    }
  }
  return maxElevation;
}

export function computeObstacleAvoidance(
  posX: number,
  posY: number,
  posZ: number,
  headingX: number,
  headingZ: number,
  agentRadius: number,
  lookaheadDist: number,
  safetyMargin = 0.35,
  verticalPadding = 0.25,
  obstacleTypeFilter?: 'all' | 'rock' | 'kelp'
): AvoidanceResult {
  let steerX = 0;
  let steerZ = 0;
  let pushX = 0;
  let pushZ = 0;
  let liftY = 0;
  let isObstructed = false;
  let minDist = 999.0;

  const headingLen = Math.hypot(headingX, headingZ);
  const normHx = headingLen > 0.0001 ? headingX / headingLen : 0;
  const normHz = headingLen > 0.0001 ? headingZ / headingLen : 1;

  for (let i = 0; i < SEABED_OBSTACLES.length; i++) {
    const obs = SEABED_OBSTACLES[i];
    if (obstacleTypeFilter && obstacleTypeFilter !== 'all' && obs.type !== obstacleTypeFilter) {
      continue;
    }

    // Check vertical overlap between agent and obstacle
    const obsBottom = obs.minY - verticalPadding;
    const obsTop = obs.maxY + verticalPadding;
    if (posY + agentRadius < obsBottom || posY - agentRadius > obsTop) {
      continue;
    }

    const dx = obs.x - posX;
    const dz = obs.z - posZ;
    const distSq = dx * dx + dz * dz;
    const dist = Math.sqrt(distSq);

    const safeRadius = obs.radius + agentRadius + safetyMargin;

    if (dist < minDist) {
      minDist = dist;
    }

    // 1. Immediate Proximity Pushout (Prevent entering obstacle bounds)
    if (dist < safeRadius) {
      isObstructed = true;
      const penetration = safeRadius - dist;
      const pushFactor = Math.min(1.0, penetration / Math.max(0.01, safeRadius));
      if (dist > 0.001) {
        // Push away from obstacle center
        pushX -= (dx / dist) * pushFactor;
        pushZ -= (dz / dist) * pushFactor;
      } else {
        // Center overlap fallback
        pushX -= normHz * pushFactor;
        pushZ += normHx * pushFactor;
      }

      // If it's a rock, provide a gentle upward lift if agent is near top
      if (obs.type === 'rock' && posY >= obs.y) {
        liftY += pushFactor * 0.4;
      }
    }

    // 2. Forward Lookahead Whisker Steering (Smooth advance steering around obstacle)
    const t = dx * normHx + dz * normHz;

    // Obstacle is ahead of agent within lookahead distance
    if (t > 0 && t < lookaheadDist) {
      // Closest point on heading ray to obstacle center
      const projX = posX + normHx * t;
      const projZ = posZ + normHz * t;

      // Perpendicular vector from ray to obstacle
      const perpX = obs.x - projX;
      const perpZ = obs.z - projZ;
      const perpDist = Math.hypot(perpX, perpZ);

      // Check if heading ray passes inside obstacle safety perimeter
      if (perpDist < safeRadius) {
        isObstructed = true;
        const forwardWeight = 1.0 - (t / lookaheadDist);
        const lateralWeight = 1.0 - (perpDist / safeRadius);
        const steerStrength = forwardWeight * lateralWeight;

        if (perpDist > 0.001) {
          // Steer perpendicularly away from obstacle center
          steerX -= (perpX / perpDist) * steerStrength;
          steerZ -= (perpZ / perpDist) * steerStrength;
        } else {
          // Head-on: steer laterally
          steerX -= normHz * steerStrength;
          steerZ += normHx * steerStrength;
        }
      }
    }
  }

  return {
    steerX,
    steerZ,
    pushX,
    pushZ,
    liftY,
    isObstructed,
    minDist,
  };
}
