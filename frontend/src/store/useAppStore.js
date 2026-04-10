import { create } from 'zustand'

const TOKEN_KEY = 'token'

function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY) || localStorage.getItem('promap_auth_token') || ''
}

function persistToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token)
    return
  }
  localStorage.removeItem(TOKEN_KEY)
}

export const useAppStore = create((set) => ({
  user: null,
  token: getStoredToken(),
  project_id: null,
  projectName: '',
  idea: '',
  questions: [],
  answers: {},
  workflow: null,
  loadingMessage: '',
  selectedNode: null,
  setAuth: ({ user, token }) => {
    persistToken(token)
    set({ user, token })
  },
  logout: () => {
    persistToken('')
    set({
      user: null,
      token: '',
      project_id: null,
      projectName: '',
      idea: '',
      questions: [],
      answers: {},
      workflow: null,
      loadingMessage: '',
      selectedNode: null,
    })
  },
  setProjectName: (projectName) => set({ projectName }),
  setIdea: (idea) => set({ idea }),
  setProjectId: (project_id) => set({ project_id }),
  setQuestions: (questions) => set({ questions }),
  setAnswers: (answers) => set({ answers }),
  updateAnswer: (question, value) =>
    set((state) => ({ answers: { ...state.answers, [question]: value } })),
  setWorkflow: (workflow) => set({ workflow }),
  setLoadingMessage: (loadingMessage) => set({ loadingMessage }),
  setSelectedNode: (selectedNode) => set({ selectedNode }),
  resetFlow: () =>
    set({
      project_id: null,
      projectName: '',
      idea: '',
      questions: [],
      answers: {},
      workflow: null,
      loadingMessage: '',
      selectedNode: null,
    }),
}))
