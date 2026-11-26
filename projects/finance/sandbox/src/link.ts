// Serves a local page that runs Plaid Link, then exchanges the public token for an access token
// and saves it to .data/<env>/items.json for fetch.ts to use.
//
// Usage: nx link finance-sandbox  (then open http://localhost:8787)
import { z } from 'zod';

import { createServer, type IncomingMessage } from 'node:http';

import { env } from './env.ts';
import { LINK_PRODUCTS } from './link-products.ts';
import { formatPlaidError, plaid } from './plaid.ts';
import { linkKindSchema, loadItems, saveItem, type LinkKind } from './store.ts';

const linkTokenRequestSchema = z.object({ kind: linkKindSchema });
const exchangeRequestSchema = z.object({
  public_token: z.string(),
  kind: linkKindSchema,
});

const readJson = async <T>(
  req: IncomingMessage,
  schema: z.ZodType<T>,
): Promise<T | undefined> => {
  let body = '';
  for await (const chunk of req) body += chunk;
  try {
    return schema.safeParse(JSON.parse(body)).data;
  } catch {
    return undefined;
  }
};

const createLinkToken = async (kind: LinkKind): Promise<string> => {
  const { link_token } = await plaid.link.createToken({
    client_name: 'Finance Sandbox',
    language: 'en',
    country_codes: ['US'],
    user: { client_user_id: 'finance-sandbox-local' },
    ...LINK_PRODUCTS[kind],
    // pull as much history as plaid allows on the first sync
    transactions: { days_requested: 730 },
  });
  return link_token;
};

const exchange = async (publicToken: string, kind: LinkKind) => {
  const { access_token, item_id } = await plaid.item.exchangePublicToken({
    public_token: publicToken,
  });
  const { item } = await plaid.item.get({ access_token });
  const stored = {
    item_id,
    access_token,
    institution_id: item.institution_id ?? null,
    institution_name: item.institution_name ?? null,
    kind,
    linked_at: new Date().toISOString(),
  };
  saveItem(stored);
  console.log(
    `Linked ${stored.institution_name ?? stored.institution_id} (${kind}), products: ${item.products.join(', ')}`,
  );
  return stored;
};

const listItems = () => loadItems().map(({ access_token: _, ...rest }) => rest);

const server = createServer(async (req, res) => {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  try {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
      return;
    }
    if (req.method === 'GET' && req.url === '/api/items') {
      send(200, listItems());
      return;
    }
    if (req.method === 'POST' && req.url === '/api/link-token') {
      const body = await readJson(req, linkTokenRequestSchema);
      if (!body) return send(400, { error: 'invalid request' });
      send(200, { link_token: await createLinkToken(body.kind) });
      return;
    }
    if (req.method === 'POST' && req.url === '/api/exchange') {
      const body = await readJson(req, exchangeRequestSchema);
      if (!body) return send(400, { error: 'invalid request' });
      const { access_token: _, ...item } = await exchange(
        body.public_token,
        body.kind,
      );
      send(200, item);
      return;
    }
    send(404, { error: 'not found' });
  } catch (error) {
    const message = formatPlaidError(error);
    console.error(`ERROR: ${req.method} ${req.url}: ${message}`);
    send(500, { error: message });
  }
});

// localhost only: this server hands out tokens for your real accounts in production
server.listen(env.PORT, '127.0.0.1', () => {
  console.log(
    `Plaid Link (${env.PLAID_ENV}) running at http://localhost:${env.PORT}`,
  );
});

const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Finance Sandbox · Link</title>
  <script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
  <style>
    body { font: 15px/1.5 system-ui, sans-serif; max-width: 640px; margin: 48px auto; padding: 0 16px; }
    button { font: inherit; padding: 8px 14px; margin-right: 8px; cursor: pointer; }
    #status { margin: 16px 0; min-height: 1.5em; }
    .error { color: #b00020; }
    li { margin: 4px 0; }
    code { font-size: 13px; color: #666; }
  </style>
</head>
<body>
  <h1>Link an account <small>(${env.PLAID_ENV})</small></h1>
  <p>
    <button data-kind="bank">Bank / credit card</button>
    <button data-kind="investments">Brokerage / 401(k)</button>
  </p>
  <div id="status"></div>
  <h2>Linked items</h2>
  <ul id="items"></ul>
  <script>
    const status = document.getElementById('status');
    const setStatus = (text, isError) => {
      status.textContent = text;
      status.className = isError ? 'error' : '';
    };

    const post = async (url, body) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      return json;
    };

    const refreshItems = async () => {
      const items = await (await fetch('/api/items')).json();
      document.getElementById('items').innerHTML = items.length
        ? items
            .map((i) => '<li>' + (i.institution_name ?? i.institution_id) + ' · ' + i.kind + ' <code>' + i.item_id + '</code></li>')
            .join('')
        : '<li>none yet</li>';
    };

    const link = async (kind) => {
      try {
        setStatus('Creating link token…');
        const { link_token } = await post('/api/link-token', { kind });
        Plaid.create({
          token: link_token,
          onSuccess: async (public_token, metadata) => {
            try {
              setStatus('Exchanging token…');
              const item = await post('/api/exchange', { public_token, kind });
              setStatus('Linked ' + (item.institution_name ?? metadata.institution?.name));
              refreshItems();
            } catch (error) {
              setStatus(error.message, true);
            }
          },
          onExit: (error) => setStatus(error ? error.display_message || error.error_message : '', !!error),
        }).open();
      } catch (error) {
        setStatus(error.message, true);
      }
    };

    for (const button of document.querySelectorAll('button[data-kind]')) {
      button.addEventListener('click', () => link(button.dataset.kind));
    }
    refreshItems();
  </script>
</body>
</html>`;
