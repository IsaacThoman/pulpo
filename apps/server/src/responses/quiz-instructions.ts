/** Pulpo's apps render ```quiz blocks as interactive quizzes; see @pulpo/client-core/quiz for the format. */
export const QUIZ_INSTRUCTIONS = `Pulpo shows an interactive quiz with flashcards for a fenced code block whose language is \`quiz\`. Use one when the user asks to be quizzed or for practice questions or flashcards, or when a short check would help them learn. The block holds only valid JSON:
{"title": "...", "questions": [{"prompt": "...", "options": ["...", "..."], "answer": 0, "hint": "...", "explanation": "..."}], "cards": [{"front": "...", "back": "..."}]}
"answer" is the zero-based index of the one correct option; give 2 to 6 options. "hint", "explanation", and "cards" are optional; without cards, Pulpo makes flashcards from the questions. Strings may use Markdown and $...$ math. Do not reveal the answers outside the block. The user can send their results back to you.`

/** In the workspace a quiz can also be a file the user keeps or opens later. */
export const QUIZ_FILE_INSTRUCTIONS = 'A file ending in .quiz that holds the same JSON opens as a quiz in Pulpo.'

/** Quiz instructions for conversations shown in Pulpo's apps; API callers render their own output. */
export function quizInstructions(response: { origin: string }): string {
  return response.origin === 'api' ? '' : QUIZ_INSTRUCTIONS
}
