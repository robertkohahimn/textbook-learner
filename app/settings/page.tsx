import { Settings } from "@/components/settings";
import { Wordmark } from "@/components/bits";

// No server-side data access: the frontend has no database in the split
// deployment, so <Settings/> loads state from /api/settings on the client.
export default function SettingsPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 pb-24">
      <header className="flex items-center justify-between py-8">
        <Wordmark />
      </header>
      <Settings />
    </main>
  );
}
