import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { signup } from '../utils/api'
import { useAppStore } from '../store/useAppStore'

export default function Signup() {
  const navigate = useNavigate()
  const setAuth = useAppStore((s) => s.setAuth)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (loading) return

    setLoading(true)
    setError('')
    try {
      const data = await signup({ email: email.trim(), password })
      setAuth({ user: data.user, token: data.token })
      navigate('/')
    } catch (err) {
      setError(err?.response?.data?.detail || 'Signup failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card card">
        <p className="auth-eyebrow">Authentication</p>
        <h1 className="auth-title">Sign up</h1>
        <form onSubmit={handleSubmit} className="auth-form">
          <div className="field-group">
            <label>Email</label>
            <input className="auth-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div className="field-group">
            <label>Password</label>
            <input className="auth-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Create a secure password" />
          </div>
          {error ? <p className="auth-error">{error}</p> : null}
          <button className="auth-button" disabled={loading}>{loading ? 'Please wait...' : 'Create account'}</button>
        </form>
        <p className="auth-footer">Already have an account? <Link to="/login">Login</Link></p>
      </div>
    </div>
  )
}
