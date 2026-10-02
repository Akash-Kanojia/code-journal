/**
 * In-memory GitHub REST API covering the endpoints Code Journal uses. Keeps real state
 * (commits, trees, refs) so tests verify behaviour — one commit per submission, file
 * contents, fast-forward checks — rather than canned responses.
 */
export interface FakeCommit {
  sha: string;
  message: string;
  parents: string[];
  files: Map<string, string>;
}

interface Repo {
  owner: string;
  name: string;
  private: boolean;
  push: boolean;
  defaultBranch: string;
  refs: Map<string, string>;
}

export class FakeGitHub {
  readonly token = 'gho_FAKE_TOKEN_DO_NOT_LOG';
  readonly commits = new Map<string, FakeCommit>();
  private readonly trees = new Map<string, Map<string, string>>();
  private readonly repos = new Map<string, Repo>();
  private counter = 0;
  /** Requests seen, as "METHOD path". */
  readonly requests: string[] = [];
  /** Lets a test inject a failure for the next matching request. */
  failNext: { match: RegExp; status: number; body?: unknown; headers?: Record<string, string> }[] =
    [];
  /** Called before a ref update; lets a test simulate a concurrent push. */
  beforeRefUpdate: (() => void) | undefined;

  addRepo(
    fullName: string,
    options: { private?: boolean; push?: boolean; empty?: boolean; branches?: string[] } = {},
  ): void {
    const [owner = '', name = ''] = fullName.split('/');
    const repo: Repo = {
      owner,
      name,
      private: options.private ?? false,
      push: options.push ?? true,
      defaultBranch: 'main',
      refs: new Map(),
    };
    if (options.empty !== true) {
      const root = this.commit(new Map([['README.md', 'hello\n']]), [], 'Initial commit');
      for (const branch of options.branches ?? ['main']) repo.refs.set(branch, root);
    }
    this.repos.set(fullName, repo);
  }

  head(fullName: string, branch = 'main'): FakeCommit | undefined {
    const sha = this.repos.get(fullName)?.refs.get(branch);
    return sha === undefined ? undefined : this.commits.get(sha);
  }

  /** Commit messages from the branch head back to the root. */
  log(fullName: string, branch = 'main'): string[] {
    const messages: string[] = [];
    let commit = this.head(fullName, branch);
    while (commit !== undefined) {
      messages.push(commit.message);
      const parent = commit.parents[0];
      commit = parent === undefined ? undefined : this.commits.get(parent);
    }
    return messages;
  }

  /** Simulates another client pushing a commit. */
  pushExternal(fullName: string, path: string, content: string, branch = 'main'): void {
    const repo = this.repo(fullName);
    const parent = this.commits.get(repo.refs.get(branch) ?? '');
    const files = new Map(parent?.files);
    files.set(path, content);
    repo.refs.set(branch, this.commit(files, parent === undefined ? [] : [parent.sha], 'external'));
  }

  readonly fetch: typeof fetch = (input, init) =>
    Promise.resolve().then(() => this.route(input, init));

