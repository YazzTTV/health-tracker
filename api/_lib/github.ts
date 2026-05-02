import fs from 'node:fs/promises'
import path from 'node:path'

type GithubContentResponse = { content: string; sha: string; encoding: string }
const dataDir = path.join(process.cwd(), 'data')
const owner = process.env.GITHUB_OWNER
const repo = process.env.GITHUB_REPO
const branch = process.env.GITHUB_BRANCH ?? 'main'
const token = process.env.GITHUB_TOKEN
const githubDataDir = process.env.GITHUB_DATA_DIR ?? 'data'

function hasGithubConfig() {
  return Boolean(owner && repo && token)
}

function githubHeaders() {
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
}

function githubContentPath(filePath: string) {
  return encodeURI(`${githubDataDir}/${filePath}`)
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  if (!hasGithubConfig()) {
    const raw = await fs.readFile(path.join(dataDir, filePath), 'utf-8')
    return JSON.parse(raw) as T
  }
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${githubContentPath(filePath)}?ref=${branch}`, { headers: githubHeaders() })
  if (!response.ok) throw new Error(`GitHub read failed for ${filePath}: ${response.status}`)
  const payload = await response.json() as GithubContentResponse
  const decoded = Buffer.from(payload.content, payload.encoding as BufferEncoding).toString('utf-8')
  return JSON.parse(decoded) as T
}

export async function writeJsonFile(filePath: string, data: unknown, message: string) {
  const content = JSON.stringify(data, null, 2) + '\n'
  if (!hasGithubConfig()) {
    if (process.env.ALLOW_LOCAL_WRITES === 'true') {
      await fs.writeFile(path.join(dataDir, filePath), content, 'utf-8')
      return { mode: 'local', message }
    }
    throw new Error('GitHub sync is not configured. Set GITHUB_TOKEN, GITHUB_OWNER and GITHUB_REPO.')
  }
  const current = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${githubContentPath(filePath)}?ref=${branch}`, { headers: githubHeaders() })
  const currentPayload = current.ok ? await current.json() as GithubContentResponse : undefined
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${githubContentPath(filePath)}`, {
    method: 'PUT',
    headers: { ...githubHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: Buffer.from(content).toString('base64'), branch, sha: currentPayload?.sha }),
  })
  if (!response.ok) throw new Error(`GitHub write failed for ${filePath}: ${response.status} ${await response.text()}`)
  return response.json()
}

export async function listLocalMealPlans() {
  const files = await fs.readdir(dataDir)
  return files.filter((file) => file.startsWith('MEAL_PLAN_WEEK') && file.endsWith('.json'))
}
