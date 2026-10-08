import FeedbackButton from "./feedback-button";

export default function Footer() {
  return (
    <footer>
      <span>
        Venue and landmark data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>.
      </span>
      <a href="/privacy">Privacy</a>
      <FeedbackButton />
    </footer>
  );
}
