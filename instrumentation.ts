// Keyrt einu sinni þegar þjónninn ræsist: byrjar að sækja IPTV-listann strax
// svo hann sé tilbúinn þegar sjónvarpið opnar síðuna.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { warm } = await import('./lib/iptv');
    warm().catch(() => {});
  }
}
