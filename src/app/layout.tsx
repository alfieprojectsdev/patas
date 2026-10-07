import "./globals.css";

export const metadata = { title: "Patas", description: "Fair meeting spots for group projects" };
export const viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        {/* GoatCounter page views (windowcards pattern). Group pages are reported
            as /g/_ so the group id never reaches GoatCounter; the key after #
            is never part of the path. The setting must exist before count.js loads. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.goatcounter={path:function(p){return p.replace(new RegExp("^/g/[^/?#]+"),"/g/_")}};`,
          }}
        />
        <script data-goatcounter="https://ithinkandicode.goatcounter.com/count" async src="//gc.zgo.at/count.js" />
      </body>
    </html>
  );
}
