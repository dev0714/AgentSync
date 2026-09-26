import 'server-only';
import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { resolveSecret } from './secrets';

/**
 * The GitHub side of a task, through the tenant's GitHub App.
 *
 * Tokens are minted per installation and never stored. Everything the agents
 * do to a repository — read files, branch, commit, open and merge a pull
 * request — goes through here, so the repository allowlist is checked in one
 * place.
 */

export type Installation = {
  app_id: number | null;
  installation_id: number;
  private_key_reference: string;
  repository_allowlist: string[] | null;
};

export type Repo = { owner: string; repo: string; defaultBranch: string };

export async function githubFor(install: Installation | null, repo: Repo): Promise<Octokit> {
  if (!install) throw new Error('no GitHub App is connected for this tenant');
  if (!install.app_id) throw new Error('the GitHub connection has no app id');

  const allow = install.repository_allowlist ?? [];
  const full = `${repo.owner}/${repo.repo}`;
  if (allow.length > 0 && !allow.some((a) => a.toLowerCase() === full.toLowerCase())) {
    throw new Error(`${full} is not on the GitHub App's repository allowlist`);
  }

  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: install.app_id,
      privateKey: await resolveSecret(install.private_key_reference),
      installationId: install.installation_id,
    },
    userAgent: 'agentsync',
  });
}

/** Every file path on a branch (blobs only). */
export async function listPaths(gh: Octokit, r: Repo, ref: string): Promise<string[]> {
  const { data } = await gh.git.getTree({
    owner: r.owner,
    repo: r.repo,
    tree_sha: ref,
    recursive: 'true',
  });
  return data.tree.filter((t) => t.type === 'blob' && t.path).map((t) => t.path as string);
}

