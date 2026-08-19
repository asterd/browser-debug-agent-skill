# Session recording

Record browser interactions only when the user explicitly asks to document, demo, or record.

## Method

Capture a screenshot at each meaningful state change. Assemble at the end:

```bash
# Assemble frames as GIF (ffmpeg)
ffmpeg -framerate 1 -pattern_type glob -i '.browser-debug/frames/*.png' \
  -vf "scale=1280:-2" -loop 0 .browser-debug/recordings/session.gif

# Or with ImageMagick
convert -delay 150 -loop 0 .browser-debug/frames/*.png \
  .browser-debug/recordings/session.gif
```

If Playwright owns the session, use its native video:

```bash
# Context option: recordVideo: { dir: '.browser-debug/recordings/' }
# Convert .webm to GIF:
ffmpeg -i recording.webm -vf "fps=10,scale=800:-1" -loop 0 session.gif
```

## Rules

- Check `command -v ffmpeg` or `command -v convert` before attempting assembly.
- If neither exists, keep raw frames and inform the user.
- Store in `.browser-debug/recordings/` (gitignored).
- Scale to 800-1280px max width.
- Clean intermediate frames after successful assembly.
- Never record by default — only on explicit request.
