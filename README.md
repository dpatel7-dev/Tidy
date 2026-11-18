# tidy

Sorts a messy folder for you, carefully. Pick a folder and a plan is ready at
once: installers together, screenshots together, documents together. Press
**Enter** and it's done. Press **u** and it all goes back.

Want something cleverer, like "sort by school subject"? Ask the AI, in your own
words. Either way you see every move before anything happens.

```
 tidy   Downloads  ~/Downloads  ·  24 things
 ───────────────────────────────────────────────────────────────────────────
  By kind   By date   Ask the AI                         19 moves into 8 folders
 Loose files sorted by what they are. Folders you made stay as they are.

 Code & Notes/  2   › ● index.html                       → Code & Notes/
 Documents/     4     ● Biology notes.docx               → Documents/
 Installers/    2     ● Discord.dmg                      → Installers/
 ───────────────────────────────────────────────────────────────────────────
  enter  move 19 things   ←→ another way   space skip   tab other folder
```

Part of the same family as [gossip](https://github.com/dpatel7-dev/gossip),
[Tree of Thought](https://github.com/dpatel7-dev/Tree-Of-Thought),
[pigeon](https://github.com/dpatel7-dev/pigeon) and
[Project CLI Access](https://github.com/dpatel7-dev/Project-CLI-Access).
Its mascot is Hazel, a squirrel who files things away for winter.

## Install

The easiest way is Project CLI Access: run `pca`, pick **tidy**, press Enter.

Or on its own, on a Mac or Linux (Terminal):

```sh
curl -fsSL https://djp7.pythonanywhere.com/tidy/install.sh | sh
```

On Windows (PowerShell):

```powershell
irm https://djp7.pythonanywhere.com/tidy/install.ps1 | iex
```

(Or straight from GitHub: `curl -fsSL https://raw.githubusercontent.com/dpatel7-dev/tidy/main/install.sh | sh`.)
Tree of Thought can open it too: **Tab → Tidy a folder**.

## Using it

1. Run `tidy`.
2. Pick a folder with **↑ ↓** and press **Enter** (Downloads, Desktop and
   Documents are listed; **Somewhere else…** lets you type any folder).
3. The plan is already there. Look it over:
   - **← →** switches between the ways to sort: **By kind**, **By date**, and
     **Ask the AI**.
   - **↑ ↓** looks through the moves (the reason for each one is under it).
   - **space** skips a move you don't want (press it again to keep it).
4. Press **Enter** to move them. Done.
5. Changed your mind? Press **u**. Everything goes back exactly where it was.

By kind and By date need no AI, so they're instant. They only sort the loose
files at the top of the folder; folders you already made, and everything in
them, are left alone (and reused: if you already have a `Pictures` folder,
pictures go there).

### Asking the AI

On **Ask the AI**, type what you want ("sort by school subject", "group by
project") or pick one of the ideas with **↑ ↓**, then press **Enter**. While it
thinks, you can still look at the other ways. When the plan is ready it works
the same way: **space** to skip, **Enter** to move, **e** to ask differently.

tidy borrows the AI from Tree of Thought, so there's nothing new to set up:

1. **Tree of Thought's free models** (set them up once with `tot free`). The
   first time, tidy asks once whether that service may see your file names and
   short snippets (secrets blanked out; private-looking files by name only).
2. **A model on your own computer** (optional, with [Ollama](https://ollama.com)):
   nothing leaves your computer.

**Ctrl+O** picks another AI. `tidy models` lists them; `tidy model <name>` picks one.

### Commands

```
tidy                         pick a folder and sort it
tidy ~/Downloads             sort that folder
tidy ~/Downloads "how"       ...and ask the AI to sort it your way
tidy plan <folder> ["how"]   print a plan without moving anything
                             (no "how": by kind, instantly)
tidy plan <folder> --apply   ...then move after you say y
tidy undo                    put the last tidy back exactly as it was
tidy history                 every tidy, newest first (tidy undo <id> for an older one)
tidy update / tidy uninstall / tidy --version
```

Other keys: **tab** another folder, **Ctrl+T** light or dark colours,
**p** also remove folders a tidy leaves empty, **esc** quit.

## How tidy stays safe

The AI only *suggests*, and so do the instant plans. tidy checks every suggestion itself and drops anything
that breaks a rule, so even a confused or misbehaving AI can't do damage.

| Rule | What it means |
| --- | --- |
| Plans first | Nothing moves until you've seen the whole plan and pressed Enter (or said `y` to `--apply`). An Enter pressed the moment a plan appears is ignored, so a double-tap can't move things by accident. |
| Only moves | tidy never deletes, renames or edits a file. If something with the same name is already where a file is going, the file gets a `(2)` beside it: nothing is ever replaced. |
| Stays inside | Every move stays inside the folder you picked. tidy refuses the whole disk, your whole home folder, system folders (`/System`, `/usr`, `~/Library`, `C:\Windows`, Program Files…) and project folders. It never follows a link out of the folder. |
| Keeps things whole | Projects (anything with `.git`, `package.json`, `Cargo.toml`…), apps and bundles (`.app`, Photos libraries…) move as one piece or not at all, and nothing is ever moved into one. Hidden files are left alone. |
| Keeps private things private | Files that look private (passwords, keys, `.env`, tax forms, bank statements, passports…) are never opened; the AI only sees their names. Other text files are shown to the AI as a short snippet with anything that looks like a password, key, token, card or social security number blanked out. |
| Checks again before moving | If a file changed, moved or disappeared since tidy looked, it's left alone. |
| Undo always works | The whole plan is written to `~/.tidy/runs/` before the first move, and each move is recorded as it happens, so `tidy undo` works even if your computer turned off halfway. |
| Limits | tidy looks at most 3 folders deep and 1,500 things at a time. Deeper folders are treated as one item. |

## For developers

No dependencies: Node 18 or newer.

```sh
npm test                         # the safety rules, plus plan → apply → undo with a pretend AI
node dev/fake-ollama.js 11999    # a pretend Ollama to try the screen with
TOT_URL_OLLAMA=http://127.0.0.1:11999/v1 TIDY_HOME=/tmp/tidy-try node bin/tidy.js ~/some/test/folder
```

| File | What it does |
| --- | --- |
| `src/scan.js` | looks at a folder safely: what to refuse, what to skip, what's private, redaction |
| `src/quick.js` | the instant plans: by kind and by date, no AI |
| `src/plan.js` | asks the AI for folders and moves (in one question for small folders, in batches side by side for big ones), and checks every suggestion |
| `src/apply.js` | moves things (journal first) and undoes them |
| `src/ai.js` | finds a model (Tree of Thought's free ones first) and asks it for JSON, moving on when one is busy |
| `src/app.js` | the screen |
| `src/hazel.js` | Hazel, in pixels |

MIT licence.
