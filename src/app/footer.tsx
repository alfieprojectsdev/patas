import FeedbackButton from "./feedback-button";

export default function Footer() {
  return (
    <footer>
      Venue and landmark data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>.{" "}
      <a href="/privacy">Privacy</a> · <FeedbackButton />
    </footer>
  );
}
