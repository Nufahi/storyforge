# StoryForge

StoryForge is a SillyTavern extension that adds a compact storytelling toolkit to the Extensions menu. It lets you inject narrative instructions into the next AI reply with one click, so you can push roleplay scenes in a specific direction without manually typing meta-prompts every time. [file:1][file:72]

## Features

StoryForge includes built-in story tools such as Plot Twist, New NPC, NPC Action, Random Event, Secret Reveal, Scene Shift, Time Skip, and Raise Stakes. Each tool injects a dedicated prompt into the current chat context before generation. [file:72]

All prompts are editable inside the popup panel. You can change prompt text directly in the Custom Prompts section, create your own tools, rename tools inline, and delete tools from the tool grid. [file:72]

The extension also supports active injection tracking, auto-clear after generation, configurable injection depth, and slash commands for opening the panel or clearing all queued prompts. [file:1][file:72]

## Built-in tools

- **Plot Twist** — introduces a sudden and dramatic change in the current scene. [file:72]
- **New NPC** — adds a new NPC with a name, personality, appearance, and hidden motive. [file:72]
- **NPC Action** — makes an existing NPC do something significant or disruptive. [file:72]
- **Random Event** — injects an unexpected event such as an ambush, explosion, alarm, or strange discovery. [file:72]
- **Secret Reveal** — reveals a hidden truth about a character, location, or the world. [file:72]
- **Scene Shift** — moves the story into a new location or setting. [file:72]
- **Time Skip** — jumps forward in time and summarizes what happened in between. [file:72]
- **Raise Stakes** — increases danger, urgency, or consequences. [file:72]

## Installation

Clone or copy this extension into your SillyTavern third-party extensions folder, then reload SillyTavern. After that, open the Extensions menu and click **StoryForge** to open the panel. [file:1][file:72]

## Usage

Click any tool in the panel to queue its prompt for the next generation. Click it again to remove it. If auto-clear is enabled, queued injections are cleared automatically after generation ends or is stopped. [file:72]

In the Custom Prompts section, you can edit the full prompt text for every tool. Tool names can also be renamed inline, making it easier to adapt the panel to your own workflow or language. [file:72]

## Slash commands

- `/storyforge` — opens the StoryForge panel. [file:72]
- `/sf-clear` — clears all active StoryForge injections. [file:72]

## Notes

StoryForge uses the modern `SillyTavern.getContext()` API, popup dialogs, extension settings, and extension prompt injection patterns described in the SillyTavern extension development reference. [file:1]

## License

MIT
