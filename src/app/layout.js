import './globals.css';

const SITE_URL = 'https://terraformmandala.xyz';
const TITLE = 'Terraform Mandala';
const DESCRIPTION =
  'Heightmap mandala designer for Terraforms parcels. Generate symmetric mandalas, preview them on any of your owned parcels with the on-chain daydream renderer, and export the uint256[16] dream array to commit on-chain.';
const KEYWORDS = [
  'Terraforms',
  'Terraforms parcels',
  'heightmap',
  'mandala',
  'mandala generator',
  'dream array',
  'daydream',
  'on-chain art',
  'mathcastles',
  'd3l33t',
  'uint256[16]',
  'terraformmandala',
];
const OG_IMAGE_ALT = 'Terraform Mandala — heightmap mandala generator for Terraforms parcels';

const JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: TITLE,
  url: SITE_URL,
  description: DESCRIPTION,
  applicationCategory: 'DesignApplication',
  operatingSystem: 'Any (browser)',
  browserRequirements: 'Requires JavaScript and a Web3 wallet (e.g., MetaMask) to load owned parcels',
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  image: `${SITE_URL}/opengraph-image`,
  inLanguage: 'en',
  about: {
    '@type': 'CreativeWork',
    name: 'Terraforms by Mathcastles',
    url: 'https://terraforms.xyz',
  },
};

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: `%s | ${TITLE}` },
  description: DESCRIPTION,
  keywords: KEYWORDS,
  applicationName: TITLE,
  category: 'design',
  alternates: { canonical: SITE_URL },
  openGraph: {
    siteName: TITLE,
    type: 'website',
    locale: 'en_US',
    url: SITE_URL,
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: OG_IMAGE_ALT,
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: '/twitter-image', alt: OG_IMAGE_ALT }],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport = {
  themeColor: '#0a0a0a',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark">
      <head>
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
