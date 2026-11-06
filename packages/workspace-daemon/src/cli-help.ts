/** Help is written for the agent model reading it in a bash tool result: short, concrete, example-led. */
export const FILES_HELP = `Usage: pulpo files <command> [options]

Read and change the user's Pulpo Files that are attached to this chat.
Files paths look like "Projects/Plan.md" (no leading slash; names are
case-insensitive). Some files are live documents that people may be editing
in Pulpo while you work: Markdown (.md), text or code files (.txt, .py,
.json, .html, …), Jupyter notebooks (.ipynb), spreadsheets (.xlsx, .xlsm, .xltx, .csv, .tsv), Word documents (.docx), and PowerPoint decks (.pptx). You still pull and push
them as ordinary files, and your push merges with their edits. Other files
are stored as uploaded bytes.

Browse:
  ls [path] [-R]                list a folder (-R: include subfolders)
  tree [path] [--depth N]       show the folder tree (default depth 3, max 8)
  cat <path>...                 print documents or text files
  grep [-i] [-F] <pattern> [path]
                                search text (JavaScript regex; -F literal, -i ignore case)
Change:
  pull <path> [dest]            copy into /workspace/files/<path> (or dest) to work on it
  status                        show local changes to pulled files (no network)
  push [local...] [--to <path>] [--force]
                                save local changes and new files back to Files
  mkdir [-p] <path>...          create folders
  mv <from> <to>                move or rename
  rm [-r] <path>...             move to the trash (-r for folders)
  convert <path> --to <format> [--output <path>]
                                converted copy of an office file (docx, xlsx, pptx, pdf)

Edit a document or file:
  pulpo files pull Projects/Plan.md
  (edit /workspace/files/Projects/Plan.md with your usual tools)
  pulpo files push
Office files work the same way: edit a pulled .docx with python-docx, .xlsx
with openpyxl (keep_vba=True for .xlsm), or .pptx with python-pptx, save it in place, then push. For a
.docx, change the paragraphs, runs, and tables you mean to and leave the rest:
styles, comments, tracked changes, headers, and pictures you don't touch are
kept, and only what differs is merged into the live document.

For a .pptx, change only the slides and shapes you mean to (python-pptx keeps their
ids, which is how your push merges with people editing other slides); \`cat\`
prints each slide's text, tables, chart data, and speaker notes.

Run a notebook: pull it, execute it in place, and push the outputs back.
  pulpo files pull Projects/analysis.ipynb
  jupyter nbconvert --to notebook --execute --inplace /workspace/files/Projects/analysis.ipynb
  pulpo files push
Edit notebooks with nbformat (or as JSON), not by rewriting them by hand;
cells keep their ids, so your push merges with people editing other cells.

Edit .csv and .tsv as text. Pulpo recalculates spreadsheet formulas after a push;
openpyxl leaves formula references alone when you insert or delete rows,
so fix formulas that point across them yourself.

Create a file: write it under /workspace/files/<folder>/ and run
\`pulpo files push\`, or push any workspace file to a chosen path:
  pulpo files push /workspace/report.pdf --to Projects/report.pdf

Each attached item is read only, suggest (your changes wait for the user to
accept them) or write (changes apply right away). Commands report which
happened. Run \`pulpo files <command> --help\` for details.
`

