import 'server-only';
import type { Octokit } from '@octokit/rest';
import {
  branchSha,
  commitFiles,
  findOrOpenPullRequest,
  githubFor,
  listPaths,
  type Installation,
  type Repo,
} from './github';
import { serviceClient } from './supabase';

/**
 * AGENTSYNC.md: each project's description, kept in its repository and
 * versioned in AgentSync.
 *
 * - Import: read AGENTSYNC.md from the default branch; if there is none, copy
 *   the current description (README, else CLAUDE.md / AGENTS.md) into one and
 *   open a pull request adding it.
 * - Every change is a numbered version: who or which task made it, when, and
 *   the text. People edit it in the portal; an AgentSync task updates it in its
 *   own pull request when the change affects what the project does.
 * - Changes reach the repository only by pull request.
 */

export const DOC_PATH = 'AGENTSYNC.md';
export const DOC_BRANCH = 'agentsync/project-description';

type Context = {
  project: { id: string; name: string; tenant_id: string };
  repository: { github_owner: string; repository: string; default_branch: string | null } | null;
  github: Installation | null;
  document: { repo_state: string; pr_number: number | null; current_version: number } | null;
  current: string | null;
};

const db = () => serviceClient();

async function contextFor(projectId: string): Promise<Context> {
  const { data, error } = await db().rpc('agentsync_project_context', { p_project_id: projectId });
  if (error) throw error;
  if (!data) throw new Error('project not found');
  return data as Context;
}

function repoOf(ctx: Context): Repo | null {
  if (!ctx.repository) return null;
  return {
    owner: ctx.repository.github_owner,
    repo: ctx.repository.repository,
    defaultBranch: ctx.repository.default_branch || 'main',
  };
}

async function readWithSha(gh: Octokit, r: Repo, path: string, ref: string): Promise<{ text: string; sha: string } | null> {
  try {
    const { data } = await gh.repos.getContent({ owner: r.owner, repo: r.repo, path, ref });
    if (Array.isArray(data) || data.type !== 'file') return null;
    return { text: Buffer.from(data.content, 'base64').toString('utf8'), sha: data.sha };
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
}

async function addVersion(projectId: string, content: string, source: string, extra: {
  userId?: string | null; authorName?: string | null; taskId?: string | null; note?: string | null; commitSha?: string | null;
} = {}): Promise<{ version: number; created: boolean }> {
  const { data, error } = await db().rpc('agentsync_doc_add_version', {
    p_project_id: projectId,
    p_content: content,
    p_source: source,
    p_author_user_id: extra.userId ?? null,
    p_author_name: extra.authorName ?? null,
    p_task_id: extra.taskId ?? null,
    p_note: extra.note ?? null,
    p_repo_commit_sha: extra.commitSha ?? null,
  });
  if (error) throw error;
  const r = data as { ok: boolean; version: number; created: boolean; error?: string };
  if (!r.ok) throw new Error(r.error ?? 'could not save the version');
  return { version: r.version, created: r.created };
}

async function setRepo(projectId: string, fields: Record<string, unknown>) {
  const { error } = await db().rpc('agentsync_doc_set_repo', { p_project_id: projectId, p_fields: fields });
  if (error) throw error;
}

/** The project's current version: package.json, else its highest vX.Y.Z tag. */
async function detectVersion(gh: Octokit, r: Repo): Promise<string | null> {
  const pkg = await readWithSha(gh, r, 'package.json', r.defaultBranch).catch(() => null);
  if (pkg) {
    try {
      const v = (JSON.parse(pkg.text) as { version?: string }).version;
      if (v && /^\d+\.\d+\.\d+/.test(v)) return v.match(/^\d+\.\d+\.\d+/)![0];
    } catch {
      // not JSON
    }
  }
  const { data: tags } = await gh.repos.listTags({ owner: r.owner, repo: r.repo, per_page: 50 }).catch(() => ({ data: [] as { name: string }[] }));
  const versions = tags
    .map((t) => t.name.match(/^v?(\d+)\.(\d+)\.(\d+)$/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => [Number(m[1]), Number(m[2]), Number(m[3])])
    .sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2]);
  return versions[0] ? versions[0].join('.') : null;
}

