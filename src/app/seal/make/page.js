import DesignerApp from '@/components/DesignerApp';

export const metadata = {
  title: 'Seal maker',
  description:
    'Hide a message or a commitment in a drawing and commit it to a dreaming Terraforms parcel. Everything happens in your browser.',
  alternates: { canonical: 'https://terraformmandala.xyz/seal/make' },
};

// The seal maker (James, 2026-11-19: "lets separate the seal function out from the normal
// heightmaps"): the designer with the seal pattern alone; decoding stays at /seal.
export default function SealMakePage() {
  return <DesignerApp variant="seal" />;
}
