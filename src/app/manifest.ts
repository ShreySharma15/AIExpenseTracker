import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Personal Expense Tracker", short_name: "Expenses", start_url: "/",
    display: "standalone", background_color: "#f2f5ef", theme_color: "#052e24",
    icons: [192, 512].map(size => ({
      src: `/expense-icon-${size}.png`, sizes: `${size}x${size}`, type: "image/png", purpose: "any",
    })),
  };
}
