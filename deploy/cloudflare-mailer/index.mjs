import nodemailer from 'nodemailer';
import { openGmailSocket } from './smtp-socket.mjs';
import { createMailHandler } from './handler.mjs';
export default {
  fetch: createMailHandler(async (env, message) => {
    const transport = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      getSocket: openGmailSocket,
      auth: { user: env.GMAIL_ADDRESS, pass: env.GMAIL_APP_PASSWORD.replace(/\s/g, '') },
      tls: { rejectUnauthorized: true },
      logger: false,
      debug: false,
      connectionTimeout: 10000,
      socketTimeout: 15000,
    });
    try {
      await transport.sendMail(message);
    } catch (error) {
      // Log only fixed categories, never SMTP responses, credentials or message data.
      const known = [
        'EAUTH',
        'ECONNECTION',
        'ESOCKET',
        'ETIMEDOUT',
        'ESERVICE',
        'ENOTFOUND',
        'ETLS',
        'EENVELOPE',
        'EMESSAGE',
        'ESTREAM',
      ];
      console.error('Mailer SMTP category:', known.includes(error?.code) ? error.code : 'UNKNOWN');
      const hints = [
        'not implemented',
        'not supported',
        'certificate',
        'connect',
        'internal',
        'option',
        'address',
        'lookup',
        'network',
        'port',
        'stream',
        'context',
        'TLS',
        'DNS',
        'socket',
        'proxy',
        'refused',
      ];
      console.error(
        'Mailer network hints:',
        hints
          .filter((hint) =>
            String(error?.message || '')
              .toLowerCase()
              .includes(hint.toLowerCase()),
          )
          .join(','),
      );
      throw error;
    } finally {
      transport.close();
    }
  }),
};