const HEADER = '<!-- AGENTSYNC.md: what this project is and does. Versioned in AgentSync; changes arrive by pull request. -->';

/** The file a project starts with: its README copied in, or a short starter. */
function starter(name: string, from: { path: string; text: string } | null, description: string | null): string {
  if (from && from.text.trim()) {
    const body = from.text.trim();
    const titled = /^#\s/m.test(body.split('\n').find((l) => l.trim()) ?? '') ? body : `# ${name}\n\n${body}`;
    return `${HEADER}\n\n${titled}\n`;
  }
  return [
    HEADER,
    '',
    `# ${name}`,
    '',
    description?.trim() || '_What this project does, who uses it, and why._',
    '',
    '## Main parts',
    '',
    '_The main parts of the codebase and what each is for._',
    '',
    '## Running it',
    '',
    '_How to install, run and test it locally._',
    '',
  ].join('\n');
}

const DESCRIPTION_SOURCES = [/^readme\.md$/i, /^readme$/i, /^readme\.(markdown|txt|rst)$/i, /^docs\/readme\.md$/i, /^claude\.md$/i, /^agents\.md$/i];

/**
 * Puts the content on the description branch and opens (or updates) the pull
 * request. A branch left over from a merged or closed PR starts again from the
 * default branch.
 */
async function propose(gh: Octokit, r: Repo, projectId: string, content: string, message: string, prBody: string) {
  const { data: open } = await gh.pulls.list({ owner: r.owner, repo: r.repo, head: `${r.owner}:${DOC_BRANCH}`, state: 'open' });
  if (!open.length) {
    const base = await branchSha(gh, r, r.defaultBranch);
    if (!base) throw new Error(`default branch ${r.defaultBranch} not found`);
    const existing = await branchSha(gh, r, DOC_BRANCH);
    if (existing) {
      await gh.git.updateRef({ owner: r.owner, repo: r.repo, ref: `heads/${DOC_BRANCH}`, sha: base, force: true });
    }
  }
  await commitFiles(gh, r, DOC_BRANCH, message, [{ path: DOC_PATH, content }]);
  const pr = await findOrOpenPullRequest(gh, r, DOC_BRANCH, 'Update AGENTSYNC.md (project description)', prBody);
  await setRepo(projectId, { repo_state: 'pr_open', pr_number: pr.number, pr_url: pr.url });
  return pr;
}

const PR_BODY = [
  '`AGENTSYNC.md` describes what this project is and does. AgentSync keeps every version of it,',
  'and its agents read it before planning a change.',
  '',
  'Merging this puts the latest version in the repository. It is edited in AgentSync (Projects → Description)',
  'or here, and AgentSync updates it in its own pull requests when a change affects what the project does.',
].join('\n');

export type ImportResult = 'imported' | 'created' | 'pr_open' | 'no_repository' | 'failed';

