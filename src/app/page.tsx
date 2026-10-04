// TODO(claude-code): MVP UI
//  1. Create/join group via join code (no accounts).
//  2. Each member picks a LANDMARK via Places Autocomplete (not a home address).
//     Landmark coords stay client-side until the single POST /api/meet call.
//  3. Show top 5 venues: name, worst/spread minutes, per-member minutes.
//     Option to hide others' minutes; never show others' landmarks.
//  4. "We met here" → write meeting + burdens (minutes only) for rotation.
export default function Home() {
  return (
    <main>
      <h1>Patas</h1>
      <p>Fair meeting spots for group projects. UI not built yet — see CLAUDE.md.</p>
    </main>
  );
}
