import Home from "./home";
import Footer from "./footer";

// MVP UI. Done: single-device planner, and group links (src/app/g/) where
// each member adds their own landmark on their own phone.
// TODO(claude-code), in order:
//  1. "We met here" → write meeting + burdens (minutes only) for rotation,
//     then send priorBurden on the next search.
//  2. Option to hide others' minutes now that members use their own devices.
export default function Page() {
  return (
    <main className="wide">
      <Home />
      <Footer />
    </main>
  );
}
