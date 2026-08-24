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

export const THEMES: readonly Theme[] = [SKY, CREAM, MINT];

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
