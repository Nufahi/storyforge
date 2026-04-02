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
