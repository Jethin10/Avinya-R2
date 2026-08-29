"""Deterministic exact and near-duplicate rumour cascade collapse."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Iterable


def normalise_claim(text: str) -> str:
    return " ".join(re.findall(r"\w+", text.casefold(), flags=re.UNICODE))


def fingerprint(text: str) -> str:
    return hashlib.blake2b(normalise_claim(text).encode("utf-8"), digest_size=16).hexdigest()


def token_similarity(left: str, right: str) -> float:
    a, b = set(normalise_claim(left).split()), set(normalise_claim(right).split())
    return 1.0 if not a and not b else (len(a & b) / len(a | b) if a | b else 0.0)


@dataclass(frozen=True, slots=True)
class ClaimLike:
    claim_id: str
    text: str
    source_id: str
    channel: str
    is_firsthand: bool


def collapse(claims: Iterable[ClaimLike], threshold: float = 0.8) -> list[list[ClaimLike]]:
    clusters: list[list[ClaimLike]] = []
    for claim in claims:
        for cluster in clusters:
            if any(fingerprint(claim.text) == fingerprint(other.text) or token_similarity(claim.text, other.text) >= threshold for other in cluster):
                cluster.append(claim)
                break
        else:
            clusters.append([claim])
    return clusters


def independent_source_count(cluster: Iterable[ClaimLike]) -> int:
    return len({(c.source_id, c.channel) for c in cluster if c.is_firsthand}) or 1

