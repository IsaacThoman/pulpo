# Quizzes and flashcards

Ask Pulpo to quiz you, or for practice questions or flashcards, and the reply can
include an interactive quiz. It works in every chat, with or without agent tools, on
web, desktop, and mobile.

## Taking a quiz

Pick an answer to lock it in. Pulpo marks it right or wrong and shows the explanation,
if the quiz has one. **Show hint** reveals a hint before you answer. You can move on
without answering, and the numbered dots jump to any question. A dot turns green or red
once its question is answered.

After the last question, Pulpo shows your score. **Send results** puts your score and
every missed or skipped question into the composer, so you can ask about them; nothing is
sent until you send it. **Retake** clears your answers; on web, **Review answers** goes
back through them, and on mobile the dots under the score do.

**Flashcards** shows one card at a time; select a card to flip it. A quiz without its
own flashcards makes one from each question and its answer.

Answers are kept while the app stays open, but not saved with the chat.

## Saving a quiz

A quiz can be saved to Files as a `.quiz` file, or downloaded (web) or shared (mobile).
Opening a `.quiz` file in Files, or as a chat attachment, shows the quiz. In agent mode the
assistant can also write `.quiz` files in its workspace and attach them or save them to
Files.

## The `.quiz` format

A quiz is JSON. In a reply it sits in a fenced code block whose language is `quiz`; a
`.quiz` file holds the same JSON.

```json
{
  "version": 1,
  "title": "Chapter 1: Security basics",
  "questions": [
    {
      "prompt": "Which cipher is unconditionally secure?",
      "options": ["AES", "One-time pad", "RSA"],
      "answer": 1,
      "hint": "Think about the key length.",
      "explanation": "A truly random key as long as the message, used once."
    }
  ],
  "cards": [{ "front": "X.800", "back": "Attacks, mechanisms, and services" }]
}
```

- `answer` is the zero-based index of the correct option. Each question has 2 to 8
  options and one correct answer.
- `title`, `hint`, `explanation`, `cards`, and `version` are optional. A quiz needs at
  least one question or card.
- Text may use Markdown and `$...$` math.

Pulpo skips questions or cards it can't use and shows the rest. A block with nothing
usable is shown as code. Up to 100 questions and 300 cards are shown.