/** A file's text at a ref, or null when it doesn't exist. */
export async function readFile(
  gh: Octokit,
  r: Repo,
  path: string,
  ref: string,
): Promise<string | null> {
  try {
    const { data } = await gh.repos.getContent({ owner: r.owner, repo: r.repo, path, ref });
    if (Array.isArray(data) || data.type !== 'file') return null;
    return Buffer.from(data.content, 'base64').toString('utf8');
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
}

export async function branchSha(gh: Octokit, r: Repo, branch: string): Promise<string | null> {
  try {
    const { data } = await gh.git.getRef({ owner: r.owner, repo: r.repo, ref: `heads/${branch}` });
    return data.object.sha;
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
}

/** Creates `branch` from the default branch if it doesn't exist yet; returns its head. */
export async function ensureBranch(gh: Octokit, r: Repo, branch: string): Promise<string> {
  const existing = await branchSha(gh, r, branch);
  if (existing) return existing;
  const base = await branchSha(gh, r, r.defaultBranch);
  if (!base) throw new Error(`default branch ${r.defaultBranch} not found`);
  await gh.git.createRef({ owner: r.owner, repo: r.repo, ref: `refs/heads/${branch}`, sha: base });
  return base;
}

export type FileWrite = { path: string; content: string | null }; // null deletes

/** One commit with every change, via the Git Data API (no checkout needed). */
export async function commitFiles(
  gh: Octokit,
  r: Repo,
  branch: string,
  message: string,
  files: FileWrite[],
): Promise<string> {
  const head = await ensureBranch(gh, r, branch);
  const { data: headCommit } = await gh.git.getCommit({
    owner: r.owner,
    repo: r.repo,
    commit_sha: head,
  });

  const tree = await Promise.all(
    files.map(async (f) => {
      if (f.content === null) {
        return { path: f.path, mode: '100644' as const, type: 'blob' as const, sha: null };
      }
      const { data: blob } = await gh.git.createBlob({
        owner: r.owner,
        repo: r.repo,
        content: Buffer.from(f.content, 'utf8').toString('base64'),
        encoding: 'base64',
      });
      return { path: f.path, mode: '100644' as const, type: 'blob' as const, sha: blob.sha };
    }),
  );

  const { data: newTree } = await gh.git.createTree({
    owner: r.owner,
    repo: r.repo,
    base_tree: headCommit.tree.sha,
    tree,
  });
  const { data: commit } = await gh.git.createCommit({
    owner: r.owner,
    repo: r.repo,
    message,
    tree: newTree.sha,
    parents: [head],
  });
  await gh.git.updateRef({
    owner: r.owner,
    repo: r.repo,
    ref: `heads/${branch}`,
    sha: commit.sha,
  });
  return commit.sha;
}

export type CheckState = {
  pending: number;
  runs: {
    id: number;
    name: string;
    conclusion: string | null;
    started_at: string | null;
    completed_at: string | null;
    summary: string | null;
    app: string | null;
  }[];
};

export async function checksFor(gh: Octokit, r: Repo, sha: string): Promise<CheckState> {
  const { data } = await gh.checks.listForRef({
    owner: r.owner,
    repo: r.repo,
    ref: sha,
    per_page: 100,
  });
  const runs = data.check_runs.map((c) => ({
    id: c.id,
    name: c.name,
    conclusion: c.status === 'completed' ? (c.conclusion ?? 'neutral') : null,
    started_at: c.started_at ?? null,
    completed_at: c.completed_at ?? null,
    summary: [c.output?.title, c.output?.summary, c.output?.text].filter(Boolean).join('\n') || null,
    app: c.app?.slug ?? null,
  }));
  return { pending: runs.filter((c) => c.conclusion === null).length, runs };
}

/** The tail of a GitHub Actions job's log — where the failure usually is. */
export async function jobLogTail(gh: Octokit, r: Repo, jobId: number, chars = 6000): Promise<string | null> {
  try {
    const res = await gh.actions.downloadJobLogsForWorkflowRun({
      owner: r.owner,
      repo: r.repo,
      job_id: jobId,
    });
    const text = typeof res.data === 'string' ? res.data : String(res.data ?? '');
    return text.slice(-chars);
  } catch {
    return null; // not an Actions job, or logs expired
  }
}

export async function compareDiff(gh: Octokit, r: Repo, head: string, maxChars = 120_000): Promise<string> {
  const { data } = await gh.repos.compareCommitsWithBasehead({
    owner: r.owner,
    repo: r.repo,
    basehead: `${r.defaultBranch}...${head}`,
  });
  let out = '';
  for (const f of data.files ?? []) {
    out += `--- ${f.filename} (${f.status}, +${f.additions} -${f.deletions})\n${f.patch ?? '(binary or too large)'}\n\n`;
    if (out.length > maxChars) {
      out = out.slice(0, maxChars) + '\n[diff truncated]';
      break;
    }
  }
  return out;
}

export async function findOrOpenPullRequest(
  gh: Octokit,
  r: Repo,
  branch: string,
  title: string,
  body: string,
): Promise<{ number: number; url: string }> {
  const { data: open } = await gh.pulls.list({
    owner: r.owner,
    repo: r.repo,
    head: `${r.owner}:${branch}`,
    state: 'open',
  });
  if (open[0]) return { number: open[0].number, url: open[0].html_url };
  const { data } = await gh.pulls.create({
    owner: r.owner,
    repo: r.repo,
    head: branch,
    base: r.defaultBranch,
    title,
    body,
  });
  return { number: data.number, url: data.html_url };
}

export async function updatePullRequestBody(gh: Octokit, r: Repo, number: number, body: string) {
  await gh.pulls.update({ owner: r.owner, repo: r.repo, pull_number: number, body });
}

export async function mergePullRequest(gh: Octokit, r: Repo, number: number, title: string) {
  const { data } = await gh.pulls.merge({
    owner: r.owner,
    repo: r.repo,
    pull_number: number,
    merge_method: 'squash',
    commit_title: title,
  });
  return data.sha;
}

export async function closePullRequest(gh: Octokit, r: Repo, number: number, comment: string) {
  await gh.issues.createComment({ owner: r.owner, repo: r.repo, issue_number: number, body: comment });
  await gh.pulls.update({ owner: r.owner, repo: r.repo, pull_number: number, state: 'closed' });
}
