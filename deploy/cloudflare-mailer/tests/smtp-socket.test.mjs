import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { openGmailSocket } from '../smtp-socket.mjs';

function fixture(callback) {
  const socket = new EventEmitter();
  socket.setTimeout = (ms, listener) => {
    socket.timeout = ms;
    if (listener) socket.once('timeout', listener);
  };
  socket.destroy = (error) => {
    socket.destroyed = true;
    if (error) socket.emit('error', error);
  };
  openGmailSocket({}, callback, (options) => {
    assert.deepEqual(options, {
      host: 'smtp.gmail.com',
      port: 465,
      servername: 'smtp.gmail.com',
      rejectUnauthorized: true,
    });
    return socket;
  });
  return socket;
}

test('SMTP socket waits for verified TLS and passes a secured connection', () => {
  const calls = [];
  const socket = fixture((...args) => calls.push(args));
  socket.emit('connect');
  assert.equal(calls.length, 0);
  socket.emit('secureConnect');
  assert.deepEqual(calls, [[null, { connection: socket, secured: true }]]);
  assert.equal(socket.timeout, 0);
  assert.equal(socket.listenerCount('timeout'), 0);
});

test('SMTP timeout closes the socket and cannot later report success', () => {
  const calls = [];
  const socket = fixture((...args) => calls.push(args));
  socket.emit('timeout');
  socket.emit('secureConnect');
  assert.equal(socket.destroyed, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].code, 'ETIMEDOUT');
});
