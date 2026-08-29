from __future__ import annotations

import difflib
import re
import unicodedata
from dataclasses import dataclass
from typing import Iterable


def _key(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).casefold()
    return " ".join(re.findall(r"\w+", value, flags=re.UNICODE))


@dataclass(frozen=True, slots=True)
class Match:
    settlement_id: str | None
    confidence: float
    surface: str | None
    method: str


class Gazetteer:
    def __init__(self, settlements: Iterable[dict]):
        self.entries: list[tuple[str, str]] = []
        for settlement in settlements:
            for variant in [settlement["name"], *settlement.get("name_variants", [])]:
                self.entries.append((settlement["id"], _key(variant)))

    def locate(self, text: str | None, explicit_id: str | None = None) -> Match:
        if explicit_id and any(sid == explicit_id for sid, _ in self.entries):
            return Match(explicit_id, 1.0, explicit_id, "explicit_id")
        haystack = _key(text or "")
        if not haystack:
            return Match(None, 0.0, None, "no_surface")
        exact = [(sid, name) for sid, name in self.entries if name and re.search(rf"\b{re.escape(name)}\b", haystack)]
        if exact:
            sid, surface = max(exact, key=lambda item: len(item[1]))
            return Match(sid, 0.98, surface, "district_exact")
        best_sid, best_name, best_score = None, None, 0.0
        words = haystack.split()
        windows = [" ".join(words[i:j]) for i in range(len(words)) for j in range(i + 1, min(len(words), i + 4) + 1)]
        for sid, name in self.entries:
            score = max((difflib.SequenceMatcher(None, name, window).ratio() for window in windows), default=0.0)
            if score > best_score:
                best_sid, best_name, best_score = sid, name, score
        # Context/source priors are zero unless the caller can substantiate them. Adding
        # unconditional priors here would turn unrelated text into a confident location guess.
        confidence = 0.65 * best_score
        return Match(best_sid if confidence >= 0.5 else None, confidence, best_name, "district_fuzzy")
