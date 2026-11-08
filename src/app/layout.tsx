import type { Metadata } from "next";
import { PwaRegistration } from "./pwa-registration";
import "./globals.css";

export const metadata: Metadata = {
  title: "Expense Tracker",
  description: "Personal spending, one month at a time.",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en-IN"><body>{children}<PwaRegistration /></body></html>;
}
