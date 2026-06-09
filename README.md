# StoryForge

One-click narrative tools for SillyTavern roleplay.

Plot twists, new NPCs, random events, scene shifts queue any story tool before the next AI response with a single click.

---

## Features

8 built-in tools — each injects a specialized prompt into chat context before generation:

| Tool | What it does |
|------|-------------|
| Plot Twist | Sudden unexpected turn that changes the scene's direction |
| New NPC | Brand-new character with name, appearance, personality and secret motive |
| NPC Action | An existing NPC takes a dramatic, potentially unexpected action |
| Random Event | Disruptive event — ambush, discovery, explosion, uninvited guest |
| Secret Reveal | Hidden secret about a character, location, or the world |
| Scene Shift | Transition to a completely new location with vivid description |
| Time Skip | Jump forward in time, summarizing what happened |
| Raise Stakes | Escalate danger — urgent threats, deadlines, devastating losses |

Full customization:

- Edit any tool's prompt text directly in the panel
- Create your own custom tools with any injection prompt
- Rename tools inline — click the name, type, done
- Delete any tool — hover and click x
- Reset to defaults with one button

Smart injection system:

- Toggle tools on/off (click to activate, click again to deactivate)
- One-shot mode — auto-clears after AI responds
- Adjustable injection depth (0-10)
- Floating badge shows active tools
- Slash commands: /storyforge, /sf-clear

---

## Reminders (prompt folders)

Persistent and periodic prompts that auto-inject so the model never forgets a detail (outfit, lore rule, OOC instruction...). No more tapping a button every turn.

- **Folders** — group reminders by topic (Appearance, Lore, OOC rules...)
- **Always** — the prompt stays in context on every reply
- **Every N replies** — the prompt surfaces once every N model replies, then steps back (counts only the AI's replies)
- Per-reminder **injection depth** (0-10) and **role** (System / User / Assistant)
- A small status tag shows when each reminder will next fire (`always on`, `next reply`, `in 2`...)

Example: put your persona's outfit description in an "Appearance" folder set to **Every 2 replies** — it auto-injects on every other AI reply so the model keeps clothing consistent.

Reminders are global (shared across chats); the every-N cycle resets when you switch chats.

---

## Director Mode (autonomous co-narrator)

Turn it on and the story starts living its own life. After each AI reply the director rolls a d100 against the **Intensity** slider (0–100%). On success it secretly queues one weighted-random story tool for the next response — a plot twist, a new NPC, a raised stake.

- **Intensity** — how often events happen (slider, 0–100% chance per eligible reply)
- **Min gap** — guaranteed quiet replies after each event, so the pacing breathes
- **Per-tool weight (1–10)** — how often each tool is picked
- **Per-tool cooldown** — replies before the same tool can fire again (Time Skip won't spam)
- **Surprise mode** — hide *which* tool was queued; the badge just shows `???`
- **Direct now!** — force an event for the next reply, ignoring the dice
- Queued events show in the floating badge with a clapperboard icon and can be cancelled with one tap

Slash commands: `/sf-director` (toggle), `/sf-direct` (force an event).

---

## Installation

### SillyTavern built-in installer (recommended)

1. Open SillyTavern
2. Go to Extensions > Install Extension
3. Paste the URL:
```
https://github.com/Nufahi/storyforge
```

4. Click Install, then refresh with Ctrl+Shift+R

### Manual

```bash
cd SillyTavern/data/default-user/extensions
git clone https://github.com/Nufahi/storyforge.git
```

Then restart SillyTavern or press Ctrl+Shift+R.

---

## Usage

1. Click the puzzle icon in the top bar > StoryForge
2. Click any tool to queue it (turns green)
3. Send your message — the AI weaves in the tool's instruction
4. With auto-clear ON, the injection disappears after one use

Stack tools — activate multiple at once. Queue Scene Shift + New NPC to move locations and introduce a character in one response.

Custom tools — click "+ New tool" and write anything. Examples: Flashback, Plot Armor Off, Lore Drop.

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Enabled | On | Master toggle |
| Injection Depth | 1 | Position in chat context (0 = last message) |
| Auto-clear | On | Remove injections after generation (one-shot) |

---

## Slash Commands

| Command | Action |
|---------|--------|
| /storyforge | Open StoryForge panel |
| /sf-clear | Clear all active injections |

---

## License

MIT

---
