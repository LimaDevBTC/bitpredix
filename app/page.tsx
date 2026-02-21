import { MarketCardV4Wrapper } from '@/components/MarketCardV4Wrapper'
import { Footer } from '@/components/Footer'

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950">
      <div className="w-full max-w-2xl lg:max-w-6xl xl:max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-10">
        <MarketCardV4Wrapper />

        <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5 text-sm text-zinc-400">
          <h3 className="font-semibold text-zinc-300 mb-2">How it works</h3>
          <ul className="space-y-1.5">
            <li>• Each round lasts <strong className="text-zinc-300">1 minute</strong>.</li>
            <li>• Predictions close <strong className="text-zinc-300">5 seconds before the round ends</strong>.</li>
            <li>• Buy <strong className="text-up">UP</strong> if you think the price will rise, <strong className="text-down">DOWN</strong> if you think it will fall.</li>
            <li>• UP and DOWN prices are set by an AMM (LMSR).</li>
            <li>• At the end of the minute: if price went up, UP pays $1 per share; if it went down, DOWN pays $1 per share.</li>
          </ul>
        </section>

        <Footer />
      </div>
    </main>
  )
}
