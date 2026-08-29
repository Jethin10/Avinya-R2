"""Small, transparent offline fallback extractor; never computes severity itself."""

from __future__ import annotations

import re


SUBJECT_TERMS = {
    "people_trapped": ("trapped", "stranded"),
    "injured": ("injured", "wounded"),
    "dead": ("dead", "fatalit", "killed"),
    "displaced": ("displaced", "evacuated"),
    "buildings": ("house", "building", "homes", "collapse"),
    "road": ("road", "route"),
    "bridge": ("bridge",),
    "embankment": ("embankment", "bund", "dam"),
    "power": ("power", "electric", "feeder"),
    "water": ("water", "flood", "inundat"),
}


def extract(text: str | None, supplied_hazard: str, supplied_hint: str) -> dict[str, object]:
    lowered = (text or "").casefold()
    subjects = [subject for subject, terms in SUBJECT_TERMS.items() if any(term in lowered for term in terms)]
    hazard = supplied_hazard
    if hazard == "unknown":
        hazard_terms = {
            "flood": ("flood", "water", "embankment", "inundat"),
            "landslide": ("landslide", "mudslide", "slope"),
            "quake": ("earthquake", "quake", "tremor"),
            "cyclone": ("cyclone", "wind", "storm"),
            "fire": ("fire", "burning"),
        }
        hazard = next((name for name, terms in hazard_terms.items() if any(t in lowered for t in terms)), "unknown")
    hint = supplied_hint
    if hint == "unknown":
        if re.search(r"\b(total(?:ly)? collapse|catastroph|many dead|destroyed)\b", lowered): hint = "catastrophic"
        elif re.search(r"\b(severe|collapsed|trapped|breach(?:ed)?)\b", lowered): hint = "severe"
        elif re.search(r"\b(moderate|damaged|waterlogging)\b", lowered): hint = "moderate"
        elif re.search(r"\b(minor|small|limited)\b", lowered): hint = "minor"
        elif re.search(r"\b(all (?:is )?fine|intact|no damage|safe)\b", lowered): hint = "none"
    firsthand = bool(re.search(r"\b(i saw|we saw|i am at|on site|eyewitness)\b", lowered))
    return {"hazard": hazard, "severity_hint": hint, "subjects": subjects, "is_firsthand": firsthand}

