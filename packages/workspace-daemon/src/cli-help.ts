/** Help is written for the agent model reading it in a bash tool result: short, concrete, example-led. */
export const FILES_HELP = `Usage: pulpo files <command> [options]

Read and change the user's Pulpo Files that are attached to this chat.
Files paths look like "Projects/Plan.md" (no leading slash; names are
case-insensitive). Markdown documents (.md) are live documents in Pulpo; other
files are stored as uploaded bytes.

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

Edit a document or file:
  pulpo files pull Projects/Plan.md
  (edit /workspace/files/Projects/Plan.md with your usual tools)
  pulpo files push

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

Print documents (as Markdown) or text files. Documents show pending suggestions
as if they were accepted. Binary or very large files cannot be printed: pull
them and inspect the local copy instead.

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
existing directory given as dest receives the item inside it. Documents arrive
as Markdown (.md). Pulling again overwrites the local copies.
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
  rm: `Usage: pulpo files rm [-r] <path>...

Move items to the trash in Files; the user can restore them. Folders need -r.
Unchanged local copies under /workspace/files are removed too.
  -r, -R, --recursive   remove folders and their contents

Example:
  pulpo files rm -r Projects/Old
`,
} as const

export type CommandName = keyof typeof COMMAND_HELP
