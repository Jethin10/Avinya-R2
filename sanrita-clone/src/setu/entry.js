/**
 * Browser entry for the SETU layer.
 *
 * Keeping this as a real module entry (rather than an inline dynamic import) lets Vite resolve the
 * standalone route's relative CSS/JS imports in production builds. The lightweight route mounts
 * first; the full district-twin graph follows without blocking Evidence / Validator first paint.
 */

import "./standalone.js";

import("./main.js").catch((error) => console.error("[setu-entry]", error));
