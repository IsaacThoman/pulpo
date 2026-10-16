#!/usr/bin/env python3
"""Prepare the second-round tap-typing benchmark (tap-r2) outside the checkout.

Builds on `prepare_tap_benchmark.py` (whose output and seeds stay reproducible) and
writes two manifests that `TapCorrectionBenchmarkTests` replays (PK_TAP_BENCH):

* fresh-verify.json: held-out Topical-Chat valid_rare conversations (disjoint from the
  round-1 test_freq/test_rare sets and from the train split), new seeds, every round-1
  thumb persona plus a second touch model ("field" personas: per-person systematic
  offset field with fixed per-key offsets, correlated scatter and heavy-tailed slips),
  new misspelling targets and new controls.
* develop-r2.json: round-1 develop conversations with new seeds, thumb personas only,
  so improvements made on it are tested against an unseen touch model.

Both add, on top of the round-1 schema:

* space taps carry their touch (["s", x, y]), including letter taps that register as
  space; the round-1 runner ignores the extra values.
* clean: sentences typed with scatter that always resolves to the intended keys, with
  every word tagged "vulnerable" when a more frequent real word is one keyboard slip
  away (substitution with an adjacent key, transposition, omission, extra key). Any
  change is an unwanted correction.
* adaptation: per persona, separate sentences (from separate conversations) typed the
  same noisy way, replayed first to simulate a personal touch-model learning phase.
* realword controls: legitimate words one slip from a more common word after a carrier.

Nothing here reads the keyboard implementation.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import re
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import prepare_tap_benchmark as r1  # noqa: E402

VERSION = "tap-r2"
SALT = "tap-r2:"
CENTER = r1.CENTER
SPACE = r1.SPACE
resolve = r1.resolve


def bucket(key: str, salt: str = SALT) -> int:
    return hashlib.sha256((salt + key).encode()).digest()[0]


@dataclass(frozen=True)
class FieldPersona:
    """Second touch model: a per-person offset field rather than a thumb pivot.

    offset(key) = (bias_x + spread * (cx - 4.5) + jx[key], bias_y + tilt * (cx - 4.5) + jy[key])
    with fixed per-key jitter drawn once from `seed`; scatter is a correlated bivariate
    Gaussian, and with probability `tail` a tap is a slip with `tail_scale` times the spread.
    """
    name: str
    seed: int
    one_hand: bool
    bias_x: float
    bias_y: float
    spread: float
    tilt: float
    key_jitter: float
    sigma_x: float
    sigma_y: float
    rho: float
    tail: float
    tail_scale: float
    space_x: float
    space_sigma_x: float
    space_y: float
    omit: float
    double: float
    transpose: float
    space_miss: float
    apostrophe_omit: float
    shift_skip: float
    cognitive: float

    def offsets(self) -> dict[str, tuple[float, float]]:
        rng = random.Random(f"{self.seed}:offsets")
        result = {}
        for letter in sorted(CENTER):
            cx, _ = CENTER[letter]
            jx, jy = rng.gauss(0, self.key_jitter), rng.gauss(0, self.key_jitter)
            result[letter] = (round(self.bias_x + self.spread * (cx - 4.5) + jx, 4),
                              round(self.bias_y + self.tilt * (cx - 4.5) + jy, 4))
        return result


FIELD_PERSONAS = [
    # One-handed (left thumb): compresses toward the hand, taps high, right side lower.
    FieldPersona("field-onehand", 7301, True, 0.04, -0.07, -0.035, 0.02, 0.07,
                 0.21, 0.17, 0.25, 0.02, 2.2, 4.0, 0.6, 2.85,
                 0.012, 0.005, 0.0, 0.015, 0.7, 0.6, 0.04),
    # Hurried two-thumb typist: low, outward spread, heavy tail, many missed spaces.
    FieldPersona("field-rusher", 7302, False, -0.03, 0.10, 0.03, -0.01, 0.08,
                 0.25, 0.19, -0.2, 0.04, 2.2, 5.3, 0.8, 2.92,
                 0.018, 0.006, 0.015, 0.035, 0.85, 0.8, 0.06),
]


class Typist:
    """Uniform interface over the round-1 thumb personas and the field personas."""

    def __init__(self, persona):
        self.persona = persona
        self.name = persona.name
        self.field = isinstance(persona, FieldPersona)
        self.offset = persona.offsets() if self.field else None

    def hand(self, letter: str) -> str:
        if self.field:
            return "one" if self.persona.one_hand else ("left" if letter in r1.LEFT_HAND else "right")
        return r1.thumb_for(letter, self.persona)

    def touch(self, letter: str, rng: random.Random) -> tuple[float, float]:
        if not self.field:
            return r1.touch(letter, self.persona, rng)
        p = self.persona
        cx, cy = CENTER[letter]
        ox, oy = self.offset[letter]
        sx, sy = p.sigma_x, p.sigma_y
        if rng.random() < p.tail:
            sx, sy = sx * p.tail_scale, sy * p.tail_scale
        z1, z2 = rng.gauss(0, 1), rng.gauss(0, 1)
        dx = sx * z1
        dy = sy * (p.rho * z1 + math.sqrt(1 - p.rho * p.rho) * z2)
        return round(cx + ox + dx, 4), round(cy + oy + dy, 4)

    def space_touch(self, rng: random.Random) -> tuple[float, float]:
        if not self.field:
            return r1.space_touch(self.persona, rng)
        p = self.persona
        return round(p.space_x + rng.gauss(0, p.space_sigma_x), 4), round(p.space_y + rng.gauss(0, p.sigma_y), 4)

    def clean_touch(self, letter: str, rng: random.Random) -> tuple[float, float]:
        for _ in range(64):
            point = self.touch(letter, rng)
            if resolve(*point) == letter:
                return point
        return CENTER[letter]

    def clean_space(self, rng: random.Random) -> tuple[float, float]:
        for _ in range(64):
            point = self.space_touch(rng)
            if resolve(*point) == SPACE:
                return point
        return (5.0, 3.0)

    def describe(self) -> dict:
        data = asdict(self.persona)
        data["model"] = "field" if self.field else "thumb"
        if self.field:
            data["keyOffsets"] = {k: list(v) for k, v in self.offset.items()}
        return data


WORD = r1.WORD


def type_sentence(sentence: str, typist: Typist, rng: random.Random, pool: dict[str, list[str]]) -> dict:
    """Round-1 noisy typing with touches on every space and per-word noise labels.

    Events: ["k", char, x, y] letter tap, ["s", x, y] space tap, ["p", char] punctuation,
    ["v", index] read the bar for intended word `index`.
    """
    p = typist.persona
    tokens = WORD.findall(sentence)
    assert "".join(tokens) == sentence, sentence
    events: list[list] = []
    words: list[dict] = []
    word_at: dict[int, int] = {}
    damaged: dict[int, str] = {}
    sentence_start = True
    for position, token in enumerate(tokens):
        if token == " ":
            if rng.random() < p.space_miss:
                damaged[position - 1] = damaged[position + 1] = "space-missed"
                continue
            x, y = typist.space_touch(rng)
            key = resolve(x, y)
            if key == SPACE:
                events.append(["s", x, y])
            else:
                events.append(["k", key, x, y])
                damaged[position - 1] = damaged[position + 1] = "space-as-letter"
            continue
        if token in ",.?!":
            events.append(["p", token])
            if token in ".?!":
                sentence_start = True
            continue
        index = len(words)
        word_at[position] = index
        record = {"ref": token, "exact": True, "cognitive": False, "typed": "", "taps": 0, "mistaps": 0,
                  "noise": [], "sentenceStart": sentence_start}
        words.append(record)
        letters = token
        bare = token.lower()
        if p.cognitive and "'" not in token and bare in pool and rng.random() < p.cognitive:
            choice = rng.choice(pool[bare])
            letters = (choice[0].upper() + choice[1:]) if token[0].isupper() else choice
            record["cognitive"] = True
            record["exact"] = False
            record["noise"].append("misspelling")
        planned: list[str] = []
        for offset, character in enumerate(letters):
            if character == "'":
                if rng.random() < p.apostrophe_omit:
                    record["exact"] = False
                    record["noise"].append("apostrophe")
                else:
                    planned.append(character)
                continue
            if character.isupper() and not (sentence_start and offset == 0) and rng.random() < p.shift_skip:
                character = character.lower()
                record["noise"].append("shift")
            planned.append(character)
        if p.transpose:
            i = 0
            while i < len(planned) - 1:
                a, b = planned[i].lower(), planned[i + 1].lower()
                if a in CENTER and b in CENTER and typist.hand(a) != typist.hand(b) \
                        and a != b and rng.random() < p.transpose:
                    planned[i], planned[i + 1] = planned[i + 1], planned[i]
                    record["exact"] = False
                    record["noise"].append("transpose")
                    i += 2
                    continue
                i += 1
        for offset, character in enumerate(planned):
            if character == "'":
                events.append(["p", "'"])
                record["typed"] += "'"
                continue
            if offset > 0 and rng.random() < p.omit:
                record["exact"] = False
                record["noise"].append("omit")
                continue
            repeats = 2 if rng.random() < p.double else 1
            if repeats == 2:
                record["exact"] = False
                record["noise"].append("double")
            for _ in range(repeats):
                x, y = typist.touch(character.lower(), rng)
                key = resolve(x, y)
                record["taps"] += 1
                if key != character.lower():
                    record["exact"] = False
                    record["mistaps"] += 1
                    record["noise"].append("letter-as-space" if key == SPACE else "mistap")
                if key == SPACE:
                    events.append(["s", x, y])
                    record["typed"] += " "
                    continue
                emitted = key.upper() if character.isupper() else key
                events.append(["k", emitted, x, y])
                record["typed"] += emitted
        sentence_start = False
        events.append(["v", index])
    events.append(["s", *typist.clean_space(rng)])
    for position, kind in damaged.items():
        if position in word_at:
            words[word_at[position]]["exact"] = False
            words[word_at[position]]["noise"].append(kind)
    return {"events": events, "words": words}


def type_clean_sentence(sentence: str, typist: Typist, rng: random.Random) -> dict:
    tokens = WORD.findall(sentence)
    events: list[list] = []
    words: list[dict] = []
    sentence_start = True
    for token in tokens:
        if token == " ":
            events.append(["s", *typist.clean_space(rng)])
            continue
        if token in ",.?!":
            events.append(["p", token])
            sentence_start = sentence_start or token in ".?!"
            continue
        words.append({"ref": token, "exact": True, "cognitive": False, "typed": token, "sentenceStart": sentence_start})
        for character in token:
            if character == "'":
                events.append(["p", "'"])
                continue
            x, y = typist.clean_touch(character.lower(), rng)
            events.append(["k", character, x, y])
        sentence_start = False
        events.append(["v", len(words) - 1])
    events.append(["s", *typist.clean_space(rng)])
    return {"events": events, "words": words}


def type_clean_token(token: str, typist: Typist, rng: random.Random) -> list[list]:
    events: list[list] = []
    for character in token:
        if character == "'":
            events.append(["p", "'"])
            continue
        x, y = typist.clean_touch(character.lower(), rng)
        events.append(["k", character, x, y])
    events.append(["v", 0])
    events.append(["s", *typist.clean_space(rng)])
    return events


# ---------------------------------------------------------------- vulnerability

ADJACENT = {a: {b for b in CENTER if b != a and math.dist(CENTER[a], CENTER[b]) <= 1.15} for a in CENTER}


def slip_neighbors(word: str) -> set[str]:
    """Words one keyboard slip away: adjacent-key substitution, adjacent transposition,
    omission (the neighbour has one more letter) and an extra doubled or adjacent key."""
    found: set[str] = set()
    for i, letter in enumerate(word):
        for other in ADJACENT.get(letter, ()):
            found.add(word[:i] + other + word[i + 1:])
        if i + 1 < len(word) and word[i] != word[i + 1]:
            found.add(word[:i] + word[i + 1] + word[i] + word[i + 2:])
        before = word[i - 1] if i else ""
        after = word[i + 1] if i + 1 < len(word) else ""
        if letter == before or letter in ADJACENT.get(before, ()) or letter in ADJACENT.get(after, ()):
            found.add(word[:i] + word[i + 1:])
    for i in range(len(word) + 1):
        for letter in CENTER:
            found.add(word[:i] + letter + word[i:])
    found.discard(word)
    return found


def vulnerability(word: str, lexicon: set[str], counts: dict[str, int]) -> tuple[bool, str | None]:
    bare = word.lower()
    if not re.fullmatch(r"[a-z]+", bare):
        return False, None
    own = counts.get(bare, 0)
    best, best_count = None, 0
    for neighbor in slip_neighbors(bare):
        count = counts.get(neighbor, 0)
        if neighbor in lexicon and count >= 50 and count > own and count > best_count:
            best, best_count = neighbor, count
    return best is not None, best


# ---------------------------------------------------------------- sources

def train_sentences(path: Path) -> set[str]:
    found = set()
    for _, sentence in r1.sentences_from([path]):
        found.add(sentence.strip().casefold())
    return found


def eligible(sentence: str, scowl_lower: set[str], counts: dict[str, int]) -> bool:
    if not re.fullmatch(r"[A-Za-z][A-Za-z ',.?!]*", sentence) or "  " in sentence:
        return False
    if re.search(r"[,.?!]{2,}|\s[,.?!]|'(\s|$)|(^|\s)'", sentence):
        return False
    words = re.findall(r"[A-Za-z']+", sentence)
    if not 4 <= len(words) <= 20:
        return False
    if any(word.lower() in r1.APOSTROPHELESS or word.lower().replace("'", "") == "" for word in words):
        return False
    return not any(word.lower() not in scowl_lower and counts.get(word.lower(), 0) < 20 for word in words)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--fresh-conversations", type=Path, nargs="+", required=True, help="Topical-Chat valid_rare.json")
    parser.add_argument("--develop-conversations", type=Path, nargs="+", required=True, help="Topical-Chat test_freq.json test_rare.json (round-1 develop half)")
    parser.add_argument("--train", type=Path, required=True)
    parser.add_argument("--scowl", type=Path, required=True)
    parser.add_argument("--wikipedia", type=Path, required=True)
    parser.add_argument("--mitton", type=Path, required=True)
    parser.add_argument("--surnames", type=Path, required=True)
    parser.add_argument("--first-names", type=Path, nargs="+", required=True)
    parser.add_argument("--controls", type=Path, required=True, help="tap-r2 authored controls")
    parser.add_argument("--round1", type=Path, nargs="+", required=True, help="round-1 develop.json verify.json (exclusions)")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--sentences", type=int, default=1200)
    parser.add_argument("--clean", type=int, default=600)
    parser.add_argument("--adaptation", type=int, default=200)
    parser.add_argument("--misspellings", type=int, default=2500)
    parser.add_argument("--names", type=int, default=300)
    args = parser.parse_args()

    scowl_exact, scowl_lower = r1.load_words(args.scowl)
    lowercase_words = {word for word in scowl_exact if word == word.lower()}
    counts = r1.train_counts(args.train)
    contaminated = train_sentences(args.train)

    # What round 1 exposed: misspelling targets, injected misspellings, control tokens and sentences.
    seen_targets: set[str] = set()
    seen_controls: set[str] = set()
    seen_sentences: set[str] = set()
    for path in args.round1:
        manifest = json.load(path.open(encoding="utf-8"))
        seen_targets.update(item["expected"].lower() for item in manifest["misspellings"])
        for run in manifest["sentences"]:
            seen_sentences.add(run["reference"])
            seen_targets.update(word["ref"].lower() for word in run["words"] if word["cognitive"])
        seen_controls.update(item["token"].lower() for item in manifest["controls"])

    # Misspellings, filtered as in round 1. Targets round 1 never exposed go to the fresh split;
    # develop-r2 injects misspellings from the round-1 develop half minus every fresh target.
    pairs_seen: set[tuple[str, str]] = set()
    fresh_items: list[dict] = []
    develop_items: list[dict] = []
    for source, wrong, target in r1.load_misspellings(args.wikipedia, args.mitton):
        if not re.fullmatch(r"[A-Za-z']{2,}", wrong) or not re.fullmatch(r"[A-Za-z' ]{1,}", target):
            continue
        key = (wrong.lower(), target.lower())
        if key[0] == key[1] or key in pairs_seen:
            continue
        distance = r1.osa_distance(key[0], key[1])
        if distance > 3:
            continue
        pairs_seen.add(key)
        item = {"source": source, "input": wrong, "expected": target, "distance": distance,
                "realword": key[0] in scowl_lower}
        if key[1] not in seen_targets:
            fresh_items.append(item)
        elif r1.split_of(key[1]) == "develop":
            develop_items.append(item)
    fresh_targets = {item["expected"].lower() for item in fresh_items}
    develop_items = [item for item in develop_items if item["expected"].lower() not in fresh_targets]

    def pool_of(items: list[dict]) -> dict[str, list[str]]:
        pool: dict[str, list[str]] = {}
        for item in items:
            if not item["realword"] and "'" not in item["expected"] and " " not in item["expected"] \
                    and item["expected"] == item["expected"].lower() and "'" not in item["input"]:
                pool.setdefault(item["expected"], []).append(item["input"].lower())
        return pool

    def candidates(paths: list[Path], keep) -> tuple[list[str], list[str]]:
        test, adapt, used = [], [], set()
        for conversation, sentence in r1.sentences_from(paths):
            conversation_id = conversation.split(":", 1)[1]
            if not keep(conversation_id) or sentence in used or sentence.strip().casefold() in contaminated:
                continue
            if not eligible(sentence, scowl_lower, counts):
                continue
            used.add(sentence)
            (adapt if bucket("adapt:" + conversation_id) % 4 == 0 else test).append(sentence)
        return test, adapt

    fresh_test, fresh_adapt = candidates(args.fresh_conversations, lambda _: True)
    develop_test, develop_adapt = candidates(args.develop_conversations, lambda cid: r1.split_of(cid) == "develop")

    surnames, first_names = [], []
    import csv
    import zipfile
    with zipfile.ZipFile(args.surnames) as archive:
        with archive.open("Names_2010Census.csv") as handle:
            for row in csv.DictReader(line.decode() for line in handle):
                name = row["name"].title()
                if row["rank"].isdigit() and int(row["rank"]) <= 10000 and re.fullmatch(r"[A-Za-z]{3,}", name):
                    surnames.append(name)
    for path in args.first_names:
        for line in path.open():
            parts = line.split()
            if parts and int(parts[3]) <= 1000 and re.fullmatch(r"[A-Za-z]{3,}", parts[0]):
                first_names.append(parts[0].title())
    authored = []
    for line in args.controls.open(encoding="utf-8"):
        if line.startswith("#") or not line.strip():
            continue
        parts = line.rstrip("\n").split("\t")
        category, token = parts[0], parts[1]
        carrier = parts[2] + " " if len(parts) > 2 else None
        assert token.lower() not in seen_controls, token
        authored.append((category, token, carrier))

    thumbs = [Typist(persona) for persona in r1.PERSONAS]
    fields = [Typist(persona) for persona in FIELD_PERSONAS]
    args.output.mkdir(parents=True, exist_ok=True)
    plans = [
        ("fresh-verify", 91827364, fresh_test, fresh_adapt, thumbs + fields, fresh_items, True, 1),
        ("develop-r2", 52026101, develop_test, develop_adapt, thumbs, [], False, 0),
    ]
    for split, seed, test_pool, adapt_pool, typists, misspelling_items, with_names, control_half in plans:
        rng = random.Random(seed)
        pool = pool_of(fresh_items if split == "fresh-verify" else develop_items)
        chosen = sorted(set(test_pool))
        rng.shuffle(chosen)
        if split == "develop-r2":
            # Prefer sentences round 1 never used, then fall back to the rest.
            fresh_first = [s for s in chosen if s not in seen_sentences] + [s for s in chosen if s in seen_sentences]
            chosen = fresh_first
        noisy, clean = chosen[:args.sentences], chosen[args.sentences:args.sentences + args.clean]
        adapt = sorted(set(adapt_pool))
        rng.shuffle(adapt)
        adapt = adapt[:args.adaptation]
        assert len(noisy) == args.sentences and len(clean) == args.clean and len(adapt) == args.adaptation, \
            (split, len(chosen), len(adapt_pool))

        runs, clean_runs, adapt_runs = [], [], []
        for number, sentence in enumerate(noisy):
            for typist in typists:
                typed = type_sentence(sentence, typist, random.Random(f"{seed}:{number}:{typist.name}"), pool)
                runs.append({"id": f"s{number}-{typist.name}", "persona": typist.name, "reference": sentence, **typed})
        for number, sentence in enumerate(clean):
            flags = [vulnerability(word, lowercase_words, counts) for word in re.findall(r"[A-Za-z']+", sentence)]
            for typist in typists:
                typed = type_clean_sentence(sentence, typist, random.Random(f"{seed}:clean:{number}:{typist.name}"))
                for word, (vulnerable, neighbor) in zip(typed["words"], flags):
                    word["vulnerable"] = vulnerable
                    word["neighbor"] = neighbor
                clean_runs.append({"id": f"c{number}-{typist.name}", "persona": typist.name, "reference": sentence, **typed})
        for number, sentence in enumerate(adapt):
            for typist in typists:
                typed = type_sentence(sentence, typist, random.Random(f"{seed}:adapt:{number}:{typist.name}"), pool)
                adapt_runs.append({"id": f"a{number}-{typist.name}", "persona": typist.name, "reference": sentence, **typed})

        misspellings = []
        items = sorted(misspelling_items, key=lambda item: (item["expected"].lower(), item["input"]))
        rng.shuffle(items)
        per_target: dict[str, int] = {}
        per_source: dict[str, int] = {}
        for item in items:
            target = item["expected"].lower()
            if per_target.get(target, 0) >= 3 or per_source.get(item["source"], 0) >= r1.SOURCE_CAPS[item["source"]]:
                continue
            per_target[target] = per_target.get(target, 0) + 1
            per_source[item["source"]] = per_source.get(item["source"], 0) + 1
            typist = typists[len(misspellings) % len(typists)]
            taps = [typist.clean_touch(character.lower(), rng) if character != "'" else None for character in item["input"]]
            conversational = all(counts.get(part, 0) >= 50 for part in target.split())
            misspellings.append({"id": f"m{len(misspellings)}", **item, "persona": typist.name,
                                 "conversational": conversational, "taps": taps})
            if len(misspellings) >= args.misspellings:
                break

        controls = []

        def add(category: str, token: str, variant: str, carrier: str) -> None:
            typist = typists[len(controls) % len(typists)]
            controls.append({"id": f"c{len(controls)}", "category": category, "variant": variant, "prefix": carrier,
                             "token": token, "persona": typist.name, "events": type_clean_token(token, typist, rng)})
        if with_names:
            name_carriers = ["I saw ", "Did you call ", "say hi to ", "we met ", "thanks "]
            for category, names in [("surname", surnames), ("firstname", first_names)]:
                candidates_ = sorted({name for name in names if name.lower() not in lowercase_words
                                      and name.lower() not in seen_controls})
                rng.shuffle(candidates_)
                for number, name in enumerate(candidates_[:args.names]):
                    carrier = name_carriers[number % len(name_carriers)]
                    add(category, name, "cased", carrier)
                    add(category, name.lower(), "lowercase", carrier)
        word_carriers = ["", "so ", "honestly ", "and ", "with "]
        mine = [item for item in authored if bucket("control:" + item[1].lower()) % 2 == control_half]
        for number, (category, token, carrier) in enumerate(mine):
            add(category, token, "carrier" if carrier else "as-written",
                carrier if carrier is not None else word_carriers[number % len(word_carriers)])

        manifest = {
            "version": VERSION, "split": split, "seed": seed,
            "personas": [typist.describe() for typist in typists],
            "sentences": runs, "clean": clean_runs, "adaptation": adapt_runs,
            "misspellings": misspellings, "controls": controls,
        }
        path = args.output / f"{split}.json"
        path.write_text(json.dumps(manifest, separators=(",", ":")) + "\n")
        print(f"{split}: {len(noisy)} noisy + {len(clean)} clean + {len(adapt)} adaptation sentences x {len(typists)} personas "
              f"(candidates test {len(test_pool)} adapt {len(adapt_pool)}), {len(misspellings)} misspellings "
              f"({sum(not m['realword'] for m in misspellings)} nonword), {len(controls)} controls, "
              f"{sum(len(v) for v in pool.values())} pooled misspellings")
        clean_words = [w for run in clean_runs for w in run["words"]]
        print(f"  clean words {len(clean_words)}, vulnerable {sum(w['vulnerable'] for w in clean_words)}")
        for typist in typists:
            words = [word for run in runs if run["persona"] == typist.name for word in run["words"]]
            kinds: dict[str, int] = {}
            for word in words:
                for kind in set(word["noise"]):
                    kinds[kind] = kinds.get(kind, 0) + 1
            print(f"  {typist.name}: {sum(not w['exact'] for w in words)}/{len(words)} words inexact, "
                  f"{sum(w['mistaps'] for w in words)}/{sum(w['taps'] for w in words)} taps off-key; "
                  + ", ".join(f"{k} {v}" for k, v in sorted(kinds.items())))


if __name__ == "__main__":
    main()
