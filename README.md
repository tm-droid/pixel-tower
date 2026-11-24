# Pixel Tower

A Claude Code mod that draws a live pixel-art cutaway tower of your Claude Code sessions in a pane beside the chat. Every running session is a floor, from the desktop app and the CLI alike. Subagents arrive by elevator as interns. The sky outside follows your real clock.

## What you see

| On a floor | Means |
| --- | --- |
| Typing, code scrolling on the monitor | Edit / Write |
| Reading a book by the shelf | Read / Grep / Glob |
| Green terminal, sparks from the server rack | Bash |
| Globe on the monitor, satellite dish spinning on the roof | WebFetch / WebSearch / browser |
| Org chart on the monitor, interns at small desks | Agent / Task |
| Red siren, "!" bubble, blinking sign | Waiting for you (permission or question) |
| Cheering with a green check | Turn just finished |
| Walking to the coffee machine | Idle |
| Asleep with "Z"s, floor dimmed | Idle over 12 minutes |
| Floor dark | Session closed |
| Janitor sweeping | Context compacted |
| Matrix rain | A new session or subagent arrived |

Every floor has an LED ticker on its back wall, so you can read what it is doing without hovering:

- A tool icon, then a verb in the tool's colour (`READ`, `EDIT`, `RUN`, `GREP`, `FETCH`, `SPAWN`, or an MCP tool's own name), then its target: the file, the Bash description or command, the search pattern, the host or the query.
- `NEEDS YOU` blinks red while a session waits on a permission or a question.
- When idle it shows the session's last line; when thinking, your last prompt.
- The age of the current state sits on the right, then pips for the last 8 tool calls, coloured by kind, red when one failed.

Interns wear a cap in their session's colour and carry a bubble with their current tool's icon (a check when done). Hover one for its type, task, tool and run time.

Under the picture, a roster lists every session in words: waiting first, then working, then the rest, each with its interns beneath it. This session's running interns get a `view` button that opens their transcript.

Each floor also shows a context battery (green, amber, red). The roof shows your 5-hour usage limit. The lobby trophy case fills as you unlock achievements. Characters are seeded from the session id, so each session keeps its look.

## Install

At the prompt of a terminal Claude Code session:

```
/plugin install pixel-tower --marketplace tm-droid/pixel-tower
```

Answer `y` to add the marketplace, then press Enter to pick the user scope.

From a shell:

```bash
claude plugin install pixel-tower --marketplace tm-droid/pixel-tower
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `tm-droid/pixel-tower`, then Add plugin.

To work on the mod from a clone, run `claude plugin marketplace add <path to the clone>`, then `claude plugin install pixel-tower@pixel-tower --scope user`. The plugin is read from the folder itself, so after an edit run `/reload-plugins`.

## Commands

- `/tower` opens the pane.
- `/tower sound` turns the 8-bit sound effects on or off.
- `/tower auto` turns opening the pane at session start on or off.
- `/tower trophies` lists the achievements.

## How it works

- Desktop app: an animated, pure-vector SVG (the app refuses embedded pictures in an Svg). Each colour's pixels are one path: stacked runs become rectangles, single runs 1 px strokes. Eight frames cover a 2 second loop; frame 0 is drawn whole and each later frame adds only the pixels that change, shown by SMIL in its own 250 ms slot. Long motion runs in CSS: clouds, birds, a jet, the street car, the lobby cat and idle workers' coffee walks move in whole-pixel `steps()`, phased from the real clock so a redraw never makes them jump (reduced motion keeps them at rest). The scene scales by half-integer steps to fill the pane's width crisply, and the sky grows to fill its height. Hover a floor for its session, activity, tool, context, interns and last exchange. With many floors and interns, finer detail (long tickers, pips, intern hovers) is dropped step by step to keep the SVG under the app's size limit. The SVG is rebuilt only when what the tower shows changes, or every 60 seconds for the sky.
- Terminal: a full-resolution image in kitty, Ghostty, WezTerm and iTerm2. Other terminals get a half-block (`▀`) cell grid.
- Data comes from your own machine only:
  - `~/.claude/sessions/*.json`: the live session list. The `*.key` files beside them are never opened.
  - The tail of each session's transcript: which tool is running, context use, errors, compactions.
  - Each session's `subagents/*.meta.json`, and the tail of each running intern's `agent-*.jsonl`: the interns and what they are doing.
  - This session's own hooks, which give exact tool calls.
- Nothing is sent anywhere.

All art and sound are drawn in code: the Endesga 32 palette, a 3x5 pixel font, and square-wave sound effects (`node build/bake.mjs` rebuilds `sounds/`). Inspired by [pixel-agents](https://github.com/pixel-agents-hq/pixel-agents); no assets are shared.

## License

MIT
