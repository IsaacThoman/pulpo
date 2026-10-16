"""Independent exposed mechanics fixtures; never implementation or useful intent claims.

All arithmetic is declared before candidate source. Superseded policy assertions
remain in protocol-assertions-v4-retained.json and the retained runner.
"""
import unicodedata


def update_retained(cases, localized):
    """Replace obsolete projection/mark oracles, preserving every existing input."""
    for case in cases:
        key = case["id"]
        if key.startswith("reserve-") and not key.endswith("-0"):
            localized[key] = [f"r34-local-{i:03d}" for i in range(case["limit"])]
        elif key.startswith("r40-v4-orphan-context-"):
            cap, index = map(int, key.rsplit("-", 2)[1:])
            localized[key] = [f"r40-v4-orphan-local-{i:03d}" for i in range(max(0, cap-(index == 1)))]
        elif key.startswith("r40-v4-mark-token-"):
            prefix = key.rsplit("-", 1)[0].replace("mark-token", "mark-token")
            label = prefix.rsplit("-", 1)[1]
            localized[key] = [f"r40-v4-mark-token-{label}-{i:03d}" for i in range(2)]
            case["forbidden"] = []
        elif key.startswith(("r40-v4-ignored-substrings-", "r40-v4-scalar-boundary-")) and not key.endswith("-0"):
            label = "ignored" if "ignored-substrings" in key else "scalar"
            localized[key] = [f"r40-v4-{label}-local-{i:03d}" for i in range(case["limit"])]
        elif key.startswith("r40-v4-retained-postings-"):
            localized[key] = [f"r40-v4-postings-local-{i:03d}" for i in range(max(0, case["limit"]-20))]
        elif key.startswith("r40-v4-exact-winner-"):
            cap, index = map(int, key.rsplit("-", 2)[1:])
            if index == 3:  # (ζ) changes X: no exact witness and no retained key.
                order = ([f"r40-v4-exact-English-{i:03d}" for i in range(20)] +
                         [f"r40-v4-exact-local-{i:03d}" for i in range(86)])
                localized[key] = order[:cap]
            else:
                localized[key] = [f"r40-v4-exact-local-{i:03d}" for i in range(max(0, cap-20))]
        if key in localized:
            # Baseline is independently declared by the original fixture code.
            # Empty combined expectations must replace obsolete nonempty ones.
            if localized[key]:
                case["acceptable"] = localized[key]; case["expectEmpty"] = False
            elif key.startswith(("r40-v4-exact-winner-", "r40-v4-retained-postings-")):
                if key.endswith(("-3", "-2")) and "exact-winner" in key:
                    case["acceptable"] = []; case["expectEmpty"] = True


