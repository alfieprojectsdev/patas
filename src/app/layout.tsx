export const metadata = { title: "Patas", description: "Fair meeting spots for group projects" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: 16 }}>{children}</body>
    </html>
  );
}
