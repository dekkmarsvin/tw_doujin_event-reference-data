# AGENTS.md

This repository contains public, reviewed reference data for `tw_doujin_event`.

## Source boundary

- Public facts may come only from organizer-official or venue-official pages.
- Do not import workbooks, community spreadsheets, aggregators, or other third-party datasets.
- Circle self-entered data belongs to the event overlay and must not be added here.

## Change gate

1. Add or update the immutable revision file and its field-level provenance.
2. Run `npm run hashes:update`.
3. Run `npm run check`.
4. Merge to `main` only after repository review and required checks pass.

Never edit an already adopted revision. Publish a new revision instead.
