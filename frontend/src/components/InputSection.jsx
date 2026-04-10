import { useState } from 'react'
import axios from 'axios'

const API_BASE_URL = 'http://127.0.0.1:8001'

export default function InputSection() {
  const [projectTitle, setProjectTitle] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [requirementsData, setRequirementsData] = useState(null)

  async function handleGenerateRequirements() {
    const title = projectTitle.trim()
    if (!title || isLoading) return

    setIsLoading(true)
    try {
      const response = await axios.post(`${API_BASE_URL}/gather-requirements`, {
        project_title: title,
      })

      console.log('[gather-requirements] response:', response.data)
      setRequirementsData(response.data)
    } catch (error) {
      console.error('[gather-requirements] request failed:', {
        message: error?.message,
        code: error?.code,
        status: error?.response?.status,
        data: error?.response?.data,
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <section>
      <input
        type="text"
        value={projectTitle}
        onChange={(e) => setProjectTitle(e.target.value)}
        placeholder="Enter project title"
      />

      <button onClick={handleGenerateRequirements} disabled={isLoading}>
        {isLoading ? 'Generating...' : 'Generate Requirements'}
      </button>

      {requirementsData ? (
        <pre>{JSON.stringify(requirementsData, null, 2)}</pre>
      ) : null}
    </section>
  )
}
