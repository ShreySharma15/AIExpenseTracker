import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Personal Expense Tracker", short_name: "Expenses", start_url: "/",
    display: "standalone", background_color: "#f2f5ef", theme_color: "#052e24",
    icons: [{ src: "/expense-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
