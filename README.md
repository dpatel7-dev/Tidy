# tidy

An AI that tidies a folder, carefully. Tell it what you want in your own words
("sort these by school subject and put installers away"), and it looks at the
names, the kinds of files, a short peek inside text files, and how your folders
are already set up. Then it shows you a plan. Nothing moves until you've seen
every move and said yes, and one key puts everything back.

```
 [Hazel]  tidy  ·  an AI that tidies folders, carefully
          folder  ~/Downloads  ·  214 things · 1.3 GB
          AI      llama3.2 · on this computer
 ───────────────────────────────────────────────────────────────
 46 of 46 moves into 7 folders  ·  nothing deleted, nothing replaced
 School/ 12          ›[x] Biology lab report.docx   → School/Biology/
   Biology/ 5            "a lab report about cells"
 Installers/ 3        [x] zoom_installer.pkg        → Installers/
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

## Which AI it uses

tidy needs an AI, and it doesn't ask you to set up anything new:

1. **A model on your own computer (best).** If [Ollama](https://ollama.com) is
   installed with a model (`ollama pull llama3.2`, or `tot pull` in Tree of
   Thought), tidy uses the biggest one. Nothing about your files leaves your
   computer, and there's no limit on how often you can use it.
2. **Tree of Thought's models.** If you've added keys in Tree of Thought, tidy
   can use those models too. Before it sends anything, it tells you exactly
   what it would send and asks first.

`tidy models` lists what it can use; `tidy model <name>` (or Ctrl+O on the
screen) picks one.

## Using it

```
tidy                         tidy the folder you're in
tidy ~/Downloads             ...or another folder
tidy plan <folder> "how"     make a plan and print it (moves nothing)
tidy plan <folder> "how" --apply   ...then move after you type yes
tidy undo                    put the last tidy back exactly as it was
tidy history                 every tidy, newest first (tidy undo <id> for an older one)
tidy update / tidy uninstall / tidy --version
```

On the screen: type how you want it tidied and press **Enter**. tidy designs the
folders, then decides where each thing goes. On the plan:

- **↑ ↓** look through the moves (each has the AI's reason under it)
- **space** skip or keep one move, **a** switch all on or off
- **p** also remove folders the tidy leaves completely empty (undo brings them back)
- **Enter**, then **Enter** again, to move
- **e** change what you asked for
- afterwards, **u** puts everything back

## How tidy stays safe

The AI only *suggests*. tidy checks every suggestion itself and drops anything
that breaks a rule, so even a confused or misbehaving AI can't do damage.

| Rule | What it means |
| --- | --- |
| Plans first | Nothing moves until you've seen the whole plan and pressed Enter twice (or typed `yes`). |
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
| `src/plan.js` | asks the AI for folders and moves, and checks every suggestion |
| `src/apply.js` | moves things (journal first) and undoes them |
| `src/ai.js` | finds a model (Ollama first, then Tree of Thought's) and asks it for JSON |
| `src/app.js` | the screen |
| `src/hazel.js` | Hazel, in pixels |

MIT licence.
