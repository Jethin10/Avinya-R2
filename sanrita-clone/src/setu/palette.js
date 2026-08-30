/**
 * The clone's design tokens, read from the page rather than copied into this file.
 *
 * The San Rita stylesheet owns these values. Hard-coding them here would mean two sources of truth
 * and a SETU layer that drifts out of the site's palette the first time the stylesheet changes, so
 * every colour is looked up on the document element and only falls back to a literal if the
 * stylesheet is somehow absent.
 */

const FALLBACK = {
  "adventure-yellow": "#e2ffcc",
  "deep-green": "#161b13",
  "forest-green": "#2d3329",
  "icy-blue": "#dde2e4",
  "terrain-grey": "#84907f",
  "setu-terrain": "#b8c5c0",
  "signal-orange": "#d65b3c",
};

function read(name) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(`--color-${name}`)
    .trim();
  return value || FALLBACK[name];
}

/**
 * sRGB channel to linear-light, because that is the space three.js does its arithmetic in.
 *
 * ``new THREE.Color(r, g, b)`` takes its three numbers to already be in the renderer's working
 * colour space, which since r152 is linear - so handing it the sRGB numbers a stylesheet uses makes
 * every material read several stops too light and squashes the dark half of any ramp into one
 * indistinguishable pale tone. Encoding here means a token means the same colour in CSS and in the
 * scene, which is the whole point of reading the tokens off the document in the first place.
 */
function toLinear(channel) {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** Hex or rgb() string to a plain sRGB 0-1 triple - the space the stylesheet's numbers are in. */
export function srgb(css) {
  const hex = css.trim();
  if (hex.startsWith("#")) {
    const digits = hex.length === 4
      ? [...hex.slice(1)].map((character) => character + character).join("")
      : hex.slice(1);
    const value = Number.parseInt(digits, 16);
    return [value >> 16 & 255, value >> 8 & 255, value & 255].map((byte) => byte / 255);
  }
  const parts = hex.match(/[\d.]+/g) || ["0", "0", "0"];
  return parts.slice(0, 3).map((part) => Number(part) / 255);
}

/** The same colour, linear-light, ready to hand straight to a THREE.Color. */
export function rgb(css) {
  return srgb(css).map(toLinear);
}

export const palette = {
  get adventureYellow() { return read("adventure-yellow"); },
  get deepGreen() { return read("deep-green"); },
  get forestGreen() { return read("forest-green"); },
  get icyBlue() { return read("icy-blue"); },
  get terrainGrey() { return read("terrain-grey"); },
  get setuTerrain() { return read("setu-terrain"); },
  get signalOrange() { return read("signal-orange"); },
};

/** The site's own easing curve, as a function, for camera moves that must feel like its scrolling. */
export function easeSanRita(t) {
  // cubic-bezier(.16, 1, .3, 1) - solved by bisection on x, which at this precision costs nothing
  // and saves carrying a polynomial approximation that would be wrong in the tail.
  const bezier = (a, b, u) => {
    const v = 1 - u;
    return 3 * v * v * u * a + 3 * v * u * u * b + u * u * u;
  };
  let low = 0;
  let high = 1;
  for (let index = 0; index < 24; index += 1) {
    const middle = (low + high) / 2;
    if (bezier(0.16, 0.3, middle) < t) low = middle;
    else high = middle;
  }
  return bezier(1, 1, (low + high) / 2);
}

/**
 * Severity to a colour on the site's own ramp: a cold forest green through to a hot orange.
 *
 * Two things this ramp has to do that a straight lerp between two tokens does not. It has to be
 * legible across a whole state at once, so the dark end is the site's forest green rather than its
 * terrain grey - fourteen districts in near-identical pale beige read as relief but not as severity.
 * And its stops have to sit where the data actually sits: a state's districts land between roughly
 * 0.2 and 0.8, so the four visible steps are placed across that range rather than spread evenly over
 * a scale whose ends nothing ever reaches.
 *
 * Interpolated in sRGB, because that is where the stops were chosen by eye, and returned in whichever
 * space the caller draws in: ``severityColour`` for a material, ``severityCss`` for the DOM.
 */
function severityRamp(severity) {
  const stops = [
    [0.0, srgb(palette.forestGreen)],
    [0.2, srgb(palette.setuTerrain)],
    [0.45, [0.76, 0.67, 0.58]],
    [0.7, [0.83, 0.48, 0.34]],
    [1.0, srgb(palette.signalOrange)],
  ];
  const value = Math.min(1, Math.max(0, severity || 0));
  for (let index = 1; index < stops.length; index += 1) {
    const [stop, colour] = stops[index];
    const [previousStop, previousColour] = stops[index - 1];
    if (value <= stop) {
      const span = (value - previousStop) / (stop - previousStop || 1);
      return previousColour.map((channel, axis) => channel + (colour[axis] - channel) * span);
    }
  }
  return stops[stops.length - 1][1];
}

/** The ramp, linear-light, for a THREE.Color. */
export function severityColour(severity) {
  return severityRamp(severity).map(toLinear);
}

/** The ramp as an `rgb()` string, for a swatch or a bar in the panels. */
export function severityCss(severity) {
  return `rgb(${severityRamp(severity).map((channel) => Math.round(channel * 255)).join(",")})`;
}
