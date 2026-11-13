export const ROOM_RADIUS = 11.5;
// The top tread continues beyond the installation until radial fog hides it.
export const OUTER_TERRACE_RADIUS = 60;
export const TERRACE_START = 4.45;
export const TERRACE_COUNT = 16;
export const TERRACE_WIDTH = (ROOM_RADIUS - TERRACE_START) / TERRACE_COUNT;
export const TERRACE_RISE = 0.105;
export const PLINTH_RADIUS = 2.2;
export const PLINTH_TOP = 0.55;
function columnRing(count, ringRadius, radius) {
  return Array.from({ length: count }, (_, i) => {
    const angle = ((i + 0.5) * Math.PI * 2) / count;
    return {
      x: Math.sin(angle) * ringRadius,
      z: Math.cos(angle) * ringRadius,
      radius,
    };
  });
}
export const COLUMNS = columnRing(12, 7.7, 0.44);

export function floorHeight(radius) {
  if (radius < 3.55) return 0.2;
  if (radius < 3.8) return 0.12;
  if (radius < 4.05) return 0.06;
  if (radius < TERRACE_START) return 0;
  return (
    TERRACE_RISE *
    Math.min(
      TERRACE_COUNT,
      1 + Math.floor((radius - TERRACE_START) / TERRACE_WIDTH),
    )
  );
}
