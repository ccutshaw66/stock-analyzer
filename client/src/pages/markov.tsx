import { Network, FlaskConical, FileCode, ArrowRight } from "lucide-react";
import { Disclaimer } from "@/components/Disclaimer";

export default function MarkovPage() {
  return (
    <div className="p-3 sm:p-6 space-y-4 max-w-4xl mx-auto">
      <div className="flex items-start gap-2 px-3 py-2 bg-purple-500/5 border border-purple-500/30 rounded-lg text-[11px] text-purple-200 leading-relaxed">
        <FlaskConical className="h-3.5 w-3.5 mt-0.5 shrink-0 text-purple-400" />
        <span>
          <strong>Experimental.</strong> The Markov strategy is not wired up
          yet. This page is a stub.
        </span>
      </div>

      <header className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-lg bg-purple-500/15 flex items-center justify-center shrink-0">
          <Network className="h-5 w-5 text-purple-400" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
            Markov Strategy
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 uppercase tracking-wider">
              Coming Soon
            </span>
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            State-transition model for regime detection and signal generation.
          </p>
        </div>
      </header>

      <section className="bg-card border border-card-border rounded-xl p-5">
        <div className="flex items-center gap-2 text-sm font-bold text-foreground mb-3">
          <FileCode className="h-4 w-4 text-primary" />
          What's missing
        </div>
        <ol className="space-y-3 text-sm text-muted-foreground">
          <li className="flex gap-3">
            <span className="shrink-0 h-5 w-5 rounded-full bg-primary/15 text-primary text-[11px] font-bold flex items-center justify-center">
              1
            </span>
            <div>
              <p className="text-foreground font-semibold">Locate the Markov <code className="text-[11px] bg-muted px-1 py-0.5 rounded">.py</code> file</p>
              <p className="text-xs mt-0.5">
                You said you have a Python implementation — drop the file in
                the repo (e.g. <code className="text-[11px] bg-muted px-1 py-0.5 rounded">server/strategies/markov.py</code>) so it can be ported or
                exposed via an API endpoint.
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 h-5 w-5 rounded-full bg-primary/15 text-primary text-[11px] font-bold flex items-center justify-center">
              2
            </span>
            <div>
              <p className="text-foreground font-semibold">Decide the integration shape</p>
              <p className="text-xs mt-0.5">
                Three reasonable options: (a) port the Python to TypeScript for
                in-browser computation, (b) run it server-side as a Node child
                process, or (c) host the Python on Railway (like HERMES) and
                hit it over HTTP.
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 h-5 w-5 rounded-full bg-primary/15 text-primary text-[11px] font-bold flex items-center justify-center">
              3
            </span>
            <div>
              <p className="text-foreground font-semibold">Build the UI</p>
              <p className="text-xs mt-0.5">
                Once we know the inputs/outputs of the model, fill in this page
                with the state matrix, current regime, transition probabilities,
                and any trade signals it produces.
              </p>
            </div>
          </li>
        </ol>

        <div className="mt-5 flex items-center gap-2 text-[11px] text-muted-foreground">
          <ArrowRight className="h-3 w-3" />
          When you've found the file, drop it in and we'll wire it up.
        </div>
      </section>

      <Disclaimer />
    </div>
  );
}
