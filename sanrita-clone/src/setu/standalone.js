/**
 * Lightweight entry for SETU's editorial / operational standalone pages.
 *
 * The captured reference shell has a large client bundle. Loading these routes through the full
 * district-twin graph makes their mount timing depend on unrelated Three.js and scene modules.
 * This entry deliberately imports the standalone route surfaces so they can claim their slots
 * before the captured app hydrates. main.js still owns the interactive twin.
 */

import "./setu.css";
import { installEvidenceRouteBridge, isEvidenceRoute, mountEvidencePage } from "./evidence.js";
import { installValidatorRouteBridge, isValidatorRoute, mountValidatorPage } from "./validator.js";
import { installInferRouteBridge, isInferRoute, mountInferPage } from "./infer.js";
import { installActRouteBridge, isActRoute, mountActPage } from "./act.js";

const evidenceRoute = isEvidenceRoute();
const validatorRoute = isValidatorRoute();
const inferRoute = isInferRoute();
const actRoute = isActRoute();

installEvidenceRouteBridge();
installValidatorRouteBridge();
installInferRouteBridge();
installActRouteBridge();

if (evidenceRoute) mountEvidencePage();
if (validatorRoute) mountValidatorPage();
if (inferRoute) mountInferPage();
if (actRoute) mountActPage();
