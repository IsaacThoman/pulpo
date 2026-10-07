#if DEBUG
import Foundation

extension MockServer {
    struct Reply {
        let text: String
        let reasoning: String?
    }

    static func reply(to prompt: String) -> Reply {
        let lowered = prompt.lowercased()
        if lowered.contains("kv cach") { return Reply(text: kvReply, reasoning: "Compare attention with and without a cache, then show the complexity difference.") }
        if lowered.contains("haiku") {
            return Reply(text: "Eight arms in the dark,\nink blooms where the current turns —\nthe reef keeps its secrets.", reasoning: nil)
        }
        if lowered.contains("table") || lowered.contains("compare") { return Reply(text: tableReply, reasoning: nil) }
        if lowered.contains("movie") { return Reply(text: movieReply, reasoning: "Pick a crowd-pleasing lineup, then snacks and lighting.") }
        if lowered.contains("long") || lowered.contains("essay") { return Reply(text: longReply, reasoning: nil) }
        return Reply(text: "Here’s a quick answer to “\(prompt)”.\n\nI’m the **Pulpo mock server**, so this reply is canned — but it streams just like a real model would, word by word, over the realtime connection.", reasoning: nil)
    }

    static let checklistReply = """
    ## Before you ship

    1. **Focus everywhere.** Every screen should be fully usable with the Siri Remote alone. Nothing should be reachable only by touch.
    2. **Safe areas.** Keep text 60 pt from the top and bottom and 80 pt from the sides.
    3. **Legible type.** Body text at 29 pt or larger reads well from the couch.
    4. **Top Shelf.** Provide both the standard and wide Top Shelf images.

    ```swift
    Button("Play") { play() }
        .buttonStyle(.card)
        .focused($focus, equals: .play)
    ```

    > Test on a real television. The simulator can hide motion and contrast problems.
    """

    static let ramenReply = """
    ### 20-minute miso ramen

    - 2 packs fresh ramen noodles
    - 4 cups chicken or vegetable stock
    - 2 tbsp white miso
    - 1 tbsp soy sauce
    - 2 soft-boiled eggs, scallions, chili crisp

    Warm the stock, whisk in the miso and soy off the heat, then pour over the cooked noodles. Top with a halved egg, sliced scallions, and as much chili crisp as you dare.
    """

    static let kvReply = """
    When a transformer generates text, each new token attends to **every previous token**. Without a cache, the model recomputes the keys and values for the whole prefix at every step.

    A **KV cache** stores those keys and values once, so each step only computes them for the newest token:

    | | Without cache | With cache |
    |---|:---:|:---:|
    | Work per new token | O(n²) | O(n) |
    | Memory | Low | Grows with context |
    | Typical speedup | — | 5–10× |

    The trade-off is memory: long conversations need a large cache, which is why long-context serving leans on tricks like paged attention.
    """

    static let tableReply = """
    | Fund type | Holdings | Expense ratio | Best for |
    |:--|--:|--:|:--|
    | Total market | ~3,700 | 0.03% | Maximum diversification |
    | S&P 500 | 500 | 0.03% | Large-cap focus |
    | Nasdaq-100 | 100 | 0.20% | Tech-heavy growth |

    Both broad funds have nearly identical long-run returns; total market adds small- and mid-caps for a little extra diversification.
    """

    static let movieReply = """
    ## Cozy movie night for four 🍿

    **The lineup**
    1. *Paddington 2* — warm, funny, universally loved
    2. *The Grand Budapest Hotel* — gorgeous and whimsical
    3. *Knives Out* — a twisty finale to end on

    **Snacks:** stovetop popcorn with brown butter, a cheese board, and hot cocoa.

    **Setting:** dim the lights, pile up blankets, and turn on *Reduce Loud Sounds* in Apple TV settings for late nights.
    """

    static let longReply = (1...12).map { index in
        "Paragraph \(index). Television interfaces are navigated by focus, so every long reply is split into screen-sized pieces. Swipe up and down on the remote to move through them one at a time, and the transcript scrolls to follow."
    }.joined(separator: "\n\n")
}
#endif
