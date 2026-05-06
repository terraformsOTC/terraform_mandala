import './globals.css';

const SITE_URL = 'https://terraformmandala.xyz';
const TITLE = 'Terraform Mandala';
const DESCRIPTION =
  'Design and preview custom heightmap mandalas on Terraforms parcels you own. Generate symmetric mandalas, render them on your parcel, export the uint256[16] dream array.';

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: `%s | ${TITLE}` },
  description: DESCRIPTION,
  alternates: { canonical: SITE_URL },
  openGraph: {
    siteName: TITLE,
    type: 'website',
    locale: 'en_US',
    url: SITE_URL,
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
