export default function ExtensionsPanel(): JSX.Element {
  return (
    <>
      <div className="sidebar-header">
        <span>Extensions</span>
      </div>
      <div style={{ padding: '0 12px 8px' }}>
        <input
          disabled
          placeholder="Search Extensions in Marketplace"
          style={{
            width: '100%',
            background: 'var(--bg-input)',
            color: 'var(--text-muted)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '6px 8px'
          }}
        />
      </div>
      <div className="empty-state">
        LLMRaki doesn't support a VS Code-compatible extension host, so there's no marketplace
        here. The built-in AI Chat, Search, Source Control, and Run panels cover the most common
        extension use cases.
      </div>
    </>
  )
}
