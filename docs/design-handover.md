# Patas: design handover

A brief for Claude Design, for improving how Patas looks and how easy it is to use. Implementation happens afterwards in Claude Code, so send back mockups and tokens, not a rewrite of the app.

Attach these with this doc. The last column says what to check in each one; the problem numbers refer to the list further down.

| File | Shows | Check |
| --- | --- | --- |
| `docs/screenshots/2-fair-spots.png` | Map and the top three results, desktop width, light | Problems 1–5 and 8. Start here. |
| `docs/screenshots/3-phone-dark.png` | The same results on a 390 px phone, dark | Problems 1, 2 and 4 at phone size. From the top of the map to the bottom of result 1 is about 910 px, taller than the 844 px screen, so even the winner doesn't fit on one screen. The member label "Bea" covers a cluster of venue pins. |
| `docs/screenshots/1-pick-landmarks.png` | The planner with four members, one landmark search open, desktop width, light | Problem 7: the pale disabled button and the hint under it. Also check the member rows: each takes about 140 px of height for two fields, plus a separate "Remove" line. |
| `docs/screenshots/4-group-link.png` | Group page after joining, phone, light | The share box, the "Who's in" roster and the join state. The link shows `localhost` only because the screenshots come from a local build. |
| `docs/screenshots/5-feedback.png` | Feedback dialog, phone | The only other dialog. Keep it consistent with the landmark finder. |
| `src/app/globals.css` | Every style the app has, in one file | The current tokens. |

Two screens have no screenshot, so look at them on the live site, https://patas.ithinkandicode.space:

- **The top of the home page**, with the header and the group-link box (problem 6).
- **The landmark finder.** Click "Can't find it? Look on the map" under any Landmark field.

## What Patas does

High school group projects in Quezon City need somewhere to meet. Patas finds the spot where the person with the longest trip has the shortest possible trip. Ties go to the smallest gap between the longest and shortest trip, then to the smallest total. "Patas" is Tagalog for even or fair.

Each member picks a public landmark near where they'll start (their school, a station, a mall, their barangay hall). Patas shortlists about 20 venues (libraries, malls, cafés, fast food) and gets everyone's travel time to each. It then shows a ranked list and a map.

## Who uses it

- Students aged roughly 13 to 18, mostly on phones and often on mobile data. Assume mid-range Android and both light and dark mode.
- Usually one person plans for the group from a group chat, then shares the link.
- The UI is in English, and place names are Filipino and English mixed.

## Screens

1. **Home** (`src/app/page.tsx`): a header, then two ways to plan, one above the other:
   - **"Everyone on their own phone?"** creates a group link (`start-group.tsx`).
   - **The single-phone planner** (`planner.tsx`): 2 to 10 member rows, each with a nickname and a landmark, plus a travel mode (Car or ride-hail, or Walking) and **Find fair spots**.

   The map appears once any member has a landmark, and results appear under it.
2. **Results** (`results.tsx`, `map.tsx`):
   - Three notes come first: how the ranking works, the routing credit and the rush-hour caveat.
   - Then a card per venue: rank, name, category tag, "Show trips on map", and the longest trip and gap. Each member gets a bar with minutes and a rush-hour range.
   - The map shows members as coloured hexagons, venues as numbered pins, and dashed lines from each member to the selected venue.
3. **Group page** (`src/app/g/[groupId]/group-room.tsx`): the share link with a copy/share button and a QR code, the roster of members who've joined, a join form (nickname and landmark), **Find fair spots**, and the same results.
4. **Landmark finder dialog** (`pin-finder.tsx`, `pin-map.tsx`): opened from "Can't find it? Look on the map" under every landmark field. It has an amber warning box, a map with a fixed circle, and a list of up to 5 nearby landmarks.
5. **Smaller pages**: the feedback dialog (`feedback-button.tsx`), the privacy page (`src/app/privacy/page.tsx`), the offline page (`src/app/offline/`) and the app icon (`public/icons/icon.svg`).

## Usability problems I can point to

1. **Results are long.** In screenshot 2, the map and three result cards take about 1,600 px of page height at desktop width. In screenshot 3 (phone), the map and result 1 alone take about 910 px. Each card has a bar per member, each with two numbers. On a phone, comparing the first and second venue means scrolling.
2. **Three paragraphs of caveats sit before the first result** (screenshots 2 and 3). All three have to stay (see the constraints below), but they don't all have to come first or look like body text.
3. **The rush-hour range appears in every row of a card** (screenshot 2): once in the summary line and again under each member's minutes, so five times for a four-member group.
4. **Map pins overlap.** In screenshot 2, pin 2 is hidden behind pin 1, and pins 3 and 4 overlap. In screenshot 3, the member label "Bea" covers venue pins as well.
5. **Each card has overlapping controls** (screenshot 2). The venue name is a link that opens OpenStreetMap in a new tab. Tapping anywhere else on the card selects it on the map, and so does the "Show trips on map" button on every card except the selected one.
6. **The home page offers two flows with no clear choice** (live site only). The group-link box sits above the single-phone planner, and nothing says which one a group should use.
7. **The disabled Find button doesn't say who's missing** (screenshot 1). It shows "Every member needs a landmark first." without naming the member.
8. **Only 8 member colours exist** (`MEMBER_COLORS` in `results.tsx`; see screenshots 2 and 3), and members 9 and 10 fall back to grey. Some pairs may be hard to tell apart for colour-blind users. Please check the palette against that.
9. **The identity is thin.** The app uses the system font, one green accent (`#1f6f50` light, `#5fbf94` dark) and plain cards. It reads as a utility. Students should find it friendly without it looking childish.

