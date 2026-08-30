/**
 * State-level operational context.
 *
 * Most states in the atlas only have regional prioritisation rows. Assam is different: the current
 * demo carries a dated replay of the August 2026 flood so the map can tell a real, recent story
 * without presenting a stylised flood wash as measured inundation depth.
 */

const ASSAM_AFFECTED = new Set([
  "sivasagar",
  "golaghat",
  "nagaon",
  "hojai",
  "sonitpur",
  "dhemaji",
  "darrang",
  "biswanath",
  "kamrup-metropolitan",
  "lakhimpur",
  "udalguri",
  "jorhat",
  "charaideo",
]);

const ASSAM_PRIORITY = {
  golaghat: {
    severity: 0.96,
    alert_level: "red",
    affected_people: 58750,
    status: "FLOOD REPLAY",
    river_status: "Dhansiri above danger level at Golaghat + Numaligarh",
    response_note: "Worst-hit district in the 08 Aug ASDMA bulletin.",
  },
  sivasagar: {
    severity: 0.91,
    alert_level: "red",
    affected_people: 48286,
    status: "FLOOD → RECOVERY",
    river_status: "Upper Assam floodplain / Sibsagar response",
    response_note: "Late-Aug recovery remained active; 49 flood-hit schools were being readied to reopen.",
  },
  jorhat: {
    severity: 0.82,
    alert_level: "red",
    affected_people: 25259,
    status: "FLOOD REPLAY",
    river_status: "Brahmaputra / Neamatighat floodplain",
    response_note: "Third-highest affected population in the 08 Aug bulletin.",
  },
};

export const ASSAM_FLOOD_2026 = {
  asOf: "08 AUG 2026",
  recoveryAsOf: "26–27 AUG 2026",
  affectedPeople: 155849,
  deaths: 98,
  affectedDistricts: 13,
  revenueCircles: 33,
  villages: 464,
  reliefCamps: 55,
  reliefCentres: 18,
  cropAreaHa: 10748.64,
  animalsAffected: 47000,
  source: "ASDMA flood bulletin · reported 08 Aug 2026",
  inundationSource: "NRSC/Bhuvan · flood:as_2026_08_08_18 · 08 Aug 2026 18Hr",
  disclosure: "Blue traces are derived from NRSC/Bhuvan's 08 Aug satellite inundation layer; they show mapped flood extent, not water depth. Red rings mark the three highest-impact districts in the ASDMA bulletin.",
};

export function stateSituationOverride(stateId, districtId) {
  if (stateId !== "assam" || !ASSAM_AFFECTED.has(districtId)) return null;
  const priority = ASSAM_PRIORITY[districtId] || {};
  return {
    hazard: "flood",
    failure_mode: "INUNDATION",
    flood_active: true,
    alert_level: priority.alert_level || "amber",
    provenance: "ASDMA · 08 Aug 2026",
    source_label: ASSAM_FLOOD_2026.source,
    status: priority.status || "AFFECTED · 08 AUG",
    response_note: priority.response_note || "Listed as flood-affected in the 08 Aug ASDMA bulletin.",
    river_status: priority.river_status || "Flood-affected district · district river gauge not transcribed here",
    severity: priority.severity ?? 0.64,
    affected_people: priority.affected_people ?? null,
    suppress_synthetic: true,
  };
}

function topFailure(rows) {
  const counts = new Map();
  for (const row of rows) {
    const key = row.failure_mode || "UNCLASSIFIED";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "UNCLASSIFIED";
}

export function situationForState(state, rowForDistrict) {
  const rows = state.districts.map(district => ({
    district,
    row: rowForDistrict(district) || {},
  }));
  const sorted = [...rows].sort((a, b) => (b.row.severity || 0) - (a.row.severity || 0));

  if (state.id === "assam") {
    return {
      alert: true,
      kicker: "RECENT FLOOD REPLAY",
      title: "UPPER ASSAM · AUG 2026",
      note: `${ASSAM_FLOOD_2026.source}. ${ASSAM_FLOOD_2026.disclosure}`,
      metrics: [
        { label: "people affected", value: ASSAM_FLOOD_2026.affectedPeople.toLocaleString("en-IN"), meta: ASSAM_FLOOD_2026.asOf },
        { label: "affected districts", value: String(ASSAM_FLOOD_2026.affectedDistricts), meta: `${ASSAM_FLOOD_2026.villages} villages` },
        { label: "season flood toll", value: String(ASSAM_FLOOD_2026.deaths), meta: ASSAM_FLOOD_2026.asOf },
        { label: "relief camps", value: String(ASSAM_FLOOD_2026.reliefCamps), meta: `${ASSAM_FLOOD_2026.reliefCentres} distribution centres` },
      ],
      topDistricts: ["golaghat", "sivasagar", "jorhat"].map(id => {
        const item = rows.find(entry => entry.district.id === id);
        return item ? {
          id,
          name: item.district.name,
          severity: item.row.severity,
          value: item.row.affected_people == null ? "AFFECTED" : item.row.affected_people.toLocaleString("en-IN"),
          meta: item.row.affected_people == null ? item.row.status : "people affected",
        } : null;
      }).filter(Boolean),
      footer: `Crop under water: ${ASSAM_FLOOD_2026.cropAreaHa.toLocaleString("en-IN")} ha · >${ASSAM_FLOOD_2026.animalsAffected.toLocaleString("en-IN")} animals affected`,
    };
  }

  const elevated = rows.filter(entry => (entry.row.severity || 0) >= 0.6);
  const peak = sorted[0];
  const average = rows.length
    ? rows.reduce((sum, entry) => sum + (entry.row.severity || 0), 0) / rows.length
    : 0;
  const live = state.districts.filter(district => district.scenarios?.length).length;
  const fullTwins = rows.filter(entry => entry.district.scenarios?.length).map(entry => ({
    id: entry.district.id,
    name: entry.district.name,
    severity: entry.row.severity || 0,
    value: "OPEN",
    meta: `${entry.district.scenarios.length} district scenario${entry.district.scenarios.length === 1 ? "" : "s"}`,
  }));

  return {
    alert: false,
    kicker: "STATE SITUATION",
    title: `${state.name} · REGIONAL PICTURE`,
    note: "District priorities are regional scenario estimates unless a full twin is explicitly marked available. Click any district for its operational readout.",
    metrics: [
      { label: "districts monitored", value: String(state.districts.length), meta: "atlas coverage" },
      { label: "elevated districts", value: String(elevated.length), meta: "≥ 60% regional belief" },
      { label: "mean threat", value: `${Math.round(average * 100)}%`, meta: "regional prioritisation" },
      { label: "full twins", value: String(live), meta: live ? "district package available" : "regional only" },
    ],
    topDistricts: sorted.slice(0, 4).map(entry => ({
      id: entry.district.id,
      name: entry.district.name,
      severity: entry.row.severity || 0,
      value: `${Math.round((entry.row.severity || 0) * 100)}%`,
      meta: entry.row.failure_mode || "UNCLASSIFIED",
    })),
    fullTwins,
    footer: `Dominant regional failure mode: ${topFailure(rows)}`,
  };
}
