# North Star Student Journey app

The one screen for running North Star Jazz Workshops' students, from first
inquiry to offboarding. Sits on top of MyMusicStaff, a Google Sheet with an
Apps Script backend, Gmail and Slack. Replaces Monday.com.

- `CLAUDE.md`: how this project is built and the rules it keeps.
- `backend/NSJW_Sequencer.gs`: the Apps Script that runs email sequences,
  reply-stop, open and click tracking, and (as it grows) the app's JSON API.
  Deployed by pasting into the NSJW Sequencer Sheet's script editor.
- `web/`: the static front end, served from GitHub Pages.
- `docs/`: scope and design references.

Status, Nov 2026: phase 1 (sequencer) is live. Phase 2 (Person page) is next.
