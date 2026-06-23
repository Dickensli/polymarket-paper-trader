import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy — PolyTrader',
  description: 'Privacy Policy and terms of data usage for the PolyTrader paper trading simulator.',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#0a0b0f] text-foreground font-sans selection:bg-primary/30 selection:text-white relative overflow-hidden">
      {/* Decorative background glow */}
      <div className="absolute top-1/4 left-1/4 h-[500px] w-[500px] rounded-full bg-primary/5 blur-[150px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 h-[500px] w-[500px] rounded-full bg-profit/5 blur-[150px] pointer-events-none" />

      <div className="relative max-w-3xl mx-auto px-4 py-16 sm:px-6 sm:py-24">
        {/* Header */}
        <div className="mb-12 border-b border-white/[0.06] pb-8">
          <div className="flex items-center gap-3 mb-4">
            <Link href="/" className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-light hover:opacity-90 transition-opacity">
              <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
              </svg>
            </Link>
            <span className="text-xl font-bold tracking-tight text-white">PolyTrader</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white mt-4">
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm text-foreground-muted">
            Last Updated: June 23, 2026
          </p>
        </div>

        {/* Content */}
        <div className="space-y-10 text-foreground-muted leading-relaxed text-sm sm:text-base">
          <section className="space-y-3">
            <h2 className="text-xl font-bold text-white tracking-tight">1. Introduction</h2>
            <p>
              Welcome to PolyTrader (hereinafter referred to as the "Service"). PolyTrader is a paper trading platform
              that allows users to practice trading prediction markets using virtual currency ("paper money").
              We are committed to protecting your privacy and security.
            </p>
            <p>
              This Privacy Policy explains how we collect, use, and safeguard information when you use our Service.
              By accessing or using PolyTrader, you agree to the collection and use of information in accordance with this policy.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-white tracking-tight">2. Information Collection</h2>
            <p>
              We collect information to provide a secure authentication mechanism and to manage virtual paper trading portfolios:
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong className="text-white">Account Information:</strong> When you sign in using Google OAuth, we collect your email address, name, and profile picture url. If you choose to sign in via Resend passwordless email login, we collect your email address.
              </li>
              <li>
                <strong className="text-white">Virtual Portfolio & Trading Activity:</strong> We store virtual currency balances, open paper trading positions, historical virtual transactions, and performance metrics associated with your account.
              </li>
              <li>
                <strong className="text-white">Device and Usage Data:</strong> We may collect technical logs such as IP addresses, browser types, and system errors to improve security and diagnose service issues.
              </li>
            </ul>
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 mt-4">
              <p className="text-xs text-primary-light font-semibold uppercase tracking-wider mb-1">
                Zero Financial Risk
              </p>
              <p className="text-xs text-foreground-muted">
                PolyTrader does NOT connect to real money wallets, ask for bank details, or support real currency transactions. All trades use virtual simulator tokens with zero real-world monetary value.
              </p>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-white tracking-tight">3. How We Use Your Information</h2>
            <p>
              We use the collected information for the following purposes:
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li>To authenticate your identity and allow secure access to your account.</li>
              <li>To initialize and update your virtual paper money balance.</li>
              <li>To maintain your virtual portfolio, execute paper trades, and calculate simulation performance.</li>
              <li>To compile the public Leaderboard displaying username performance.</li>
              <li>To diagnose technical errors, improve application load speed, and prevent abuse of the Service.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-white tracking-tight">4. Data Sharing and Transfer</h2>
            <p>
              We do not sell, trade, or rent your personal information to third parties. We only share information with third-party service providers as necessary to run the Service:
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong className="text-white">Google OAuth & Resend:</strong> For user authentication.
              </li>
              <li>
                <strong className="text-white">Vercel:</strong> For secure hosting and serverless functions deployment.
              </li>
              <li>
                <strong className="text-white">Polymarket:</strong> We pull public, real-time prediction market data from Polymarket API, but we do not share your private account or trading activity with them.
              </li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-white tracking-tight">5. Data Security</h2>
            <p>
              We prioritize data security by employing standard authentication protocols (OAuth 2.0 / OpenID Connect) and transport encryption (HTTPS/TLS). However, please note that no method of transmission over the internet or database storage is 100% secure. We strive to protect your info but cannot guarantee absolute security.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-white tracking-tight">6. Changes to this Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new policy on this page and updating the "Last Updated" date. You are advised to review this page periodically for any changes.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-white tracking-tight">7. Contact Us</h2>
            <p>
              If you have any questions about this Privacy Policy, please contact us at:
            </p>
            <p className="text-white font-medium">
              support@polymarkettraders.com
            </p>
          </section>
        </div>

        {/* Back Link */}
        <div className="mt-16 pt-8 border-t border-white/[0.06] flex justify-between items-center text-xs">
          <span className="text-foreground-muted">© 2026 PolyTrader. All rights reserved.</span>
          <Link href="/" className="text-primary-light hover:underline font-medium">
            Back to Home &rarr;
          </Link>
        </div>
      </div>
    </div>
  );
}
