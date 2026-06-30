import { Settings } from "@/components/settings";
import { Wordmark } from "@/components/bits";
import { settingsState } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 pb-24">
      <header className="flex items-center justify-between py-8">
        <Wordmark />
      </header>
      <Settings initial={settingsState()} />
    </main>
  );
}
