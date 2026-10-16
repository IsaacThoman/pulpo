#!/usr/bin/env python3
"""Write our development fixtures only; never discover/read other case files.

Core and native fixtures differ only where the missing native document ID makes
automatic delivery unavailable. Literal complete-document oracles are explicit.
The errors fixture deliberately fails to prove that later operations continue.
"""
import json
from pathlib import Path


LANGUAGES = ("en_US", "es", "en_es")


def utf16(text):
    return len(text.encode("utf-16-le")) // 2


def field(identifier="none", route="native", keyboard="standard", secure=False):
    return dict(id=identifier, route=route, keyboard=keyboard, secure=secure)


def step(op, actual, caret=None, expect=None, **arguments):
    expected = dict(text=actual, selection=caret if caret is not None else [utf16(actual), 0])
    expected.update(expect or {})
    return dict(op=op, **arguments, expect=expected)


def variant(steps, initial="", selection=None, input_field=None):
    return dict(initialText=initial, selection=selection or [utf16(initial), 0],
                field=input_field or field(), steps=steps)


def allops(language, platform):
    word = "hola" if language == "es" else "hello"
    base = "😀 " + word
    automatic = base + " world" if platform == "core" else base
    confirmed = automatic + " again"
    initial_expect = dict(private=False, plain=True, totalCount=0, touchWeight=0,
                          allowsConfirmation=True, automaticCore=False, automaticNative=False)
    private_expect = dict(private=True, plain=False, suggestionsEmpty=True,
                          allowsConfirmation=False, automaticCore=False, automaticNative=False)
    steps = [
        step("destination", "", expect=initial_expect),
        step("automatic", "", text="blocked-before-origin",
             expect=dict(acceptedCore=False, acceptedNative=False)),
        step("type", word, text=word),
        step("capture", word, text=word, kind="literal"),
        step("choose", word + " ", expect=dict(knownCounts={word: 1}, totalCount=1)),
        step("space", word + "  "),
        step("delete", word + " "),
        step("insert", word + " X", text="X"),
        step("host", "😀 tail", [3, 4], text="😀 tail", selection=[3, 4], newIdentity=True,
             expect=dict(allowsConfirmation=False, automaticCore=False, automaticNative=False)),
        step("insert", base, text=word),
        step("guardOrigin", base, expect=dict(automaticCore=True, automaticNative=False)),
        step("destination", base, expect=dict(automaticCore=True, automaticNative=False)),
        step("automatic", automatic, text="world", expect=dict(acceptedCore=True, acceptedNative=False)),
        step("invalidateGuard", automatic, expect=dict(automaticCore=False, automaticNative=False)),
        step("destination", automatic),
        step("automatic", automatic, text="blocked-invalidated", expect=dict(acceptedCore=False, acceptedNative=False)),
        step("confirm", confirmed, text="again", expect=dict(acceptedCore=True, acceptedNative=True)),
        step("field", confirmed, field=field("password"), expect=private_expect),
        step("guardOrigin", confirmed, expect=private_expect),
        step("automatic", confirmed, text="blocked-private",
             expect=dict(**private_expect, acceptedCore=False, acceptedNative=False)),
        step("confirm", confirmed, text="blocked-private",
             expect=dict(**private_expect, acceptedCore=False, acceptedNative=False)),
        step("host", "P😀Q", [1, 2], text="P😀Q", selection=[1, 2], newIdentity=False),
        step("type", "P" + word + "Q", [1 + utf16(word), 0], text=word,
             expect=dict(totalCount=1, touchWeight=0)),
        step("space", "P" + word + " Q", [2 + utf16(word), 0]),
        step("delete", "P" + word + "Q", [1 + utf16(word), 0]),
    ]
    return variant(steps)


def choices(language, kind):
    if kind == "completion":
        token, choice = {"en_US": ("hel", "hello"), "es": ("hel", "helado"),
                         "en_es": ("hel", "helped")}[language]
    elif kind == "correction":
        token, choice = ("hols", "hola") if language == "es" else ("teh", "the")
    else:
        token, choice = "", ("no" if language != "en_US" else "the")
    steps = [] if not token else [step("type", token, text=token)]
    steps += [step("capture", token, text=choice, kind=kind),
              step("choose", choice + " ")]
    return variant(steps)


def learning(language, private):
    word = "hola" if language == "es" else "hello"
    typed = f"{word} {word} "
    return variant([step("type", typed, text=typed,
                         expect=dict(private=private, plain=not private,
                                     knownCounts={word: 0 if private else 2},
                                     totalCount=0 if private else 2,
                                     touchWeight=0 if private else 2 * len(word),
                                     touchPositive=not private))],
                   input_field=field("password") if private else field())


def errors(language):
    # Successful earlier capture, failed later capture and choose: the second
    # failure must clear the old choice, and all subsequent steps still execute.
    word = "hola" if language == "es" else "hello"
    steps = [step("destination", ""),
             step("choose", ""),
             step("invalidateGuard", ""),
             step("type", word, text=word),
             step("capture", word, text=word, kind="literal"),
             step("capture", word, text="r38-never-offered-choice", kind="completion"),
             step("choose", word),
             step("host", word, text="😀", selection=[1, 0], newIdentity=False),
             step("insert", word + "!", text="!"),
             # Missing acceptance declaration is an error even if the guard refuses.
             step("automatic", word + "!", text="blocked"),
             step("insert", word + "!?", text="?")]
    return variant(steps)


def main():
    audit = Path(__file__).resolve().parent
    for platform, name in [("core", "development-smoke.json"),
                           ("native", "development-smoke-native.json")]:
        cases = [dict(id="development-allops", intent="Execute every R38 operation, UTF16 selections and guard challenges",
                      languages={lang: allops(lang, platform) for lang in LANGUAGES})]
        for kind in ("completion", "correction", "prediction"):
            cases.append(dict(id="development-capture-" + kind, intent="Capture a real offered " + kind + " and choose it",
                              languages={lang: choices(lang, kind) for lang in LANGUAGES}))
        for private in [False, True]:
            cases.append(dict(id="development-learning-" + ("private" if private else "normal"),
                              intent="Literal commits with public word, pair and centered-tap readbacks",
                              languages={lang: learning(lang, private) for lang in LANGUAGES}))
        (audit / name).write_text(json.dumps(dict(version=1, cases=cases), ensure_ascii=False, indent=2) + "\n")
    case = dict(id="development-deliberate-errors", intent="Intentional failures; verify continued execution and cleared capture",
                languages={lang: errors(lang) for lang in LANGUAGES})
    (audit / "development-errors-smoke.json").write_text(
        json.dumps(dict(version=1, cases=[case]), ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
