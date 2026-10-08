"use client";

import { useEffect, useState } from "react";
import { PlannerForm, PlannerPreview, PlannerResults, usePlanner } from "./planner";
import StartGroup from "./start-group";

type Who = "me" | "group";

const CHOICES: { value: Who; title: string; rule: string }[] = [
  { value: "me", title: "Me, for everyone", rule: "One phone. Quickest if you already know where everyone starts." },
  { value: "group", title: "Each person, on their own phone", rule: "Send a group link. Nobody sees anyone else's landmark." },
];

/** Wide screens get the map beside the form; phones see it with the results. */
function useWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    setWide(mq.matches);
    const on = (e: MediaQueryListEvent) => setWide(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

export default function Home() {
  const [who, setWho] = useState<Who>("me");
  const p = usePlanner();
  const wide = useWide();

  if (p.showResults && p.results) return <PlannerResults p={p} />;

  return (
    <>
      <header className="site-header split">
        <div className="site-header">
          <a href="/" className="brand">
            <img src="/icons/icon.svg" width={34} height={34} alt="" />
            <h1 className="wordmark">Patas</h1>
          </a>
          <p className="lede">Find a fair place to meet, so nobody gets stuck with the long commute.</p>
        </div>
        <p className="scope">Quezon City only for now. Members can start up to 5 km outside QC.</p>
      </header>

      <div className="home-grid">
        <section aria-labelledby="who-adds">
          <h2 id="who-adds">Who's adding the landmarks?</h2>
          <div className="choices" role="radiogroup" aria-labelledby="who-adds">
            {CHOICES.map((c) => (
              <label key={c.value} className={who === c.value ? "choice on" : "choice"}>
                <input type="radio" name="who" value={c.value} checked={who === c.value} onChange={() => setWho(c.value)} />
                <b>{c.title}</b>
                <small>{c.rule}</small>
              </label>
            ))}
          </div>
        </section>
        {/* Kept mounted while hidden, so switching back doesn't lose what was typed. */}
        <div hidden={who !== "me"}>
          <PlannerForm p={p} />
        </div>
        {who === "group" && <StartGroup />}
        {wide && who === "me" && (
          <aside className="home-side">
            <PlannerPreview p={p} />
          </aside>
        )}
      </div>
    </>
  );
}
