"""Fit and backtest the CourtEdge educational pre-match model. Requires NumPy."""
import argparse
import csv
import hashlib
import heapq
import json
import math
import re
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path

import numpy as np

ROUNDS = {name: i for i, name in enumerate(["R128", "R64", "R32", "R16", "QF", "SF", "F"])}
SURFACES = {"Hard", "Clay", "Grass"}
FEATURES = ["log_rank_ratio", "rank_wta", "rank_bo5", "overall_rating_gap",
            "surface_rating_gap", "rating_wta", "rating_bo5", "prior_hours_gap"]
CANDIDATES = {"rank": 3, "ratings": 7, "ratings_workload": 8}
VALIDATION_START = date(2025, 1, 1)
TEST_START = date(2026, 1, 1)


def numeric(value):
    try:
        number = float(value)
        return number if math.isfinite(number) else 0
    except (TypeError, ValueError):
        return 0


def completed(row):
    needed = row["format"] // 2 + 1
    wins = losses = 0
    for token in row["score"].split():
        match = re.fullmatch(r"(\d+)-(\d+)(?:\(\d+\))?", token)
        if not match or wins == needed or losses == needed:
            return False
        a, b = map(int, match.groups())
        low, high = sorted((a, b))
        if not ((high == 6 and low <= 4) or (high == 7 and low in (5, 6))):
            return False
        wins += a > b
        losses += b > a
    return wins == needed


def read_events(directory, cutoff):
    manifest = json.loads((directory / "manifest.json").read_text())
    unique, counts = {}, Counter()
    for source in manifest:
        path = directory / source["file"]
        if hashlib.sha256(path.read_bytes()).hexdigest() != source["sha256"]:
            raise ValueError(f"Source checksum mismatch for {path.name}")
        tour = "WTA" if "wta" in path.stem else "ATP"
        with path.open(encoding="utf-8-sig", newline="") as stream:
            for row in csv.DictReader(stream):
                counts["raw"] += 1
                try:
                    day = date.fromisoformat(row["tourney_date"])
                except (ValueError, TypeError):
                    counts["invalid_date"] += 1
                    continue
                if day > cutoff:
                    counts["after_cutoff"] += 1
                    continue
                w, l = row["winner_id"], row["loser_id"]
                if not (w and l and w != l and row["tourney_id"]):
                    counts["invalid_identity"] += 1
                    continue
                if row["round"] not in ROUNDS or row["surface"] not in SURFACES or row["best_of"] not in ("3", "5"):
                    counts["outside_scope"] += 1
                    continue
                event = (tour, row["tourney_id"])
                identity = (event, row["round"], tuple(sorted((w, l))))
                if identity in unique:
                    counts["duplicates"] += 1
                unique[identity] = dict(row, day=day, event=event, format=int(row["best_of"]))
    events = defaultdict(list)
    for row in unique.values():
        row["complete"] = completed(row)
        events[row["event"]].append(row)
    return events, counts, manifest


