// Relaie une alerte du confessionnal vers Telegram.
// Variables d'environnement Netlify : TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, NOTIFY_KEY.
export default async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, NOTIFY_KEY } = process.env;
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return new Response('Telegram non configuré', { status: 500 });
  if (NOTIFY_KEY && req.headers.get('x-notify-key') !== NOTIFY_KEY) return new Response('Forbidden', { status: 403 });

  let text = '';
  try { ({ text = '' } = await req.json()); } catch { return new Response('Bad Request', { status: 400 }); }
  text = String(text).slice(0, 1000);
  if (!text) return new Response('Bad Request', { status: 400 });

  const chats = String(TELEGRAM_CHAT_ID).split(',').map((s) => s.trim()).filter(Boolean);
  const results = await Promise.all(chats.map((chat_id) =>
    fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id, text, disable_web_page_preview: true })
    }).then((r) => r.ok).catch(() => false)
  ));
  return results.some(Boolean) ? new Response('ok') : new Response('Telegram a refusé le message', { status: 502 });
};
