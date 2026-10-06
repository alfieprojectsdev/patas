import Planner from "./planner";
import StartGroup from "./start-group";

// MVP UI. Done: single-device planner (aliases + landmarks → top 5 venues).
// TODO(claude-code), in order:
//  1. Join code so each member picks their own landmark on their own phone.
//  2. "We met here" → write meeting + burdens (minutes only) for rotation,
//     then send priorBurden on the next search.
//  2. Option to hide others' minutes now that members use their own devices.
export default function Home() {
  return (
    <main>
      <header>
        <h1>Patas</h1>
        <p className="lede">Find a meeting spot for your group project where nobody gets stuck with the long commute.</p>
        <p className="hint">Quezon City only for now. Members can start up to 5 km outside QC.</p>
      </header>
      <StartGroup />
      <Planner />
      <footer>
        Venue and landmark data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>.
      </footer>
    </main>
  );
}