def build_examples(events, cutoff):
    ratings = defaultdict(lambda: 1500.)
    profiles, examples, pending = {}, [], []

    def release(day):
        while pending and pending[0][0] < day:
            _, event = heapq.heappop(pending)
            for row in sorted(events[event], key=lambda r: (ROUNDS[r["round"]], r["winner_id"])):
                if not row["complete"]:
                    continue
                for context in ("All", row["surface"]):
                    w = (event[0], row["winner_id"], context)
                    l = (event[0], row["loser_id"], context)
                    expected = 1 / (1 + 10 ** ((ratings[l] - ratings[w]) / 400))
                    step = 24 * (1 - expected)
                    ratings[w] += step
                    ratings[l] -= step

    starts = {k: min(r["day"] for r in rows) for k, rows in events.items()}
    for event in sorted(events, key=lambda k: (starts[k], k)):
        start, rows = starts[event], events[event]
        release(start)
        ready = max(start + timedelta(days=21), max(r["day"] for r in rows))
        heapq.heappush(pending, (ready, event))
        prior = defaultdict(list)
        for r in sorted(rows, key=lambda r: (ROUNDS[r["round"]], r["winner_id"])):
            w, l, tour = r["winner_id"], r["loser_id"], event[0]
            a, b = sorted((w, l))
            side_a, side_b = ("winner", "loser") if a == w else ("loser", "winner")
            rank_a, rank_b = [numeric(r[s + "_rank"]) for s in (side_a, side_b)]
            for side, pid, rank in [(side_a, a, rank_a), (side_b, b, rank_b)]:
                if not 1 <= rank <= 3000:
                    continue
                key = (tour, pid)
                if key not in profiles or r["day"].isoformat() >= profiles[key]["rank_date"]:
                    profiles[key] = dict(id=pid, tour=tour, name=r[side + "_name"], rank=int(rank),
                                         rank_date=r["day"].isoformat())
            order = ROUNDS[r["round"]]
            def history_hours(pid):
                history = prior[pid]
                if not history or [i for i, _ in history] != list(range(order-len(history), order)):
                    return None
                minutes = [m for _, m in history]
                return sum(minutes)/60 if all(20 <= m <= 600 for m in minutes) else None
            h_a, h_b = history_hours(a), history_hours(b)
            known = h_a is not None and h_b is not None
            if r["complete"] and 1 <= rank_a <= 3000 and 1 <= rank_b <= 3000:
                rank = math.log(rank_b/rank_a)
                overall = (ratings[tour, a, "All"] - ratings[tour, b, "All"]) / 400
                surface = (ratings[tour, a, r["surface"]] - ratings[tour, b, r["surface"]]) / 400
                hours = max(-5, min(5, h_a-h_b)) if known else 0.
                wta, bo5 = tour == "WTA", r["format"] == 5
                x = [rank, rank*wta, rank*bo5, overall, surface, overall*wta, overall*bo5, hours]
                examples.append((start, ready, tour, event, x, int(a == w), known))
            for pid in (w, l):
                prior[pid].append((order, numeric(r["minutes"]) if r["complete"] else 0.))
    release(cutoff + timedelta(days=1))
    current_profiles = []
    for (tour, pid), profile in profiles.items():
        if profile["rank_date"] < "2026-01-01":
            continue
        profile["ratings"] = {s: ratings[tour, pid, s] for s in ("All", *sorted(SURFACES))}
        current_profiles.append(profile)
    return examples, current_profiles


def sigmoid(z):
    return 1 / (1 + np.exp(-np.clip(z, -35, 35)))


def fit(x, y):
    # No intercept gives complementary probabilities when participants swap.
    beta = np.zeros(x.shape[1])
    penalty = 4 * np.eye(x.shape[1])
    for _ in range(50):
        p = sigmoid(x @ beta)
        hessian = x.T @ (x * (p * (1-p))[:, None]) + penalty
        step = np.linalg.solve(hessian, x.T @ (p-y) + penalty @ beta)
        beta -= step
        if np.max(np.abs(step)) < 1e-9:
            break
    return beta


def loss(y, p):
    return -np.log(np.clip(np.where(y, p, 1-p), 1e-12, 1))


def metrics(y, p):
    return dict(n=len(y), accuracy=float(np.mean(np.where(p == .5, .5, (p > .5) == y))),
                log_loss=float(loss(y, p).mean()), brier=float(np.mean((y-p)**2)))


def monthly_performance(held, outcomes, probabilities):
    """Summarize the original out-of-sample probabilities by event start month."""
    months = np.array([row[0].strftime("%Y-%m") for row in held])
    tours = np.array([row[2] for row in held])
    confidence = np.maximum(probabilities, 1 - probabilities)
    by_tour = {}
    for tour in ("All", "ATP", "WTA"):
        rows = []
        for month in sorted(set(months)):
            mask = months == month
            if tour != "All":
                mask &= tours == tour
            if mask.any():
                rows.append(dict(month=str(month), n=int(mask.sum()),
                                 predicted=float(confidence[mask].mean()),
                                 observed=metrics(outcomes[mask], probabilities[mask])["accuracy"]))
        by_tour[tour] = rows
    return by_tour


