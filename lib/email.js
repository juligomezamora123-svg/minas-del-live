// Envío de correos con Resend (https://resend.com). Variables: RESEND_API_KEY y MAIL_FROM.
// Sin RESEND_API_KEY, en desarrollo el correo se escribe en la consola del servidor.

export function mailConfigured() {
  return !!process.env.RESEND_API_KEY;
}

export async function sendMail({ to, subject, text, html }) {
  if (!process.env.RESEND_API_KEY) {
    if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
      throw new Error('El envío de correos no está configurado (falta RESEND_API_KEY).');
    }
    console.log(`\n[correo de desarrollo] Para: ${to}\nAsunto: ${subject}\n${text}\n`);
    return { dev: true };
  }
  const from = process.env.MAIL_FROM || 'Minas del Live <onboarding@resend.dev>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text, html }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend respondió ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.json();
}
