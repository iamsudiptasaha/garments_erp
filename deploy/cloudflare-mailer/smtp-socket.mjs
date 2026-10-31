import { connect } from 'node:tls';

// Keep hostname resolution in the runtime; Nodemailer's resolved-IP path fails on Workers.
export function openGmailSocket(_options, callback, connectTls = connect) {
  const socket = connectTls({
    host: 'smtp.gmail.com',
    port: 465,
    servername: 'smtp.gmail.com',
    rejectUnauthorized: true,
  });
  let settled = false;
  const timeout = () =>
    socket.destroy(Object.assign(new Error('SMTP connection timeout'), { code: 'ETIMEDOUT' }));
  const fail = (error) => {
    if (settled) return;
    settled = true;
    socket.removeListener('secureConnect', ready);
    socket.removeListener('timeout', timeout);
    socket.destroy();
    callback(error);
  };
  const ready = () => {
    if (settled) return;
    settled = true;
    socket.removeListener('error', fail);
    socket.removeListener('timeout', timeout);
    socket.setTimeout(0);
    callback(null, { connection: socket, secured: true });
  };
  socket.once('error', fail);
  socket.once('secureConnect', ready);
  socket.setTimeout(10000, timeout);
}
