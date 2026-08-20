import Link from "next/link";
import { PhoneCall } from "lucide-react";

const footerLinks = {
  Company: [
    { label: "Features", href: "#features" },
    { label: "How It Works", href: "#how-it-works" },
    { label: "Packages", href: "#pricing" },
  ],
  Agents: [
    { label: "Dexter", href: "#agents" },
    { label: "Zia", href: "#agents" },
    { label: "Sparky", href: "#agents" },
    { label: "Bella", href: "#agents" },
  ],
  Start: [
    { label: "Book a Demo", href: "#demo" },
    { label: "Try a Live Call", href: "#demo" },
    { label: "Privacy", href: "/privacy" },
    { label: "Terms", href: "/terms" },
  ],
};

export function Footer() {
  return (
    <footer className="bg-[#111417] px-4 py-14 text-white">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 md:grid-cols-[1.25fr_0.75fr_0.75fr_0.75fr]">
          <div>
            <Link href="/" className="flex items-center gap-3" aria-label="Sigyn home">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-slate-950">
                <PhoneCall className="h-5 w-5" />
              </span>
              <span className="text-xl font-black">Sigyn</span>
            </Link>
            <p className="mt-4 max-w-sm text-sm leading-6 text-slate-300">
              Ready-built AI voice agents for small businesses that need calls answered, appointments booked, and leads captured.
            </p>
          </div>
          {Object.entries(footerLinks).map(([title, links]) => (
            <div key={title}>
              <h4 className="font-black">{title}</h4>
              <ul className="mt-4 grid gap-2">
                {links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-slate-300 transition-colors hover:text-white"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 border-t border-white/10 pt-8 text-center text-sm text-slate-400">
          Copyright {new Date().getFullYear()} Sigyn. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
