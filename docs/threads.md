# Threads, side chats, and projects

Pulpo can split work across several conversations that know about each other. Forks and side
chats let you branch off a chat yourself. Threads let the agent delegate tasks to background
sessions. Project folders give a group of chats shared instructions and memory. Apply migration
`0115_threads_side_chats_projects.sql` with `npm run db:migrate` before starting the server.

## Forks

**Fork from here** on a message copies the conversation up to that message into a new chat in
the same folder. The fork is an ordinary chat; it only remembers where it came from, and links back
to it. You can also type `/fork` in the composer to fork from the latest reply.

## Side chats

A side chat is an aside for a quick question that shouldn't clutter the main conversation, like
asking what a term means halfway through a long task. Type `/btw` and your question in the
composer, or choose **Ask in a side chat** on a message.

- The side chat sees the main chat up to the point you opened it, so you don't need to repeat
  context. Nothing you say there is added to the main chat.
- Side chats aren't listed in the sidebar. Open them from the chat they belong to, and use the
  link at the top of a side chat to go back.
- Side chats move to the trash, come back, and are deleted with their chat.

## Threads

In agent mode, the agent can start **threads**: separate agent sessions, each with its own
workspace and context, that work on a task in the background while the conversation continues.
Ask for several independent things at once ("compare these three vendors and draft the summary
email") and the agent can start a thread for each, tell you what it started, and keep talking with
you while they work.

- When a thread stops, its final reply comes back to the chat as a **thread update**: a turn the
  server starts on its own, which the agent reads and answers like any other message. If the chat
  is busy, the updates wait and arrive together when it's free.
- The agent writes each thread a complete brief, because a thread doesn't see the conversation
  that started it. Threads in a project also get the project's instructions and memory.
- Open a thread from its card in the conversation or from the chat's threads list to read what it
  did. You can also write in the thread directly to steer it. Its next reply is reported back the
  same way.
- Threads are listed by status: **Working**, **Needs attention** (the last reply failed, was
  stopped, or was cut short), **Done**, and **Resolved**. Resolve a thread once you have what you
  need from it; resolving stops anything it is still working on. The agent can resolve threads too.

The agent's thread tools are `start_thread`, `message_thread`, `list_threads`, `read_thread`, and
`resolve_thread`. They're available in agent mode in saved, ordinary chats, but not in temporary
chats, side chats, or threads themselves, so threads can't start threads of their own.

### Limits and cost

Every thread is a full agent session with its own workspace, so threads draw on usage limits
faster than a single chat does, and each one counts against workspace capacity like any other
agent reply.

| Limit | Value |
| :- | :- |
| Threads working at once, per chat | 6 |
| Threads per chat | 50 |
| New threads per account per day | 100 |
| Thread updates in a row without a message from you | 8 |

Past the last limit, thread reports wait until you next send a message, so a chat and its threads
can't keep waking each other up indefinitely. The agent always sees every open thread's status at
the start of a turn, so nothing is lost while reports wait.

## Projects

Any folder in Files (other than the built-in ones) can be made into a project from its menu.
Chats filed in the folder or its subfolders, and the side chats and threads they start, share:

- **Instructions**: up to 16,000 characters, included in every reply in the project.
- **Memory**: up to 16,000 characters of notes about the project, such as requirements,
  decisions, and pitfalls. In agent mode, the agent keeps it current with the
  `update_project_memory` tool. You can read and edit it in the project's settings. It is
  separate from your personal MEMORY.md, which the agent keeps with `update_memory`.
- **Thread model**: optionally, the model new threads in the project use. Otherwise threads use
  the model of the chat that starts them. It must be enabled for agent mode.

The folder itself is the project's library: attach it to a chat to give the agent its files.
Stopping a folder from being a project removes its instructions and memory, but leaves its chats
and files where they are.

Projects are included in encrypted backups. Side chats and threads are backed up with all other
chats.