  private route(input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]): Response {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const method = (init?.method ?? 'GET').toUpperCase();
    const route = `${method} ${url.pathname}`;
    this.requests.push(route);
    const headers = new Headers(init?.headers);
    if (headers.get('authorization') !== `Bearer ${this.token}`) {
      return json(401, { message: 'Bad credentials' });
    }
    const failure = this.failNext.findIndex((f) => f.match.test(route));
    if (failure !== -1) {
      const [f] = this.failNext.splice(failure, 1);
      if (f !== undefined) {
        if (f.status === 0) throw new TypeError('Failed to fetch');
        return json(f.status, f.body ?? { message: 'Injected failure' }, f.headers);
      }
    }
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    return this.handle(method, url, body, headers);
  }

  private handle(
    method: string,
    url: URL,
    body: Record<string, unknown>,
    headers: Headers,
  ): Response {
    const path = url.pathname;
    if (method === 'GET' && path === '/user') return json(200, { login: 'octo' });
    if (method === 'GET' && path === '/user/repos') {
      const page = Number(url.searchParams.get('page') ?? '1');
      const all = [...this.repos.values()].map((r) => ({
        name: r.name,
        full_name: `${r.owner}/${r.name}`,
        private: r.private,
        default_branch: r.defaultBranch,
        owner: { login: r.owner },
        permissions: { push: r.push },
      }));
      return json(200, all.slice((page - 1) * 100, page * 100));
    }
    const m = /^\/repos\/([^/]+)\/([^/]+)\/(.*)$/.exec(path);
    if (m === null) return json(404, { message: 'Not Found' });
    const repo = this.repos.get(
      `${decodeURIComponent(m[1] ?? '')}/${decodeURIComponent(m[2] ?? '')}`,
    );
    if (repo === undefined) return json(404, { message: 'Not Found' });
    const rest = m[3] ?? '';
    const empty = repo.refs.size === 0;

    if (method === 'GET' && rest === 'branches') {
      return json(
        200,
        [...repo.refs.keys()].map((name) => ({ name })),
      );
    }
    if (method === 'GET' && rest.startsWith('git/ref/heads/')) {
      if (empty) return json(409, { message: 'Git Repository is empty.' });
      const sha = repo.refs.get(decodeURIComponent(rest.slice('git/ref/heads/'.length)));
      return sha === undefined
        ? json(404, { message: 'Not Found' })
        : json(200, { object: { sha } });
    }
    if (method === 'GET' && rest.startsWith('git/commits/')) {
      const commit = this.commits.get(rest.slice('git/commits/'.length));
      return commit === undefined
        ? json(404, { message: 'Not Found' })
        : json(200, { sha: commit.sha, tree: { sha: `tree-${commit.sha}` } });
    }
    if (method === 'GET' && rest.startsWith('contents/')) {
      const filePath = rest.slice('contents/'.length).split('/').map(decodeURIComponent).join('/');
      const content = this.commits.get(url.searchParams.get('ref') ?? '')?.files.get(filePath);
      if (content === undefined) return json(404, { message: 'Not Found' });
      return headers.get('accept')?.includes('raw') === true
        ? new Response(content, { status: 200 })
        : json(200, { content: btoa(content) });
    }
    if (method === 'POST' && rest === 'git/trees') {
      if (!push(repo)) return json(403, { message: 'Resource not accessible by integration' });
      const baseSha = String(body.base_tree).replace(/^tree-/, '');
      const files = new Map(this.commits.get(baseSha)?.files);
      for (const entry of body.tree as { path: string; content: string }[])
        files.set(entry.path, entry.content);
      const sha = `t${String(++this.counter)}`;
      this.trees.set(sha, files);
      return json(201, { sha });
    }
    if (method === 'POST' && rest === 'git/commits') {
      const files = this.trees.get(String(body.tree));
      if (files === undefined) return json(422, { message: 'Tree SHA does not exist' });
      const commit = this.commit(files, body.parents as string[], String(body.message));
      return json(201, { sha: commit });
    }
    if (method === 'PATCH' && rest.startsWith('git/refs/heads/')) {
      this.beforeRefUpdate?.();
      this.beforeRefUpdate = undefined;
      const branch = decodeURIComponent(rest.slice('git/refs/heads/'.length));
      const current = repo.refs.get(branch);
      const next = this.commits.get(String(body.sha));
      if (current === undefined || next === undefined)
        return json(422, { message: 'Reference does not exist' });
      if (body.force !== true && next.parents[0] !== current) {
        return json(422, { message: 'Update is not a fast forward' });
      }
      repo.refs.set(branch, next.sha);
      return json(200, { object: { sha: next.sha } });
    }
    if (method === 'PUT' && rest.startsWith('contents/')) {
      if (!push(repo)) return json(403, { message: 'Resource not accessible by integration' });
      const filePath = rest.slice('contents/'.length).split('/').map(decodeURIComponent).join('/');
      const branch = String(body.branch);
      const parentSha = repo.refs.get(branch);
      const files = new Map(parentSha === undefined ? [] : this.commits.get(parentSha)?.files);
      files.set(
        filePath,
        new TextDecoder().decode(
          Uint8Array.from(atob(String(body.content)), (c) => c.charCodeAt(0)),
        ),
      );
      repo.refs.set(
        branch,
        this.commit(files, parentSha === undefined ? [] : [parentSha], String(body.message)),
      );
      return json(201, {});
    }
    return json(404, { message: `Unhandled ${method} ${path}` });
  }

  private repo(fullName: string): Repo {
    const repo = this.repos.get(fullName);
    if (repo === undefined) throw new Error(`no repo ${fullName}`);
    return repo;
  }

  private commit(files: Map<string, string>, parents: string[], message: string): string {
    const sha = `c${String(++this.counter)}`;
    this.commits.set(sha, { sha, message, parents, files: new Map(files) });
    return sha;
  }
}

function push(repo: Repo): boolean {
  return repo.push;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
