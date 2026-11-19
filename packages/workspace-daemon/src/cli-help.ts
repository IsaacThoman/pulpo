/** Help is written for the agent model reading it in a bash tool result: short, concrete, example-led. */
export const FILES_HELP = `Usage: pulpo files <command> [options]

Read and change the user's Pulpo Files. Paths start at the top of My files
and look like "Projects/Plan.md" (no leading slash; names are
case-insensitive). Items the user mentioned in this chat work right away;
reaching anything else asks the user first and waits for their answer. Markdown documents (.md) are live documents in Pulpo; other
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

Each item is read only, suggest (your changes wait for the user to
accept them) or write (changes apply right away). Commands report which
happened. Run \`pulpo files <command> --help\` for details.
`

export const COMMAND_HELP = {
  ls: `Usage: pulpo files ls [path] [-R]

List a folder in Files; without a path, list the top of My files.
Pending changes are marked (for example "suggested, not accepted yet").
  -R, -r, --recursive   include subfolders

Examples:
  pulpo files ls
  pulpo files ls Projects -R
`,
  tree: `Usage: pulpo files tree [path] [--depth N]

Show the folder tree under path (default: the top of My files).
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

Search the text of documents and text files under path (default: all of
My files). Prints "path:line: text" for each match.
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

/** `pulpo --help`: which group to use. */
export const TOP_HELP = `Usage: pulpo <group> <command> [options]

  pulpo files <command>      the user's Pulpo Files
  pulpo computer <command>   the folder the user shared from their computer
                             (only when they shared one in this chat)

Run \`pulpo files --help\` or \`pulpo computer --help\` for the commands.
`

export const COMPUTER_HELP = `Usage: pulpo computer <command> [options]

Read and change the folder the user shared from their computer. It stays on
their computer: you work on copies under /workspace/computer. Paths are
relative to the shared folder and look like "src/app.ts" (no leading slash).
Folders named .git and node_modules are left out of pulls, searches and
listings deeper than one level.

Browse:
  ls [path] [-R]                list a folder (-R: include subfolders)
  tree [path] [--depth N]       show the folder tree (default depth 3, max 8)
  cat <path>...                 print text files
  grep [-i] [-F] <pattern> [path]
                                search text (regex; -F literal, -i ignore case)
Change:
  pull <path> [dest]            copy into /workspace/computer/<path> (or dest)
  status                        show local changes to pulled files (no network)
  push [local...] [--to <path>] [--force]
                                save local changes and new files back
  mkdir [-p] <path>...          create folders
  mv <from> <to>                move or rename
  rm [-r] <path>...             remove (-r for folders)

Edit a file:
  pulpo computer pull src/app.ts
  (edit /workspace/computer/src/app.ts with your usual tools)
  pulpo computer push

The user chose read only (changes are refused), suggest (your changes wait for
the user to accept them on their computer) or edit directly (changes apply
right away). Commands report which happened. Run
\`pulpo computer <command> --help\` for details.
`

export const COMPUTER_COMMAND_HELP: Record<CommandName, string> = {
  ls: `Usage: pulpo computer ls [path] [-R]

List a folder; without a path, list the shared folder itself.
  -R, -r, --recursive   include subfolders (skips .git and node_modules)

Examples:
  pulpo computer ls
  pulpo computer ls src -R
`,
  tree: `Usage: pulpo computer tree [path] [--depth N]

Show the folder tree under path (default: the shared folder). Skips .git and
node_modules.
  -L, --depth N   levels to show (default 3, max 8)

Example:
  pulpo computer tree src --depth 2
`,
  cat: `Usage: pulpo computer cat <path>...

Print UTF-8 text files. Binary or very large files cannot be printed: pull
them and inspect the local copy instead.

Example:
  pulpo computer cat README.md
`,
  grep: `Usage: pulpo computer grep [-i] [-F] <pattern> [path]

Search the text files under path (default: the whole shared folder, without
.git and node_modules). Prints "path:line:text" for each match.
  -i, --ignore-case     ignore case
  -F, --fixed-strings   match the pattern literally instead of as a regex
Put \`--\` before a pattern that starts with "-".

Examples:
  pulpo computer grep -i todo src
  pulpo computer grep -F "total (net)"
`,
  pull: `Usage: pulpo computer pull <path> [dest]

Copy a file or folder from the shared folder into the workspace so you can
read or edit it with normal tools. The default destination is
/workspace/computer/<path>; an existing directory given as dest receives the
item inside it. Pulling again overwrites the local copies. .git and
node_modules folders are left out.
Limits: 1000 files and 500 MiB per pull.

Examples:
  pulpo computer pull src/app.ts
  pulpo computer pull src
  pulpo computer pull data/sales.csv /tmp/sales.csv
`,
  status: `Usage: pulpo computer status

Compare local copies with what you last pulled or pushed, without contacting
the user's computer. Lists modified pulled files, new files under
/workspace/computer (names starting with "." are ignored) and pulled files
deleted locally.
`,
  push: `Usage: pulpo computer push [local...] [--to <path>] [--force]

Save local files back to the shared folder. Without arguments, pushes every
modified or new file under /workspace/computer plus modified pulled files
elsewhere. Pulled files go back where they came from; a new file at
/workspace/computer/<path> is created at <path>. Directories are pushed
recursively (changed and new files only). Each file can be at most 25 MiB.
  --to <path>     destination in the folder for one local file (end it with / to keep the file name)
  -f, --force     overwrite the file even if it changed since you pulled it

Each file reports created, updated, suggested (waiting for the user to accept),
unchanged, conflict, denied or error. A conflict means the file changed on the
user's computer after you pulled it. Deleting a local copy never deletes
anything on the user's computer; use \`pulpo computer rm\` for that.

Examples:
  pulpo computer push
  pulpo computer push /workspace/computer/src/app.ts
  pulpo computer push chart.png --to docs/
`,
  mkdir: `Usage: pulpo computer mkdir [-p] <path>...

Create folders in the shared folder.
  -p, --parents   also create missing parent folders

Example:
  pulpo computer mkdir -p docs/2026
`,
  mv: `Usage: pulpo computer mv <from> <to>

Move or rename a file or folder inside the shared folder. If <to> is an
existing folder, the item moves into it and keeps its name; otherwise <to> is
the new path. Unchanged local copies of the old path are removed; pull the new
path to keep working on it.

Examples:
  pulpo computer mv src/old.ts src/new.ts
  pulpo computer mv notes.md archive
`,
  rm: `Usage: pulpo computer rm [-r] <path>...

Remove files or folders from the shared folder; they go to the computer's
trash, where the user can restore them. Folders need -r. Unchanged local copies
under /workspace/computer are removed too.
  -r, -R, --recursive   remove folders and their contents

Example:
  pulpo computer rm -r build/old
`,
}
