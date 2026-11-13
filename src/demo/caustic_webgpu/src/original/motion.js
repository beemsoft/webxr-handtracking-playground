export const WATER_HEIGHT = 5.2;
export const ORB_RADIUS = 1.85;
export const FLOAT_PERIOD = 20;
// Dip to 8 cm above the plinth while retaining the same surface-contact peak.
export const REST_HEIGHT = 2.48;
export const FLOAT_RANGE = 1.07;

export function orbHeight(time) {
  return (
    REST_HEIGHT +
    FLOAT_RANGE * (0.5 - 0.5 * Math.cos((time * Math.PI * 2) / FLOAT_PERIOD))
  );
}

const CONTACT_PHASE = Math.acos(
  1 - (2 * (WATER_HEIGHT - ORB_RADIUS - REST_HEIGHT)) / FLOAT_RANGE,
);
export const FIRST_CONTACT = (CONTACT_PHASE / (Math.PI * 2)) * FLOAT_PERIOD;

// Return the last upward crossing, even when a manual time step skips a cycle.
export function surfaceContactBetween(before, after) {
  const epsilon = 1e-9;
  if (after <= before || after + epsilon < FIRST_CONTACT) return null;
  const cycle = Math.floor((after + epsilon - FIRST_CONTACT) / FLOAT_PERIOD);
  const contact = cycle * FLOAT_PERIOD + FIRST_CONTACT;
  return contact > before + epsilon ? contact : null;
}
