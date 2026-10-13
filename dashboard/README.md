# CANScope dashboard

A read-only monitoring dashboard built with Vite, React 19 and TypeScript. Today it runs only on **mock data generated in the browser**, and an amber "MOCK DATA" badge and banner stay visible the whole time.

```sh
npm install
npm run dev          # http://localhost:5173
npm run typecheck
npm run lint
npm test             # Vitest + Testing Library (jsdom)
npm run build        # outputs to dist/
npm run check        # all of the above
```

## Mock scenarios

Choose one with the header picker, or with `?scenario=`:

| Scenario | Shows |
|---|---|
| `normal` | Frames captured by `monitor` and `node1`. Node 3 reports status only, with an UNVERIFIED config and CAN not running |
| `empty` | Connected, status only, no frames |
| `stale` | Frames stop after about 2 s while the link stays open, so the stale banner appears after 3 s |
| `disconnected` | Link drops after about 2 s |
| `error` | Connection error |
| `bus_off` | The bus goes to BUS-OFF after a few seconds |

Mock IDs 0x201–0x210 replay the constants in `sketch_node2_test.ino` and show as **unverified**. 0x7A0 and 0x18FEF100 are EXAMPLE IDs and show as **unknown**.

## Structure

- `src/types/events.ts`: event model (the frame and status shapes that mirror the firmware JSON lines)
- `src/lib/data-source.ts`: the transport-neutral `CanDataSource` interface. It has no send method.
- `src/lib/serial-line-parser.ts`: parses firmware serial lines, for a future live adapter
- `src/lib/protocol-registry.ts`, `decoder.ts`: copy of `docs/protocol/can-id-registry.md`, plus the decoder
- `src/lib/dashboard-state.ts`, `filters.ts`, `use-can-scope.ts`: state, derived views, filtering
- `src/mock-data/mock-source.ts`: the mock source
- `src/components/`, `src/pages/DashboardPage.tsx`: UI
- `tests/`: unit and rendering tests

## Adding a live source

Implement `CanDataSource` (for example a WebSocket client fed by a serial bridge that calls `parseSerialLine()`), then select it in `src/App.tsx`. Live events must use `origin: 'live'`. See `../docs/architecture.md`.

## Out of scope

No CAN transmission, commands, actuator or relay control, or hidden background requests. See `../docs/architecture.md#out-of-scope`.
