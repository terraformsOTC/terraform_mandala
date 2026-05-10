const SITE_URL = 'https://terraformmandala.xyz';

export default function robots() {
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
