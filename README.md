# teams-transcript-copier

A browser-console script that copies the full transcript of a Microsoft Teams meeting to your clipboard.

The Teams transcript pane is virtualized: rows only exist in the DOM while they are visible on screen, so selecting the text and copying it only gets part of the transcript. This script scrolls the pane from top to bottom, collects every row as it renders, removes duplicates, and copies the result.

## Usage

1. Open the meeting's transcript in Teams on the web (or the Recap / Stream page that shows it).
2. Open DevTools (`F12` / `Cmd+Opt+I`) → **Console**.
3. Paste in the contents of [`teams-transcript.js`](teams-transcript.js) and press Enter.
4. Click back into the page so the tab has focus, then wait. The script scrolls on its own and logs its progress.
5. When it finishes, the transcript is on your clipboard. If the browser blocks clipboard access, an overlay opens with the text already selected; press `Ctrl+C` / `Cmd+C`.

Tip: if the script picks the wrong container, select the transcript panel in the **Elements** tab first. The script uses `$0` as a hint.

## Commands

After it runs, these are available in the console:

```js
__teamsTranscript.count()     // number of captured blocks
__teamsTranscript.text()      // the transcript as a string
__teamsTranscript.copy()      // copy again
__teamsTranscript.download()  // save as teams-transcript.txt
__teamsTranscript.show()      // show it in an overlay
__teamsTranscript.stop()      // stop scrolling and watching
```

## Configuration

Edit `CONFIG` at the top of the script:

| Option | Default | Description |
| --- | --- | --- |
| `scrollStep` | `650` | Pixels scrolled per step |
| `scrollDelayMs` | `600` | Delay between steps |
| `maxIdleRounds` | `18` | Idle steps at the bottom before finishing |
| `copyWhenFinished` | `true` | Copy to the clipboard when done |
| `downloadWhenFinished` | `false` | Also download a `.txt` file |
| `stripSpeakerTimestampHeader` | `true` | Remove the speaker name and timestamp from each block |

## Notes

- Everything runs locally in your browser. Nothing is sent anywhere.
- Teams changes its DOM often, so the selectors are heuristic. If you capture nothing or the wrong content, please open an issue.

## License

MIT
