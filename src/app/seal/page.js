import Header from '@/components/Header';
import { Footer } from '@/components/shared';
import SealDecoder from '@/components/SealDecoder';

export const metadata = {
  title: 'Seal decoder',
  description:
    'Decode a Terraform seal, a message or commitment stored in a Terraforms heightmap, from a parcel, a commit transaction or the digits.',
  alternates: { canonical: 'https://terraformmandala.xyz/seal' },
};

// Read-only: decoding happens in the browser; the parcel's canvas and the commit
// transaction are read through /api/parcel/[id]/canvas and /api/tx/[hash].
export default function SealPage() {
  return (
    <div className="content-wrapper">
      <Header />
      <main className="px-6 flex-1 max-w-3xl">
        <SealDecoder />
      </main>
      <Footer />
    </div>
  );
}
