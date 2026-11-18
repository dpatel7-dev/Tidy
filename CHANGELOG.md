# Changelog

## 1.2.0
Much less fiddly.
- **A plan is ready at once.** Pick a folder and tidy has already sorted the loose files by kind (installers, screenshots, documents, pictures…), with no AI and no waiting. **By date** is one key away. Folders you already made are kept and reused.
- **Fewer steps.** `tidy` on its own shows a short list (Downloads, Desktop, Documents) to pick from. One Enter moves everything; u puts it back.
- **Asks permission once.** Using a cloud AI, tidy asks one time whether it may see file names, and remembers your answer.
- **The AI is faster.** Small folders are planned with one question instead of two or more; big ones are planned in batches side by side.
- **Ask the AI** has ready-made ideas to pick from, and you can look at the other plans while it thinks.
- A clearer screen: tabs for the ways to sort, every folder in its own colour, and a key bar where the main key stands out.
- Hazel is drawn in whole blocks in macOS Terminal, so no thin lines run through her.
- `tidy plan <folder>` with no "how" makes the instant plan.

## 1.1.0
- Uses Tree of Thought's free cloud models first (set them up with `tot free`), and moves on to another free model when one is busy or over its limit.
- Knows the new services (NVIDIA, Ollama Cloud, SambaNova).

## 1.0.0 (2026-11-16)

The first version.

- Tidy a folder by saying what you want; tidy plans, you review, then it moves.
- Looks at names, kinds of files, short snippets of text files and the folders you already have.
- Uses a model on your computer (Ollama) first, or Tree of Thought's models after asking you.
- Safety: plans first, only moves, never replaces, stays inside the folder, keeps projects and apps whole, never reads private-looking files, re-checks before each move, journal-first undo.
- `tidy plan`, `tidy undo`, `tidy history`, `tidy models`, `tidy model`, `tidy update`, `tidy uninstall`.
- Hazel the squirrel, and two colour themes (walnut and linen, Ctrl+T).
