#!/usr/bin/env node
// Obtiene el GMAIL_REFRESH_TOKEN para que la API envíe correos desde tu cuenta de Gmail.
// Uso: node scripts/gmail-auth.mjs <CLIENT_ID> <CLIENT_SECRET>
// Requiere un "ID de cliente OAuth" de tipo "App de escritorio" en Google Cloud Console.
import http from 'node:http';

const [clientId = process.env.GMAIL_CLIENT_ID, clientSecret = process.env.GMAIL_CLIENT_SECRET] = process.argv.slice(2);
if (!clientId || !clientSecret) {
  console.error('Uso: node scripts/gmail-auth.mjs <CLIENT_ID> <CLIENT_SECRET>');
  process.exit(1);
}

const PORT = 53682;
const redirectUri = `http://127.0.0.1:${PORT}/oauth2callback`;
const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/gmail.send',
    access_type: 'offline',
    prompt: 'consent',
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, redirectUri);
  if (url.pathname !== '/oauth2callback') return res.writeHead(404).end();

  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`Autorización cancelada: ${url.searchParams.get('error')}`);
    return server.close();
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  });
  const body = await tokenRes.json();

  if (!body.refresh_token) {
    console.error('\nGoogle no devolvió refresh_token:', body);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No se obtuvo el refresh token. Revisa la consola.');
  } else {
    console.log('\nListo. Agrega esta variable al backend en Railway:\n');
    console.log(`GMAIL_REFRESH_TOKEN=${body.refresh_token}\n`);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Listo. Ya puedes cerrar esta ventana y volver a la consola.');
  }
  server.close();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Abre este enlace en el navegador e inicia sesión con la cuenta de Gmail que enviará los correos:\n');
  console.log(authUrl);
});
