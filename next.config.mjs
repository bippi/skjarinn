/** @type {import('next').NextConfig} */
const nextConfig = {
  // Sjálfstæð keyrsla í Docker (sjá Dockerfile)
  output: 'standalone',
  // Sjónvarpsviðmótið er hreint ES5 í public/ (Tizen 2017 vafrinn ræður ekki við
  // nútíma React/Next runtime). Next sér bara um EPG-proxy og hýsingu.
  async rewrites() {
    return [{ source: '/', destination: '/index.html' }];
  },
  async headers() {
    return [
      {
        source: '/:file(tv\\.js|tv\\.css|channels\\.js|index\\.html)',
        headers: [{ key: 'Cache-Control', value: 'no-cache' }],
      },
    ];
  },
};

export default nextConfig;
