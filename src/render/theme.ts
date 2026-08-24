/**
 * Art direction.
 *
 * Hard rule, from the brief: this must look like a toy, not like a dashboard.
 * That means NO indigo/violet gradients, NO dark slate background, NO neon
 * glow, NO glassmorphism — the whole default "AI app" palette is off limits.
 *
 * What we want instead is Block Blast: a bright background, fat rounded
 * shapes, and saturated candy colours with a light top edge and a darker
 * bottom edge so every block reads as a little 3D sweet.
 */

export interface BlockColour {
  readonly base: string;
  readonly light: string;
  readonly dark: string;
}

export interface Theme {
  readonly id: string;
  readonly label: string;
  /** Page background, painted as a vertical gradient. */
  readonly backdrop: readonly [string, string];
  /** The disc the puzzle sits on. */
  readonly plate: string;
  readonly plateEdge: string;
  /** An unfilled cell. */
  readonly empty: string;
  readonly emptyEdge: string;
  /** Outline drawn around every filled block. */
  readonly blockOutline: string;
  readonly text: string;
  readonly textSoft: string;
  /** Pieces with nowhere to go. Fading alone vanishes on the light themes. */
  readonly muted: BlockColour;
  /** Index 0 is unused — colour ids start at 1 to keep 0 meaning "empty". */
  readonly blocks: readonly BlockColour[];
  /** What the core fills with. Warm, so a full hub reads as heat. */
  readonly charge: BlockColour;
  /** The ramp's blockage. Deliberately outside the candy palette. */
  readonly stone: BlockColour;
}

function candy(base: string, light: string, dark: string): BlockColour {
  return { base, light, dark };
}

/**
 * Eight blocks, spaced around the wheel and also separated by lightness, so
 * they stay distinguishable for colour-blind players rather than relying on
 * hue alone.
 */
const CANDY_BLOCKS: readonly BlockColour[] = [
  candy("#FF2D42", "#FF7080", "#D40A22"), // 1 strawberry
  candy("#FF7A00", "#FFA63D", "#D65A00"), // 2 orange
  candy("#FFC400", "#FFDC4D", "#DB9E00"), // 3 lemon
  candy("#4FD31A", "#87E95C", "#35A408"), // 4 apple
  candy("#00CFC9", "#47E5E0", "#00A39E"), // 5 mint
  candy("#0A7CFF", "#55A8FF", "#005FD6"), // 6 blueberry
  candy("#A03CF0", "#C47EF7", "#7A1FC4"), // 7 grape
  candy("#FF3D93", "#FF7DB5", "#DB1C71"), // 8 bubblegum
];

/**
 * Stone sits outside the candy palette on purpose: it is the one thing on the
 * disc that is not a sweet to be cleared but an obstacle in the way, and it has
 * to be legible as that at a glance, on every theme, without stealing a hue
 * from the eight colours that carry meaning.
 */
const STONE = candy("#94A0AC", "#BAC4CE", "#6E7A87");
/**
 * The core's charge. Orange rather than one of the eight block colours: the
 * hub is not a cell and must never look like one that happens to be full.
 */
const CHARGE = candy("#FF9A2E", "#FFC46B", "#E06A00");

/** Bright sky. Reads instantly as a mobile puzzle game. */
export const SKY: Theme = {
  id: "sky",
  label: "Sky",
  backdrop: ["#63CDFF", "#2E9BE8"],
  plate: "#F3FAFF",
  plateEdge: "#C2E4F7",
  empty: "#C9DFEE",
  emptyEdge: "#AECEE2",
  blockOutline: "rgba(28, 52, 74, 0.20)",
  muted: candy("#A9BCCB", "#C6D6E2", "#8CA0B0"),
  text: "#12384F",
  textSoft: "#5B8AA6",
  blocks: CANDY_BLOCKS,
  charge: CHARGE,
  stone: STONE,
};

/** Warm cream. Softer and more "wooden toy" than the sky. */
export const CREAM: Theme = {
  id: "cream",
  label: "Cream",
  backdrop: ["#FFE9BF", "#FFC377"],
  plate: "#FFFBF0",
  plateEdge: "#F0DCB8",
  empty: "#E5D2B0",
  emptyEdge: "#CDB58E",
  blockOutline: "rgba(90, 60, 20, 0.20)",
  muted: candy("#C3B39B", "#D9CCB8", "#A3927A"),
  text: "#5A3B14",
  textSoft: "#A5824F",
  blocks: CANDY_BLOCKS,
  charge: CHARGE,
  stone: STONE,
};

