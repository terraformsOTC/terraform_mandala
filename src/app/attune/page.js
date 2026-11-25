import Header from '@/components/Header';
import { Footer } from '@/components/shared';
import AttunePanel from '@/components/AttunePanel';

// Unlinked on purpose (James, 2026-11-25): not in the header, the sitemap or
// robots.txt, since listing it there would advertise it. Its one write is
// setAttunement, through lib/commit.js with the same checks as the other writes.
export const metadata = {
  title: 'Attune',
  description: "Set a Terraforms parcel's attunement.",
  robots: { index: false, follow: false },
};

export default function AttunePage() {
  return (
    <div className="content-wrapper">
      <Header />
      <main className="px-6 flex-1">
        <AttunePanel />
      </main>
      <Footer />
    </div>
  );
}
