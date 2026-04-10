import axios from 'axios'

const API_BASE_URL = 'http://127.0.0.1:8000'
const API_TIMEOUT_MS = 90000

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT_MS,
})

function authConfig(token) {
  return token ? { headers: { Authorization: `Bearer ${token}` } } : {}
}

export async function login(payload) {
  const res = await api.post('/login', payload)
  return res.data
}

export async function signup(payload) {
  const res = await api.post('/signup', payload)
  return res.data
}

export async function gatherRequirements({ description, project_id, previous_questions = [], token }) {
  const normalizedPreviousQuestions = (Array.isArray(previous_questions) ? previous_questions : [])
    .map((item) => {
      if (typeof item === 'string') return item.trim()
      if (item && typeof item === 'object') return String(item.question || '').trim()
      return ''
    })
    .filter(Boolean)

  const res = await api.post(
    '/gather-requirements',
    { description, project_id, previous_questions: normalizedPreviousQuestions },
    authConfig(token)
  )
  return res.data
}

export async function submitRequirements({ project_id, answers, token }) {
  const res = await api.post(
    '/submit-requirements',
    { project_id, answers },
    authConfig(token)
  )
  return res.data
}

export async function generateTasks({ description, requirements, project_id, token }) {
  const res = await api.post(
    '/generate-tasks',
    { description, requirements, project_id },
    authConfig(token)
  )
  return res.data
}

export async function buildGraph({ project_id, tasks, dependencies, token }) {
  const res = await api.post(
    '/build-graph',
    { project_id, tasks, dependencies },
    authConfig(token)
  )
  return res.data
}

export async function analyzeWorkflow({ project_id, nodes, edges, token }) {
  const res = await api.post(
    '/analyze-workflow',
    { project_id, nodes, edges },
    authConfig(token)
  )
  return res.data
}

export async function listProjects({ token }) {
  const res = await api.get('/projects', authConfig(token))
  return res.data
}

export async function getProject({ project_id, token }) {
  const res = await api.get(`/projects/${project_id}`, authConfig(token))
  return res.data
}

export async function listOrders({ token }) {
  const res = await api.get('/orders', authConfig(token))
  return res.data
}

export async function createOrder({ token, order_number, delivery_provider, tracking_number, tracking_url, estimated_minutes }) {
  const res = await api.post(
    '/orders',
    { order_number, delivery_provider, tracking_number, tracking_url, estimated_minutes },
    authConfig(token)
  )
  return res.data
}

export async function getOrderTracking({ token, order_id }) {
  const res = await api.get(`/orders/${order_id}/tracking`, authConfig(token))
  return res.data
}

export async function updateOrderStatus({ token, order_id, status }) {
  const res = await api.post(
    `/orders/${order_id}/status`,
    { status },
    authConfig(token)
  )
  return res.data
}
