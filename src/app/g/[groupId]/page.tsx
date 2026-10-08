import GroupRoom from "./group-room";
import Footer from "../../footer";

export const metadata = { title: "Patas group", referrer: "no-referrer" };

export default async function GroupPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  return (
    <main className="wide">
      <GroupRoom groupId={groupId} />
      <Footer />
    </main>
  );
}
