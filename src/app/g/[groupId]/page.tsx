import GroupRoom from "./group-room";

export const metadata = { title: "Patas group", referrer: "no-referrer" };

export default async function GroupPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  return (
    <main>
      <header>
        <h1>
          <a href="/" className="home">Patas</a>
        </h1>
        <p className="lede">Find a meeting spot where nobody gets stuck with the long commute.</p>
      </header>
      <GroupRoom groupId={groupId} />
      <footer>
        Venue and landmark data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>.
      </footer>
    </main>
  );
}
