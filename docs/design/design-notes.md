# Patas design handover v1: notes for Claude Code

The mockups are in `Patas Redesign.dc.html` (sections 1–4). The tokens are in `handoff/patas-tokens.css`. The brand green, the manifest, `themeColor` and `icon.svg` don't change.

## Problems

1. **Results are long.** Only the selected card is expanded, showing a row per member (no rush range on those rows) and an "Open map ↗" button. The other cards collapse to a header plus a *trip strip*: one 0–20 min line with a dot per member, labelled with initials, and a band from the shortest trip to the longest. The scale is shared across cards, so a tighter band means a fairer spot. The phone map is 236 px (it was 340). On a 390 × 844 screen, the map, the legend and the whole first result fit above the fold.
2. **Caveats.** All three stay. "Times assume clear roads" and the rush-hour line are now one 13 px sentence. The ORS credit is a 12 px line under it, still above the first time. The ranking explanation moves behind a "How is this ranked?" disclosure.
3. **Rush hour repeated.** The range is shown once per card, under the longest trip ("24–32 at rush hour"). Member rows show plain minutes.
4. **Pins overlap.** The permanent member tooltips are removed. Each hexagon shows the member's initial in its own colour, and names go in a legend under the map. After `fitBounds`, run a collision pass: the selected pin stays where it is; any other pin that would touch a pin or hexagon moves out in steps (r+14, r+26, r+38 px at a set of angles), with a 1.5 px leader line to a 3 px dot at its true position. The selected pin gets the highest z-index.
5. **Overlapping controls.** The card is one `role="button"` with `aria-pressed`. The venue name isn't a link. "Show trips on map" is removed. The OSM link is a 44 px button inside the selected card only.
6. **Two flows.** A single radio question, "Who's adding the landmarks?", offers "Me, for everyone" (the default, which shows the planner) and "Each person, on their own phone" (which shows a three-step explainer and **Create a group link**).
7. **Find button.** Use `aria-disabled="true"` instead of `disabled`, with a dashed neutral style. `.primary + .hint` lists each member still missing a landmark as an amber chip, and tapping a chip focuses that member's landmark input.
8. **Colours.** There are 10 slots in each mode, at least 3:1 against the surface. Slots 1–5 stay at OKLab ΔE ≥ 9.9 under protan, deutan and tritan simulation (Machado 2009). Some pairs among slots 6–10 come close under deutan, which can't be avoided with 10 colours, so every swatch, hexagon and strip dot also carries the initial (or the row number before a nickname is entered). The live check is in section 6 of the mockup.
9. **Identity.** Bricolage Grotesque (via next/font) for display text only, at weight 700 (800 is for the wordmark only) so it works for a 15-year-old and a 30-year-old alike, the icon's hexagon as the recurring shape, pill buttons and segmented controls, and radius 12 / 16.

## Audience

Patas is now for high school students (still the first users) through college students, university orgs and working adults. Keep the tone friendly but not school-specific. The privacy rules stay the same for everyone, and there is no age question or age-based mode.

Copy changes:
- Tagline: "Find a fair place to meet, so nobody gets stuck with the long commute." (on home and the group page)
- Landmark hint: "…a station, a mall, a campus or office, a barangay hall. Not a home address."
- Landmark placeholder: "Station, mall, campus, office…"

## Room for later (don't build yet)

- **Weekly groups that take turns with the long trip:** keep the results top bar's second line free for a group status. Keep the expanded member rows as a CSS grid so a marker column can be added. A status row on the group page (same component as "You're in as") would go above Who's in. "How is this ranked?" is where the turn rule would be explained.
- **Members starting outside QC (Makati, Ortigas):** keep "Quezon City only for now…" as one standalone line. Always show "type · city" under landmarks. Fit the map to all members, with QC as a dashed outline. Scale the trip strip and member bars to the longest trip, rounded up to 10 min (at least 20), not a fixed 20. Make sure the minute columns fit three digits.

## Component changes

- **Member row:** a header line with a hexagon swatch showing the row number, the nickname input and a × remove button (44 × 44, `aria-label="Remove …"`), then the landmark field. "Can't find it? Look on the map" becomes a "Map" button inside the input, which keeps the same accessible name, and is also the last item in the suggestion list. On desktop, the row is a single line.
- **Mode picker:** a segmented pill control (still a radiogroup).
- **Group page:** the order is the join form, "Who's in", the invite box (shrunk to a single row after joining), the mode, then Find. "You're in as **Mika**." is kept, with a "Change landmark" button next to it.
- **Landmark finder:** a full-height sheet on phones with a 44 px close button. The warning gets a 2 px `--warn-line` border and stays above the map. Nearby places are 56 px rows, with a dashed outline on the map for each.
- **Feedback dialog:** use the same sheet header and the pill radios.
- **Tap targets:** every text link (Change, Remove, Privacy, Feedback, Can't find it?, QR) is at least 44 px tall.

## Changes for `scripts/screenshots.ts`

Every class it uses is kept. Text changes:

- "Add member" becomes "+ Add member".
- "Remove" becomes a × button, so find it by its aria-label.
- "Create a group link" now appears only after the "Each person, on their own phone" radio is picked, so click that radio first.
- "Show trips on map" is removed.
- `.primary + .hint` is now a `div` that holds chips.
- "Join", "Find fair spots", "Feedback", "An idea", "You're in as", "Member 1" and "e.g. Bea" are unchanged.

## Not changed

The basemap style (still the built-in protomaps light and dark), the ranking, privacy behaviour and all copy apart from the lines above. In the mockups, venues 4 and 5, the nearby list and the basemap are placeholders.