## Constraints: please don't design these away

### Privacy (the users are minors)

- **Members are areas, never points.** Each member's start is drawn as a ~200 m hexagon. No pin icons for members, no "your location" button and no geolocation.
- **On group pages, nobody sees anyone else's landmark.** Only nicknames, who has joined, and travel times.
- **Inputs are public landmarks, never addresses.** No copy may ask for an address or "where do you live".
- **The landmark finder's amber warning ("Don't put the circle on your home") stays prominent and above the map.** It explains that the blur is on purpose.
- **No third-party requests.** No font, icon or image CDNs and no external map tiles: the browser must never contact another company except GoatCounter (analytics). A custom font is fine if it's served from Patas itself, either through `next/font` (which downloads Google Fonts at build time, so visitors never contact Google) or as woff2 files in `/public`.

### Credits and honesty

- **"© openrouteservice by HeiGIT | Data from OpenStreetMap" stays visible wherever travel times appear.** The licence requires it.
- **The map's "Leaflet | Protomaps © OpenStreetMap" credit stays.**
- **Driving times assume clear roads.** The rush-hour range (1.5 to 2 times) stays visible near driving times and stays labelled as a Metro Manila average, not live traffic.
- **The ranking order is the product.** Don't reorder results or hide the longest trip and the gap. Restyling them is welcome.

### Technical

- Next.js 15 and React, styled with plain CSS in `src/app/globals.css`, using CSS variables for colour and `prefers-color-scheme` for dark mode. There's no Tailwind or component library. Plain CSS with variables is easiest to apply. If you'd add something, say what and why.
- The map is Leaflet with protomaps-leaflet. It draws a self-hosted basemap in the built-in "light" and "dark" styles. Restyling the basemap means a custom protomaps theme, so treat it as optional. Overlay colours (hexagons, pins, lines, QC boundary) are easy to change.
- Accessibility already in place:
  - the landmark search is an ARIA combobox;
  - status text uses `aria-live`;
  - focus outlines are visible;
  - inputs are 16px so iOS doesn't zoom.

  Keep these. Tap targets should be at least 44 px, which the current text links (Change, Remove, Show trips on map, Can't find it?) are not: they're unpadded 0.9rem text, about 22 px tall.
- The app is installable. If the brand colour changes, it also has to change in `src/app/manifest.ts`, `themeColor` in `src/app/layout.tsx`, and `public/icons/icon.svg`. The PNGs are re-rendered with `npm run icons`.
- `scripts/screenshots.ts` regenerates the README images. It finds elements by class name and by visible text, so list any renames of either:
  - classes: `.planner`, `.member`, `.map`, `.venue`, `.share`, `.roster`, `.join`, `.primary`, `.primary + .hint` and `dialog.feedback`;
  - text: the buttons "Add member", "Find fair spots", "Create a group link", "Join" and "Feedback", the option "An idea", the line "You're in as", and the placeholders "Member 1" and "e.g. Bea".

## Voice

Plain, short and friendly English, written for a teenager reading on a phone. Technical terms never appear in the UI: it says "a ~200 m area", not "H3 cell". Current examples:

- "Find a meeting spot for your group project where nobody gets stuck with the long commute."
- "Ranked so the longest trip is as short as possible, then by how even the trips are."
- "Pick a public landmark near where each person starts: their school, a station, a mall, their barangay hall. Not a home address."

## What I'd like back

1. Mockups, phone first, with desktop where it differs:
   - the home page (both ways to plan);
   - a member row with an empty, searching and chosen landmark;
   - results with the map;
   - the group page before and after joining;
   - the landmark finder dialog.

   Light and dark for at least the results.
2. A token set as CSS variables, keeping the current names where they still fit (`--bg`, `--surface`, `--text`, `--muted`, `--line`, `--accent`, `--accent-text`, `--accent-soft`, `--warn-bg`, `--warn-text`, `--error`, `--radius`), plus a type scale and spacing.
3. A member colour palette for 10 members, in light and dark, checked for colour blindness.
4. A short note for each numbered problem above saying how the design handles it, or why it doesn't.