/** Fresh mint. Cooler, a little more grown-up, still nowhere near techy. */
export const MINT: Theme = {
  id: "mint",
  label: "Mint",
  backdrop: ["#B8F2D8", "#63D6A8"],
  plate: "#F4FFFA",
  plateEdge: "#BCE8D3",
  empty: "#C6E5D6",
  emptyEdge: "#A8D0BC",
  blockOutline: "rgba(20, 66, 48, 0.20)",
  muted: candy("#A8C3B6", "#C4D9CF", "#8AA79A"),
  text: "#14513A",
  textSoft: "#579B7C",
  blocks: CANDY_BLOCKS,
  charge: CHARGE,
  stone: STONE,
};

/**
 * Earned themes.
 *
 * Cosmetic and nothing else — progression that changes how the game *plays*
 * turns a puzzle into a treadmill, and the whole appeal of this one is that
 * everybody's board is the same board. What a player earns is how it looks.
 *
 * All four obey the same rule the first three do: bright, saturated, toy-like.
 * No dark ground, no gradient into violet, nothing that reads as a dashboard.
 */

/** Bright pink. The loudest of them, and the one people play toward. */
export const BUBBLEGUM: Theme = {
  id: "bubblegum",
  label: "Bubblegum",
  backdrop: ["#FFB3DA", "#FF6FB5"],
  plate: "#FFF5FA",
  plateEdge: "#F7CFE4",
  empty: "#F4CFE2",
  emptyEdge: "#E3AECB",
  blockOutline: "rgba(96, 24, 62, 0.20)",
  muted: candy("#D4B3C4", "#E8D2DE", "#B593A4"),
  text: "#7A1244",
  textSoft: "#C2568F",
  blocks: CANDY_BLOCKS,
  charge: CHARGE,
  stone: STONE,
};

/** Warm coral. Sunset without the gradient cliché. */
export const SHERBET: Theme = {
  id: "sherbet",
  label: "Sherbet",
  backdrop: ["#FFC9A3", "#FF8E63"],
  plate: "#FFF7F1",
  plateEdge: "#F5D9C6",
  empty: "#F2D4C0",
  emptyEdge: "#DDB89F",
  blockOutline: "rgba(102, 44, 16, 0.20)",
  muted: candy("#D3BCAC", "#E7D6CA", "#B39C8C"),
  text: "#7A3312",
  textSoft: "#C4744A",
  blocks: CANDY_BLOCKS,
  charge: CHARGE,
  stone: STONE,
};

/** Deep teal. The coolest one, and still nowhere near a dark theme. */
export const LAGOON: Theme = {
  id: "lagoon",
  label: "Lagoon",
  backdrop: ["#7FE3DC", "#1FB9B2"],
  plate: "#F2FEFD",
  plateEdge: "#BEE9E6",
  empty: "#C3E4E1",
  emptyEdge: "#A2CBC7",
  blockOutline: "rgba(10, 62, 60, 0.20)",
  muted: candy("#A9C4C2", "#C7DBD9", "#8AA6A4"),
  text: "#0B4B48",
  textSoft: "#3F9A94",
  blocks: CANDY_BLOCKS,
  charge: CHARGE,
  stone: STONE,
};

/** Lemonade. The last one, and deliberately the brightest thing in the game. */
export const LEMONADE: Theme = {
  id: "lemonade",
  label: "Lemonade",
  backdrop: ["#FFE884", "#FFC61F"],
  plate: "#FFFDF0",
  plateEdge: "#F2E1AE",
  empty: "#EFDFA8",
  emptyEdge: "#D8C48A",
  blockOutline: "rgba(92, 68, 6, 0.20)",
  muted: candy("#CFC7A4", "#E4DDC4", "#ADA484"),
  text: "#6B5000",
  textSoft: "#B99417",
  blocks: CANDY_BLOCKS,
  charge: CHARGE,
  stone: STONE,
};

export const THEMES: readonly Theme[] = [SKY, CREAM, MINT, LAGOON, SHERBET, BUBBLEGUM, LEMONADE];

/**
 * Colour ids run 1..8 and every caller is supposed to hold one. The wrap is
 * written to survive a caller that does not: a plain modulo turns id 0 into
 * index -1, which is `undefined`, and the first property read off it takes the
 * whole frame down mid-draw. Painting the wrong sweet is a blemish; throwing
 * here left the canvas in a state the next frame inherited.
 */
export function blockColour(theme: Theme, colourId: number): BlockColour {
  const n = theme.blocks.length;
  const index = (((Math.trunc(colourId) - 1) % n) + n) % n;
  return theme.blocks[index]!;
}
