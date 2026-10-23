import type { Finding } from '../lib/bus-diagnosis';
import { StatusIcon } from './StatusIcon';

/** "What is wrong and what to do next", derived from the boards' own reports. */
export function BusDiagnosis({ findings }: { findings: Finding[] }) {
  return (
    <section className="card diagnosis" aria-labelledby="diagnosis-title" data-testid="bus-diagnosis">
      <h2 id="diagnosis-title">CAN link check</h2>
      <ul className="finding-list">
        {findings.map((f) => (
          <li key={f.id} className={`finding finding-${f.tone}`} data-testid={`finding-${f.id}`}>
            <StatusIcon tone={f.tone} />
            <div>
              <p className="finding-title">{f.title}</p>
              <p className="finding-detail">{f.detail}</p>
              {f.steps.length > 0 && (
                <ol className="finding-steps">
                  {f.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
