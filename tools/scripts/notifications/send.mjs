#!/usr/bin/env node
// Sends a notification through notifications-service's HTTP API, to every device that hasn't
// muted its channel.
//
// Usage: node tools/scripts/notifications/send.mjs <title> [body] [options]
//   --channel <id>          defaults to "general"
//   --url <url>             opened on tap: "/path" is a route in the app, anything else opens externally
//   --data <json>           extra data delivered with it, e.g. '{"runId":"abc"}'
//   --priority <p>          default, normal or high
//   --silent                no sound
//   --ttl <seconds>         dropped if it can't be sent within this long (the service defaults to 1h)
//   --collapse-id <id>      replaces an earlier notification with the same ID on the device (iOS)
//   --idempotency-key <k>   sending the same key again within about an hour does nothing
//   --source <name>         who it's from (defaults to "tools/scripts/notifications")
//   --service-url <url>     notifications-service, e.g. https://notifications-service.wuguishifu.dev
//                           (or NOTIFICATIONS_SERVICE_URL)
//   --token <token>         its API_TOKEN (or NOTIFICATIONS_SERVICE_API_TOKEN)
//   --dry-run               print the request instead of sending it
//
// The URL and token come from this folder's .env.local (nx setup environment). The service checks
// the notification and says what's wrong with it, e.g. a channel that doesn't exist.
import { config } from 'dotenv';
import path from 'node:path';
import { parseArgs } from 'node:util';

config({ path: path.join(import.meta.dirname, '.env.local'), quiet: true });

const USAGE =
  'usage: send.mjs <title> [body] [--channel C] [--url U] [--data JSON] [--priority P] [--silent] [--ttl S] [--collapse-id ID] [--idempotency-key K] [--source S] [--service-url URL] [--token T] [--dry-run]';

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      channel: { type: 'string', default: 'general' },
      url: { type: 'string' },
      data: { type: 'string' },
      priority: { type: 'string' },
      silent: { type: 'boolean' },
      ttl: { type: 'string' },
      'collapse-id': { type: 'string' },
      'idempotency-key': { type: 'string' },
      source: { type: 'string', default: 'tools/scripts/notifications' },
      'service-url': {
        type: 'string',
        default: process.env.NOTIFICATIONS_SERVICE_URL,
      },
      token: {
        type: 'string',
        default: process.env.NOTIFICATIONS_SERVICE_API_TOKEN,
      },
      'dry-run': { type: 'boolean', default: false },
    },
  });
} catch (error) {
  console.error(`${error.message}\n${USAGE}`);
  process.exit(1);
}
const { positionals, values } = parsed;
if (positionals.length < 1 || positionals.length > 2) {
  console.error(USAGE);
  process.exit(1);
}
const [title, body] = positionals;

let data;
if (values.data !== undefined) {
  try {
    data = JSON.parse(values.data);
  } catch (error) {
    console.error(`--data isn't valid JSON: ${error.message}`);
    process.exit(1);
  }
}
const ttlSeconds = values.ttl === undefined ? undefined : Number(values.ttl);

const notification = {
  channel: values.channel,
  title,
  body,
  data,
  url: values.url,
  priority: values.priority,
  silent: values.silent,
  ttlSeconds,
  collapseId: values['collapse-id'],
  source: values.source,
  idempotencyKey: values['idempotency-key'],
};

const serviceUrl = values['service-url'];
const endpoint = serviceUrl && new URL('/api/notifications', serviceUrl);
if (values['dry-run']) {
  console.log(
    `POST ${endpoint ?? '<NOTIFICATIONS_SERVICE_URL>/api/notifications'}`,
  );
  console.log(JSON.stringify(notification, null, 2));
  process.exit(0);
}
if (!endpoint || !values.token) {
  console.error(
    'Set --service-url and --token (or NOTIFICATIONS_SERVICE_URL and NOTIFICATIONS_SERVICE_API_TOKEN)',
  );
  process.exit(1);
}

let response;
try {
  response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${values.token}`,
      'content-type': 'application/json',
    },
    // undefined fields are dropped
    body: JSON.stringify(notification),
  });
} catch (error) {
  console.error(
    `Couldn't reach ${endpoint.origin} (is Tailscale up?): ${error.cause?.code || error.cause?.message || error.message}`,
  );
  process.exit(1);
}

const text = await response.text();
if (!response.ok) {
  console.error(`${response.status} ${response.statusText}`);
  console.error(formatError(text));
  process.exit(1);
}
const { jobId } = JSON.parse(text);
console.log(`Queued "${title}" on ${values.channel} (job ${jobId})`);

/** ts-rest's validation errors, as one line per issue; anything else as it came. */
function formatError(text) {
  try {
    const { bodyResult } = JSON.parse(text);
    if (bodyResult?.issues) {
      return bodyResult.issues
        .map(
          ({ path, message }) => `  ${path.join('.') || '(body)'}: ${message}`,
        )
        .join('\n');
    }
  } catch {
    // not JSON
  }
  return text;
}
