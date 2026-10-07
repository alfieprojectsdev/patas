import "./globals.css";
import RegisterServiceWorker from "./register-sw";

export const metadata = {
  title: "Patas",
  description: "Fair meeting spots for group projects",
  // Installable: the manifest comes from src/app/manifest.ts; these cover iOS "Add to Home Screen".
  appleWebApp: { capable: true, title: "Patas", statusBarStyle: "default" as const },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};
export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1f6f50" },
    { media: "(prefers-color-scheme: dark)", color: "#141614" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <RegisterServiceWorker />
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
