// An in-memory stand-in for the parts of the GitHub API the app uses, including its sha
// checks, so sync can be tested without a network or a real token.

import { parseState, serialize } from '../js/store.js';
import { decodeBase64, encodeBase64 } from '../js/sync.js';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function fakeGitHub({ isPrivate = true } = {}) {
  const server = { file: null, sha: null, n: 0, offline: false, token: 'good', isPrivate, puts: 0, gets: 0 };
  server.fetch = async (url, options = {}) => {
    if (server.offline) throw new TypeError('Failed to fetch');
    if (options.headers?.Authorization !== `Bearer ${server.token}`) return json(401, { message: 'Bad credentials' });
    const { pathname } = new URL(url);
    if (pathname === '/repos/me/budget-data') return json(200, { private: server.isPrivate });
    if (pathname !== '/repos/me/budget-data/contents/budget.json') return json(404, {});
    if ((options.method ?? 'GET') === 'GET') {
      server.gets += 1;
      if (server.file === null) return json(404, {});
      return json(200, { type: 'file', encoding: 'base64', content: encodeBase64(server.file), sha: server.sha });
    }
    const body = JSON.parse(options.body);
    if (server.file !== null && !body.sha) return json(422, { message: 'sha required' });
    if (server.file !== null && body.sha !== server.sha) return json(409, { message: 'conflict' });
    server.file = decodeBase64(body.content);
    server.sha = `sha${(server.n += 1)}`;
    server.puts += 1;
    return json(200, { content: { sha: server.sha } });
  };
  // Simulates another device saving a change.
  server.edit = (fn) => {
    const state = parseState(server.file);
    fn(state);
    server.file = serialize(state);
    server.sha = `sha${(server.n += 1)}`;
  };
  server.state = () => parseState(server.file);
  return server;
}
