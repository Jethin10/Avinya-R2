from __future__ import annotations

import math

from core.belief import EvidenceTerm, FailureMode, fuse, logit, sigmoid, smooth_once
from core.dedupe import ClaimLike, collapse, independent_source_count
from core.dispatch import Asset, DispatchCandidate, solve
from core.likelihoods import human_lr, sar_lrs, telecom_lrs
from core.silence import assess_silence
from core.routing import assess_route
from core.trust import TrustState


def test_logit_round_trip_and_monotonic_evidence() -> None:
    assert abs(sigmoid(logit(0.73)) - 0.73) < 1e-9
    key = ("A", FailureMode.COLLAPSE)
    priors = {key: (logit(0.2), 0.3)}
    weak = fuse(priors, [EvidenceTerm("A", FailureMode.COLLAPSE, math.log(1.5), "verification")])[key]
    strong = fuse(priors, [EvidenceTerm("A", FailureMode.COLLAPSE, math.log(5.0), "verification")])[key]
    assert 0.2 < weak.probability < strong.probability


def test_correlation_damping_never_exceeds_independent_bound() -> None:
    key = ("A", FailureMode.COLLAPSE); priors = {key: (0.0, 0.3)}
    terms = [EvidenceTerm("A", FailureMode.COLLAPSE, math.log(4), "human_report") for _ in range(4)]
    damped = fuse(priors, terms)[key].log_odds
    independent = fuse(priors, terms, damping={"human_report": 1.0})[key].log_odds
    assert damped < independent


def test_reliability_zero_has_exactly_no_effect() -> None:
    assert human_lr("catastrophic", 0.0, 100, True) == 1.0


def test_dead_sensor_is_neutral_and_normality_is_evidence() -> None:
    assert all(value == 1.0 for value in sar_lrs(coherence_loss=1, backscatter_drop_db=9, usable=False).values())
    assert telecom_lrs(0.9)[FailureMode.COLLAPSE] < 1.0


def test_dedupe_is_idempotent_and_counts_independent_firsthand_sources() -> None:
    claims = [
        ClaimLike("1", "Bridge collapsed near Bhimsar", "s1", "ham", True),
        ClaimLike("2", "Bridge collapsed near Bhimsar", "s2", "sms", True),
        ClaimLike("3", "Bridge collapsed near Bhimsar", "s2", "whatsapp", False),
    ]
    once = collapse(claims); twice = collapse([claim for cluster in once for claim in cluster])
    assert [[c.claim_id for c in group] for group in once] == [[c.claim_id for c in group] for group in twice]
    assert independent_source_count(once[0]) == 2


def test_spatial_smoothing_is_single_pass() -> None:
    from core.belief import BeliefState
    states = {("A", FailureMode.COLLAPSE): BeliefState("A", FailureMode.COLLAPSE, 4.0, .2), ("B", FailureMode.COLLAPSE): BeliefState("B", FailureMode.COLLAPSE, 0.0, .2)}
    output = smooth_once(states, {"A": {"B": 1}, "B": {"A": 1}})
    assert output[("A", FailureMode.COLLAPSE)].log_odds == 3.4
    assert output[("B", FailureMode.COLLAPSE)].log_odds == 0.6


def test_dispatch_assigns_asset_by_failure_mode() -> None:
    candidate = DispatchCandidate("A", "Alpha", 2000, .1, {mode: (.9 if mode == FailureMode.INUNDATION else .05) for mode in FailureMode}, .8, 20)
    tasks = solve([candidate], [Asset("BOAT-1", "boat", 10)], hours_elapsed=3)
    assert tasks[0]["asset_kind"] == "boat"
    assert tasks[0]["failure_mode"] == "INUNDATION"


def test_route_assessment_degrades_and_honours_explicit_edge_cut() -> None:
    route = {"id": "r", "asset_kind": "medical", "eta_minutes_normal": 20, "distance_km": 10, "segments": [{"way_id": 42, "settlement_id": "A", "length_m": 1000, "base_passability": 0.95}]}
    open_route = assess_route(route, {"A": {"INUNDATION": 0.0}})
    flooded = assess_route(route, {"A": {"INUNDATION": 0.9}})
    cut = assess_route(route, {"A": {"INUNDATION": 0.0}}, cut_edges={"42"})
    assert open_route["passability"] > flooded["passability"] > cut["passability"]
    assert cut["status"] == "blocked"


def test_trust_beta_posterior() -> None:
    state = TrustState().update(True).update(True).update(False)
    assert state.alpha == 3 and state.beta == 2 and state.reliability == 0.6


def test_silence_cannot_authorise_dispatch_without_corroboration() -> None:
    alone = assess_silence(0, 100, corroborating_channels=0)
    corroborated = assess_silence(0, 100, corroborating_channels=1)
    nuisance = assess_silence(0, 100, known_backhaul_failure=True, corroborating_channels=2)
    assert alone.informative and not alone.dispatch_allowed
    assert corroborated.dispatch_allowed
    assert not nuisance.informative and not nuisance.dispatch_allowed