def train(directory, cutoff, destination):
    events, audit, manifest = read_events(directory, cutoff)
    examples, profiles = build_examples(events, cutoff)
    x = np.array([r[4] for r in examples])
    y = np.array([r[5] for r in examples])
    development = np.array([r[1] < VALIDATION_START for r in examples])
    validation = np.array([r[0] >= VALIDATION_START and r[1] < TEST_START for r in examples])
    final_train = np.array([r[1] < TEST_START for r in examples])
    test = np.array([r[0] >= TEST_START for r in examples])
    assert not np.any(final_train & test)
    validation_scores = {}
    for candidate, k in CANDIDATES.items():
        coef = fit(x[development, :k], y[development])
        validation_scores[candidate] = metrics(y[validation], sigmoid(x[validation, :k] @ coef))
    chosen = min(validation_scores, key=lambda key: validation_scores[key]["log_loss"])
    k = CANDIDATES[chosen]
    beta = fit(x[final_train, :k], y[final_train])
    baseline = fit(x[final_train, :3], y[final_train])
    p, p_rank = sigmoid(x[test, :k] @ beta), sigmoid(x[test, :3] @ baseline)
    yt = y[test]
    held = [r for r, is_test in zip(examples, test) if is_test]
    table = {}
    for label in ("All", "ATP", "WTA"):
        mask = np.array([label == "All" or r[2] == label for r in held])
        table[label] = dict(selected=metrics(yt[mask], p[mask]), rank=metrics(yt[mask], p_rank[mask]))
    # Paired event bootstrap keeps the two forecasts for each match together.
    groups = defaultdict(list)
    for row, delta in zip(held, loss(yt,p)-loss(yt,p_rank)):
        groups[row[3]].append(delta)
    sums = np.array([sum(v) for v in groups.values()])
    sizes = np.array([len(v) for v in groups.values()])
    indices = np.random.default_rng(20261105).integers(len(groups), size=(2000,len(groups)))
    interval = np.quantile(sums[indices].sum(axis=1)/sizes[indices].sum(axis=1), [.025,.975])
    calibration = []
    confidence = np.maximum(p, 1-p)
    for lo in [.5,.6,.7,.8,.9]:
        mask = (confidence >= lo) & (confidence < round(lo+.1,1))
        if mask.any():
            calibration.append(dict(low=lo,n=int(mask.sum()),expected=float(confidence[mask].mean()),
                                    observed=metrics(yt[mask],p[mask])["accuracy"]))
    report = dict(as_of=str(cutoff), source="TennisMyLife", sources=manifest, ingestion=audit,
                  eligible=len(y), train=int(final_train.sum()), development=int(development.sum()),
                  selection=validation_scores, selected=chosen, test=table, test_events=len(groups),
                  log_loss_delta_ci95=interval.tolist(), calibration=calibration,
                  monthly=monthly_performance(held, yt, p),
                  test_workload_available=sum(r[6] for r in held), coefficients_fit_before=str(TEST_START),
                  scope="Ranked players in standard completed tour-level knockout singles on hard, clay or grass. "
                        "Rank is the source ranking attached to the match. Event-opening ratings use completed older events "
                        "only after the later of their last source date and 21 days after their first source date. "
                        "Outcomes in 2026 update ratings only when their release date precedes the next event. "
                        "Workload is earlier same-event minutes for both players with contiguous observed prior rounds. "
                        "When unknown, omit its adjustment. Frozen coefficients selected on 2025 log loss, then fit on pre-2026 data.")
    payload = dict(report=report, features=FEATURES[:k], coefficients=beta.tolist(), profiles=profiles)
    destination.write_text(json.dumps(payload, allow_nan=False, ensure_ascii=False), encoding="utf8")
    print(json.dumps({k:v for k,v in report.items() if k not in {"sources","scope"}},indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--as-of", type=date.fromisoformat, required=True)
    args = parser.parse_args()
    train(args.directory, args.as_of, args.destination)
