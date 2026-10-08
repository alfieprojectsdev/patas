import Footer from "../footer";

export const metadata = { title: "Privacy · Patas" };

// Keep in step with CLAUDE.md "Privacy rules" and what the code actually stores.
const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

export default function Privacy() {
  return (
    <main className="prose">
      <header>
        <a href="/" className="brand">
          <img src="/icons/icon.svg" width={28} height={28} alt="" />
          <span className="wordmark">Patas</span>
        </a>
        <h1>Privacy notice</h1>
        <p className="hint">
          This is a test version of Patas. It was built for high school students, who are minors, so these rules are written
          with them in mind and apply to everyone. Patas never asks your age.
        </p>
      </header>

      <h2>What Patas asks for</h2>
      <p>
        A nickname and a public landmark near where you'll start, like your school, campus or office, a station or a mall. Patas doesn't
        ask for your name, phone number, email or home address, and there are no accounts.
      </p>

      <h2>What's stored, and for how long</h2>
      <ul>
        <li>
          On a single phone, nothing is stored. Nicknames stay on that phone, and the landmarks are used for one search and
          then dropped.
        </li>
        <li>
          With a group link, Patas stores each member's nickname and an encrypted copy of their landmark's area (a ~200 m
          hexagon, never an exact point). The key to decrypt it is only in the group link, not on our server. The
          landmark is deleted 48 hours after you join; the group and nicknames are deleted after 120 days.
        </li>
        <li>
          To stop abuse, Patas counts requests per device for up to a day, using a scrambled (hashed) form of your IP
          address, not the address itself.
        </li>
        <li>
          If you send feedback, Patas stores your message, the contact you chose to leave (if any), the kind of page you
          were on and your browser type, and deletes it after 180 days. It may also be forwarded to the developer's private
          Discord channel.
        </li>
      </ul>

      <h2>Who else sees it</h2>
      <ul>
        <li>Other members of your group see your nickname and your travel times to the suggested places, but never your landmark.</li>
        <li>
          Travel times come from openrouteservice (HeiGIT, Germany). It receives the centre of each ~200 m area, not your
          landmark or nickname.
        </li>
        <li>Landmark search, the list of places and the map are served by Patas itself, so no other company sees what you type or which part of the map you look at.</li>
        <li>
          If you look for a landmark on the map, your browser sends Patas the ~200 m area under the circle, never an exact
          point, to list public places nearby. It isn't stored. You still pick one of those places; the spot on the map is
          never used as your starting point.
        </li>
        <li>The hosting company (Vercel) keeps standard request logs, such as page addresses and IP addresses, for a limited time.</li>
        <li>
          Page views and a few anonymous actions (a search was run, a group was created, someone joined, a landmark was picked from the map) are counted with
          GoatCounter, which uses no cookies. Like any website it loads from, it receives the page address (with group links
          shortened so it never sees which group), the previous page's address, your browser type, screen size and IP
          address. It never receives your nickname, landmark or results.
        </li>
      </ul>

      <h2>Questions or deletion</h2>
      <p>
        {CONTACT ? (
          <>
            Email <a href={`mailto:${CONTACT}`}>{CONTACT}</a> to ask what's stored or to have a group deleted sooner.
          </>
        ) : (
          "Ask the person who shared the link with you to contact the Patas team."
        )}
      </p>

      <p className="hint">
        <a href="/">Back to Patas</a>
      </p>
      <Footer />
    </main>
  );
}
