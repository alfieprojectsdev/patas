import type { MetadataRoute } from "next";

/** Web app manifest (served at /manifest.webmanifest) so Patas can be installed to a home screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Patas: fair meeting spots",
    short_name: "Patas",
    description: "Find a fair place to meet, so nobody gets stuck with the long commute.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fbfaf7",
    theme_color: "#1f6f50",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
