export const SCHOOL_SIZE = 288;
export const REEF_FISH_COUNT = 12;

// Each school keeps its own color, orbit and diving phase while sharing
// separation and obstacle avoidance with every other fish.
export const FISH_SCHOOLS = [
  {
    name: "Amber",
    hue: 0.025,
    hueRange: 0.065,
    accent: "#e85c25",
    // Enter the opening view from the right, with the sphere clear at startup.
    phase: 1.05,
    speed: -0.055,
    depthPhase: 1.1,
  },
  {
    name: "Azure",
    hue: 0.55,
    hueRange: 0.045,
    accent: "#305ce5",
    belly: "#f37fb7",
    phase: 2.24,
    speed: 0.064,
    depthPhase: 1.7,
  },
  {
    name: "Green",
    hue: 0.3,
    hueRange: 0.055,
    accent: "#1b9139",
    belly: "#438de8",
    phase: -2.24,
    speed: -0.073,
    depthPhase: 4.1,
  },
  {
    name: "Yellow",
    hue: 0.145,
    hueRange: 0.025,
    accent: "#d7b51c",
    belly: "#ed791e",
    phase: 0.9,
    speed: 0.082,
    depthPhase: 5.2,
  },
];

export const SCHOOL_FISH_COUNT = SCHOOL_SIZE * FISH_SCHOOLS.length;
export const FISH_COUNT = SCHOOL_FISH_COUNT + REEF_FISH_COUNT;
