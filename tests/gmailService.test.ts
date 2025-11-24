import assert from 'assert';
import { GmailService } from '../src/services/email/GmailService';

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {}
};

const service = new GmailService(noopLogger);
const serviceAny = service as any;

// Test search query builder
const query = serviceAny.buildSearchQuery({
  from: 'john@example.com',
  to: 'me@example.com',
  subjectContains: 'Invoice',
  textContains: '"refund status"',
  labelIds: ['INBOX', 'IMPORTANT']
});

assert(query.includes('from:(john@example.com)'), 'Query should include from filter');
assert(query.includes('to:(me@example.com)'), 'Query should include to filter');
assert(query.includes('subject:(Invoice)'), 'Query should include subject filter');
assert(query.includes('"refund status"'), 'Query should include raw text token');
assert(query.includes('label:INBOX'), 'Query should include label filters');

// Test reply subject formatting
assert.strictEqual(serviceAny.formatReplySubject('Invoice update'), 'Re: Invoice update');
assert.strictEqual(serviceAny.formatReplySubject('Re: Invoice update'), 'Re: Invoice update');

// Test composed payload encoding
const payload = serviceAny.composeEmailPayload({
  to: ['recipient@example.com'],
  subject: 'שלום',
  bodyHtml: '<p>Hello world</p>',
  bodyText: 'Hello world'
});

const decodedPayload = Buffer.from(
  payload.encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (payload.encoded.length % 4)) % 4),
  'base64'
).toString('utf8');

assert(decodedPayload.includes('To: recipient@example.com'), 'Payload should include To header');
assert(decodedPayload.includes('Subject: =?UTF-8?B?'), 'Subject should be encoded for non-ASCII');
assert(decodedPayload.includes('Hello world'), 'Payload should include message body');

console.log('✅ GmailService helper tests passed');