/** First contact with a project's description. Safe to run again. */
export async function importProjectDoc(projectId: string): Promise<{ result: ImportResult; detail?: string }> {
  const ctx = await contextFor(projectId);
  const r = repoOf(ctx);
  if (!r || !ctx.github) return { result: 'no_repository' };
  if (ctx.document?.repo_state === 'pr_open') return { result: 'pr_open' };

  try {
    const gh = await githubFor(ctx.github, r);
    const version = await detectVersion(gh, r).catch(() => null);
    if (version) await setRepo(projectId, { release_version: version });

    const existing = await readWithSha(gh, r, DOC_PATH, r.defaultBranch);
    if (existing) {
      await addVersion(projectId, existing.text, 'repository', { authorName: 'Repository', note: 'Read from the repository' });
      await setRepo(projectId, { repo_state: 'in_sync', repo_blob_sha: existing.sha, pr_number: null, pr_url: null });
      return { result: 'imported' };
    }

    const paths = await listPaths(gh, r, r.defaultBranch);
    let from: { path: string; text: string } | null = null;
    for (const re of DESCRIPTION_SOURCES) {
      const hit = paths.find((p) => re.test(p));
      if (hit) {
        const f = await readWithSha(gh, r, hit, r.defaultBranch);
        if (f?.text.trim()) {
          from = { path: hit, text: f.text.slice(0, 150_000) };
          break;
        }
      }
    }
    const pkg = await readWithSha(gh, r, 'package.json', r.defaultBranch).catch(() => null);
    let pkgDescription: string | null = null;
    try {
      pkgDescription = pkg ? ((JSON.parse(pkg.text) as { description?: string }).description ?? null) : null;
    } catch {
      pkgDescription = null;
    }

    const content = starter(ctx.project.name, from, pkgDescription);
    await addVersion(projectId, content, 'import', {
      authorName: 'AgentSync',
      note: from ? `Copied from ${from.path}` : 'Starter written by AgentSync (no README found)',
    });
    await propose(gh, r, projectId, content, 'Add AGENTSYNC.md: project description',
      `${PR_BODY}\n\n${from ? `This first version is copied from \`${from.path}\`.` : 'The repository had no README, so this is a starter to fill in.'}`);
    return { result: 'created' };
  } catch (e) {
    return { result: 'failed', detail: (e as Error).message };
  }
}

/**
 * Brings AgentSync up to date with the repository: a merged PR, or an edit made
 * directly in the repo (recorded as its own version).
 */
export async function refreshProjectDoc(projectId: string): Promise<string> {
  const ctx = await contextFor(projectId);
  const r = repoOf(ctx);
  if (!r || !ctx.github) return 'no_repository';
  const gh = await githubFor(ctx.github, r);

  if (ctx.document?.repo_state === 'pr_open' && ctx.document.pr_number) {
    const { data: pr } = await gh.pulls.get({ owner: r.owner, repo: r.repo, pull_number: ctx.document.pr_number });
    if (pr.state === 'open') return 'pr_open';
  }

  const file = await readWithSha(gh, r, DOC_PATH, r.defaultBranch);
  if (!file) {
    await setRepo(projectId, { repo_state: 'missing', pr_number: null, pr_url: null });
    return 'missing';
  }
  if (ctx.current === null || file.text !== ctx.current) {
    // Merged as proposed matches the current version; anything else was edited in the repo.
    await addVersion(projectId, file.text, 'repository', { authorName: 'Repository', note: 'Edited in the repository' });
  }
  await setRepo(projectId, { repo_state: 'in_sync', repo_blob_sha: file.sha, pr_number: null, pr_url: null });
  return 'in_sync';
}

/** A person's edit, or a restore of an earlier version: a new version and a PR. */
export async function saveProjectDoc(projectId: string, content: string, by: {
  userId: string; source: 'person' | 'restore'; note?: string | null;
}): Promise<{ version: number; pr_url: string | null }> {
  const ctx = await contextFor(projectId);
  const { version, created } = await addVersion(projectId, content, by.source, { userId: by.userId, note: by.note ?? null });
  const r = repoOf(ctx);
  if (!created || !r || !ctx.github) return { version, pr_url: null };
  const gh = await githubFor(ctx.github, r);
  const pr = await propose(gh, r, projectId, content,
    by.source === 'restore' ? `Restore AGENTSYNC.md: ${by.note ?? 'earlier version'}` : `Update AGENTSYNC.md${by.note ? `: ${by.note}` : ''}`,
    PR_BODY);
  return { version, pr_url: pr.url };
}

/** Called after an AgentSync task merged a change that updated the description. */
export async function recordAgentDoc(projectId: string, content: string, taskId: string, commitSha: string, note: string) {
  await addVersion(projectId, content, 'agent', { authorName: 'AgentSync', taskId, commitSha, note });
  await setRepo(projectId, { repo_state: 'in_sync' });
}
