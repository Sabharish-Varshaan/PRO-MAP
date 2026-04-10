import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, errorMessage: '' }
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: error?.message || 'Unexpected dashboard error',
    }
  }

  componentDidCatch(error, errorInfo) {
    console.error('Dashboard ErrorBoundary caught:', { error, errorInfo })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="card" style={{ margin: 24 }}>
          <p className="section-kicker">Dashboard Error</p>
          <h2 className="section-title">Something went wrong</h2>
          <p className="section-subtitle">{this.state.errorMessage}</p>
        </div>
      )
    }

    return this.props.children
  }
}