def add_final_controls(add, groups):
    def entries(label, count, name, unique=True):
        return [{"emoji": f"r40-final-{label}-{i:03d}",
                 "name": name + (f" item{chr(97+i//26)}{chr(97+i%26)}" if unique else ""),
                 "keywords": []} for i in range(count)]

    def tranche(label, english, locals_, aliases, queries, reservations, legacy,
                order=None, preferred=None):
        wanted = [e["emoji"] for e in locals_] if order is None else order
        for cap in (1, 48, 60):
            ids = []
            for i, query in enumerate(queries):
                key = f"r40-final-{label}-{cap}-{i}"; ids.append(key)
                local, old = wanted[:max(0, cap-reservations[i])], legacy[i][:cap]
                add(key, query, action="fixture", values=old, local=local,
                    acceptable=local or old, expectEmpty=not (local or old),
                    entries=english + locals_, spanishAliases=aliases, limit=cap,
                    preferred=preferred or {}, family="exposed-capacity")
            groups.append({"ids": ids, "kind": "localized-suffix-only"})

    # Genuine mixed intent: red is English; corazón is Spanish. E is EMPTY,
    # because corazon lacks every English V prefix. No English-only reservation.
    mixed = entries("mixed-heart", 86, "red heart")
    aliases = [{"emoji": e["emoji"], "name": "corazón"} for e in mixed]
    for stratum, queries in (("mixed", ["red corazón", "corazón red", "RED CORA\u0301ZON RED"]),
                             ("es", ["corazón", "CORAZON", "cora\u0301zon cora\u0301zon"])):
        tranche("red-heart-" + stratum, [], mixed, aliases, queries, [0]*3, [[]]*3,
                preferred={mixed[-1]["emoji"]: 2})
    for cap in (1, 48, 60):
        add(f"r40-final-red-heart-en-{cap}", "red", action="fixture",
            values=[e["emoji"] for e in mixed[:cap]], local=[], entries=mixed,
            spanishAliases=aliases, limit=cap, family="exposed-capacity")

    # Generic internal-only non-ASCII capacity, including ñ and consonant marks
    # from each mark category. No special branch for any single alphabet.
    for label, letter, internal in (("enye", "ñ", "n"), ("Mc", "z\u093e", "z\u093e"),
                                    ("Me", "z\u20dd", "z"), ("Mn", "z\u034f", "z")):
        english = entries("internal-"+label, 73, "vex"+internal+"ara talumber")
        locals_ = entries("capacity-"+label, 86, "velvet lantern")
        aliases = [{"emoji": e["emoji"], "name": letter+"avela umber"} for e in locals_]
        queries = [letter+" umber", "umber "+letter, "umber "+letter+" umber",
                   unicodedata.normalize("NFD", letter.upper())+" UMBER"]
        tranche("internal-"+label, english, locals_, aliases, queries, [0]*4, [[]]*4,
                preferred={english[-1]["emoji"]: 2, locals_[-1]["emoji"]: 2})

    # Old orphan-Mn counterexample: same T=ñ, different W and therefore capacity.
    english = entries("iota-English", 7, "ιnbar")
    locals_ = entries("iota-local", 86, "velvet lantern")
    aliases = [{"emoji": e["emoji"], "name": "ñavoru"} for e in locals_]
    old = [e["emoji"] for e in english]
    tranche("orphan-iota", english, locals_, aliases,
            ["ñ", "\u0345ñ", "'\u0345ñ", "\u0345ñ \u0345ñ"], [0, 7, 0, 0], [[], old, [], []])

    # Orphan Mc changes raw legacy W and fallback, while T remains unchanged.
    english = entries("orphanMc-English", 7, "orchard amber")
    locals_ = entries("orphanMc-local", 86, "velvet lantern")
    aliases = [{"emoji": e["emoji"], "name": "orchard amber"} for e in locals_]
    old = [e["emoji"] for e in english]
    tranche("orphan-Mc", english, locals_, aliases,
            ["\u093eorchard amber", "amber \u093eorchard", "orchard amber", "amber orchard amber"],
            [0, 7, 7, 7], [[], old, old, old])

    # U+FF9E is Lm, not an orphan combining mark. Foundation's context-sensitive
    # fold changes W across an apostrophe, without changing Spanish eligibility.
    english = entries("FF9E-English", 7, "ﾞnbar")
    locals_ = entries("FF9E-local", 86, "velvet lantern")
    aliases = [{"emoji": e["emoji"], "name": "ﾞñavoru"} for e in locals_]
    old = [e["emoji"] for e in english]
    tranche("FF9E-context", english, locals_, aliases,
            ["ﾞñ", "'ﾞñ", "ﾞÑ", "'ﾞñ 'ﾞñ"], [7, 0, 7, 0], [old, [], old, []])

    # Final postings, compact names, keyword phrases, and exact folded names are
    # independent controls; capacity is not inferred from unbounded raw terms.
    for label, name, keyword, queries in (
        ("compact", "anchor beacon", [], ["anchorbe", "ANCHORBE", "anchorbe anchorbe"]),
        ("phrase", "the orchard amber", [], ["the orchard am", "am the orchard", "the orchard am the"]),
        ("keyword", "velvet lantern", ["the orchard amber"], ["the orchard am", "am the orchard", "the orchard am the"])):
        english = entries(label+"-English", 20, name, unique=False)
        for e in english: e["keywords"] = keyword
        locals_ = entries(label+"-local", 86, "velvet lantern")
        alias = "anchorbe" if label == "compact" else "the orchard amber"
        aliases = [{"emoji": e["emoji"], "name": alias} for e in locals_]
        # Exactly 12 retain postings. None of these queries has an exact-name
        # word-set witness, including the complete compact-query prefix.
        old = [e["emoji"] for e in english[:12]]
        # Repeated compact queries have no whole-query hit; fallback's English
        # searchWords omit compact forms, so their inherited row is empty.
        legacy = ([old, old, []] if label == "compact" else
                  [old, [], []] if label == "keyword" else [old]*3)
        tranche("bounded-"+label, english, locals_, aliases, queries, [12]*3, legacy)

    # Rejected v6 exact-name implication: whitespace collapse and orphan Mc
    # make normalized name/query word sets differ despite equal exact keys.
    for label, name, queries in (
        ("exact-Mc", "\u093ebar", ["\u093ebar", " \t\u093ebar\n", "\t\u093ebar\n"]),
        ("exact-musical", "\U0001d15ebar", ["\U0001d15ebar", "\U0001d157\U0001d165bar"])):
        english = entries(label+"-English", 7, name, unique=False)
        locals_ = entries(label+"-local", 86, "velvet lantern")
        aliases = [{"emoji": e["emoji"], "name": "bar"} for e in locals_]
        old = [[english[0]["emoji"]]]*len(queries)
        if label == "exact-Mc": old[0] = [e["emoji"] for e in english]
        tranche(label, english, locals_, aliases, queries, [7]*len(queries), old)
        for i, query in enumerate(queries):
            add(f"r40-final-{label}-EnglishOnly-{i}", query, action="fixture",
                values=old[i][:1], local=[], entries=english, limit=1,
                family="exposed-orthography")

