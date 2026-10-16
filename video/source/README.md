# Build video source

Renders `video/CANScope_Physical_Build_Demo.mp4` (1920×1080, 30 fps, H.264 + AAC, one chapter per scene) together with `video/storyboard.md`, `video/narration.md` and `video/CANScope_Physical_Build_Demo.srt`.

| File | Role |
|---|---|
| `scenes.py` | The storyboard: 10 scenes, 94 steps. Wiring steps and their narration are **generated from** `docs/wiring/pin_ledger.json`, never typed by hand |
| `render_video.py` | Narration (Windows SAPI, voice Microsoft Zira), one frame per sentence with burned-in subtitles, then ffmpeg encode |
| `../../tools/hwdocs/` | Shared ledger loader, diagram renderer, PDF builder and cross-checker |

## Render

Windows only, because narration uses `System.Speech`. Run from the repository root:

```powershell
python -m venv .venv-docs
.venv-docs\Scripts\pip install -r tools/hwdocs/requirements.txt
.venv-docs\Scripts\python tools/hwdocs/validate.py          # must print 17/17 checks passed
.venv-docs\Scripts\python tools/hwdocs/build_manual.py      # diagrams + Rev 2 PDF
.venv-docs\Scripts\python video/source/render_video.py      # about 25 min; TTS cached in build/video/tts
```

- Test render: `render_video.py --limit 5` writes `video/preview.mp4`.
- Frames only, no TTS or encode: `render_video.py --frames-only`.
- ffmpeg comes from the `imageio-ffmpeg` wheel; no system install is needed.

## Changing the content

- **A wire changes:** edit `docs/wiring/pin_ledger.json`, and update the route in `tools/hwdocs/draw.py` (`geometry()` / `bus_geometry()`). Then rerun `validate.py`. It fails if a diagram, the video or the firmware disagrees with the ledger.
- **Explanatory text changes:** edit `scenes.py`.

Every frame is a schematic illustration. No photographs of the builder's hardware were available, and none are simulated.
