import { TIME_RANGES, type FrameFilter, type TimeRange } from '../lib/filters';

interface Props {
  filter: FrameFilter;
  nodes: string[];
  onChange: (filter: FrameFilter) => void;
}

export function FrameFilters({ filter, nodes, onChange }: Props) {
  return (
    <div className="filters" role="search" aria-label="Frame filters">
      <label>
        CAN ID
        <input
          type="text"
          placeholder="e.g. 0x201"
          value={filter.canId}
          onChange={(e) => onChange({ ...filter, canId: e.target.value })}
        />
      </label>
      <label>
        Node
        <select value={filter.node} onChange={(e) => onChange({ ...filter, node: e.target.value })}>
          <option value="all">All nodes</option>
          {nodes.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label>
        Time range
        <select
          value={filter.timeRange}
          onChange={(e) => onChange({ ...filter, timeRange: e.target.value as TimeRange })}
        >
          {Object.entries(TIME_RANGES).map(([key, r]) => (
            <option key={key} value={key}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