export const COMMAND_HELP = {
  ls: `Usage: pulpo files ls [path] [-R]

List a folder in Files; without a path, list everything attached to this chat.
Pending changes are marked (for example "suggested, not accepted yet").
  -R, -r, --recursive   include subfolders

Examples:
  pulpo files ls
  pulpo files ls Projects -R
`,
  tree: `Usage: pulpo files tree [path] [--depth N]

Show the folder tree under path (default: everything attached to this chat).
  -L, --depth N   levels to show (default 3, max 8)

Example:
  pulpo files tree Projects --depth 2
`,
  cat: `Usage: pulpo files cat <path>...

Print documents or text files: Markdown documents as Markdown, other live
documents as their plain text. Spreadsheets print each sheet's values as tab-separated lines followed by formulas. Notebooks print as readable text: each cell
under a "# %% [code] cell 3 · In [2] · id …" line, with outputs summarized as
comments (pull the .ipynb for the real file). Word documents print with list numbers, headings, tables, footnotes, and comments. Documents show pending
suggestions as if they were accepted. Binary or very large files cannot be printed: pull them and
inspect the local copy instead.

Example:
  pulpo files cat Projects/Plan.md
`,
  grep: `Usage: pulpo files grep [-i] [-F] <pattern> [path]

Search the text of documents and text files under path (default: everything
attached to this chat). Prints "path:line: text" for each match.
  -i, --ignore-case     ignore case
  -F, --fixed-strings   match the pattern literally instead of as a JavaScript regex
Put \`--\` before a pattern that starts with "-".

Examples:
  pulpo files grep -i budget Projects
  pulpo files grep -F "total (net)"
`,
  pull: `Usage: pulpo files pull <path> [dest]

Copy a file or folder from Files into the workspace so you can read or edit it
with normal tools. The default destination is /workspace/files/<path>; an
existing directory given as dest receives the item inside it. Markdown
documents arrive as Markdown (.md); other live documents arrive as the real
file (a .py stays a .py). Pulling again overwrites the local copies.
Limits: 1000 files and 500 MiB per pull.

Examples:
  pulpo files pull Projects/Plan.md
  pulpo files pull Projects
  pulpo files pull Data/sales.csv /tmp/sales.csv
`,
  status: `Usage: pulpo files status

Compare local copies with what you last pulled or pushed, without contacting
Pulpo. Lists modified pulled files, new files under /workspace/files (names
starting with "." are ignored) and pulled files deleted locally.
`,
  push: `Usage: pulpo files push [local...] [--to <path>] [--force]

Save local files back to Files. Without arguments, pushes every modified or new
file under /workspace/files plus modified pulled files elsewhere. Pulled files
go back where they came from; a new file at /workspace/files/<path> is created
at <path>. Directories are pushed recursively (changed and new files only).
  --to <path>     Files destination for one local file (end it with / to keep the file name)
  -f, --force     overwrite the item even if it changed in Files since you pulled it

Each file reports created, updated, suggested (waiting for the user to accept),
unchanged, conflict, denied or error. A conflict means the item changed in
Files after you pulled it. Deleting a local copy never deletes anything in
Files; use \`pulpo files rm\` for that.

Examples:
  pulpo files push
  pulpo files push /workspace/files/Projects/Plan.md
  pulpo files push chart.png --to Projects/
`,
  mkdir: `Usage: pulpo files mkdir [-p] <path>...

Create folders in Files.
  -p, --parents   also create missing parent folders

Example:
  pulpo files mkdir -p Projects/2026/Q3
`,
  mv: `Usage: pulpo files mv <from> <to>

Move or rename an item in Files. If <to> is an existing folder, the item moves
into it and keeps its name; otherwise <to> is the new path and its parent
folder must exist. Unchanged local copies of the old path are removed; pull the
new path to keep working on it.

Examples:
  pulpo files mv Projects/Draft.md Projects/Plan.md
  pulpo files mv Notes.md Archive
`,
  convert: `Usage: pulpo files convert <path> --to <format> [--output <path>]

Make a converted copy of an office file in Files. The original stays as it is.
  -t, --to <format>     docx, xlsx, pptx, or pdf
  -o, --output <path>   Files path for the copy (must not exist yet); by default
                        it goes beside the original as "<name>.<format>", or
                        "<name> (2).<format>" when that is taken

Converts legacy Microsoft Office (.doc, .xls, .ppt, .pps), OpenDocument (.odt,
.ods, .odp and templates), RTF, WordPerfect (.wpd), Apple iWork (.pages,
.numbers, .key) and Office templates (.dotx, .xltx, .potx) to the matching
docx/xlsx/pptx, and any of those or docx/xlsx/pptx to PDF. The copy is created
like a pushed file: in suggest mode it waits for the user to accept it.
Password-protected files cannot be converted.

To convert files in your workspace instead, use LibreOffice directly:
  soffice --headless --convert-to docx --outdir /workspace/out file.doc

Examples:
  pulpo files convert Projects/Budget.xls --to xlsx
  pulpo files convert Projects/Deck.pptx --to pdf --output Projects/Deck.pdf
`,
  rm: `Usage: pulpo files rm [-r] <path>...

Move items to the trash in Files; the user can restore them. Folders need -r.
Unchanged local copies under /workspace/files are removed too.
  -r, -R, --recursive   remove folders and their contents

Example:
  pulpo files rm -r Projects/Old
`,
} as const

export type CommandName = keyof typeof COMMAND_HELP
