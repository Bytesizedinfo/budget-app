// Shown on any device that hasn't been connected yet. No budget data is visible here.

import { h } from '../dom.js';

const STEPS = [
  ['On GitHub, ', h('a', { href: 'https://github.com/new', target: '_blank', rel: 'noopener noreferrer' }, 'create a repository'), ' called ', h('code', {}, 'budget-data'), ' and set it to ', h('strong', {}, 'Private'), '.'],
  ['Open ', h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener noreferrer' }, 'new fine-grained token'), '. Give it a name and an expiry date.'],
  ['Under ', h('strong', {}, 'Repository access'), ', choose ', h('strong', {}, 'Only select repositories'), ' and pick ', h('code', {}, 'budget-data'), '.'],
  ['Under ', h('strong', {}, 'Permissions'), ', set ', h('strong', {}, 'Contents'), ' to ', h('strong', {}, 'Read and write'), '.'],
  ['Generate the token, copy it, and paste it below. Your browser can save it like a password.'],
];

// Accepts "owner/repo" or a full GitHub URL in the repository box.
function cleanConfig({ owner, repo, path, token }) {
  let o = owner.trim().replace(/^@/, '');
  let r = repo.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '').replace(/\/+$/, '');
  if (r.includes('/')) [o, r] = [o || r.split('/')[0], r.split('/')[1]];
  return { owner: o, repo: r, path: path.trim().replace(/^\/+/, '') || 'budget.json', token: token.trim() };
}

function explain(err) {
  if (err.kind === 'auth') return 'GitHub didn’t accept that token. Check that you copied all of it and that it hasn’t expired.';
  if (err.kind === 'network') return 'Couldn’t reach GitHub. Check your internet connection and try again.';
  return err.message;
}

export function renderSetup(ctx, onConnected) {
  const input = (props) => {
    const el = h('input', { class: 'input', autocapitalize: 'none', autocomplete: 'off', ...props });
    el.spellcheck = false;
    return el;
  };
  const owner = input({ name: 'owner', autocomplete: 'username', placeholder: 'your-github-username' });
  const repo = input({ name: 'repo', value: 'budget-data' });
  const token = input({ name: 'token', type: 'password', autocomplete: 'current-password', placeholder: 'github_pat_…' });
  const path = input({ name: 'path', value: 'budget.json' });
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'Connect');
  const showError = (message) => {
    error.textContent = message;
    error.hidden = false;
  };

  const form = h('form', {
    class: 'form-grid',
    novalidate: true,
    onsubmit: async (event) => {
      event.preventDefault();
      error.hidden = true;
      const config = cleanConfig({ owner: owner.value, repo: repo.value, path: path.value, token: token.value });
      if (!config.owner || !config.repo || !config.token) {
        showError('Fill in your GitHub username, the repository name and the access token.');
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Connecting…';
      try {
        await ctx.sync.connect(config);
        onConnected();
      } catch (err) {
        showError(explain(err));
        submit.disabled = false;
        submit.textContent = 'Connect';
      }
    },
  },
    label('GitHub username', owner),
    label('Repository', repo, 'A private repository that holds your budget file.'),
    label('Access token', token),
    h('details', { class: 'advanced' }, h('summary', {}, 'Advanced'), label('File name', path)),
    error,
    submit);

  document.getElementById('app').replaceChildren(h('main', { class: 'setup', id: 'main' },
    h('div', { class: 'setup-card' },
      h('div', { class: 'brand brand-lg' }, h('img', { src: 'icon.svg', alt: '', width: 36, height: 36 }), 'Budget'),
      h('h1', {}, 'Connect your budget'),
      h('p', { class: 'lead' }, 'Your budget is saved in a private GitHub repository that only you can access. Connect it once on each device you use.'),
      h('div', { class: 'card' }, form),
      h('details', { class: 'howto' },
        h('summary', {}, 'How do I get these?'),
        h('ol', {}, STEPS.map((step) => h('li', {}, step)))),
      h('p', { class: 'setup-foot' }, 'Want to look around first? ', h('a', { href: '?demo' }, 'Try it with sample data'), '.'))));
}

function label(text, control, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, text), control, hint ? h('span', { class: 'field-hint' }, hint) : null);
}
