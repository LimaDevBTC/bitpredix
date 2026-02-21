export function Footer() {
  return (
    <footer className="mt-12 pt-8 border-t border-zinc-800/50">
      <div className="flex flex-col items-center gap-4 text-xs text-zinc-500">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Predix" className="h-8 w-auto opacity-50" />
          <span className="text-zinc-600">·</span>
          <span className="text-zinc-500">beta</span>
        </div>
        <div className="text-zinc-600">
          © 2026 Predix. All rights reserved.
        </div>
        <div className="text-zinc-600/80 text-[10px] max-w-md text-center leading-relaxed">
          This is a beta version. Predictions are simulated. Not financial advice.
        </div>
      </div>
    </footer>
  )
}
