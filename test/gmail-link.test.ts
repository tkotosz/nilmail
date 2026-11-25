import assert from 'node:assert/strict';
import test from 'node:test';
import { gmailAppLink, gmailLink } from '../src/web/gmail-http.ts';

test('a conversation opens in Gmail on the web, for the signed-in account', () => {
  assert.equal(gmailLink('me@example.com', '18c2f'), 'https://mail.google.com/mail/?authuser=me%40example.com#all/18c2f');
});

test('on Android the same link goes to the Gmail app as an intent naming it', () => {
  assert.equal(
    gmailAppLink('me@example.com', '18c2f'),
    'intent://mail.google.com/mail/?authuser=me%40example.com#all/18c2f#Intent;scheme=https;package=com.google.android.gm;end',
  );
});
