#!/usr/bin/env python3
"""Prepare a frozen tap-typing autocorrection benchmark outside the checkout.

The benchmark has three parts, written per split (develop / verify):

* sentences: held-out Topical-Chat sentences typed by simulated thumb personas.
  Every tap carries a touch coordinate in key-pitch units; the generator resolves
  each touch to the key a rectangular hit test would report, so mistaps, space
  bar hits, missed spaces, doubled, omitted and transposed letters, skipped
  apostrophes/shift and injected real human misspellings all arrive as the keys
  and touches the engine would see.
* misspellings: real human misspelling pairs (Wikipedia and Roger Mitton's
  corpora), typed with scatter that still resolves to the misspelled letters.
* controls: intended names, brands, slang, abbreviations, contractions, code and
  foreign words that should be kept as typed.

Splits are disjoint by conversation (sentences), by target word (misspellings)
and by token (controls). Nothing here reads the keyboard implementation.
Replay with `TapCorrectionBenchmarkTests` (PK_TAP_BENCH).
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import random
import re
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path

VERSION = "tap-correction-r1"
SALT = "tap-correction-r1:"

ROWS = [("qwertyuiop", 0.5), ("asdfghjkl", 1.0), ("zxcvbnm", 2.0)]
CENTER = {letter: (start + offset, float(row)) for row, (letters, start) in enumerate(ROWS)
          for offset, letter in enumerate(letters)}
LEFT_HAND = set("qwertasdfgzxcvb")
# Thumb pivots below the keyboard, in key-pitch units (rows grow downward).
THUMB_BASE = {"left": (-0.5, 5.0), "right": (10.5, 5.0), "one": (9.5, 5.5)}
SPACE = " "

APOSTROPHELESS = {
    "dont", "im", "ive", "didnt", "doesnt", "isnt", "wasnt", "arent", "thats", "theyre", "youre",
    "whats", "shouldnt", "couldnt", "wouldnt", "havent", "hasnt", "hadnt", "werent", "aint",
    "theres", "heres", "wheres", "whos", "youve", "weve", "theyve", "youll", "theyll", "itll",
    "hes", "shes", "id", "i", "u", "ur",
}


@dataclass(frozen=True)
class Persona:
    name: str
    sigma_x: float
    sigma_y: float
    undershoot: float
    down: float
    one_thumb: bool
    omit: float
    double: float
    transpose: float
    space_miss: float
    apostrophe_omit: float
    shift_skip: float
    cognitive: float


PERSONAS = [
    Persona("careful", 0.18, 0.14, 0.015, 0.04, False, 0.004, 0.002, 0.004, 0.008, 0.2, 0.1, 0.03),
    Persona("average", 0.22, 0.16, 0.020, 0.05, False, 0.010, 0.004, 0.010, 0.020, 0.5, 0.3, 0.05),
    Persona("sloppy", 0.26, 0.19, 0.022, 0.06, False, 0.020, 0.008, 0.020, 0.030, 0.8, 0.7, 0.05),
    Persona("one-thumb", 0.24, 0.18, 0.022, 0.05, True, 0.012, 0.004, 0.0, 0.020, 0.6, 0.5, 0.05),
]
SOURCE_CAPS = {"mitton-birkbeck": 1000, "wikipedia-current": 600, "mitton-wikipedia": 500,
               "mitton-holbrook": 400, "mitton-aspell": 400}


def split_of(key: str) -> str:
    digest = hashlib.sha256((SALT + key).encode()).digest()
    return "develop" if digest[0] % 2 == 0 else "verify"


def thumb_for(letter: str, persona: Persona) -> str:
    if persona.one_thumb:
        return "one"
    return "left" if letter in LEFT_HAND else "right"


def resolve(x: float, y: float) -> str:
    """The key a rectangular hit test reports. Keys are one pitch wide and one row tall."""
    if y > 2.5:
        if 2.5 <= x <= 7.5:
            return SPACE
        y = 2.0  # 123/globe or return keys: modelled as the nearest bottom-row letter.
    row = min(2, max(0, math.floor(y + 0.5)))
    letters, start = ROWS[row]
    return min(letters, key=lambda letter: abs(CENTER[letter][0] - x))


def touch(letter: str, persona: Persona, rng: random.Random) -> tuple[float, float]:
    cx, cy = CENTER[letter]
    bx, by = THUMB_BASE[thumb_for(letter, persona)]
    x = cx + persona.undershoot * (bx - cx) + rng.gauss(0, persona.sigma_x)
    y = cy + persona.undershoot * (by - cy) + persona.down + rng.gauss(0, persona.sigma_y)
    return round(x, 4), round(y, 4)


def space_touch(persona: Persona, rng: random.Random) -> tuple[float, float]:
    center = 6.0 if persona.one_thumb else 5.0
    return round(center + rng.gauss(0, 0.7), 4), round(2.9 + rng.gauss(0, persona.sigma_y), 4)


def clean_touch(letter: str, persona: Persona, rng: random.Random) -> tuple[float, float]:
    """Scatter conditioned on the touch registering the intended key."""
    for _ in range(64):
        point = touch(letter, persona, rng)
        if resolve(*point) == letter:
            return point
    return CENTER[letter]


def osa_distance(a: str, b: str) -> int:
    previous2: list[int] | None = None
    previous = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        current = [i] + [0] * len(b)
        for j in range(1, len(b) + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            current[j] = min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
            if previous2 is not None and i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                current[j] = min(current[j], previous2[j - 2] + 1)
        previous2, previous = previous, current
    return previous[len(b)]


# ---------------------------------------------------------------- sources

def load_words(path: Path) -> tuple[set[str], set[str]]:
    exact = {line.strip() for line in path.open(encoding="utf-8") if line.strip()}
    return exact, {word.lower() for word in exact}


def load_misspellings(wikipedia: Path, mitton: Path) -> list[tuple[str, str, str]]:
    pairs: list[tuple[str, str, str]] = []
    for name in ["aspell.dat", "wikipedia.dat", "holbrook-missp.dat", "missp.dat"]:
        target = None
        source = "birkbeck" if name == "missp.dat" else name.split(".")[0].replace("-missp", "")
        for raw in (mitton / name).open(encoding="latin-1"):
            line = raw.strip()
            if not line:
                continue
            if line.startswith("$"):
                target = line[1:].replace("_", " ")
                continue
            if target is None:
                continue
            pairs.append(("mitton-" + source, line.split()[0], target))
    for raw in wikipedia.open(encoding="utf-8"):
        match = re.fullmatch(r"\s*([^\s>]+)->(.+)", raw.rstrip("\n"))
        if not match:
            continue
        targets = [part.strip() for part in match.group(2).split(",")]
        if len(targets) == 1:
            pairs.append(("wikipedia-current", match.group(1), targets[0]))
    return pairs


def sentences_from(paths: list[Path]) -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    for path in paths:
        data = json.load(path.open(encoding="utf-8"))
        for conversation_id in sorted(data):
            for turn in data[conversation_id]["content"]:
                message = turn["message"].replace("’", "'").strip()
                for sentence in re.split(r"(?<=[.!?])\s+", message):
                    found.append((path.stem + ":" + conversation_id, sentence.strip()))
    return found


def train_counts(path: Path) -> dict[str, int]:
    counts: dict[str, int] = {}
    data = json.load(path.open(encoding="utf-8"))
    for conversation in data.values():
        for turn in conversation["content"]:
            for token in re.findall(r"[A-Za-z']+", turn["message"].replace("’", "'")):
                key = token.lower()
                counts[key] = counts.get(key, 0) + 1
    return counts


# ---------------------------------------------------------------- typing simulation

WORD = re.compile(r"[A-Za-z']+|[,.?!]| ")


def type_sentence(sentence: str, persona: Persona, rng: random.Random, pool: dict[str, list[str]]) -> dict:
    """Events: ["k", char, x, y] letter tap (uppercase = shift intended), ["s"] space,
    ["p", char] punctuation, ["v", index] read the bar for intended word `index`."""
    tokens = WORD.findall(sentence)
    assert "".join(tokens) == sentence, sentence
    events: list[list] = []
    words: list[dict] = []
    word_at: dict[int, int] = {}
    damaged: set[int] = set()
    sentence_start = True
    for position, token in enumerate(tokens):
        if token == " ":
            if rng.random() < persona.space_miss:
                damaged.update({position - 1, position + 1})
                continue
            x, y = space_touch(persona, rng)
            key = resolve(x, y)
            if key == SPACE:
                events.append(["s"])
            else:
                events.append(["k", key, x, y])
                damaged.update({position - 1, position + 1})
            continue
        if token in ",.?!":
            events.append(["p", token])
            if token in ".?!":
                sentence_start = True
            continue
        index = len(words)
        word_at[position] = index
        record = {"ref": token, "exact": True, "cognitive": False, "typed": "", "taps": 0, "mistaps": 0}
        words.append(record)
        letters = token
        bare = token.lower()
        if persona.cognitive and "'" not in token and bare in pool and rng.random() < persona.cognitive:
            choice = rng.choice(pool[bare])
            letters = (choice[0].upper() + choice[1:]) if token[0].isupper() else choice
            record["cognitive"] = True
            record["exact"] = False
        planned: list[str] = []
        for offset, character in enumerate(letters):
            if character == "'":
                if rng.random() < persona.apostrophe_omit:
                    record["exact"] = False
                else:
                    planned.append(character)
                continue
            if character.isupper() and not (sentence_start and offset == 0) and rng.random() < persona.shift_skip:
                character = character.lower()
            planned.append(character)
        # Rolling two-thumb transpositions.
        if persona.transpose:
            i = 0
            while i < len(planned) - 1:
                a, b = planned[i].lower(), planned[i + 1].lower()
                if a in CENTER and b in CENTER and thumb_for(a, persona) != thumb_for(b, persona) \
                        and a != b and rng.random() < persona.transpose:
                    planned[i], planned[i + 1] = planned[i + 1], planned[i]
                    record["exact"] = False
                    i += 2
                    continue
                i += 1
        for offset, character in enumerate(planned):
            if character == "'":
                events.append(["p", "'"])
                record["typed"] += "'"
                continue
            if offset > 0 and rng.random() < persona.omit:
                record["exact"] = False
                continue
            repeats = 2 if rng.random() < persona.double else 1
            if repeats == 2:
                record["exact"] = False
            for _ in range(repeats):
                x, y = touch(character.lower(), persona, rng)
                key = resolve(x, y)
                record["taps"] += 1
                if key != character.lower():
                    record["exact"] = False
                    record["mistaps"] += 1
                if key == SPACE:
                    events.append(["s"])
                    record["typed"] += " "
                    continue
                emitted = key.upper() if character.isupper() else key
                events.append(["k", emitted, x, y])
                record["typed"] += emitted
        sentence_start = False
        events.append(["v", index])
    # Commit the final word or punctuation.
    events.append(["s"])
    # A missed or mistyped space damages the words on both sides.
    for position in damaged:
        if position in word_at:
            words[word_at[position]]["exact"] = False
    return {"events": events, "words": words}


def type_clean(token: str, persona: Persona, rng: random.Random) -> list[list]:
    events: list[list] = []
    for character in token:
        if character == "'":
            events.append(["p", "'"])
            continue
        x, y = clean_touch(character.lower(), persona, rng)
        events.append(["k", character, x, y])
    events.append(["v", 0])
    events.append(["s"])
    return events


# ---------------------------------------------------------------- main

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--conversations", type=Path, nargs="+", required=True, help="Topical-Chat test_freq.json test_rare.json")
    parser.add_argument("--train", type=Path, required=True, help="Topical-Chat train.json (reference vocabulary filter only)")
    parser.add_argument("--scowl", type=Path, required=True, help="Independent word list, one word per line")
    parser.add_argument("--wikipedia", type=Path, required=True, help="Wikipedia 'Lists of common misspellings/For machines' wikitext")
    parser.add_argument("--mitton", type=Path, required=True, help="Directory with aspell.dat wikipedia.dat holbrook-missp.dat missp.dat")
    parser.add_argument("--surnames", type=Path, required=True, help="Census 2010 names.zip")
    parser.add_argument("--first-names", type=Path, nargs="+", required=True, help="Census 1990 dist.*.first")
    parser.add_argument("--controls", type=Path, required=True, help="category<TAB>token authored control list")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--sentences", type=int, default=600)
    parser.add_argument("--misspellings", type=int, default=2500)
    parser.add_argument("--names", type=int, default=300)
    args = parser.parse_args()

    scowl_exact, scowl_lower = load_words(args.scowl)
    lowercase_words = {word for word in scowl_exact if word == word.lower()}
    counts = train_counts(args.train)

    # Real misspellings: nonword errors are the correction target; real-word errors are reported apart.
    seen: set[tuple[str, str]] = set()
    by_split: dict[str, list[dict]] = {"develop": [], "verify": []}
    for source, wrong, target in load_misspellings(args.wikipedia, args.mitton):
        if not re.fullmatch(r"[A-Za-z']{2,}", wrong) or not re.fullmatch(r"[A-Za-z' ]{1,}", target):
            continue
        key = (wrong.lower(), target.lower())
        if key[0] == key[1] or key in seen:
            continue
        distance = osa_distance(key[0], key[1])
        if distance > 3:
            continue
        seen.add(key)
        realword = key[0] in scowl_lower
        by_split[split_of(key[1])].append({"source": source, "input": wrong, "expected": target,
                                           "distance": distance, "realword": realword})
    pools: dict[str, dict[str, list[str]]] = {"develop": {}, "verify": {}}
    for split, items in by_split.items():
        for item in items:
            if not item["realword"] and "'" not in item["expected"] and " " not in item["expected"] \
                    and item["expected"] == item["expected"].lower() and "'" not in item["input"]:
                pools[split].setdefault(item["expected"], []).append(item["input"].lower())

    sentences = sentences_from(args.conversations)
    candidates: dict[str, list[str]] = {"develop": [], "verify": []}
    used: set[str] = set()
    for conversation, sentence in sentences:
        if sentence in used or not re.fullmatch(r"[A-Za-z][A-Za-z ',.?!]*", sentence) or "  " in sentence:
            continue
        if re.search(r"[,.?!]{2,}|\s[,.?!]|'(\s|$)|(^|\s)'", sentence):
            continue
        words = re.findall(r"[A-Za-z']+", sentence)
        if not 4 <= len(words) <= 20:
            continue
        if any(word.lower() in APOSTROPHELESS or word.lower().replace("'", "") == "" for word in words):
            continue
        if any(word.lower() not in scowl_lower and counts.get(word.lower(), 0) < 20 for word in words):
            continue
        used.add(sentence)
        candidates[split_of(conversation.split(":", 1)[1])].append(sentence)

    surnames = []
    with zipfile.ZipFile(args.surnames) as archive:
        with archive.open("Names_2010Census.csv") as handle:
            for row in csv.DictReader(line.decode() for line in handle):
                name = row["name"].title()
                if row["rank"].isdigit() and int(row["rank"]) <= 10000 and re.fullmatch(r"[A-Za-z]{3,}", name):
                    surnames.append(name)
    first_names = []
    for path in args.first_names:
        for line in path.open():
            parts = line.split()
            if parts and int(parts[3]) <= 1000 and re.fullmatch(r"[A-Za-z]{3,}", parts[0]):
                first_names.append(parts[0].title())
    authored = []
    for line in args.controls.open(encoding="utf-8"):
        if line.startswith("#") or not line.strip():
            continue
        category, token = line.rstrip("\n").split("\t")
        authored.append((category, token))

    args.output.mkdir(parents=True, exist_ok=True)
    persona_by_name = {persona.name: persona for persona in PERSONAS}
    for split, seed in [("develop", 20261014), ("verify", 41101620)]:
        rng = random.Random(seed)
        chosen = sorted(candidates[split])
        rng.shuffle(chosen)
        chosen = chosen[:args.sentences]
        runs = []
        for number, sentence in enumerate(chosen):
            for persona in PERSONAS:
                typed = type_sentence(sentence, persona, random.Random(f"{seed}:{number}:{persona.name}"), pools[split])
                runs.append({"id": f"s{number}-{persona.name}", "persona": persona.name, "reference": sentence, **typed})

        average = persona_by_name["average"]
        items = sorted(by_split[split], key=lambda item: (item["expected"].lower(), item["input"]))
        rng.shuffle(items)
        per_target: dict[str, int] = {}
        per_source: dict[str, int] = {}
        misspellings = []
        for item in items:
            target = item["expected"].lower()
            if per_target.get(target, 0) >= 3 or per_source.get(item["source"], 0) >= SOURCE_CAPS[item["source"]]:
                continue
            per_target[target] = per_target.get(target, 0) + 1
            per_source[item["source"]] = per_source.get(item["source"], 0) + 1
            taps = [clean_touch(character.lower(), average, rng) if character != "'" else None for character in item["input"]]
            conversational = all(counts.get(part, 0) >= 50 for part in target.split())
            misspellings.append({"id": f"m{len(misspellings)}", **item, "conversational": conversational, "taps": taps})
            if len(misspellings) >= args.misspellings:
                break

        controls = []
        def add(category: str, token: str, variant: str, carrier: str) -> None:
            controls.append({"id": f"c{len(controls)}", "category": category, "variant": variant, "prefix": carrier,
                             "token": token, "events": type_clean(token, average, rng)})
        name_carriers = ["I talked to ", "Have you met ", "tell ", "I was with ", "ask "]
        word_carriers = ["", "it's ", "just ", "lol ", "I use "]
        for category, names in [("surname", surnames), ("firstname", first_names)]:
            pool = sorted({name for name in names if split_of(name.lower()) == split and name.lower() not in lowercase_words})
            rng.shuffle(pool)
            for number, name in enumerate(pool[:args.names]):
                carrier = name_carriers[number % len(name_carriers)]
                add(category, name, "cased", carrier)
                add(category, name.lower(), "lowercase", carrier)
        for number, (category, token) in enumerate(item for item in authored if split_of(item[1].lower()) == split):
            add(category, token, "as-written", word_carriers[number % len(word_carriers)])

        manifest = {
            "version": VERSION, "split": split, "seed": seed,
            "personas": [asdict(persona) for persona in PERSONAS],
            "sentences": runs, "misspellings": misspellings, "controls": controls,
        }
        path = args.output / f"{split}.json"
        path.write_text(json.dumps(manifest, separators=(",", ":")) + "\n")
        print(f"{split}: {len(chosen)} sentences x {len(PERSONAS)} personas, {len(misspellings)} misspellings "
              f"({sum(not m['realword'] for m in misspellings)} nonword), {len(controls)} controls, "
              f"{len(candidates[split])} candidate sentences, {sum(len(v) for v in pools[split].values())} pooled misspellings")
        for persona in PERSONAS:
            subset = [run for run in runs if run["persona"] == persona.name]
            words = [word for run in subset for word in run["words"]]
            print(f"  {persona.name}: {sum(not w['exact'] for w in words)}/{len(words)} words typed inexactly, "
                  f"{sum(w['mistaps'] for w in words)}/{sum(w['taps'] for w in words)} letter taps off-key, "
                  f"{sum(w['cognitive'] for w in words)} real misspellings injected")


if __name__ == "__main__":
    main()
