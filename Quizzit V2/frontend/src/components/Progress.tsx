export function Progress({ value, message }: { value: number; message: string }) {
  return (
    <div className="progress-panel">
      <div className="progress-label"><span>{message}</span><strong>{Math.round(value)}%</strong></div>
      <div className="progress-track"><div className="progress-fill" style={{ width: `${value}%` }} /></div>
    </div>
  );
}
