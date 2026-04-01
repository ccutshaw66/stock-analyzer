import { useState } from "react";
import iconUrl from "@/assets/icon.png";
import logoTextUrl from "@/assets/logo-text.png";

type Tab = "terms" | "privacy";

export default function LegalPage() {
  const [tab, setTab] = useState<Tab>(() => {
    const hash = window.location.hash || "";
    if (hash.includes("privacy")) return "privacy";
    return "terms";
  });

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#040d22" }}>
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <img src={iconUrl} alt="" className="h-8 w-8 rounded-lg" />
          <img src={logoTextUrl} alt="Stock Otter" className="h-5 w-auto" />
        </div>

        {/* Tabs */}
        <div className="flex gap-4 mb-8 border-b border-[#1E2235]">
          <button
            onClick={() => setTab("terms")}
            className={`pb-3 text-sm font-semibold ${tab === "terms" ? "text-white border-b-2 border-primary" : "text-[#6b7084]"}`}
          >Terms of Service</button>
          <button
            onClick={() => setTab("privacy")}
            className={`pb-3 text-sm font-semibold ${tab === "privacy" ? "text-white border-b-2 border-primary" : "text-[#6b7084]"}`}
          >Privacy Policy</button>
        </div>

        {tab === "terms" ? <TermsOfService /> : <PrivacyPolicy />}

        <div className="mt-12 pt-6 border-t border-[#1E2235] text-center">
          <p className="text-[11px] text-[#4a4f65]">Stock Otter &copy; {new Date().getFullYear()} &mdash; All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="text-base font-bold text-white mb-3">{title}</h2>
      <div className="text-sm text-[#8b8fa3] leading-relaxed space-y-3">{children}</div>
    </div>
  );
}

function TermsOfService() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-2">Terms of Service</h1>
      <p className="text-xs text-[#6b7084] mb-8">Last updated: {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>

      <Section title="1. Acceptance of Terms">
        <p>By accessing or using Stock Otter ("the Service"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.</p>
      </Section>

      <Section title="2. Not Financial Advice">
        <p><strong className="text-yellow-400">Stock Otter is NOT a registered investment advisor, broker-dealer, or financial planner.</strong> All data, scores, analysis, trade ideas, market maker positioning, and any other information provided by the Service are for <strong className="text-white">educational and informational purposes only.</strong></p>
        <p>The Service does not provide personalized investment advice. Any "trade ideas" or "suggestions" are algorithmic outputs based on publicly available data and should not be construed as recommendations to buy, sell, or hold any security.</p>
        <p><strong className="text-white">You are solely responsible for your own investment decisions.</strong> Past performance does not guarantee future results. All investments carry risk, including the possible loss of principal.</p>
      </Section>

      <Section title="3. User Accounts">
        <p>You must provide accurate information when creating an account. You are responsible for maintaining the security of your account credentials. You must be at least 18 years old to use the Service.</p>
      </Section>

      <Section title="4. Subscriptions and Billing">
        <p>Paid subscriptions are billed monthly through Stripe. You may cancel at any time through the billing portal. Cancellation takes effect at the end of the current billing period. No refunds are provided for partial months.</p>
        <p>We reserve the right to change pricing with 30 days notice to existing subscribers.</p>
      </Section>

      <Section title="5. Data Accuracy">
        <p>Stock Otter sources market data from third-party providers including Yahoo Finance. While we strive for accuracy, we cannot guarantee that all data is complete, accurate, or timely. Data may be delayed, incomplete, or contain errors.</p>
        <p>You should always verify critical information through your brokerage platform before making trading decisions.</p>
      </Section>

      <Section title="6. Acceptable Use">
        <p>You agree not to: (a) reverse-engineer, scrape, or extract data from the Service for redistribution; (b) share your account with others; (c) use the Service for any illegal purpose; (d) attempt to circumvent subscription limits or feature restrictions.</p>
      </Section>

      <Section title="7. Limitation of Liability">
        <p>TO THE MAXIMUM EXTENT PERMITTED BY LAW, STOCK OTTER AND ITS OPERATORS SHALL NOT BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR EXEMPLARY DAMAGES, INCLUDING BUT NOT LIMITED TO DAMAGES FOR LOSS OF PROFITS, GOODWILL, OR DATA, RESULTING FROM YOUR USE OF THE SERVICE OR ANY TRADING DECISIONS MADE BASED ON INFORMATION PROVIDED BY THE SERVICE.</p>
      </Section>

      <Section title="8. Indemnification">
        <p>You agree to indemnify and hold harmless Stock Otter and its operators from any claims, losses, or damages arising from your use of the Service or your trading activities.</p>
      </Section>

      <Section title="9. Modifications">
        <p>We may update these Terms at any time. Continued use of the Service after changes constitutes acceptance of the updated Terms.</p>
      </Section>

      <Section title="10. Termination">
        <p>We reserve the right to suspend or terminate your account at any time for violation of these Terms or for any reason at our discretion.</p>
      </Section>

      <Section title="11. Contact">
        <p>Questions about these Terms? Contact us at <a href="mailto:support@stockotter.ai" className="text-primary hover:underline">support@stockotter.ai</a></p>
      </Section>
    </div>
  );
}

