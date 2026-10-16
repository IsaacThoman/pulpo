# R18 sealed heldout authorship

Authored independently from ordinary everyday messaging scenarios. The only preexisting artifact read was the designated exclusions.json. No implementation, dictionary, tests, audit results, development prompts, other agents' work, or availability probes were inspected. No target was selected or discarded on guessed dictionary availability.

The corpus has 12 cases: four English, four Spanish, and four bilingual contexts. Language metadata is descriptive; every case is intended to run against all three actual stacks. Every target is an ordinary real word, distinct from all exclusions and other targets. Each final token is a literal target prefix with at least three remaining graphemes. Exactly three cases contain unchanged after text, including punctuation.

Acceptance oracle frozen before candidate/runner reveal: replace only the final literal prefix in before with target. Preserve all preceding text and all after text exactly. If after is empty, append one space. If after begins whitespace or punctuation, insert no extra space. If after begins another character, insert one separating space. This product-appropriate synthetic contract is fixed, regardless of observed engine behavior. Punctuation or spacing failures must remain failures; no oracle changes after reveal.

The following JSON freezes each expected full document. JSON escaping makes terminal spaces explicit when parsed, even though the pretty-printed string may visually end in a space.

```json
[
  {
    "id": "hold-01",
    "prefix": "blan",
    "expectedDocument": "Could you bring an extra blanket "
  },
  {
    "id": "hold-02",
    "prefix": "appo",
    "expectedDocument": "Please confirm my appointment, thanks."
  },
  {
    "id": "hold-03",
    "prefix": "lau",
    "expectedDocument": "I need to finish the laundry "
  },
  {
    "id": "hold-04",
    "prefix": "par",
    "expectedDocument": "There should be free parking "
  },
  {
    "id": "hold-05",
    "prefix": "bici",
    "expectedDocument": "Voy al trabajo en bicicleta."
  },
  {
    "id": "hold-06",
    "prefix": "far",
    "expectedDocument": "Voy a pasar por la farmacia "
  },
  {
    "id": "hold-07",
    "prefix": "cump",
    "expectedDocument": "No olvides mi cumpleaños "
  },
  {
    "id": "hold-08",
    "prefix": "servi",
    "expectedDocument": "Para la cena faltan servilletas "
  },
  {
    "id": "hold-09",
    "prefix": "bat",
    "expectedDocument": "Mi móvil needs a new battery "
  },
  {
    "id": "hold-10",
    "prefix": "carg",
    "expectedDocument": "Can you bring el cargador, por favor?"
  },
  {
    "id": "hold-11",
    "prefix": "air",
    "expectedDocument": "Te espero at the airport "
  },
  {
    "id": "hold-12",
    "prefix": "esta",
    "expectedDocument": "I left the car en el estacionamiento "
  }
]
```

heldout.json SHA256: dea3ae6f64ee681557961999c0ad28b71b28ea4aae100712886c688df05c2f4e

Keep both files sealed until the parent confirms candidate and runner freeze. No devices, builds, deployments, or source changes were used.