function PrivacyPolicy() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-2">Privacy Policy</h1>
      <p className="text-xs text-[#6b7084] mb-8">Last updated: {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>

      <Section title="1. Information We Collect">
        <p><strong className="text-white">Account Information:</strong> Email address, display name, and encrypted password when you register.</p>
        <p><strong className="text-white">Trading Data:</strong> Trades, watchlists, and portfolio data you enter into the Service. This data is stored securely and is only accessible to you.</p>
        <p><strong className="text-white">Usage Data:</strong> Pages visited, features used, and scan frequency for improving the Service.</p>
        <p><strong className="text-white">Payment Data:</strong> Processed entirely by Stripe. We do not store credit card numbers.</p>
      </Section>

      <Section title="2. How We Use Your Information">
        <p>We use your information to: (a) provide and improve the Service; (b) process payments; (c) send account-related emails (password resets, billing); (d) enforce our Terms of Service.</p>
        <p>We do NOT sell your personal information to third parties. We do NOT share your trading data with anyone.</p>
      </Section>

      <Section title="3. Data Storage and Security">
        <p>Your data is stored on secure servers with encrypted connections (SSL/TLS). Passwords are hashed using bcrypt. We implement reasonable security measures but cannot guarantee absolute security.</p>
      </Section>

      <Section title="4. Third-Party Services">
        <p>We use the following third-party services:</p>
        <p>&bull; <strong className="text-white">Yahoo Finance</strong> — market data (governed by Yahoo's terms)<br/>
        &bull; <strong className="text-white">Stripe</strong> — payment processing (governed by Stripe's privacy policy)<br/>
        &bull; <strong className="text-white">Office 365</strong> — transactional email delivery</p>
      </Section>

      <Section title="5. Cookies">
        <p>We use HTTP-only secure cookies for authentication (session management). We do not use tracking cookies or third-party analytics cookies.</p>
      </Section>

      <Section title="6. Data Retention">
        <p>Your account data is retained as long as your account is active. You may request deletion of your account and all associated data by contacting us. We will process deletion requests within 30 days.</p>
      </Section>

      <Section title="7. Your Rights">
        <p>You have the right to: (a) access your personal data; (b) correct inaccurate data; (c) request deletion of your data; (d) export your trading data. Contact us to exercise these rights.</p>
      </Section>

      <Section title="8. Children's Privacy">
        <p>The Service is not intended for users under 18. We do not knowingly collect information from minors.</p>
      </Section>

      <Section title="9. Changes to This Policy">
        <p>We may update this Privacy Policy periodically. We will notify registered users of material changes via email.</p>
      </Section>

      <Section title="10. Contact">
        <p>Privacy questions? Contact us at <a href="mailto:privacy@stockotter.ai" className="text-primary hover:underline">privacy@stockotter.ai</a></p>
      </Section>
    </div>
  );
}
